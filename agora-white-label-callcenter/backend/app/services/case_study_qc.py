from __future__ import annotations

import base64
import json
import logging
from typing import Any

import boto3
import httpx
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.llm import make_async_openai_client
from app.models.calls_v2 import CallV2
from app.models.campaign_v2 import CampaignV2
from app.models.case_study import CaseStudyCallQc, CaseStudyFilterLog
from app.services.case_study_util import (
    audio_format_from_url,
    dumps_json,
    format_transcript,
    parse_call_success,
    parse_success_criteria,
)

logger = logging.getLogger(__name__)


def _fmt3(value) -> str | None:
    if value is None:
        return None
    try:
        return f'{float(value):.3f}'
    except (TypeError, ValueError):
        return None


_QC_SCHEMA = {
    'name': 'call_qc',
    'strict': True,
    'schema': {
        'type': 'object',
        'additionalProperties': False,
        'properties': {
            'content_score': {'type': 'number'},
            'quality_score': {'type': 'number'},
            'criteria_passed': {'type': 'string', 'enum': ['true', 'false', 'unknown']},
            'criteria_score': {'type': 'number'},
            'composite': {'type': 'number'},
            'evidence': {'type': 'string'},
            'content_notes': {'type': 'string'},
            'quality_notes': {'type': 'string'},
            'criteria_notes': {'type': 'string'},
        },
        'required': [
            'content_score', 'quality_score', 'criteria_passed', 'criteria_score',
            'composite', 'evidence', 'content_notes', 'quality_notes', 'criteria_notes',
        ],
    },
}

_SYSTEM = """You are a QA rater for an AI outbound voice-survey agent.
Score one call using the transcript (and optional audio notes).
Return JSON only.

content_score 0-1: Did the agent follow the interview script, cover key questions, avoid inventing/skipping items?
quality_score 0-1: Politeness, handling objections, no talking-over, no abrupt hangup, natural turn-taking.
criteria_passed: "true" if the call meets Success Criteria; "false" if it clearly fails; "unknown" if criteria are empty/unknown.
criteria_score 0-1: how well Success Criteria were met (0.5 if unknown).
composite 0-1: overall. Weight content, quality, and criteria equally when criteria exist; otherwise average content+quality.
Keep evidence/notes short (one sentence each).
"""


def _presign_s3(s3_uri: str) -> str | None:
    parts = s3_uri[5:].split('/', 1)
    if len(parts) != 2:
        return None
    bucket, key = parts
    try:
        s3 = boto3.client(
            's3',
            region_name=settings.aws_s3_region,
            aws_access_key_id=settings.aws_access_key_id or None,
            aws_secret_access_key=settings.aws_secret_access_key or None,
        )
        return s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=3600,
        )
    except (BotoCoreError, ClientError, Exception) as exc:
        logger.warning('case_study presign failed: %s', exc)
        return None


async def resolve_audio_url(record_file_url: str | None) -> str | None:
    if not record_file_url:
        return None
    if record_file_url.startswith('s3://'):
        return _presign_s3(record_file_url)
    if record_file_url.startswith('http://') or record_file_url.startswith('https://'):
        return record_file_url
    return None


async def _download_audio(url: str, max_bytes: int = 6_000_000) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            return None
        data = resp.content
        if not data or len(data) > max_bytes:
            return None
        return data
    except Exception as exc:
        logger.info('case_study audio download skipped: %s', exc)
        return None


async def _audio_notes(url: str) -> tuple[str | None, float | None]:
    """Best-effort multimodal audio QC. Returns (notes, score) or (None, None)."""
    if not settings.effective_openai_api_key:
        return None, None
    blob = await _download_audio(url)
    if not blob:
        return None, None
    fmt = audio_format_from_url(url)
    b64 = base64.b64encode(blob).decode('ascii')
    try:
        client = make_async_openai_client(timeout=60.0, max_retries=0)
        resp = await client.chat.completions.create(
            model=settings.case_study_audio_model,
            temperature=0.0,
            max_tokens=300,
            messages=[{
                'role': 'user',
                'content': [
                    {
                        'type': 'text',
                        'text': (
                            'Listen to this outbound AI survey call recording. '
                            'In one short JSON object report: '
                            '{"audio_score": 0-1, "notes": "interruptions/silence/tone, one sentence"}.'
                        ),
                    },
                    {
                        'type': 'input_audio',
                        'input_audio': {'data': b64, 'format': fmt},
                    },
                ],
            }],
        )
        raw = (resp.choices[0].message.content or '').strip()
        if raw.startswith('```'):
            raw = raw.split('\n', 1)[1].rsplit('```', 1)[0].strip()
        data = json.loads(raw)
        notes = str(data.get('notes') or '')[:400]
        score = float(data.get('audio_score')) if data.get('audio_score') is not None else None
        return notes or None, score
    except Exception as exc:
        logger.info('case_study audio LLM skipped: %s', exc)
        return None, None


async def _qc_one_transcript(
    transcript_text: str,
    criteria: str,
    call_success,
    audio_notes: str | None,
) -> dict[str, Any]:
    client = make_async_openai_client(timeout=90.0, max_retries=1)
    extra = []
    if criteria:
        extra.append(f'Success Criteria: {criteria}')
    if call_success is not None:
        extra.append(f'Existing structured call_success={call_success!r}')
    if audio_notes:
        extra.append(f'Audio QA notes: {audio_notes}')
    user = 'Transcript:\n' + transcript_text
    if extra:
        user = '\n'.join(extra) + '\n\n' + user
    resp = await client.chat.completions.create(
        model=settings.case_study_qc_model,
        temperature=0.0,
        response_format={'type': 'json_schema', 'json_schema': _QC_SCHEMA},
        messages=[
            {'role': 'system', 'content': _SYSTEM},
            {'role': 'user', 'content': user},
        ],
    )
    text = (resp.choices[0].message.content or '').strip()
    return json.loads(text)


def _criteria_flag(result: dict[str, Any], call_success) -> bool | None:
    raw = result.get('criteria_passed')
    if raw is True or raw == 'true' or raw == 'True':
        return True
    if raw is False or raw == 'false' or raw == 'False':
        return False
    if call_success is False:
        return False
    if call_success is True:
        return True
    return None


def _is_effective(result: dict[str, Any], call_success) -> bool:
    try:
        composite = float(result.get('composite') or 0)
    except (TypeError, ValueError):
        composite = 0.0
    if composite < float(settings.case_study_quality_threshold):
        return False
    flag = _criteria_flag(result, call_success)
    if flag is False:
        return False
    return True


async def run_ai_qc(
    db: AsyncSession,
    run_id: int,
    calls: list[CallV2],
    next_seq: int,
) -> tuple[list[CaseStudyCallQc], list[CaseStudyFilterLog], int, int]:
    """
    Stage 2 AI QC. Returns (qc rows, extra logs, effective_count, next_seq).
    """
    logs: list[CaseStudyFilterLog] = []
    qc_rows: list[CaseStudyCallQc] = []

    camp_ids = {c.campaign_id for c in calls if c.campaign_id}
    criteria_by_camp: dict[str, str] = {}
    if camp_ids:
        camps = (await db.execute(
            select(CampaignV2).where(CampaignV2.campaign_id.in_(camp_ids))
        )).scalars().all()
        for camp in camps:
            criteria_by_camp[camp.campaign_id] = parse_success_criteria(camp.structured_output)

    unique_criteria = sorted({v for v in criteria_by_camp.values() if v})
    crit_preview = unique_criteria[0][:120] if unique_criteria else '（未配置）'
    logs.append(CaseStudyFilterLog(
        run_id=run_id,
        seq=next_seq,
        stage='ai_qc',
        action='success_criteria',
        input_count=len(calls),
        passed_count=len(calls),
        dropped_count=0,
        detail=dumps_json({'criteria': unique_criteria}),
        message=f'[AI QC] Success Criteria: "{crit_preview}"',
    ))
    next_seq += 1

    # Prefer longer + call_success for audio sample
    ranked = sorted(
        calls,
        key=lambda c: (
            1 if parse_call_success(c.structured_output) is True else 0,
            int(c.duration_seconds or 0),
        ),
        reverse=True,
    )
    audio_ids = {c.call_id for c in ranked[: max(0, int(settings.case_study_audio_qc_limit))]}

    content_fail = quality_fail = criteria_fail = audio_skipped = 0
    effective_n = 0

    for call in calls:
        criteria = criteria_by_camp.get(call.campaign_id or '', '') or ''
        call_success = parse_call_success(call.structured_output)
        transcript_text = format_transcript(call.transcript)
        audio_notes = None
        audio_score = None
        audio_used = False
        url = None
        if call.call_id in audio_ids:
            url = await resolve_audio_url(call.record_file_url)
            if url:
                audio_notes, audio_score = await _audio_notes(url)
                audio_used = audio_notes is not None or audio_score is not None
            if not audio_used:
                audio_skipped += 1

        try:
            result = await _qc_one_transcript(
                transcript_text, criteria, call_success, audio_notes,
            )
        except Exception as exc:
            logger.warning('case_study QC failed for %s: %s', call.call_id, exc)
            qc_rows.append(CaseStudyCallQc(
                run_id=run_id,
                call_id=call.call_id,
                campaign_id=call.campaign_id,
                db_passed=True,
                effective=False,
                drop_stage='ai_qc',
                drop_reason='qc_error',
                evidence=str(exc)[:500],
                success_criteria_text=criteria or None,
                duration_seconds=call.duration_seconds,
                call_category=call.call_category,
            ))
            continue

        if audio_score is not None:
            result['audio_score'] = audio_score
            result['audio_notes'] = audio_notes
            result['audio_used'] = True
        else:
            result['audio_used'] = False
            result['audio_skipped'] = bool(call.call_id in audio_ids)

        effective = _is_effective(result, call_success)
        drop_reason = None
        if not effective:
            try:
                if float(result.get('content_score') or 0) < settings.case_study_quality_threshold:
                    content_fail += 1
                    drop_reason = 'content'
                elif float(result.get('quality_score') or 0) < settings.case_study_quality_threshold:
                    quality_fail += 1
                    drop_reason = drop_reason or 'quality'
            except (TypeError, ValueError):
                pass
            flag = _criteria_flag(result, call_success)
            if flag is False:
                criteria_fail += 1
                drop_reason = drop_reason or 'success_criteria'
            drop_reason = drop_reason or 'composite'
        else:
            effective_n += 1

        qc_rows.append(CaseStudyCallQc(
            run_id=run_id,
            call_id=call.call_id,
            campaign_id=call.campaign_id,
            db_passed=True,
            effective=effective,
            drop_stage=None if effective else 'ai_qc',
            drop_reason=drop_reason,
            transcript_score=_fmt3(result.get('composite')),
            audio_score=_fmt3(audio_score),
            criteria_passed=_criteria_flag(result, call_success),
            rubric=dumps_json(result),
            evidence=str(result.get('evidence') or '')[:800],
            success_criteria_text=criteria or None,
            duration_seconds=call.duration_seconds,
            call_category=call.call_category,
        ))

    logs.append(CaseStudyFilterLog(
        run_id=run_id,
        seq=next_seq,
        stage='ai_qc',
        action='qc_breakdown',
        input_count=len(calls),
        passed_count=effective_n,
        dropped_count=len(calls) - effective_n,
        detail=dumps_json({
            'content_fail': content_fail,
            'quality_fail': quality_fail,
            'criteria_fail': criteria_fail,
            'audio_skipped': audio_skipped,
        }),
        message=(
            f'[AI QC] Failed content {content_fail} / quality {quality_fail} / '
            f'Success Criteria {criteria_fail}'
            + (f'; audio skipped {audio_skipped}' if audio_skipped else '')
        ),
    ))
    next_seq += 1
    logs.append(CaseStudyFilterLog(
        run_id=run_id,
        seq=next_seq,
        stage='ai_qc',
        action='effective',
        input_count=len(calls),
        passed_count=effective_n,
        dropped_count=len(calls) - effective_n,
        detail=None,
        message=f'[AI QC] Effective calls: {effective_n} (used for suggestions)',
    ))
    next_seq += 1
    return qc_rows, logs, effective_n, next_seq
