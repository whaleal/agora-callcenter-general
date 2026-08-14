from sqlalchemy import String, Integer, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CampaignV2(Base):
    __tablename__ = 'campaigns_v2'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    campaign_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    campaign_name: Mapped[str] = mapped_column(String(255))
    # 本环境归属：create 时 stamp；sync 时按 agent 归属补齐
    app_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # 本地元数据（创建时填写，不发给 Agora）
    # create_agent_by_ai | existing_agent (new); file_upload | url_load (legacy)
    questionnaire_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # manual | ai_auto (new); hybrid | ai (legacy)
    quota_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    total_numbers: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 从 Agora 详情接口同步
    phone_number_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    phone_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    agent_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    start_immediately: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # end_call_config
    max_call_duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    silence_timeout_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_call_on_silence_timeout: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    ring_timeout_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_call_on_user_request: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    end_call_on_ai_assistant: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # structured_output（完整 JSON）
    structured_output: Mapped[str | None] = mapped_column(Text, nullable=True)

    # features
    enable_transcript: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    enable_recording: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # CSV import metadata
    is_imported: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default='false')
    imported_at: Mapped[str | None] = mapped_column(Text, nullable=True)
