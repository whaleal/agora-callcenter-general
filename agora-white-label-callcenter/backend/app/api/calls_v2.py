import asyncio
import json

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.calls_v2 import CallV2
from app.models.calls_v2_sync_state import CallV2SyncState
from app.models.campaign_v2 import CampaignV2


router = APIRouter(prefix='/api/calls-v2', tags=['calls-v2'])

CALLS_BASE_URL = f'{settings.agora_conversational_base_url}/calls'

STRUCTURED_OUTPUT_TERMINAL = frozenset({'completed', 'failed', 'disabled'})

ANSWERED_CATEGORIES = (
    'ai_assistant',
    'customer_answered',
    'human_answered',
    'outbound_transferred_success',
)
FAILED_CATEGORIES = ('failed', 'outbound_transferred_failed')

# call_category in this set: has_structured_output is always false for API clients
CLIENT_STRUCTURED_OUTPUT_EXCLUDED_CALL_CATEGORIES = frozenset(
    (*FAILED_CATEGORIES, 'no_answer', 'voicemail'),
)


def _norm_structured_output_status(status: str | None) -> str:
    return (status or '').strip().lower()


def structured_output_terminal(status: str | None) -> bool:
    return _norm_structured_output_status(status) in STRUCTURED_OUTPUT_TERMINAL


def transcript_has_usable_content(transcript_json: str | None) -> bool:
    """True when transcript JSON contains at least one non-empty message (not just \"[]\")."""
    if not transcript_json or not str(transcript_json).strip():
        return False
    try:
        data = json.loads(transcript_json)
    except Exception:
        return True
    if not isinstance(data, list):
        return bool(data)
    for m in data:
        if not isinstance(m, dict):
            if m is not None and str(m).strip():
                return True
            continue
        text = m.get('content')
        if text is None:
            text = m.get('text')
        if str(text or '').strip():
            return True
    return False


def has_structured_output_for_client(
    structured_output_status: str | None,
    call_category: str | None = None,
) -> bool:
    """True only when upstream SO is completed and call outcome allows showing SO (not failed / no_answer / voicemail)."""
    cat = (call_category or '').strip().lower()
    if cat in CLIENT_STRUCTURED_OUTPUT_EXCLUDED_CALL_CATEGORIES:
        return False
    return _norm_structured_output_status(structured_output_status) == 'completed'


def structured_output_json_for_storage(
    call_category: str | None,
    structured_output_status: str | None,
    structured: object | None,
) -> str | None:
    """
    JSON text for calls_v2.structured_output, or None to leave the column unchanged on upsert.

    - Excluded dial outcomes (failed / no_answer / voicemail, etc.): always store [].
    - SO terminal non-success (failed, disabled): store [] so we do not keep placeholder JSON.
    - completed: store upstream payload (default []).
    - scheduled / evaluating / empty status: store only when structured is a non-empty list.
    """
    cat = (call_category or '').strip().lower()
    if cat in CLIENT_STRUCTURED_OUTPUT_EXCLUDED_CALL_CATEGORIES:
        return json.dumps([], ensure_ascii=False)
    st = _norm_structured_output_status(structured_output_status)
    if st == 'completed':
        if structured is None:
            return json.dumps([], ensure_ascii=False)
        return json.dumps(structured, ensure_ascii=False)
    if st in ('failed', 'disabled'):
        return json.dumps([], ensure_ascii=False)
    if isinstance(structured, list) and len(structured) > 0:
        return json.dumps(structured, ensure_ascii=False)
    return None


def _headers() -> dict:
    return {
        'Authorization': f'Basic {settings.agora_conversational_api_key}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }


def _serialize(row: CallV2) -> dict:
    def _loads(s: str | None):
        if not s:
            return None
        try:
            return json.loads(s)
        except Exception:
            return None

    show_so = has_structured_output_for_client(
        row.structured_output_status,
        row.call_category,
    )
    raw_so = _loads(row.structured_output)
    structured_output_api = None if not show_so else (raw_so if raw_so is not None else [])

    return {
        'sip_call_id': row.sip_call_id,
        'call_id': row.call_id,
        'campaign_id': row.campaign_id,
        'agent_id': row.agent_id,
        'agent_session_id': row.agent_session_id,
        'agent_name': row.agent_name,
        'from_number': row.from_number,
        'to_number': row.to_number,
        'call_category': row.call_category,
        'hangup_reason': row.hangup_reason,
        'duration_seconds': row.duration_seconds,
        'answered_ts': row.answered_ts,
        'call_ts': row.call_ts,
        'start_ts': row.start_ts,
        'end_ts': row.end_ts,
        'channel_name': row.channel_name,
        'structured_output_status': row.structured_output_status,
        'has_structured_output': show_so,
        'transcript': _loads(row.transcript) or [],
        'record_file_url': row.record_file_url,
        'structured_output': structured_output_api,
    }

def _serialize_light(row: CallV2) -> dict:
    # Extract call_success from structured_output JSON without full parse overhead
    call_success = None
    if row.structured_output:
        try:
            so = json.loads(row.structured_output)
            if isinstance(so, dict):
                call_success = so.get('call_success')
            elif isinstance(so, list) and so and isinstance(so[0], dict):
                call_success = so[0].get('call_success')
        except Exception:
            pass

    return {
        'sip_call_id': row.sip_call_id,
        'call_id': row.call_id,
        'campaign_id': row.campaign_id,
        'agent_id': row.agent_id,
        'agent_session_id': row.agent_session_id,
        'agent_name': row.agent_name,
        'from_number': row.from_number,
        'to_number': row.to_number,
        'call_category': row.call_category,
        'hangup_reason': row.hangup_reason,
        'duration_seconds': row.duration_seconds,
        'answered_ts': row.answered_ts,
        'call_ts': row.call_ts,
        'start_ts': row.start_ts,
        'end_ts': row.end_ts,
        'channel_name': row.channel_name,
        'structured_output_status': row.structured_output_status,
        'record_file_url': row.record_file_url,
        'has_transcript': transcript_has_usable_content(row.transcript),
        'has_structured_output': has_structured_output_for_client(
            row.structured_output_status,
            row.call_category,
        ),
        'call_success': call_success,
    }


async def _fetch_all_calls(campaign_id: str) -> list[dict]:
    return await _fetch_incremental_calls(campaign_id, None)


async def _fetch_call_detail(client: httpx.AsyncClient, call_id: str) -> dict | None:
    try:
        resp = await client.get(f'{CALLS_BASE_URL}/{call_id}', headers=_headers())
        if resp.status_code != 200:
            return None
        body = resp.json()
        code = body.get('code') if 'code' in body else body.get('reason')
        if code not in (0, '0'):
            return None
        return body.get('data') or None
    except Exception:
        return None


def _merge_upstream_detail_into_row(row: CallV2, d: dict) -> None:
    row.transcript = json.dumps(d.get('transcript') or [], ensure_ascii=False)
    if not (row.record_file_url and row.record_file_url.startswith('s3://')):
        row.record_file_url = d.get('record_file_url') or None
    if d.get('from_number') and not row.from_number:
        row.from_number = str(d['from_number']).strip() or None
    if d.get('call_category'):
        row.call_category = str(d['call_category']).strip() or None
    if d.get('hangup_reason'):
        row.hangup_reason = str(d['hangup_reason']).strip() or None
    if d.get('duration_seconds') is not None:
        row.duration_seconds = d['duration_seconds']
    if 'structured_output' in d or 'structured_output_status' in d:
        so = d.get('structured_output') if 'structured_output' in d else None
        fj = structured_output_json_for_storage(
            row.call_category,
            d.get('structured_output_status'),
            so,
        )
        if fj is not None:
            row.structured_output = fj
    raw = d.get('structured_output_status')
    if raw is not None:
        s = str(raw).strip()
        row.structured_output_status = s if s else None


async def merge_upstream_call_details(db: AsyncSession, call_ids: list[str]) -> int:
    """GET v3/calls/{call_id} for each id; merge transcript, recording, structured_output, status."""
    if not call_ids:
        return 0
    call_ids = list(dict.fromkeys(call_ids))
    sem = asyncio.Semaphore(6)
    async with httpx.AsyncClient(timeout=20) as client:
        async def _one(cid2: str):
            async with sem:
                return cid2, await _fetch_call_detail(client, cid2)

        results = await asyncio.gather(*[_one(cid2) for cid2 in call_ids])

    affected_ids = [cid2 for cid2, d in results if d]
    if not affected_ids:
        return 0
    rows_result = await db.execute(select(CallV2).where(CallV2.call_id.in_(affected_ids)))
    rows_map = {r.call_id: r for r in rows_result.scalars().all()}
    n = 0
    for cid2, d in results:
        if not d:
            continue
        row = rows_map.get(cid2)
        if not row:
            continue
        _merge_upstream_detail_into_row(row, d)
        n += 1
    await db.commit()
    if rows_map:
        from app.services.call_usage import upsert_call_usage
        await upsert_call_usage(db, list(rows_map.values()))
    return n


def _to_seconds(ts: int) -> int:
    """Normalize a Unix timestamp to seconds — Agora API uses seconds for from_time."""
    return ts // 1000 if ts > 9_999_999_999 else ts


async def _fetch_incremental_calls(campaign_id: str, from_time: int | None) -> list[dict]:
    items: list[dict] = []
    cursor = ''

    async with httpx.AsyncClient(timeout=20) as client:
        while True:
            params: dict = {
                'campaign_ids': campaign_id,
                'limit': 50,
            }
            if from_time is not None:
                params['from_time'] = _to_seconds(from_time)
            if cursor:
                params['cursor'] = cursor
            resp = await client.get(CALLS_BASE_URL, params=params, headers=_headers())
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            body = resp.json()
            code = body.get('code') if 'code' in body else body.get('reason')
            if code not in (0, '0'):
                raise HTTPException(status_code=400, detail=body.get('message', body.get('detail', 'Calls API error')))

            data = body.get('data') or {}
            lst = data.get('list') or []
            page_items = lst if isinstance(lst, list) else []

            items.extend(page_items)

            cursor = data.get('next_cursor') or ''
            if not cursor:
                break

    return items


def _call_category_filter_expr(category: str):
    c = (category or 'all').strip().lower()
    if c in ('', 'all'):
        return None
    if c == 'answered':
        return CallV2.call_category.in_(ANSWERED_CATEGORIES)
    if c == 'voicemail':
        return CallV2.call_category == 'voicemail'
    if c == 'no_answer':
        return CallV2.call_category == 'no_answer'
    if c == 'failed':
        return CallV2.call_category.in_(FAILED_CATEGORIES)
    raise HTTPException(
        status_code=400,
        detail='Invalid category. Use: all, answered, voicemail, no_answer, failed',
    )


def _list_order_clauses(sort: str):
    s = (sort or 'time_desc').strip().lower()
    if s == 'time_desc':
        ts = func.coalesce(CallV2.end_ts, CallV2.call_ts)
        return [ts.desc().nullslast(), CallV2.id.desc()]
    if s == 'duration_asc':
        return [CallV2.duration_seconds.asc().nulls_last(), CallV2.id.asc()]
    if s == 'duration_desc':
        return [CallV2.duration_seconds.desc().nulls_last(), CallV2.id.desc()]
    raise HTTPException(
        status_code=400,
        detail='Invalid sort. Use: time_desc, duration_asc, duration_desc',
    )


def _campaign_stats_select(campaign_id: str):
    return select(
        func.count(CallV2.id).label('total_dialed'),
        func.coalesce(
            func.sum(case((CallV2.call_category.in_(ANSWERED_CATEGORIES), 1), else_=0)),
            0,
        ).label('answered'),
        func.coalesce(
            func.sum(case((CallV2.call_category == 'voicemail', 1), else_=0)),
            0,
        ).label('voicemail'),
        func.coalesce(
            func.sum(case((CallV2.call_category == 'no_answer', 1), else_=0)),
            0,
        ).label('no_answer'),
        func.coalesce(
            func.sum(case((CallV2.call_category.in_(FAILED_CATEGORIES), 1), else_=0)),
            0,
        ).label('failed'),
        func.coalesce(
            func.sum(func.coalesce(CallV2.duration_seconds, 0)),
            0,
        ).label('total_duration_seconds'),
    ).where(CallV2.campaign_id == campaign_id)


def _stats_row_to_payload(campaign_id: str, row) -> dict:
    return {
        'campaign_id': campaign_id,
        'total_dialed': int(row.total_dialed or 0),
        'answered': int(row.answered or 0),
        'voicemail': int(row.voicemail or 0),
        'no_answer': int(row.no_answer or 0),
        'failed': int(row.failed or 0),
        'total_duration_seconds': int(row.total_duration_seconds or 0),
    }


@router.get('/', summary='List all calls across all campaigns')
async def list_all_calls(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    offset = (page - 1) * page_size
    total = int((await db.execute(select(func.count(CallV2.id)))).scalar_one() or 0)
    result = await db.execute(
        select(CallV2).order_by(CallV2.id.desc()).offset(offset).limit(page_size)
    )
    rows = result.scalars().all()
    return {
        'total': total,
        'page': page,
        'page_size': page_size,
        'items': [_serialize_light(r) for r in rows],
    }


@router.get('/{campaign_id}/stats')
async def get_campaign_call_stats(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(_campaign_stats_select(campaign_id))).one()
    return _stats_row_to_payload(campaign_id, row)


@router.get('/{campaign_id}')
async def list_calls(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    category: str = Query('all', description='Filter: all | answered | voicemail | no_answer | failed'),
    sort: str = Query('time_desc', description='time_desc | duration_asc | duration_desc'),
    include_stats: bool = Query(
        True,
        description='If true, include aggregated stats (stats query then paginated list).',
    ),
):
    offset = (page - 1) * page_size
    filt = _call_category_filter_expr(category)
    wheres = [CallV2.campaign_id == campaign_id]
    if filt is not None:
        wheres.append(filt)
    where_clause = and_(*wheres)
    list_q = (
        select(CallV2)
        .where(where_clause)
        .order_by(*_list_order_clauses(sort))
        .offset(offset)
        .limit(page_size)
    )
    if include_stats:
        # Same AsyncSession must not run concurrent executes (see SQLAlchemy async docs).
        stats_q = _campaign_stats_select(campaign_id)
        count_q = select(func.count()).select_from(CallV2).where(where_clause)
        stats_res = await db.execute(stats_q)
        count_res = await db.execute(count_q)
        list_res = await db.execute(list_q)
        srow = stats_res.one()
        stats = _stats_row_to_payload(campaign_id, srow)
        total = int(count_res.scalar_one() or 0)
        rows = list_res.scalars().all()
        return {
            'campaign_id': campaign_id,
            'total': int(total),
            'page': page,
            'page_size': page_size,
            'items': [_serialize_light(r) for r in rows],
            'stats': stats,
        }
    total = (await db.execute(select(func.count()).select_from(CallV2).where(where_clause))).scalar_one() or 0
    result = await db.execute(list_q)
    rows = result.scalars().all()
    return {
        'campaign_id': campaign_id,
        'total': int(total),
        'page': page,
        'page_size': page_size,
        'items': [_serialize_light(r) for r in rows],
    }


@router.get('/call/{call_id}')
async def get_call_detail(call_id: str, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(CallV2).where(CallV2.call_id == call_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail='Call not found')
    return _serialize(row)


async def sync_calls_v2_upstream(db: AsyncSession, campaign_id: str) -> dict:
    """
    Fetch Agora call list + per-call detail (transcript, etc.), upsert calls_v2.
    Same behavior as POST /api/calls-v2/{campaign_id}/sync?refresh=true.
    """
    # Pre-load campaign's caller number as fallback for calls where from_number is absent
    campaign_row = (await db.execute(
        select(CampaignV2).where(CampaignV2.campaign_id == campaign_id)
    )).scalar_one_or_none()
    campaign_phone_number = campaign_row.phone_number if campaign_row else None

    state = (await db.execute(
        select(CallV2SyncState).where(CallV2SyncState.campaign_id == campaign_id)
    )).scalar_one_or_none()
    last_from_time = state.last_call_ts if state else None

    upstream = await _fetch_incremental_calls(campaign_id, last_from_time)

    # Watermark uses start_ts — captures in-progress calls that have no end_ts yet.
    # The stored watermark is max(start_ts) - 5 s so the next sync re-queries a
    # 5-second overlap and never misses a call whose start_ts arrived slightly late.
    max_start_ts: int | None = None
    for c in upstream:
        for k in ('start_ts', 'call_ts', 'answered_ts'):
            t = c.get(k)
            if isinstance(t, int) and t > 0:
                t_s = _to_seconds(t)
                max_start_ts = t_s if max_start_ts is None else max(max_start_ts, t_s)
                break

    call_ids = [c.get('call_id') for c in upstream if c.get('call_id')]
    existing: dict[str, CallV2] = {}
    if call_ids:
        exist_rows = await db.execute(select(CallV2).where(CallV2.call_id.in_(call_ids)))
        existing = {r.call_id: r for r in exist_rows.scalars().all()}

    need_detail: set[str] = set()
    new_ids: list[str] = []
    updated_ids: list[str] = []
    for c in upstream:
        cid = c.get('call_id')
        if not cid:
            continue
        start_ts = c.get('start_ts')
        end_ts = c.get('end_ts')
        structured = c.get('structured_output')
        raw_so_status = c.get('structured_output_status')
        if raw_so_status is None or (isinstance(raw_so_status, str) and raw_so_status.strip() == ''):
            list_so_status = None
        else:
            list_so_status = str(raw_so_status).strip()

        fields = {
            'campaign_id': campaign_id,
            'sip_call_id': c.get('sip_call_id') or None,
            'call_id': cid,
            'agent_id': c.get('agent_id') or None,
            'agent_session_id': c.get('agent_session_id') or None,
            'agent_name': c.get('agent_name') or None,
            'from_number': c.get('from_number') or campaign_phone_number or None,
            'to_number': c.get('to_number') or None,
            'call_category': c.get('call_category') or None,
            'hangup_reason': c.get('hangup_reason') or None,
            'duration_seconds': c.get('duration_seconds'),
            'answered_ts': c.get('answered_ts'),
            'call_ts': start_ts if isinstance(start_ts, int) else c.get('call_ts'),
            'start_ts': start_ts if isinstance(start_ts, int) else None,
            'end_ts': end_ts if isinstance(end_ts, int) else None,
            'channel_name': c.get('channel_name') or None,
            'structured_output_status': list_so_status,
        }
        fj = structured_output_json_for_storage(c.get('call_category'), list_so_status, structured)
        if fj is not None:
            fields['structured_output'] = fj

        if cid in existing:
            row = existing[cid]
            for k, v in fields.items():
                setattr(row, k, v)
            updated_ids.append(cid)
            if not row.transcript or not row.record_file_url:
                need_detail.add(cid)
            if not structured_output_terminal(list_so_status):
                need_detail.add(cid)
        else:
            db.add(CallV2(**fields))
            need_detail.add(cid)
            new_ids.append(cid)

    await db.commit()

    if need_detail:
        await merge_upstream_call_details(db, list(need_detail))

    if max_start_ts is not None:
        # Store max_start_ts - 5 s so the next sync re-queries from 5 s before the
        # latest known start_ts, catching any calls whose timestamps arrived slightly late.
        watermark = max(0, max_start_ts - 5)
        if state is None:
            state = CallV2SyncState(campaign_id=campaign_id, last_call_ts=watermark)
            db.add(state)
        else:
            prev = _to_seconds(int(state.last_call_ts)) if state.last_call_ts is not None else 0
            state.last_call_ts = max(prev, watermark)
        await db.commit()

    changed_ids = list(dict.fromkeys([*new_ids, *updated_ids]))
    rows: list[CallV2] = []
    if changed_ids:
        result = await db.execute(select(CallV2).where(CallV2.call_id.in_(changed_ids)))
        rows = result.scalars().all()
        from app.services.call_usage import upsert_call_usage
        await upsert_call_usage(db, rows)
    return {
        'campaign_id': campaign_id,
        'count': len(rows),
        'items': [_serialize_light(r) for r in rows],
    }


@router.post('/{campaign_id}/sync')
async def sync_calls(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    refresh: bool = Query(True, description='If true, fetch from upstream then upsert DB'),
):
    if not refresh:
        return {'campaign_id': campaign_id, 'count': 0, 'items': []}
    return await sync_calls_v2_upstream(db, campaign_id)


@router.delete('/{campaign_id}/sync-state')
async def reset_sync_state(campaign_id: str, db: AsyncSession = Depends(get_db)):
    """Clear the sync watermark so the next sync re-fetches all calls from the beginning."""
    state = (await db.execute(
        select(CallV2SyncState).where(CallV2SyncState.campaign_id == campaign_id)
    )).scalar_one_or_none()
    if state is not None:
        state.last_call_ts = None
        await db.commit()
    return {'campaign_id': campaign_id, 'reset': True}

