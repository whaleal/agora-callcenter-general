from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.tenant import current_app_id, current_email, current_user_id, is_admin
from app.models.operation_log import OperationLog

router = APIRouter(prefix='/api/operation-logs', tags=['operation-logs'])


@router.get('')
async def list_operation_logs(
    action: str | None = Query(None, description='e.g. login / register / send_code / campaigns-v2.sync'),
    success: bool | None = None,
    email: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    page_size = min(200, max(1, page_size))
    page = max(1, page)
    filters = []
    if action:
        filters.append(OperationLog.action == action)
    if success is not None:
        filters.append(OperationLog.success.is_(success))
    if email:
        filters.append(OperationLog.email == email.strip().lower())

    if not is_admin():
        own_email = (current_email() or '').strip().lower()
        own_uid = current_user_id()
        own_app = current_app_id()
        tenant_clauses = [OperationLog.app_id == own_app]
        if own_email:
            tenant_clauses.append(OperationLog.email == own_email)
        if own_uid is not None:
            tenant_clauses.append(OperationLog.user_id == own_uid)
        filters.append(or_(*tenant_clauses))

    count_q = select(func.count(OperationLog.id))
    if filters:
        count_q = count_q.where(*filters)
    total = int((await db.execute(count_q)).scalar_one() or 0)

    q = select(OperationLog).order_by(OperationLog.id.desc())
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
                'id': r.id,
                'ip': r.ip,
                'created_at': r.created_at.isoformat() if r.created_at else None,
                'method': r.method,
                'path': r.path,
                'action': r.action,
                'status_code': r.status_code,
                'success': r.success,
                'fail_reason': r.fail_reason,
                'duration_ms': r.duration_ms,
                'email': r.email,
                'app_id': r.app_id,
            }
            for r in rows
        ],
    }
