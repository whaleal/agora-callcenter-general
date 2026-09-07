import json
import random
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.agent_v2 import AgentV2
from app.services.env_scope import agent_belongs_to_env
from app.services.agora_http import agora_headers as _headers

router = APIRouter(prefix='/api/live-test', tags=['live-test'])

TOKEN_SERVER_URL = 'https://token.stantest.top:8084/fetch_agora_token3'


async def _fetch_token(uid: str, channel: str) -> str:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            TOKEN_SERVER_URL,
            json={'uid': uid, 'channel': channel},
            headers={'Content-Type': 'application/json'},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f'Token server error: {resp.text}')
    data = resp.json()
    token = data.get('token', '')
    if not token:
        raise HTTPException(status_code=502, detail='Token server returned empty token')
    return token


def _session_join_url() -> str:
    parsed = urlparse(settings.agora_conversational_base_url)
    return (
        f'{parsed.scheme}://{parsed.netloc}'
        f'/api/conversational-ai-agent/v2'
        f'/projects/{settings.agora_project_id}/join'
    )


def _session_leave_url(session_agent_id: str) -> str:
    parsed = urlparse(settings.agora_conversational_base_url)
    return (
        f'{parsed.scheme}://{parsed.netloc}'
        f'/api/conversational-ai-agent/v2'
        f'/projects/{settings.agora_project_id}'
        f'/agents/{session_agent_id}/leave'
    )


# ── Models ────────────────────────────────────────────────────────────────────

class TokenRequest(BaseModel):
    uid: str
    channel: str


class StartRequest(BaseModel):
    agent_id: str
    channel: str
    user_uid: str


class StopRequest(BaseModel):
    session_agent_id: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post('/token')
async def get_token(body: TokenRequest):
    token = await _fetch_token(body.uid, body.channel)
    return {'token': token, 'app_id': settings.agora_project_id}


@router.post('/start')
async def start_live_test(body: StartRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AgentV2).where(AgentV2.agent_id == body.agent_id))
    agent = result.scalar_one_or_none()
    if not agent or not await agent_belongs_to_env(db, body.agent_id):
        raise HTTPException(status_code=404, detail='Agent not found')

    stored_props: dict = json.loads(agent.properties) if agent.properties else {}

    agent_uid = str(random.randint(1000, 9999))
    user_token, agent_token = await _fetch_token(body.user_uid, body.channel), None
    agent_token = await _fetch_token(agent_uid, body.channel)

    print(f'[live-test] token server OK  user_token={user_token[:40]}...')
    print(f'[live-test] token server OK  agent_token={agent_token[:40]}...')

    session_props: dict = {
        'channel': body.channel,
        'token': agent_token,
        'agent_rtc_uid': agent_uid,
        'remote_rtc_uids': [body.user_uid],
        'idle_timeout': stored_props.get('idle_timeout', 120),
    }
    for key in ('asr', 'llm', 'tts', 'parameters', 'turn_detection', 'advanced_features'):
        if key in stored_props:
            session_props[key] = stored_props[key]

    # Ensure RTM transcription is always enabled for live test
    params = session_props.setdefault('parameters', {})
    params['data_channel'] = 'rtm'

    adv = session_props.setdefault('advanced_features', {})
    adv['enable_rtm'] = True

    payload = {
        'name': str(random.randint(10_000_000, 99_999_999)),
        'properties': session_props,
    }

    join_url = _session_join_url()
    print(f'[live-test] POST {join_url}')
    print(f'[live-test] channel={body.channel}  agent_uid={agent_uid}  user_uid={body.user_uid}')

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(join_url, json=payload, headers=_headers())

    print(f'[live-test] Agora response {resp.status_code}: {resp.text[:500]}')

    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    data = resp.json()
    code = data.get('code', data.get('reason'))
    if code not in (0, '0', None):
        raise HTTPException(
            status_code=400,
            detail=data.get('message', data.get('detail', 'Agora join error')),
        )

    session_agent_id = (
        data.get('data', {}).get('agent_id')
        or data.get('agent_id')
        or data.get('id')
        or ''
    )
    return {
        'session_agent_id': session_agent_id,
        'channel': body.channel,
        'user_uid': body.user_uid,
        'user_token': user_token,
        'app_id': settings.agora_project_id,
    }


@router.post('/stop')
async def stop_live_test(body: StopRequest):
    leave_url = _session_leave_url(body.session_agent_id)
    print(f'[live-test] POST {leave_url}')

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(leave_url, headers=_headers())

    print(f'[live-test] Agora leave {resp.status_code}: {resp.text[:200]}')

    if resp.status_code not in (200, 201, 204):
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    return {'detail': 'stopped'}
