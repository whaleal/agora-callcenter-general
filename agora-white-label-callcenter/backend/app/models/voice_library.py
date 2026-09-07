from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class VoiceLibrary(Base):
    __tablename__ = 'voice_library'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    voice_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    language: Mapped[str] = mapped_column(String(64), index=True)
    gender: Mapped[str | None] = mapped_column(String(32), nullable=True)
    age: Mapped[str | None] = mapped_column(String(32), nullable=True)
