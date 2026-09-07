"""Request-scoped tenant (app_id / role) derived from the authenticated user."""

from __future__ import annotations

from contextvars import ContextVar, Token

from app.core.config import settings

_app_id: ContextVar[str | None] = ContextVar('tenant_app_id', default=None)
_is_admin: ContextVar[bool] = ContextVar('tenant_is_admin', default=False)
_user_id: ContextVar[int | None] = ContextVar('tenant_user_id', default=None)
_email: ContextVar[str | None] = ContextVar('tenant_email', default=None)

ROLE_ADMIN = 'admin'
ROLE_USER = 'user'


class TenantTokens:
    __slots__ = ('app_id', 'is_admin', 'user_id', 'email')

    def __init__(self, app_id: Token, is_admin: Token, user_id: Token, email: Token):
        self.app_id = app_id
        self.is_admin = is_admin
        self.user_id = user_id
        self.email = email


def bind_request_user(user: dict | None) -> TenantTokens:
    if not user:
        return TenantTokens(
            _app_id.set(None),
            _is_admin.set(False),
            _user_id.set(None),
            _email.set(None),
        )
    role = (user.get('role') or ROLE_USER).strip().lower()
    return TenantTokens(
        _app_id.set(user.get('app_id')),
        _is_admin.set(role == ROLE_ADMIN),
        _user_id.set(user.get('id')),
        _email.set(user.get('email')),
    )


def reset_request_user(tokens: TenantTokens | None) -> None:
    if tokens is None:
        return
    _app_id.reset(tokens.app_id)
    _is_admin.reset(tokens.is_admin)
    _user_id.reset(tokens.user_id)
    _email.reset(tokens.email)


def is_system_context() -> bool:
    """True for background jobs / unbound requests (no logged-in user)."""
    return _app_id.get() is None and not _is_admin.get()


def is_admin() -> bool:
    return bool(_is_admin.get())


def current_user_id() -> int | None:
    return _user_id.get()


def current_email() -> str | None:
    return _email.get()


def tenant_app_id() -> str | None:
    return _app_id.get()


def current_app_id() -> str:
    """Stamp / filter app_id for the current request. Background jobs fall back to AGORA_PROJECT_ID."""
    if is_admin():
        return settings.agora_project_id
    aid = _app_id.get()
    if aid:
        return aid
    return settings.agora_project_id
