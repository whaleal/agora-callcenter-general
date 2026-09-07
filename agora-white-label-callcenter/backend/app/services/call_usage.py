from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.call_usage import CallUsage
from app.models.calls_v2 import CallV2
from app.models.campaign_v2 import CampaignV2
from app.models.agent_v2 import AgentV2
from app.models.phone_number_v2 import PhoneNumberV2

logger = logging.getLogger(__name__)

ANSWERED_CATEGORIES = frozenset({
    'ai_assistant',
    'customer_answered',
    'human_answered',
    'outbound_transferred_success',
})


def _to_date(ts: int | None) -> str | None:
    if ts is None:
        return None
    try:
        ts_sec = ts / 1000 if ts > 1e11 else ts
        return datetime.fromtimestamp(ts_sec, tz=timezone.utc).strftime('%Y-%m-%d')
    except (OSError, OverflowError, ValueError):
        return None


def usage_date_for_call(call: CallV2) -> str:
    return (
        _to_date(call.start_ts)
        or _to_date(call.call_ts)
        or _to_date(call.end_ts)
        or datetime.now(timezone.utc).strftime('%Y-%m-%d')
    )


def is_answered(category: str | None) -> bool:
    return (category or '').strip().lower() in ANSWERED_CATEGORIES


def infer_direction(
    call: CallV2,
    campaign_ids: set[str],
    inbound_numbers: set[str],
) -> str:
    cat = (call.call_category or '').strip().lower()
    if 'inbound' in cat:
        return 'inbound'
    to_num = (call.to_number or '').strip()
    if to_num and to_num in inbound_numbers:
        return 'inbound'
    if call.campaign_id and call.campaign_id in campaign_ids:
        return 'outbound'
    return 'inbound'


async def upsert_call_usage(db: AsyncSession, calls: list[CallV2]) -> int:
    if not calls:
        return 0

    campaign_ids = {c.campaign_id for c in calls if c.campaign_id}
    app_by_campaign: dict[str, str | None] = {}
    known_campaign_ids: set[str] = set()
    if campaign_ids:
        rows = await db.execute(
            select(CampaignV2.campaign_id, CampaignV2.app_id).where(
                CampaignV2.campaign_id.in_(campaign_ids)
            )
        )
        for cid, app_id in rows.all():
            known_campaign_ids.add(cid)
            app_by_campaign[cid] = app_id

    agent_ids = {c.agent_id for c in calls if c.agent_id}
    app_by_agent: dict[str, str | None] = {}
    if agent_ids:
        arows = await db.execute(
            select(AgentV2.agent_id, AgentV2.app_id).where(AgentV2.agent_id.in_(agent_ids))
        )
        app_by_agent = {aid: app for aid, app in arows.all()}

    inbound_numbers: set[str] = set()
    pn_rows = await db.execute(
        select(PhoneNumberV2.phone_number).where(PhoneNumberV2.phone_number.isnot(None))
    )
    inbound_numbers = {row[0] for row in pn_rows.all() if row[0]}

    call_ids = [c.call_id for c in calls if c.call_id]
    existing_rows = await db.execute(select(CallUsage).where(CallUsage.call_id.in_(call_ids)))
    existing = {row.call_id: row for row in existing_rows.scalars().all()}

    n = 0
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for call in calls:
        if not call.call_id or not call.campaign_id:
            continue
        duration = int(call.duration_seconds or 0)
        answered = is_answered(call.call_category)
        usage_date = usage_date_for_call(call)
        app_id = app_by_campaign.get(call.campaign_id) or (
            app_by_agent.get(call.agent_id) if call.agent_id else None
        )
        direction = infer_direction(call, known_campaign_ids, inbound_numbers)
        row = existing.get(call.call_id)
        if row is None:
            db.add(CallUsage(
                call_id=call.call_id,
                campaign_id=call.campaign_id,
                app_id=app_id,
                usage_date=usage_date,
                duration_seconds=duration,
                answered=answered,
                call_category=call.call_category,
                direction=direction,
                start_ts=call.start_ts or call.call_ts,
                created_at=now,
                updated_at=now,
            ))
            n += 1
            continue
        row.campaign_id = call.campaign_id
        row.app_id = app_id or row.app_id
        row.usage_date = usage_date
        row.duration_seconds = duration
        row.answered = answered
        row.call_category = call.call_category
        row.direction = direction
        row.start_ts = call.start_ts or call.call_ts or row.start_ts
        row.updated_at = now
        n += 1

    await db.commit()
    return n


async def backfill_call_usage(db: AsyncSession, batch_size: int = 500) -> int:
    total = 0
    while True:
        q = (
            select(CallV2)
            .outerjoin(CallUsage, CallV2.call_id == CallUsage.call_id)
            .where(CallUsage.id.is_(None))
            .limit(batch_size)
        )
        calls = list((await db.execute(q)).scalars().all())
        if not calls:
            break
        total += await upsert_call_usage(db, calls)
        if len(calls) < batch_size:
            break
    if total:
        logger.info('backfilled %s call_usage row(s)', total)
    return total
