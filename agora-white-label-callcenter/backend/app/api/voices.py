from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.voice_library import VoiceLibrary

router = APIRouter(prefix='/api/voices', tags=['voices'])


def _serialize(v: VoiceLibrary) -> dict:
    return {
        'voice_id': v.voice_id,
        'name': v.name,
        'language': v.language,
        'gender': v.gender,
        'age': v.age,
    }


@router.get('')
async def list_voices(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(VoiceLibrary).order_by(VoiceLibrary.language, VoiceLibrary.name)
    )
    return [_serialize(r) for r in result.scalars().all()]
