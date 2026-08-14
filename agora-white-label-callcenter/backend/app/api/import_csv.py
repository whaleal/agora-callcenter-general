import asyncio
import csv
import io
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import boto3
import httpx
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_db
from app.models.campaign_v2 import CampaignV2
from app.models.calls_v2 import CallV2

router = APIRouter(prefix='/api/import', tags=['import'])

# ─── shared migration state ────────────────────────────────────────────────────
_mig: dict = {
    'status': 'idle',   # idle | running | done | error | stopped
    'total': 0,
    'done': 0,
    'failed': 0,
    'errors': [],
    'current_call_id': '',
    'log': [],          # per-item log lines, max 500
}
_mig_stop = False


# ─── helpers ───────────────────────────────────────────────────────────────────

def _parse_ts_ms(value: str) -> int | None:
    v = value.strip()
    if not v:
        return None
    try:
        return int(datetime.fromisoformat(v.replace('Z', '+00:00')).timestamp() * 1000)
    except Exception:
        return None


def _safe_int(value: str) -> int | None:
    try:
        return int(float(value.strip()))
    except Exception:
        return None


def _s3_upload(s3_client, bucket: str, key: str, audio_bytes: bytes, content_type: str):
    s3_client.upload_fileobj(
        io.BytesIO(audio_bytes),
        bucket,
        key,
        ExtraArgs={'ContentType': content_type},
    )


# ─── CSV import ────────────────────────────────────────────────────────────────

@router.post('/campaign-csv')
async def import_campaign_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    for enc in ('utf-8-sig', 'utf-8', 'gbk'):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise HTTPException(status_code=400, detail='Cannot decode CSV — please save as UTF-8')

    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return {'campaigns_created': 0, 'calls_created': 0, 'calls_skipped': 0}

    # Group rows by campaign — collect stats needed to fill CampaignV2 fields
    campaigns_in_csv: dict[str, dict] = {}
    for row in rows:
        cid = row.get('Campaign ID', '').strip()
        if not cid:
            continue
        call_start = row.get('Call Start Time', '').strip()
        if cid not in campaigns_in_csv:
            campaigns_in_csv[cid] = {
                'campaign_id': cid,
                'campaign_name': row.get('Campaign Name', '').strip() or cid,
                'agent_id': row.get('Agent ID', '').strip() or None,
                'agent_name': row.get('Agent Name', '').strip() or None,
                'phone_number': row.get('From Number', '').strip() or None,
                'call_start_times': [],
                'row_count': 0,
            }
        campaigns_in_csv[cid]['row_count'] += 1
        if call_start:
            campaigns_in_csv[cid]['call_start_times'].append(call_start)

    campaigns_created = 0
    now_str = datetime.now(timezone.utc).isoformat()

    for cid, cdata in campaigns_in_csv.items():
        existing = (await db.execute(
            select(CampaignV2).where(CampaignV2.campaign_id == cid)
        )).scalar_one_or_none()
        if not existing:
            sorted_times = sorted(cdata['call_start_times'])
            created_at = sorted_times[0] if sorted_times else now_str
            updated_at = sorted_times[-1] if sorted_times else now_str
            db.add(CampaignV2(
                campaign_id=cdata['campaign_id'],
                campaign_name=cdata['campaign_name'],
                app_id=settings.agora_project_id,
                agent_id=cdata['agent_id'],
                agent_name=cdata['agent_name'],
                phone_number=cdata['phone_number'],
                total_numbers=cdata['row_count'],
                status='completed',
                enable_transcript=True,
                enable_recording=True,
                end_call_on_silence_timeout=True,
                end_call_on_user_request=True,
                end_call_on_ai_assistant=True,
                is_imported=True,
                imported_at=now_str,
                created_at=created_at,
                updated_at=updated_at,
            ))
            campaigns_created += 1

    await db.flush()

    calls_created = 0
    calls_skipped = 0

    for row in rows:
        call_id = row.get('Call ID', '').strip()
        if not call_id:
            calls_skipped += 1
            continue

        existing_call = (await db.execute(
            select(CallV2).where(CallV2.call_id == call_id)
        )).scalar_one_or_none()
        if existing_call:
            calls_skipped += 1
            continue

        record_url = row.get('Audio Record File Download URL', '').strip() or None
        structured_output_raw = row.get('Structured Output', '').strip() or None
        # Dashboard checks structured_output_status == 'completed' to enable the SO button
        structured_output_status = 'completed' if structured_output_raw else None
        # Dashboard displays start_ts for "Call Start Time"; set both to the same value
        call_ts_ms = _parse_ts_ms(row.get('Call Start Time', ''))
        db.add(CallV2(
            call_id=call_id,
            campaign_id=row.get('Campaign ID', '').strip(),
            agent_id=row.get('Agent ID', '').strip() or None,
            agent_session_id=row.get('Agent ID', '').strip() or None,
            agent_name=row.get('Agent Name', '').strip() or None,
            from_number=row.get('From Number', '').strip() or None,
            to_number=row.get('To Number', '').strip() or None,
            call_category=row.get('Call Category', '').strip() or None,
            hangup_reason=row.get('Hangup Reason', '').strip() or None,
            duration_seconds=_safe_int(row.get('Duration (seconds)', '')),
            call_ts=call_ts_ms,
            start_ts=call_ts_ms,
            answered_ts=_parse_ts_ms(row.get('Answered Time', '')),
            channel_name=row.get('Channel', '').strip() or None,
            transcript=row.get('Transcript', '').strip() or None,
            record_file_url=record_url,
            original_record_url=record_url,
            structured_output=structured_output_raw,
            structured_output_status=structured_output_status,
            quota_checked=False,
            is_imported=True,
        ))
        calls_created += 1

    await db.commit()
    return {'campaigns_created': campaigns_created, 'calls_created': calls_created, 'calls_skipped': calls_skipped}


# ─── delete imported campaign ─────────────────────────────────────────────────

@router.delete('/campaign/{campaign_id}')
async def delete_imported_campaign(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
):
    campaign = (await db.execute(
        select(CampaignV2).where(CampaignV2.campaign_id == campaign_id)
    )).scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail='Campaign not found')
    if not campaign.is_imported:
        raise HTTPException(status_code=403, detail='Only imported campaigns can be deleted here')

    calls_deleted = (await db.execute(
        delete(CallV2).where(CallV2.campaign_id == campaign_id)
    )).rowcount
    await db.execute(delete(CampaignV2).where(CampaignV2.campaign_id == campaign_id))
    await db.commit()

    return {'deleted': True, 'calls_deleted': calls_deleted}


# ─── audio migration ───────────────────────────────────────────────────────────

async def _run_migration():
    global _mig, _mig_stop
    bucket  = settings.aws_s3_bucket
    region  = settings.aws_s3_region
    prefix  = settings.aws_s3_prefix.rstrip('/')

    s3_client = boto3.client(
        's3',
        region_name=region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
    )

    # Fetch ALL calls whose record_file_url is still a http(s) URL (not yet migrated to s3://)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(CallV2).where(
                CallV2.record_file_url.isnot(None),
                CallV2.record_file_url.like('http%'),
            )
        )
        # Use original_record_url when available (CSV imports), else fall back to record_file_url
        call_rows = [
            (c.call_id, c.original_record_url or c.record_file_url)
            for c in result.scalars().all()
        ]

    _mig['total'] = len(call_rows)
    _mig['done']  = 0
    _mig['failed'] = 0
    _mig['errors'] = []
    _mig['log']   = [f'[開始] 共找到 {len(call_rows)} 個待 migrate 的錄音']

    def _log(line: str):
        _mig['log'].append(line)
        if len(_mig['log']) > 500:
            _mig['log'] = _mig['log'][-500:]

    loop = asyncio.get_event_loop()

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as http:
        for call_id, url in call_rows:
            if _mig_stop:
                _mig['status'] = 'stopped'
                _mig['current_call_id'] = ''
                _log(f'[停止] 已手動停止，已完成 {_mig["done"]}，失敗 {_mig["failed"]}')
                return
            _mig['current_call_id'] = call_id
            try:
                ext = Path(urllib.parse.urlparse(url).path).suffix or '.wav'
                key    = f'{prefix}/{call_id}{ext}'
                s3_uri = f's3://{bucket}/{key}'

                resp = await http.get(url)
                resp.raise_for_status()
                audio_bytes  = resp.content
                content_type = resp.headers.get('content-type', 'audio/wav')

                # boto3 is sync — run in default thread pool
                await loop.run_in_executor(
                    None, _s3_upload, s3_client, bucket, key, audio_bytes, content_type
                )

                async with AsyncSessionLocal() as session:
                    await session.execute(
                        update(CallV2)
                        .where(CallV2.call_id == call_id)
                        .values(record_file_url=s3_uri)
                    )
                    await session.commit()

                _mig['done'] += 1
                size_kb = len(audio_bytes) / 1024
                _log(f'[OK] {call_id}  →  {key}  ({size_kb:.1f} KB)')

            except Exception as exc:
                _mig['failed'] += 1
                _mig['errors'].append(f'{call_id}: {exc}')
                _log(f'[ERROR] {call_id}: {exc}')

    _mig['status']         = 'done'
    _mig['current_call_id'] = ''
    _log(f'[完成] 全部處理完畢：成功 {_mig["done"]}，失敗 {_mig["failed"]}')


@router.post('/migrate-audio/start')
async def start_audio_migration():
    global _mig_stop
    if _mig['status'] == 'running':
        return _mig
    _mig_stop = False
    _mig['status']         = 'running'
    _mig['current_call_id'] = ''
    asyncio.create_task(_run_migration())
    return _mig


@router.post('/migrate-audio/stop')
async def stop_audio_migration():
    global _mig_stop
    if _mig['status'] != 'running':
        return _mig
    _mig_stop = True
    return {**_mig, 'status': 'stopping'}


@router.get('/migrate-audio/status')
async def get_migration_status(db: AsyncSession = Depends(get_db)):
    # When not running, also return the pending count so the UI can always show progress
    if _mig['status'] != 'running':
        from sqlalchemy import func as sa_func
        result = await db.execute(
            select(sa_func.count()).select_from(CallV2).where(
                CallV2.record_file_url.isnot(None),
                CallV2.record_file_url.like('http%'),
            )
        )
        pending = result.scalar() or 0
        return {**_mig, 'pending': pending}
    return {**_mig, 'pending': 0}


# ─── presign ───────────────────────────────────────────────────────────────────

@router.post('/audio-presign')
async def presign_audio(body: dict):
    s3_uri: str = body.get('s3_uri', '')
    if not s3_uri.startswith('s3://'):
        raise HTTPException(status_code=400, detail='Expected s3:// URI')
    parts = s3_uri[5:].split('/', 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail='Malformed s3:// URI')

    bucket, key = parts
    try:
        s3 = boto3.client(
            's3',
            region_name=settings.aws_s3_region,
            aws_access_key_id=settings.aws_access_key_id or None,
            aws_secret_access_key=settings.aws_secret_access_key or None,
        )
        url = s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=3600,
        )
        return {'url': url}
    except (BotoCoreError, ClientError) as e:
        raise HTTPException(status_code=500, detail=str(e))
