import asyncio
import logging

from sqlalchemy import func, select

from app.api.calls_v2 import merge_upstream_call_details
from app.core.config import settings
from app.core.database import async_session_factory
from app.models.calls_v2 import CallV2

logger = logging.getLogger(__name__)


async def poll_pending_structured_outputs_forever() -> None:
    """Periodically refresh conversational call detail for rows not in a terminal SO status."""
    interval = max(5, int(settings.structured_output_poll_interval_seconds))
    batch = max(1, min(500, int(settings.structured_output_poll_batch_size)))
    logger.info(
        'Structured output poll started (interval=%ss, batch=%s)',
        interval,
        batch,
    )
    try:
        while True:
            try:
                async with async_session_factory() as db:
                    from sqlalchemy import or_

                    from app.models.campaign_v2 import CampaignV2
                    from app.services.env_scope import campaign_scope_filter, load_local_agent_ids

                    local_agent_ids = await load_local_agent_ids(db)
                    st = func.lower(func.coalesce(CallV2.structured_output_status, ''))
                    q = (
                        select(CallV2.call_id)
                        .join(CampaignV2, CallV2.campaign_id == CampaignV2.campaign_id)
                        .where(
                            campaign_scope_filter(local_agent_ids),
                            or_(
                                ~st.in_(('completed', 'failed', 'disabled')),
                                # transcript is always set (at minimum '[]') after a successful
                                # detail fetch, so NULL means detail was never fetched yet.
                                CallV2.transcript.is_(None),
                            ),
                        )
                        .order_by(CallV2.id.asc())
                        .limit(batch)
                    )
                    ids = [r[0] for r in (await db.execute(q)).all()]
                if ids:
                    async with async_session_factory() as db2:
                        n = await merge_upstream_call_details(db2, ids)
                        if n:
                            logger.debug('Structured output poll updated %s call(s)', n)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception('Structured output poll tick failed')
            await asyncio.sleep(interval)
    finally:
        logger.info('Structured output poll stopped')


def start_structured_output_poll() -> None:
    asyncio.create_task(poll_pending_structured_outputs_forever())
