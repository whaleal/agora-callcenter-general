from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.operation_log import OperationLog

logger = logging.getLogger(__name__)

AUTH_LOG_PREFIX = '/api/auth/'
MUTATING_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}

ACTION_BY_PATH = {
    '/api/auth/send-code': 'send_code',
    '/api/auth/register': 'register',
    '/api/auth/login': 'login',
    '/api/auth/admin-login': 'admin_login',
    '/api/auth/me': 'me',
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize_path(path: str) -> str:
    if path != '/' and path.endswith('/'):
        return path[:-1]
    return path


def should_log_path(method: str, path: str) -> bool:
    normalized = normalize_path(path)
    if normalized.startswith(AUTH_LOG_PREFIX):
        return True
    if normalized.startswith('/api/') and (method or '').upper() in MUTATING_METHODS:
        return True
    return False


def action_for_path(path: str) -> str:
    normalized = normalize_path(path)
    mapped = ACTION_BY_PATH.get(normalized)
    if mapped:
        return mapped
    parts = [p for p in normalized.split('/') if p]
    if len(parts) >= 2 and parts[0] == 'api':
        resource = parts[1]
        if len(parts) >= 3:
            tail = parts[-1]
            if tail and not _looks_like_id(tail):
                return f'{resource}.{tail}'[:64]
        return resource[:64]
    return 'unknown'


def _looks_like_id(segment: str) -> bool:
    if len(segment) >= 16:
        return True
    if segment.isdigit():
        return True
    return False


def client_ip(scope: dict, headers: dict[str, str]) -> str:
    xff = (headers.get('x-forwarded-for') or '').strip()
    if xff:
        return xff.split(',')[0].strip()[:64]
    xri = (headers.get('x-real-ip') or '').strip()
    if xri:
        return xri[:64]
    client = scope.get('client')
    if client:
        return str(client[0])[:64]
    return ''


def email_from_body(raw: bytes) -> str | None:
    if not raw:
        return None
    try:
        data = json.loads(raw.decode('utf-8'))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    email = data.get('email')
    if isinstance(email, str) and email.strip():
        return email.strip().lower()[:255]
    username = data.get('username')
    if isinstance(username, str) and username.strip():
        return username.strip()[:255]
    return None


def app_id_from_body(raw: bytes) -> str | None:
    if not raw:
        return None
    try:
        data = json.loads(raw.decode('utf-8'))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    app_id = data.get('app_id') or data.get('appId')
    if isinstance(app_id, str) and app_id.strip():
        return app_id.strip()[:64]
    return None


def fail_reason_from_body(raw: bytes) -> str | None:
    if not raw:
        return None
    text = raw.decode('utf-8', errors='replace')
    try:
        data = json.loads(text)
    except Exception:
        return text[:512] or None
    if not isinstance(data, dict):
        return text[:512]
    detail = data.get('detail')
    if isinstance(detail, str):
        return detail[:512]
    if isinstance(detail, list):
        parts = []
        for item in detail:
            if isinstance(item, dict) and item.get('msg'):
                parts.append(str(item['msg']))
            else:
                parts.append(str(item))
        return '; '.join(parts)[:512]
    if detail is not None:
        return str(detail)[:512]
    return text[:512]


async def write_operation_log(
    *,
    ip: str,
    method: str,
    path: str,
    status_code: int,
    duration_ms: int,
    fail_reason: str | None,
    email: str | None,
    user_id: int | None = None,
    app_id: str | None = None,
) -> None:
    try:
        async with AsyncSessionLocal() as db:
            db.add(OperationLog(
                ip=ip or '',
                method=(method or 'GET')[:16],
                path=normalize_path(path)[:255],
                action=action_for_path(path)[:64],
                status_code=int(status_code),
                success=200 <= int(status_code) < 400,
                fail_reason=fail_reason,
                duration_ms=max(0, int(duration_ms)),
                email=email,
                user_id=user_id,
                app_id=app_id,
                created_at=_utcnow(),
            ))
            await db.commit()
    except Exception:
        logger.exception('failed to write operation log')


async def purge_expired_operation_logs(db: AsyncSession) -> int:
    days = max(1, int(settings.operation_log_retention_days))
    cutoff = _utcnow() - timedelta(days=days)
    result = await db.execute(delete(OperationLog).where(OperationLog.created_at < cutoff))
    await db.commit()
    return int(result.rowcount or 0)


def elapsed_ms(started: float) -> int:
    return max(0, int((time.perf_counter() - started) * 1000))
