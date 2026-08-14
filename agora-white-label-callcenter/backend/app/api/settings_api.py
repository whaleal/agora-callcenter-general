from pathlib import Path

from dotenv import set_key, dotenv_values
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix='/api/settings', tags=['settings'])

ENV_PATH = Path(__file__).parent.parent.parent / '.env'

KEYS = [
    'DATABASE_URL',
    'OPENROUTER_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'AGORA_API_KEY',
    'AGORA_PIPELINE_ID',
    'AGORA_PHONE_NUMBER',
    'VOICE_AGENT_BASE_URL',
    'VOICE_AGENT_API_KEY',
    'WEBHOOK_SECRET',
    'POLL_INTERVAL_SECONDS',
    'MAX_CONCURRENT_CALLS',
]


class SettingsPayload(BaseModel):
    DATABASE_URL: str = ''
    OPENROUTER_API_KEY: str = ''
    ANTHROPIC_API_KEY: str = ''
    OPENAI_API_KEY: str = ''
    AGORA_API_KEY: str = ''
    AGORA_PIPELINE_ID: str = ''
    AGORA_PHONE_NUMBER: str = ''
    VOICE_AGENT_BASE_URL: str = ''
    VOICE_AGENT_API_KEY: str = ''
    WEBHOOK_SECRET: str = ''
    POLL_INTERVAL_SECONDS: str = '5'
    MAX_CONCURRENT_CALLS: str = '10'


@router.get('')
async def get_settings():
    values = dotenv_values(ENV_PATH)
    return {k: values.get(k, '') for k in KEYS}


@router.post('')
async def save_settings(payload: SettingsPayload):
    data = payload.model_dump()
    for key, value in data.items():
        set_key(str(ENV_PATH), key, value)
    return {'ok': True}
