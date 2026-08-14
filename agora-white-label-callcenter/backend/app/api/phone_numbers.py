import asyncio

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.phone_number_v2 import PhoneNumberV2
from app.services.env_scope import (
    current_app_id,
    load_env_campaign_phone_ids,
    load_local_agent_ids,
    phone_belongs,
    phone_scope_filter,
)

router = APIRouter(prefix='/api/phone-numbers', tags=['phone-numbers'])

PHONE_NUMBER_BASE_URL = f'{settings.agora_conversational_base_url}/phone-numbers'


def _headers() -> dict:
    return {
        'Authorization': f'Basic {settings.agora_conversational_api_key}',
        'Content-Type': 'application/json',
    }


def _extract_list(body: dict) -> list[dict]:
    """兼容 Agora 列表响应的多种 data 结构。"""
    data = body.get('data')
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        # { "list": [...], "total": N } 形式
        items = data.get('list') or data.get('items') or data.get('phone_numbers') or []
        if isinstance(items, list):
            return items
    return []


class CreatePhoneNumberRequest(BaseModel):
    name: str
    phone_number: str
    type: str = 'sip_trunk'
    sip_gateway_host: str | None = None
    sip_signaling_port: int | None = None
    outbound_protocol: str | None = None


def _serialize(p: PhoneNumberV2) -> dict:
    return {
        'id': p.id,
        'number_id': p.number_id,
        'name': p.name,
        'phone_number': p.phone_number,
        'type': p.type,
        'app_id': p.app_id,
        'sip_gateway_host': p.sip_gateway_host,
        'sip_signaling_port': p.sip_signaling_port,
        'outbound_protocol': p.outbound_protocol,
        'created_at': p.created_at,
        'updated_at': p.updated_at,
    }


async def _fetch_binding_agent_id(client: httpx.AsyncClient, number_id: str) -> str | None:
    try:
        resp = await client.get(
            f'{PHONE_NUMBER_BASE_URL}/{number_id}/agent-binding',
            headers=_headers(),
        )
        if resp.status_code != 200:
            return None
        body = resp.json()
        if isinstance(body, dict):
            code = body.get('code')
            data = body.get('data') if (code == 0 or code == '0' or 'data' in body) else body
            if isinstance(data, dict) and data.get('agent_id'):
                return str(data['agent_id'])
            if body.get('agent_id'):
                return str(body['agent_id'])
    except Exception:
        return None
    return None


async def _list_env_phone_numbers(db: AsyncSession) -> list[dict]:
    local_agent_ids = await load_local_agent_ids(db)
    campaign_phone_ids = await load_env_campaign_phone_ids(db, local_agent_ids)
    result = await db.execute(
        select(PhoneNumberV2)
        .where(phone_scope_filter(campaign_phone_ids))
        .order_by(PhoneNumberV2.id.desc())
    )
    return [_serialize(r) for r in result.scalars().all()]


@router.post('')
async def create_phone_number(body: CreatePhoneNumberRequest, db: AsyncSession = Depends(get_db)):
    payload = body.model_dump(exclude_none=True)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(PHONE_NUMBER_BASE_URL, json=payload, headers=_headers())
    except httpx.ConnectTimeout:
        raise HTTPException(status_code=504, detail='Connection to Agora API timed out. Check network / VPN.')
    except httpx.TimeoutException as e:
        raise HTTPException(status_code=504, detail=f'Agora API request timed out: {e}')
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f'Failed to reach Agora API: {e}')

    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    result = resp.json()
    code = result.get('code') if 'code' in result else result.get('reason')
    if code not in (0, '0'):
        raise HTTPException(status_code=400, detail=result.get('message', result.get('detail', 'Agora API error')))

    data = result['data']
    record = PhoneNumberV2(
        number_id=str(data['number_id']),
        name=data['name'],
        phone_number=data['phone_number'],
        type=data['type'],
        app_id=current_app_id(),
        sip_gateway_host=data.get('sip_gateway_host'),
        sip_signaling_port=data.get('sip_signaling_port'),
        outbound_protocol=data.get('outbound_protocol'),
        created_at=data.get('created_at'),
        updated_at=data.get('updated_at'),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return _serialize(record)


@router.get('')
async def list_phone_numbers(db: AsyncSession = Depends(get_db)):
    return await _list_env_phone_numbers(db)


@router.post('/sync')
async def sync_phone_numbers(db: AsyncSession = Depends(get_db)):
    """从 Agora API 拉取列表；仅 upsert 属于本环境的号码，返回本环境列表。"""
    agora_items: list[dict] = []
    page = 1
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            try:
                resp = await client.get(
                    PHONE_NUMBER_BASE_URL,
                    params={'page': page, 'page_size': 100},
                    headers=_headers(),
                )
                if resp.status_code != 200:
                    break
                body = resp.json()
                items = _extract_list(body)
                agora_items.extend(items)
                if len(items) < 100:
                    break
                page += 1
            except Exception:
                break

    if agora_items:
        local_agent_ids = await load_local_agent_ids(db)
        if not local_agent_ids:
            from app.api.agents import sync_agents
            await sync_agents(db)
            local_agent_ids = await load_local_agent_ids(db)
        campaign_phone_ids = await load_env_campaign_phone_ids(db, local_agent_ids)
        existing_result = await db.execute(select(PhoneNumberV2))
        existing: dict[str, PhoneNumberV2] = {
            r.number_id: r for r in existing_result.scalars().all()
        }
        app_id = current_app_id()

        # 已 stamp 为本环境或被本环境 campaign 引用的，直接更新，无需查 binding
        need_binding: list[str] = []
        for item in agora_items:
            nid = str(item.get('number_id', '')) if item.get('number_id') is not None else ''
            if not nid:
                continue
            stamped = existing[nid].app_id if nid in existing else None
            if phone_belongs(
                stamped_app_id=stamped,
                number_id=nid,
                binding_agent_id=None,
                local_agent_ids=local_agent_ids,
                campaign_phone_ids=campaign_phone_ids,
            ):
                continue
            need_binding.append(nid)

        binding_agent_map: dict[str, str | None] = {}
        if need_binding:
            async with httpx.AsyncClient(timeout=15) as client:
                results = await asyncio.gather(*[
                    _fetch_binding_agent_id(client, nid) for nid in need_binding
                ])
            binding_agent_map = dict(zip(need_binding, results))

        for item in agora_items:
            nid = str(item.get('number_id', '')) if item.get('number_id') is not None else ''
            if not nid:
                continue
            stamped = existing[nid].app_id if nid in existing else None
            binding_agent_id = binding_agent_map.get(nid)
            if not phone_belongs(
                stamped_app_id=stamped,
                number_id=nid,
                binding_agent_id=binding_agent_id,
                local_agent_ids=local_agent_ids,
                campaign_phone_ids=campaign_phone_ids,
            ):
                continue

            stmt = pg_insert(PhoneNumberV2).values(
                number_id=nid,
                name=item.get('name', ''),
                phone_number=item.get('phone_number', ''),
                type=item.get('type', ''),
                app_id=app_id,
                sip_gateway_host=item.get('sip_gateway_host'),
                sip_signaling_port=item.get('sip_signaling_port'),
                outbound_protocol=item.get('outbound_protocol'),
                created_at=item.get('created_at'),
                updated_at=item.get('updated_at'),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=['number_id'],
                set_={
                    'name': stmt.excluded.name,
                    'phone_number': stmt.excluded.phone_number,
                    'type': stmt.excluded.type,
                    'sip_gateway_host': stmt.excluded.sip_gateway_host,
                    'sip_signaling_port': stmt.excluded.sip_signaling_port,
                    'outbound_protocol': stmt.excluded.outbound_protocol,
                    'updated_at': stmt.excluded.updated_at,
                    'app_id': stmt.excluded.app_id,
                },
            )
            await db.execute(stmt)
        await db.commit()

    return await _list_env_phone_numbers(db)


@router.get('/debug/agora-raw')
async def debug_agora_raw():
    """直接返回 Agora API 的原始响应，用于排查 sync 问题。"""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            PHONE_NUMBER_BASE_URL,
            params={'page': 1, 'page_size': 20},
            headers=_headers(),
        )
    return {'status_code': resp.status_code, 'body': resp.json() if resp.content else None}


@router.get('/{number_id}')
async def get_phone_number(number_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PhoneNumberV2).where(PhoneNumberV2.number_id == number_id)
    )
    record = result.scalar_one_or_none()

    if record:
        local_agent_ids = await load_local_agent_ids(db)
        campaign_phone_ids = await load_env_campaign_phone_ids(db, local_agent_ids)
        if not phone_belongs(
            stamped_app_id=record.app_id,
            number_id=record.number_id,
            binding_agent_id=None,
            local_agent_ids=local_agent_ids,
            campaign_phone_ids=campaign_phone_ids,
        ):
            # 可能仅靠 binding 归属；再查一次
            async with httpx.AsyncClient(timeout=10) as client:
                binding_agent_id = await _fetch_binding_agent_id(client, number_id)
            if not phone_belongs(
                stamped_app_id=record.app_id,
                number_id=record.number_id,
                binding_agent_id=binding_agent_id,
                local_agent_ids=local_agent_ids,
                campaign_phone_ids=campaign_phone_ids,
            ):
                raise HTTPException(status_code=404, detail='Phone number not found')
        return _serialize(record)

    # 数据库没有则不自动灌入他环境号码
    raise HTTPException(status_code=404, detail='Phone number not found')


@router.delete('/{number_id}')
async def delete_phone_number(number_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PhoneNumberV2).where(PhoneNumberV2.number_id == number_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail='Phone number not found')

    # 调用 Agora API 删除远端记录
    async with httpx.AsyncClient(timeout=15) as client:
        agora_resp = await client.delete(
            f'{PHONE_NUMBER_BASE_URL}/{number_id}',
            headers=_headers(),
        )
    if agora_resp.status_code not in (200, 204, 404):
        raise HTTPException(
            status_code=agora_resp.status_code,
            detail=f'Agora API error: {agora_resp.text}',
        )

    await db.delete(record)
    await db.commit()
    return {'detail': 'deleted'}
