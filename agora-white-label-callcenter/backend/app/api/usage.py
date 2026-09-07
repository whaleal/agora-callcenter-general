from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.tenant import current_app_id, is_admin
from app.models.call_usage import CallUsage

router = APIRouter(prefix='/api/usage', tags=['usage'])


def _clamp_page(page: int, page_size: int) -> tuple[int, int]:
    page = max(1, page)
    page_size = min(200, max(1, page_size))
    return page, page_size


def _scope_filters(
    start_date: str | None,
    end_date: str | None,
    app_id: str | None,
    campaign_id: str | None,
    direction: str | None,
):
    filters = []
    if start_date:
        filters.append(CallUsage.usage_date >= start_date)
    if end_date:
        filters.append(CallUsage.usage_date <= end_date)
    if campaign_id:
        filters.append(CallUsage.campaign_id == campaign_id)
    if direction in ('inbound', 'outbound'):
        filters.append(CallUsage.direction == direction)

    if is_admin():
        if app_id:
            filters.append(CallUsage.app_id == app_id)
    else:
        filters.append(CallUsage.app_id == current_app_id())
    return filters


def _direction_bucket(rows) -> dict[str, dict]:
    buckets = {
        'outbound': {'total_calls': 0, 'answered_calls': 0, 'total_duration_seconds': 0},
        'inbound': {'total_calls': 0, 'answered_calls': 0, 'total_duration_seconds': 0},
    }
    for direction, calls, answered, duration in rows:
        key = (direction or 'outbound').strip().lower()
        if key not in buckets:
            key = 'outbound'
        buckets[key]['total_calls'] = int(calls or 0)
        buckets[key]['answered_calls'] = int(answered or 0)
        buckets[key]['total_duration_seconds'] = int(duration or 0)
        buckets[key]['total_duration_minutes'] = round(buckets[key]['total_duration_seconds'] / 60, 2)
    return buckets


@router.get('')
async def usage_summary(
    start_date: str | None = Query(None, description='YYYY-MM-DD inclusive'),
    end_date: str | None = Query(None, description='YYYY-MM-DD inclusive'),
    app_id: str | None = None,
    campaign_id: str | None = None,
    direction: str | None = Query(None, description='inbound | outbound'),
    db: AsyncSession = Depends(get_db),
):
    filters = _scope_filters(start_date, end_date, app_id, campaign_id, direction)

    totals_q = select(
        func.count(CallUsage.id),
        func.coalesce(func.sum(case((CallUsage.answered.is_(True), 1), else_=0)), 0),
        func.coalesce(func.sum(CallUsage.duration_seconds), 0),
    )
    if filters:
        totals_q = totals_q.where(*filters)
    total_calls, answered_calls, total_duration = (await db.execute(totals_q)).one()
    total_calls = int(total_calls or 0)
    answered_calls = int(answered_calls or 0)
    total_duration = int(total_duration or 0)

    by_dir_q = select(
        CallUsage.direction,
        func.count(CallUsage.id),
        func.coalesce(func.sum(case((CallUsage.answered.is_(True), 1), else_=0)), 0),
        func.coalesce(func.sum(CallUsage.duration_seconds), 0),
    ).group_by(CallUsage.direction)
    if filters:
        by_dir_q = by_dir_q.where(*filters)
    by_direction = _direction_bucket((await db.execute(by_dir_q)).all())

    daily_q = (
        select(
            CallUsage.usage_date,
            CallUsage.direction,
            func.count(CallUsage.id),
            func.coalesce(func.sum(case((CallUsage.answered.is_(True), 1), else_=0)), 0),
            func.coalesce(func.sum(CallUsage.duration_seconds), 0),
        )
        .group_by(CallUsage.usage_date, CallUsage.direction)
        .order_by(CallUsage.usage_date.asc())
    )
    if filters:
        daily_q = daily_q.where(*filters)
    daily_rows = (await db.execute(daily_q)).all()

    daily_map: dict[str, dict] = {}
    for date, dir_name, calls, answered, duration in daily_rows:
        item = daily_map.setdefault(date, {
            'date': date,
            'total_calls': 0,
            'answered_calls': 0,
            'total_duration_seconds': 0,
            'outbound_calls': 0,
            'inbound_calls': 0,
            'outbound_duration_seconds': 0,
            'inbound_duration_seconds': 0,
        })
        n_calls = int(calls or 0)
        n_ans = int(answered or 0)
        n_dur = int(duration or 0)
        item['total_calls'] += n_calls
        item['answered_calls'] += n_ans
        item['total_duration_seconds'] += n_dur
        key = (dir_name or 'outbound').strip().lower()
        if key == 'inbound':
            item['inbound_calls'] += n_calls
            item['inbound_duration_seconds'] += n_dur
        else:
            item['outbound_calls'] += n_calls
            item['outbound_duration_seconds'] += n_dur

    return {
        'filters': {
            'start_date': start_date,
            'end_date': end_date,
            'app_id': None if not is_admin() else app_id,
            'campaign_id': campaign_id,
            'direction': direction,
        },
        'totals': {
            'total_calls': total_calls,
            'answered_calls': answered_calls,
            'total_duration_seconds': total_duration,
            'total_duration_minutes': round(total_duration / 60, 2),
        },
        'by_direction': by_direction,
        'daily': list(daily_map.values()),
    }


@router.get('/records')
async def usage_records(
    start_date: str | None = Query(None, description='YYYY-MM-DD inclusive'),
    end_date: str | None = Query(None, description='YYYY-MM-DD inclusive'),
    app_id: str | None = None,
    campaign_id: str | None = None,
    direction: str | None = Query(None, description='inbound | outbound'),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    page, page_size = _clamp_page(page, page_size)
    filters = _scope_filters(start_date, end_date, app_id, campaign_id, direction)

    count_q = select(func.count(CallUsage.id))
    if filters:
        count_q = count_q.where(*filters)
    total = int((await db.execute(count_q)).scalar_one() or 0)

    q = select(CallUsage).order_by(CallUsage.usage_date.desc(), CallUsage.id.desc())
    if filters:
        q = q.where(*filters)
    q = q.offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(q)).scalars().all()

    return {
        'page': page,
        'page_size': page_size,
        'total': total,
        'items': [
            {
                'call_id': r.call_id,
                'campaign_id': r.campaign_id,
                'app_id': r.app_id,
                'usage_date': r.usage_date,
                'duration_seconds': r.duration_seconds,
                'answered': r.answered,
                'call_category': r.call_category,
                'direction': r.direction,
                'start_ts': r.start_ts,
            }
            for r in rows
        ],
    }
