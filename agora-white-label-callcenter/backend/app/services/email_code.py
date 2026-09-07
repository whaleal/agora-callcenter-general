from __future__ import annotations

import logging
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import EmailVerificationCode

logger = logging.getLogger(__name__)

PURPOSE_REGISTER = 'register'
PURPOSE_LOGIN = 'login'


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def generate_code() -> str:
    return f'{secrets.randbelow(1_000_000):06d}'


async def issue_code(db: AsyncSession, email: str, purpose: str) -> tuple[str, bool]:
    """生成并保存验证码。返回 (code, smtp_configured)。"""
    now = _utcnow()
    resend_after = now - timedelta(seconds=settings.email_code_resend_seconds)
    recent = await db.execute(
        select(EmailVerificationCode)
        .where(
            EmailVerificationCode.email == email,
            EmailVerificationCode.purpose == purpose,
            EmailVerificationCode.created_at >= resend_after,
        )
        .order_by(EmailVerificationCode.created_at.desc())
        .limit(1)
    )
    if recent.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=429,
            detail=f'please wait {settings.email_code_resend_seconds}s before requesting another code',
        )

    await db.execute(
        update(EmailVerificationCode)
        .where(
            EmailVerificationCode.email == email,
            EmailVerificationCode.purpose == purpose,
            EmailVerificationCode.used.is_(False),
        )
        .values(used=True)
    )

    code = generate_code()
    record = EmailVerificationCode(
        email=email,
        code=code,
        purpose=purpose,
        expires_at=now + timedelta(seconds=settings.email_code_ttl_seconds),
        used=False,
        created_at=now,
    )
    db.add(record)
    await db.commit()
    return code, settings.smtp_enabled


async def consume_code(db: AsyncSession, email: str, code: str, purpose: str) -> None:
    now = _utcnow()
    result = await db.execute(
        select(EmailVerificationCode)
        .where(
            EmailVerificationCode.email == email,
            EmailVerificationCode.purpose == purpose,
            EmailVerificationCode.code == code.strip(),
            EmailVerificationCode.used.is_(False),
            EmailVerificationCode.expires_at > now,
        )
        .order_by(EmailVerificationCode.created_at.desc())
        .limit(1)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=400, detail='invalid or expired verification code')
    record.used = True
    await db.flush()


def send_verification_email(to_email: str, code: str, purpose: str) -> None:
    host = (settings.smtp_host or '').strip()
    if not host:
        logger.warning('SMTP not configured; verification code for %s (%s): %s', to_email, purpose, code)
        return

    subject = 'Registration code' if purpose == PURPOSE_REGISTER else 'Login code'
    body = (
        f'Your verification code is: {code}\n'
        f'It expires in {settings.email_code_ttl_seconds // 60} minutes.\n'
        f'If you did not request this, please ignore this email.\n'
    )
    from_addr = (settings.smtp_from or settings.smtp_user or '').strip()
    if not from_addr:
        raise RuntimeError('SMTP_FROM or SMTP_USER must be set when SMTP is enabled')

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = from_addr
    msg['To'] = to_email
    msg.set_content(body)

    user = (settings.smtp_user or '').strip()
    if settings.smtp_implicit_ssl:
        with smtplib.SMTP_SSL(host, settings.smtp_port, timeout=20) as smtp:
            if user:
                smtp.login(user, settings.smtp_password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, settings.smtp_port, timeout=20) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if user:
                smtp.login(user, settings.smtp_password)
            smtp.send_message(msg)
    logger.info('verification email sent to %s (%s)', to_email, purpose)
