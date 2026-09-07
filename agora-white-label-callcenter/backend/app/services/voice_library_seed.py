import json
from pathlib import Path

from sqlalchemy import delete, func, select

from app.core.database import AsyncSessionLocal
from app.models.voice_library import VoiceLibrary

SEED_PATH = Path(__file__).resolve().parent.parent / 'data' / 'minimax_voice_library.json'


async def seed_voice_library() -> None:
    if not SEED_PATH.is_file():
        return
    rows: list[dict] = json.loads(SEED_PATH.read_text(encoding='utf-8'))
    if not rows:
        return

    async with AsyncSessionLocal() as session:
        count = (await session.execute(select(func.count()).select_from(VoiceLibrary))).scalar() or 0
        existing_ids = set()
        if count:
            existing_ids = set(
                (await session.execute(select(VoiceLibrary.voice_id))).scalars().all()
            )
        seed_ids = {r['voice_id'] for r in rows if r.get('voice_id')}
        if count == len(rows) and existing_ids == seed_ids:
            return

        await session.execute(delete(VoiceLibrary))
        session.add_all([
            VoiceLibrary(
                voice_id=r['voice_id'],
                name=r.get('name') or r['voice_id'],
                language=r.get('language') or '',
                gender=r.get('gender'),
                age=r.get('age'),
            )
            for r in rows
            if r.get('voice_id')
        ])
        await session.commit()
