from __future__ import annotations

import logging
import secrets

from sqlalchemy import or_, select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.core.tenant import ROLE_ADMIN
from app.models.user import User

logger = logging.getLogger(__name__)


async def ensure_admin_user() -> None:
    """Create the default admin account on startup if it does not exist.

    The plaintext password is logged only when a new admin is created.
    """
    username = (settings.admin_username or 'admin').strip()
    email = (settings.admin_email or 'admin@localhost').strip().lower()
    app_id = settings.agora_project_id

    async with AsyncSessionLocal() as db:
        existing = (
            await db.execute(
                select(User).where(or_(User.username == username, User.email == email))
            )
        ).scalar_one_or_none()

        if existing is not None:
            changed = False
            if (existing.role or '').strip().lower() != ROLE_ADMIN:
                existing.role = ROLE_ADMIN
                changed = True
            if not existing.is_active:
                existing.is_active = True
                changed = True
            configured = (settings.admin_password or '').strip()
            if configured:
                existing.password_hash = hash_password(configured)
                changed = True
                logger.warning(
                    'Reset admin password from ADMIN_PASSWORD — username=%s',
                    existing.username,
                )
            if changed:
                await db.commit()
                if not configured:
                    logger.warning(
                        'Promoted existing user to admin: username=%s email=%s',
                        existing.username,
                        existing.email,
                    )
            else:
                logger.info(
                    'Admin user already exists: username=%s email=%s',
                    existing.username,
                    existing.email,
                )
            return

        password = (settings.admin_password or '').strip() or secrets.token_urlsafe(12)
        user = User(
            email=email,
            username=username,
            password_hash=hash_password(password),
            app_id=app_id,
            role=ROLE_ADMIN,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        logger.warning(
            'Created default admin user — username=%s password=%s  '
            '(change this password after first login)',
            username,
            password,
        )
