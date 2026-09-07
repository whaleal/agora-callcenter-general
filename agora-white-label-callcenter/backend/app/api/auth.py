from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_middleware import get_current_user_from_request
from app.core.database import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.core.tenant import ROLE_ADMIN, ROLE_USER
from app.models.user import User
from app.schemas.auth import (
    AdminLoginRequest,
    LoginRequest,
    RegisterRequest,
    SendCodeRequest,
    SendCodeResponse,
    TokenResponse,
    UserOut,
)
from app.services.email_code import (
    PURPOSE_LOGIN,
    PURPOSE_REGISTER,
    consume_code,
    issue_code,
    send_verification_email,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/auth', tags=['auth'])


def _norm_email(email: str) -> str:
    return email.strip().lower()


def _token_response(user: User) -> TokenResponse:
    token = create_access_token(
        user_id=user.id,
        email=user.email,
        username=user.username,
        app_id=user.app_id,
        role=user.role or ROLE_USER,
    )
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post('/send-code', response_model=SendCodeResponse, openapi_extra={'security': []})
async def send_code(body: SendCodeRequest, db: AsyncSession = Depends(get_db)):
    email = _norm_email(body.email)
    code_type = body.type

    existing = await db.execute(select(User).where(User.email == email))
    user = existing.scalar_one_or_none()

    if code_type == PURPOSE_REGISTER:
        if user is not None:
            raise HTTPException(status_code=400, detail='email already registered')
    elif code_type == PURPOSE_LOGIN:
        password = (body.password or '').strip()
        if not password:
            raise HTTPException(status_code=400, detail='password is required')
        if user is None or not user.is_active or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=400, detail='invalid email or password')

    code, smtp_configured = await issue_code(db, email, code_type)
    try:
        await asyncio.to_thread(send_verification_email, email, code, code_type)
    except Exception:
        logger.exception('failed to send verification email to %s', email)
        raise HTTPException(status_code=502, detail='failed to send verification email')

    return SendCodeResponse(
        ok=True,
        message='verification code sent',
        dev_code=None if smtp_configured else code,
    )


@router.post('/register', response_model=TokenResponse, openapi_extra={'security': []})
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    email = _norm_email(body.email)
    username = body.username.strip()
    app_id = body.app_id.strip()
    if not username:
        raise HTTPException(status_code=400, detail='username is required')
    if not app_id:
        raise HTTPException(status_code=400, detail='appId is required')

    dup_email = await db.execute(select(User).where(User.email == email))
    if dup_email.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail='email already registered')

    dup_name = await db.execute(
        select(User).where(func.lower(User.username) == username.lower())
    )
    if dup_name.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail='username already taken')

    await consume_code(db, email, body.code, PURPOSE_REGISTER)

    user = User(
        email=email,
        username=username,
        password_hash=hash_password(body.password),
        app_id=app_id,
        role=ROLE_USER,
        is_active=True,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail='email or username already registered')
    await db.refresh(user)
    return _token_response(user)


@router.post('/login', response_model=TokenResponse, openapi_extra={'security': []})
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    email = _norm_email(body.email)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail='invalid email or password')

    await consume_code(db, email, body.code, PURPOSE_LOGIN)
    await db.commit()
    return _token_response(user)


@router.post('/admin-login', response_model=TokenResponse, openapi_extra={'security': []})
async def admin_login(body: AdminLoginRequest, db: AsyncSession = Depends(get_db)):
    """Admin-only login: username + password, no email verification code."""
    ident = body.username.strip()
    if not ident:
        raise HTTPException(status_code=400, detail='invalid username or password')

    result = await db.execute(
        select(User).where(func.lower(User.username) == ident.lower())
    )
    user = result.scalar_one_or_none()
    if user is None and '@' in ident:
        result = await db.execute(select(User).where(User.email == ident.lower()))
        user = result.scalar_one_or_none()

    if (
        user is None
        or not user.is_active
        or (user.role or '').strip().lower() != ROLE_ADMIN
        or not verify_password(body.password, user.password_hash)
    ):
        raise HTTPException(status_code=400, detail='invalid username or password')

    return _token_response(user)


@router.get('/me', response_model=UserOut)
async def me(request: Request):
    return get_current_user_from_request(request)
