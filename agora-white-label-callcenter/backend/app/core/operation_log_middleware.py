from __future__ import annotations

import logging
import time

from starlette.types import ASGIApp, Receive, Scope, Send

from app.services.operation_log import (
    AUTH_LOG_PREFIX,
    app_id_from_body,
    client_ip,
    elapsed_ms,
    email_from_body,
    fail_reason_from_body,
    normalize_path,
    should_log_path,
    write_operation_log,
)

logger = logging.getLogger(__name__)


class OperationLogMiddleware:
    """Records mutating /api/* requests and all /api/auth/* into operation_logs."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return

        method = scope.get('method', 'GET')
        path = scope.get('path', '')
        if method == 'OPTIONS' or not should_log_path(method, path):
            await self.app(scope, receive, send)
            return

        headers = {
            k.decode('latin-1').lower(): v.decode('latin-1')
            for k, v in scope.get('headers', [])
        }
        ip = client_ip(scope, headers)
        req_chunks: list[bytes] = []
        capture_body = normalize_path(path).startswith(AUTH_LOG_PREFIX)
        req_bytes = 0

        async def receive_wrapper() -> dict:
            nonlocal req_bytes
            message = await receive()
            if capture_body and message.get('type') == 'http.request' and req_bytes < 8192:
                chunk = message.get('body') or b''
                req_chunks.append(chunk[: 8192 - req_bytes])
                req_bytes += len(chunk)
            return message

        started = time.perf_counter()
        status_code = 500
        resp_chunks: list[bytes] = []

        async def send_wrapper(message: dict) -> None:
            nonlocal status_code
            if message.get('type') == 'http.response.start':
                status_code = int(message.get('status') or 500)
            elif message.get('type') == 'http.response.body' and status_code >= 400:
                resp_chunks.append(message.get('body') or b'')
            await send(message)

        try:
            await self.app(scope, receive_wrapper, send_wrapper)
        finally:
            duration_ms = elapsed_ms(started)
            fail_reason = fail_reason_from_body(b''.join(resp_chunks)) if status_code >= 400 else None
            email = email_from_body(b''.join(req_chunks))
            body_app_id = app_id_from_body(b''.join(req_chunks))
            user_id = None
            app_id = None
            raw_state = scope.get('state')
            user = None
            if isinstance(raw_state, dict):
                user = raw_state.get('user')
            else:
                user = getattr(raw_state, 'user', None)
            if isinstance(user, dict):
                user_id = user.get('id')
                app_id = user.get('app_id')
                email = email or user.get('email')
            app_id = app_id or body_app_id
            try:
                await write_operation_log(
                    ip=ip,
                    method=method,
                    path=path,
                    status_code=status_code,
                    duration_ms=duration_ms,
                    fail_reason=fail_reason,
                    email=email,
                    user_id=user_id,
                    app_id=app_id,
                )
            except Exception:
                logger.exception('operation log middleware failed')
