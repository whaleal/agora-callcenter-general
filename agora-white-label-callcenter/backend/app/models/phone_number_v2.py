from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PhoneNumberV2(Base):
    __tablename__ = 'phone_numbers_v2'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    number_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    phone_number: Mapped[str] = mapped_column(String(64))
    type: Mapped[str] = mapped_column(String(32))
    # 本环境归属：create 时 stamp；sync 时按 binding/campaign 引用补齐
    app_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    sip_gateway_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sip_signaling_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outbound_protocol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
