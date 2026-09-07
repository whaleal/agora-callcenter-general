from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.calls_v2 import CallV2
from app.services.env_scope import call_scope_filter

router = APIRouter(prefix='/api/dashboard', tags=['dashboard'])


def _to_date(ts: int | None) -> str | None:
    """Convert a Unix timestamp (auto-detect seconds vs milliseconds) to YYYY-MM-DD."""
    if ts is None:
        return None
    try:
        ts_sec = ts / 1000 if ts > 1e11 else ts
        return datetime.fromtimestamp(ts_sec, tz=timezone.utc).strftime('%Y-%m-%d')
    except (OSError, OverflowError, ValueError):
        return None


@router.get('/stats')
async def dashboard_stats(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(
            CallV2.start_ts,
            CallV2.call_ts,
            CallV2.call_category,
            CallV2.duration_seconds,
        ).where(call_scope_filter())
    )
    rows = result.all()

    daily: dict[str, dict] = defaultdict(lambda: {'total': 0, 'answered': 0, 'duration': 0})
    category_counts: dict[str, int] = defaultdict(int)

    for start_ts, call_ts, call_category, duration_seconds in rows:
        date = _to_date(start_ts) or _to_date(call_ts)
        if date is None:
            continue

        daily[date]['total'] += 1

        cat_lower = (call_category or '').lower()
        if 'answered' in cat_lower:
            daily[date]['answered'] += 1

        if duration_seconds:
            daily[date]['duration'] += duration_seconds

        category_counts[call_category or 'unknown'] += 1

    sorted_dates = sorted(daily.keys())
    daily_stats = [
        {
            'date': d,
            'total_calls': daily[d]['total'],
            'answered_calls': daily[d]['answered'],
            'answer_rate': (
                round(daily[d]['answered'] / daily[d]['total'] * 100, 1)
                if daily[d]['total'] > 0 else 0.0
            ),
            'total_duration_seconds': daily[d]['duration'],
        }
        for d in sorted_dates
    ]

    total_calls = sum(d['total_calls'] for d in daily_stats)
    total_answered = sum(d['answered_calls'] for d in daily_stats)
    total_duration = sum(d['total_duration_seconds'] for d in daily_stats)

    return {
        'daily_stats': daily_stats,
        'category_distribution': [
            {'category': k, 'count': v}
            for k, v in sorted(category_counts.items(), key=lambda x: -x[1])
        ],
        'totals': {
            'total_calls': total_calls,
            'total_answered': total_answered,
            'overall_answer_rate': (
                round(total_answered / total_calls * 100, 1) if total_calls > 0 else 0.0
            ),
            'total_duration_seconds': total_duration,
        },
    }
