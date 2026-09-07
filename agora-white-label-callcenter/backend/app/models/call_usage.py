from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CallUsage(Base):
    """Per-call usage snapshot, upserted when calls are synced / imported."""

    __tablename__ = 'call_usage'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    call_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    campaign_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    app_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    usage_date: Mapped[str] = mapped_column(String(10), index=True, nullable=False)  # YYYY-MM-DD
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    answered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    call_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    direction: Mapped[str] = mapped_column(String(16), default='outbound', nullable=False, server_default='outbound')
    start_ts: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False,
    )
