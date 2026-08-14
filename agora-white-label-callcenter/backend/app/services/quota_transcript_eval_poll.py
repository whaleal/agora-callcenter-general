import asyncio
import logging

from sqlalchemy import func, or_, select

from app.core.config import settings
from app.core.database import async_session_factory
from app.models.calls_v2 import CallV2
from app.services.quota_transcript_eval import run_transcript_eval_for_campaign

logger = logging.getLogger(__name__)


async def poll_running_campaigns_quota_transcript_eval_forever() -> None:
    """
    For each ``campaign_id`` that still has at least one ``calls_v2`` row with
    ``quota_checked`` false or NULL, run transcript eval (same as POST transcript-eval).

    Selection is **independent of** ``campaigns_v2.status``: interrupt / completed / failed
    campaigns keep being processed until every call row is quota-checked (or skipped with
    ``quota_checked`` set inside eval).
    """
    interval = max(5, int(settings.quota_transcript_eval_poll_interval_seconds))
    batch = max(1, min(1000, int(settings.quota_transcript_eval_poll_batch_limit)))
    logger.info(
        'Quota transcript-eval poll started (interval=%ss, batch_limit=%s)',
        interval,
        batch,
    )
    try:
        while True:
            try:
                if not settings.effective_openai_api_key:
                    await asyncio.sleep(interval)
                    continue

                async with async_session_factory() as db:
                    from app.models.campaign_v2 import CampaignV2
                    from app.services.env_scope import campaign_scope_filter, load_local_agent_ids

                    local_agent_ids = await load_local_agent_ids(db)
                    pending_filter = or_(
                        CallV2.quota_checked.is_(False),
                        CallV2.quota_checked.is_(None),
                    )
                    q = (
                        select(CallV2.campaign_id)
                        .join(CampaignV2, CallV2.campaign_id == CampaignV2.campaign_id)
                        .where(
                            campaign_scope_filter(local_agent_ids),
                            CallV2.campaign_id.isnot(None),
                            CallV2.campaign_id != '',
                            pending_filter,
                        )
                        .distinct()
                    )
                    campaign_ids = [r[0] for r in (await db.execute(q)).all()]

                for campaign_id in campaign_ids:
                    async with async_session_factory() as db2:
                        pending_cnt = (
                            await db2.execute(
                                select(func.count()).select_from(CallV2).where(
                                    CallV2.campaign_id == campaign_id,
                                    or_(
                                        CallV2.quota_checked.is_(False),
                                        CallV2.quota_checked.is_(None),
                                    ),
                                ),
                            )
                        ).scalar_one() or 0
                        if pending_cnt == 0:
                            continue
                        out = await run_transcript_eval_for_campaign(
                            db2,
                            campaign_id,
                            limit=batch,
                            prefetch_transcripts=True,
                        )
                        proc = int(out.get('processed') or 0)
                        if proc:
                            logger.info(
                                'quota transcript-eval poll: campaign=%s processed=%s pending_was=%s',
                                campaign_id,
                                proc,
                                pending_cnt,
                            )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception('Quota transcript-eval poll tick failed')
            await asyncio.sleep(interval)
    finally:
        logger.info('Quota transcript-eval poll stopped')


def start_quota_transcript_eval_poll() -> None:
    asyncio.create_task(poll_running_campaigns_quota_transcript_eval_forever())
