from __future__ import annotations

from fastapi import HTTPException, Request, status
from starlette.datastructures import State
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.security import decode_access_token
from app.core.tenant import ROLE_USER, bind_request_user, reset_request_user
from app.models.user import User

PUBLIC_PATHS = {
    '/health',
    '/docs',
    '/redoc',
    '/openapi.json',
    '/docs/oauth2-redirect',
}

PUBLIC_PREFIXES = (
    '/docs',
    '/redoc',
)

# 登录/注册/发码本身不能要求 token；仅 /api/auth/me 需要已登录
AUTH_PUBLIC_PREFIX = '/api/auth/'
AUTH_PROTECTED_PATHS = {'/api/auth/me'}


def _normalize_path(path: str) -> str:
    if path != '/' and path.endswith('/'):
        return path[:-1]
    return path


def is_public_path(method: str, path: str) -> bool:
    if method == 'OPTIONS':
        return True
    normalized = _normalize_path(path)
    if normalized in PUBLIC_PATHS:
        return True
    if normalized.startswith(AUTH_PUBLIC_PREFIX) and normalized not in AUTH_PROTECTED_PATHS:
        return True
    return any(normalized.startswith(prefix) for prefix in PUBLIC_PREFIXES)


def get_current_user_from_request(request: Request) -> dict:
    user = getattr(request.state, 'user', None)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Not authenticated')
    return user


class AuthMiddleware:
    """Pure ASGI middleware so StreamingResponse / SSE are not buffered."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return

        method = scope.get('method', 'GET')
        path = scope.get('path', '')
        if is_public_path(method, path):
            await self.app(scope, receive, send)
            return

        headers = {k.decode('latin-1').lower(): v.decode('latin-1') for k, v in scope.get('headers', [])}
        auth_header = headers.get('authorization', '')
        if not auth_header.lower().startswith('bearer '):
            response = JSONResponse(status_code=401, content={'detail': 'Not authenticated'})
            await response(scope, receive, send)
            return

        token = auth_header.split(' ', 1)[1].strip()
        if not token:
            response = JSONResponse(status_code=401, content={'detail': 'Not authenticated'})
            await response(scope, receive, send)
            return

        try:
            payload = decode_access_token(token)
        except HTTPException as exc:
            response = JSONResponse(status_code=exc.status_code, content={'detail': exc.detail})
            await response(scope, receive, send)
            return

        sub = payload.get('sub')
        try:
            user_id = int(sub)
        except (TypeError, ValueError):
            response = JSONResponse(status_code=401, content={'detail': 'invalid token'})
            await response(scope, receive, send)
            return

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()

        if user is None or not user.is_active:
            response = JSONResponse(status_code=401, content={'detail': 'user not found or inactive'})
            await response(scope, receive, send)
            return

        user_payload = {
            'id': user.id,
            'email': user.email,
            'username': user.username,
            'app_id': user.app_id,
            'role': user.role or ROLE_USER,
        }
        raw_state = scope.get('state')
        if isinstance(raw_state, dict):
            raw_state['user'] = user_payload
        elif isinstance(raw_state, State):
            raw_state.user = user_payload
        else:
            scope['state'] = {'user': user_payload}

        tokens = bind_request_user(user_payload)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_request_user(tokens)
