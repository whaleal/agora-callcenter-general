from sqlalchemy import String, Integer, Boolean, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CaseStudyRun(Base):
    __tablename__ = 'case_study_run'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    biz_date: Mapped[str] = mapped_column(String(16), index=True)
    agent_id: Mapped[str] = mapped_column(String(128), index=True)
    agent_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    app_id: Mapped[str] = mapped_column(String(64), index=True)

    calls_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    answered_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    effective_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # running | ready | skipped | failed
    status: Mapped[str] = mapped_column(String(32), default='running', nullable=False, index=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    baseline_system_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggested_system_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    optimizer_detail: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    forked_agent_ids: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str | None] = mapped_column(String(64), nullable=True)


class CaseStudyFilterLog(Base):
    __tablename__ = 'case_study_filter_log'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey('case_study_run.id'), index=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    stage: Mapped[str] = mapped_column(String(32), nullable=False)  # db | ai_qc
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    input_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    passed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    dropped_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    message: Mapped[str] = mapped_column(Text, nullable=False)


class CaseStudyCallQc(Base):
    __tablename__ = 'case_study_call_qc'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey('case_study_run.id'), index=True)
    call_id: Mapped[str] = mapped_column(String(64), index=True)
    campaign_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    db_passed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    effective: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    drop_stage: Mapped[str | None] = mapped_column(String(32), nullable=True)
    drop_reason: Mapped[str | None] = mapped_column(String(128), nullable=True)
    transcript_score: Mapped[str | None] = mapped_column(String(32), nullable=True)
    audio_score: Mapped[str | None] = mapped_column(String(32), nullable=True)
    criteria_passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    rubric: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    success_criteria_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    call_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
