from __future__ import annotations

import asyncio
import logging

from app.core.database import AsyncSessionLocal
from app.services.call_usage import backfill_call_usage
from app.services.operation_log import purge_expired_operation_logs

logger = logging.getLogger(__name__)


async def _maintenance_loop() -> None:
    # first pass shortly after boot, then hourly
    await asyncio.sleep(5)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                deleted = await purge_expired_operation_logs(db)
                if deleted:
                    logger.info('purged %s expired operation log(s)', deleted)
            async with AsyncSessionLocal() as db:
                await backfill_call_usage(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception('usage/log maintenance tick failed')
        await asyncio.sleep(3600)


def start_maintenance() -> None:
    asyncio.create_task(_maintenance_loop())
