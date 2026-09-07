from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.core.database import async_session_factory
from app.services.case_study_runner import run_for_date
from app.services.case_study_util import yesterday_biz_date

logger = logging.getLogger(__name__)

_started = False


def _seconds_until_next_run() -> float:
    tz = ZoneInfo(settings.case_study_timezone)
    now = datetime.now(tz)
    hour = max(0, min(23, int(settings.case_study_run_hour)))
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return max(5.0, (target - now).total_seconds())


async def poll_case_study_forever() -> None:
    logger.info(
        'Case Study scheduler started (tz=%s hour=%s)',
        settings.case_study_timezone,
        settings.case_study_run_hour,
    )
    while True:
        try:
            await asyncio.sleep(_seconds_until_next_run())
            biz_date = yesterday_biz_date()
            logger.info('Case Study daily run starting for %s', biz_date)
            async with async_session_factory() as db:
                results = await run_for_date(db, biz_date, skip_if_ready=True)
            logger.info('Case Study daily run finished: %s snapshots', len(results))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception('Case Study scheduler iteration failed')
            await asyncio.sleep(60)


def start_case_study_scheduler() -> None:
    global _started
    if _started:
        return
    _started = True
    asyncio.create_task(poll_case_study_forever())
