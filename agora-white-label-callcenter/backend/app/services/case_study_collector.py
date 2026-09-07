from __future__ import annotations

from collections import Counter

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.calls_v2 import ANSWERED_CATEGORIES, transcript_has_usable_content
from app.core.config import settings
from app.models.calls_v2 import CallV2
from app.models.case_study import CaseStudyCallQc, CaseStudyFilterLog
from app.services.case_study_util import biz_day_bounds, dumps_json, ts_to_seconds

ANSWERED_SET = frozenset(ANSWERED_CATEGORIES)


async def load_agent_day_calls(
    db: AsyncSession,
    agent_id: str,
    biz_date: str,
) -> list[CallV2]:
    start_s, end_s, start_ms, end_ms = biz_day_bounds(biz_date)
    q = (
        select(CallV2)
        .where(
            CallV2.agent_id == agent_id,
            or_(
                and_(CallV2.start_ts >= start_ms, CallV2.start_ts < end_ms),
                and_(CallV2.start_ts >= start_s, CallV2.start_ts < end_s),
                and_(CallV2.call_ts >= start_ms, CallV2.call_ts < end_ms),
                and_(CallV2.call_ts >= start_s, CallV2.call_ts < end_s),
            ),
        )
        .order_by(CallV2.id.asc())
    )
    rows = list((await db.execute(q)).scalars().all())
    out: list[CallV2] = []
    seen: set[str] = set()
    for c in rows:
        ts = ts_to_seconds(c.start_ts) or ts_to_seconds(c.call_ts)
        if ts is None or not (start_s <= ts < end_s):
            continue
        if c.call_id in seen:
            continue
        seen.add(c.call_id)
        out.append(c)
    return out


def _log(
    run_id: int,
    seq: int,
    stage: str,
    action: str,
    input_count: int,
    passed: int,
    dropped: int,
    message: str,
    detail: dict | None = None,
) -> CaseStudyFilterLog:
    return CaseStudyFilterLog(
        run_id=run_id,
        seq=seq,
        stage=stage,
        action=action,
        input_count=input_count,
        passed_count=passed,
        dropped_count=dropped,
        detail=dumps_json(detail) if detail is not None else None,
        message=message,
    )


def _qc_drop(run_id: int, call: CallV2, reason: str) -> CaseStudyCallQc:
    return CaseStudyCallQc(
        run_id=run_id,
        call_id=call.call_id,
        campaign_id=call.campaign_id,
        db_passed=False,
        effective=False,
        drop_stage='db',
        drop_reason=reason,
        duration_seconds=call.duration_seconds,
        call_category=call.call_category,
    )


def filter_answered_usable(
    run_id: int,
    calls: list[CallV2],
    min_duration: int | None = None,
) -> tuple[list[CallV2], list[CaseStudyFilterLog], list[CaseStudyCallQc]]:
    """Stage 1 DB filter. Returns surviving calls, log rows, drop QC rows."""
    min_duration = (
        settings.case_study_min_duration_seconds if min_duration is None else min_duration
    )
    logs: list[CaseStudyFilterLog] = []
    drops: list[CaseStudyCallQc] = []
    seq = 1

    total = len(calls)
    logs.append(_log(
        run_id, seq, 'db', 'day_total', total, total, 0,
        f'[DB] Calls today: {total}',
        {'count': total},
    ))
    seq += 1

    answered: list[CallV2] = []
    cat_drop: Counter[str] = Counter()
    for c in calls:
        cat = (c.call_category or '').strip()
        if cat in ANSWERED_SET:
            answered.append(c)
        else:
            key = cat or 'unknown'
            cat_drop[key] += 1
            drops.append(_qc_drop(run_id, c, f'not_answered:{key}'))
    logs.append(_log(
        run_id, seq, 'db', 'answered_filter', total, len(answered), total - len(answered),
        f'[DB] Answered: {len(answered)}, dropped {total - len(answered)}'
        + (f' ({dict(cat_drop)})' if cat_drop else ''),
        {'dropped_by_category': dict(cat_drop)},
    ))
    seq += 1

    long_enough: list[CallV2] = []
    short_n = 0
    for c in answered:
        dur = int(c.duration_seconds or 0)
        if dur >= min_duration:
            long_enough.append(c)
        else:
            short_n += 1
            drops.append(_qc_drop(run_id, c, f'too_short:{dur}s'))
    logs.append(_log(
        run_id, seq, 'db', 'duration_filter', len(answered), len(long_enough), short_n,
        f'[DB] Duration ≥ {min_duration}s → {len(long_enough)}'
        + (f', dropped {short_n}' if short_n else ''),
        {'min_duration_seconds': min_duration, 'dropped': short_n},
    ))
    seq += 1

    usable: list[CallV2] = []
    no_tr = 0
    for c in long_enough:
        if transcript_has_usable_content(c.transcript):
            usable.append(c)
        else:
            no_tr += 1
            drops.append(_qc_drop(run_id, c, 'no_transcript'))
    logs.append(_log(
        run_id, seq, 'db', 'transcript_filter', len(long_enough), len(usable), no_tr,
        f'[DB] Has transcript → {len(usable)}'
        + (f', dropped {no_tr}' if no_tr else ''),
        {'dropped_no_transcript': no_tr},
    ))

    return usable, logs, drops
