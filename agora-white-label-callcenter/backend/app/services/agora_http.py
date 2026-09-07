from fastapi import HTTPException

from app.core.config import settings


def agora_headers() -> dict[str, str]:
    """Authorization headers for Agora Conversational AI REST APIs."""
    key = (settings.agora_conversational_api_key or '').strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail='AGORA_CONVERSATIONAL_API_KEY 未配置，请写入 backend/.env 后重启',
        )
    return {
        'Authorization': f'Basic {key}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }
