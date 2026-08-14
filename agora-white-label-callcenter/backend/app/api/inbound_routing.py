import asyncio
import json
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.phone_number_v2 import PhoneNumberV2
from app.services.env_scope import (
    agent_belongs_to_env,
    current_app_id,
    load_env_campaign_phone_ids,
    load_local_agent_ids,
    phone_belongs,
    phone_scope_filter,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/inbound-routing', tags=['inbound-routing'])

PHONE_NUMBER_BASE_URL = f'{settings.agora_conversational_base_url}/phone-numbers'


def _headers() -> dict:
    return {
        'Authorization': f'Basic {settings.agora_conversational_api_key}',
        'Content-Type': 'application/json',
    }


class CallSuccessEvaluation(BaseModel):
    criteria: str = ''


class CustomEvaluation(BaseModel):
    variable_name: str
    type: str  # 'number', 'boolean', 'string'
    criteria: str
    enums: list[str] = []


class StructuredOutputConfig(BaseModel):
    enable_structured_output: bool = True
    call_success_evaluation: CallSuccessEvaluation = CallSuccessEvaluation()
    custom_evaluations: list[CustomEvaluation] = []


class EndCallConfig(BaseModel):
    max_call_duration_seconds: int = 600
    silence_timeout_seconds: int = 120
    end_call_on_silence_timeout: bool = True
    ring_timeout_seconds: int = 45
    end_call_on_voicemail: bool = True
    end_call_on_user_request: bool = True
    end_call_on_ai_assistant: bool = True


class TransferConfig(BaseModel):
    enabled: bool = False
    phone_number: str = ''
    description: str = ''


class BindingRequest(BaseModel):
    agent_id: str
    end_call_config: EndCallConfig = EndCallConfig()
    structured_output: StructuredOutputConfig = StructuredOutputConfig()
    transfer_config: TransferConfig = TransferConfig()
    enable_transcript: bool = True
    enable_recording: bool = True


async def _fetch_binding(client: httpx.AsyncClient, number_id: str) -> dict | None:
    try:
        resp = await client.get(
            f'{PHONE_NUMBER_BASE_URL}/{number_id}/agent-binding',
            headers=_headers(),
        )
        if resp.status_code == 200:
            body = resp.json()
            # Handle both {code:0, data:{...}} and direct data shapes
            if isinstance(body, dict):
                code = body.get('code')
                if code == 0 or code == '0':
                    return body.get('data')
                # Some endpoints return data directly without code wrapper
                if 'agent_id' in body:
                    return body
        return None
    except Exception:
        return None


@router.get('')
async def list_inbound_routing(db: AsyncSession = Depends(get_db)):
    local_agent_ids = await load_local_agent_ids(db)
    campaign_phone_ids = await load_env_campaign_phone_ids(db, local_agent_ids)
    result = await db.execute(
        select(PhoneNumberV2)
        .where(phone_scope_filter(campaign_phone_ids))
        .order_by(PhoneNumberV2.id.desc())
    )
    numbers = result.scalars().all()

    async with httpx.AsyncClient(timeout=10) as client:
        bindings = await asyncio.gather(*[
            _fetch_binding(client, n.number_id) for n in numbers
        ])

    out = []
    for n, b in zip(numbers, bindings):
        binding = b
        if binding and binding.get('agent_id'):
            if binding['agent_id'] not in local_agent_ids:
                # 绑定到他环境 agent：不展示 binding，避免误操作
                binding = None
            elif not n.app_id:
                n.app_id = current_app_id()
        out.append({
            'number_id': n.number_id,
            'name': n.name,
            'phone_number': n.phone_number,
            'type': n.type,
            'binding': binding,
        })
    await db.commit()
    return out


@router.get('/{number_id}')
async def get_inbound_routing(number_id: str, db: AsyncSession = Depends(get_db)):
    local_agent_ids = await load_local_agent_ids(db)
    campaign_phone_ids = await load_env_campaign_phone_ids(db, local_agent_ids)
    pn = (await db.execute(
        select(PhoneNumberV2).where(PhoneNumberV2.number_id == number_id)
    )).scalar_one_or_none()

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f'{PHONE_NUMBER_BASE_URL}/{number_id}/agent-binding',
            headers=_headers(),
        )
        binding_agent_id = None
        data = None
        if resp.status_code == 200:
            body = resp.json()
            data = body.get('data') if isinstance(body, dict) and 'data' in body else body
            if isinstance(data, dict):
                binding_agent_id = data.get('agent_id')

    if pn and not phone_belongs(
        stamped_app_id=pn.app_id,
        number_id=number_id,
        binding_agent_id=binding_agent_id,
        local_agent_ids=local_agent_ids,
        campaign_phone_ids=campaign_phone_ids,
    ):
        raise HTTPException(status_code=404, detail='Phone number not found')

    if resp.status_code == 404:
        return {'binding': None}
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    if binding_agent_id and binding_agent_id not in local_agent_ids:
        return {'binding': None}
    return {'binding': data}


@router.post('/{number_id}/bind')
async def bind_phone_number(number_id: str, body: BindingRequest, db: AsyncSession = Depends(get_db)):
    if not await agent_belongs_to_env(db, body.agent_id):
        raise HTTPException(
            status_code=400,
            detail='agent_id does not belong to the current environment app_id',
        )

    payload = {
        'agent_id': body.agent_id,
        'end_call_config': body.end_call_config.model_dump(),
        'structured_output': body.structured_output.model_dump(),
        'transfer_config': body.transfer_config.model_dump(),
        'enable_transcript': body.enable_transcript,
        'enable_recording': body.enable_recording,
    }

    url = f'{PHONE_NUMBER_BASE_URL}/{number_id}/agent-binding'
    logger.info('[inbound-routing] POST %s\npayload: %s', url, json.dumps(payload, indent=2))

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload, headers=_headers())
    except httpx.ConnectTimeout:
        raise HTTPException(status_code=504, detail='Connection to Agora API timed out. Check network / VPN.')
    except httpx.TimeoutException as e:
        raise HTTPException(status_code=504, detail=f'Agora API request timed out: {e}')
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f'Failed to reach Agora API: {e}')

    logger.info(
        '[inbound-routing] Agora response: status=%s body=%s',
        resp.status_code, resp.text,
    )

    if resp.status_code not in (200, 201):
        raise HTTPException(
            status_code=resp.status_code,
            detail=f'Agora error {resp.status_code}: {resp.text}',
        )

    result = resp.json()
    # Agora sometimes returns HTTP 200 but with a non-zero error code
    code = result.get('code')
    if code is not None and code != 0 and code != '0':
        msg = result.get('message') or result.get('detail') or json.dumps(result)
        logger.error('[inbound-routing] Agora returned error code %s: %s', code, msg)
        raise HTTPException(status_code=400, detail=f'Agora error (code={code}): {msg}')

    # 成功绑定后补齐本环境 stamp
    pn = (await db.execute(
        select(PhoneNumberV2).where(PhoneNumberV2.number_id == number_id)
    )).scalar_one_or_none()
    if pn and pn.app_id != current_app_id():
        pn.app_id = current_app_id()
        await db.commit()

    return result


@router.delete('/{number_id}/bind')
async def unbind_phone_number(number_id: str):
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.delete(
                f'{PHONE_NUMBER_BASE_URL}/{number_id}/agent-binding',
                headers=_headers(),
            )
    except httpx.ConnectTimeout:
        raise HTTPException(status_code=504, detail='Connection to Agora API timed out. Check network / VPN.')
    except httpx.TimeoutException as e:
        raise HTTPException(status_code=504, detail=f'Agora API request timed out: {e}')
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f'Failed to reach Agora API: {e}')

    logger.info('[inbound-routing] DELETE binding: status=%s body=%s', resp.status_code, resp.text)

    if resp.status_code not in (200, 204):
        raise HTTPException(status_code=resp.status_code, detail=f'Agora error {resp.status_code}: {resp.text}')

    return {'detail': 'unbound'}
