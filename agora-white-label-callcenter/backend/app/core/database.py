from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from .config import settings

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)
async_session_factory = AsyncSessionLocal  # alias for background tasks


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:  # type: ignore[return]
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    """Create all tables on startup (dev only; use Alembic in production)."""
    # 显式 import 所有模型，确保 Base.metadata 已注册
    from app.models.agora_campaign import AgoraCampaign  # noqa: F401
    from app.models.campaign_call import CampaignCall  # noqa: F401
    from app.models.phone_number_v2 import PhoneNumberV2  # noqa: F401
    from app.models.agent_v2 import AgentV2  # noqa: F401
    from app.models.campaign_v2 import CampaignV2  # noqa: F401
    from app.models.quota_v2 import QuotaV2  # noqa: F401
    from app.models.calls_v2 import CallV2  # noqa: F401
    from app.models.calls_v2_sync_state import CallV2SyncState  # noqa: F401
    from app.models.case_study import CaseStudyRun, CaseStudyFilterLog, CaseStudyCallQc  # noqa: F401
    from app.models.voice_library import VoiceLibrary  # noqa: F401
    from app.models.user import EmailVerificationCode, User  # noqa: F401
    from app.models.operation_log import OperationLog  # noqa: F401
    from app.models.call_usage import CallUsage  # noqa: F401

    from sqlalchemy import text

    # Step 1: create all ORM-mapped tables (idempotent)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Helper: run each DDL in its own transaction so one failure can't abort the rest
    async def _ddl(sql: str) -> None:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(sql))
        except Exception:
            pass

    # calls_v2 column migrations
    await _ddl('ALTER TABLE calls_v2 ADD COLUMN IF NOT EXISTS hangup_reason VARCHAR(128)')
    await _ddl('ALTER TABLE calls_v2 ADD COLUMN IF NOT EXISTS transcript TEXT')
    await _ddl('ALTER TABLE calls_v2 ADD COLUMN IF NOT EXISTS record_file_url TEXT')
    await _ddl('ALTER TABLE calls_v2 ADD COLUMN IF NOT EXISTS structured_output TEXT')
    await _ddl('ALTER TABLE calls_v2 ADD COLUMN IF NOT EXISTS start_ts BIGINT')
    await _ddl('ALTER TABLE calls_v2 ADD COLUMN IF NOT EXISTS end_ts BIGINT')
    await _ddl('ALTER TABLE calls_v2 ADD COLUMN IF NOT EXISTS structured_output_status VARCHAR(64)')
    await _ddl(
        'ALTER TABLE calls_v2 ADD COLUMN IF NOT EXISTS quota_checked '
        'BOOLEAN NOT NULL DEFAULT false',
    )
    await _ddl('ALTER TABLE calls_v2 ADD COLUMN IF NOT EXISTS quota_check_detail TEXT')
    await _ddl('ALTER TABLE quota_v2 ADD COLUMN IF NOT EXISTS hit_evidence TEXT')

    # campaigns_v2 column migrations
    await _ddl('ALTER TABLE campaigns_v2 ADD COLUMN IF NOT EXISTS total_numbers INTEGER')
    await _ddl('ALTER TABLE campaigns_v2 ADD COLUMN IF NOT EXISTS app_id VARCHAR(64)')
    await _ddl('ALTER TABLE phone_numbers_v2 ADD COLUMN IF NOT EXISTS app_id VARCHAR(64)')
    await _ddl("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user'")
    await _ddl('ALTER TABLE operation_logs ADD COLUMN IF NOT EXISTS user_id INTEGER')
    await _ddl('ALTER TABLE operation_logs ADD COLUMN IF NOT EXISTS app_id VARCHAR(64)')
    await _ddl('ALTER TABLE operation_logs ALTER COLUMN action TYPE VARCHAR(64)')
    await _ddl("ALTER TABLE call_usage ADD COLUMN IF NOT EXISTS direction VARCHAR(16) NOT NULL DEFAULT 'outbound'")

    from app.services.voice_library_seed import seed_voice_library
    await seed_voice_library()
