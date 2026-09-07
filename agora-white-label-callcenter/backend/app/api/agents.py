import asyncio
import json
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.agent_v2 import AgentV2
from app.services.env_scope import agent_scope_filter, current_app_id, is_admin, resource_visible
from app.services.agora_http import agora_headers as _headers

router = APIRouter(prefix='/api/agents', tags=['agents'])

AGENT_BASE_URL = f'{settings.agora_conversational_base_url}/projects/{settings.agora_project_id}/agents'


_ASR_LANG_MAP: dict[str, str] = {
    'Chinese': 'zh-CN',
    'Japanese': 'ja-JP',
    'Korean': 'ko-KR',
    'English': 'en-US',
}


class CreateAgentRequest(BaseModel):
    agent_name: str
    system_content: str
    greeting_message: str
    failure_message: str
    voice_id: str
    language_boost: str = 'Chinese'
    asr_language: str | None = None  # 若不传则从 language_boost 自动推导


def _build_payload(body: CreateAgentRequest) -> dict:
    asr_lang = body.asr_language or _ASR_LANG_MAP.get(body.language_boost, 'zh-CN')
    return {
        'agent_name': body.agent_name,
        'agent_type': 'CALL_AGENT',
        'properties': {
            'asr': {
                'vendor': 'ares',
                'language': asr_lang,
            },
            'llm': {
                'url': settings.openai_compatible_chat_completions_url,
                'api_key': settings.effective_openai_api_key,
                'system_messages': [{'role': 'system', 'content': body.system_content}],
                'max_history': 32,
                'greeting_message': body.greeting_message,
                'failure_message': body.failure_message,
                'params': {'model': settings.agent_llm_model},
            },
            'tts': {
                'vendor': 'minimax',
                'params': {
                    'key': settings.minimax_api_key,
                    'url': 'wss://api-uw.minimax.io/ws/v1/t2a_v2',
                    'model': 'speech-02-turbo',
                    'group_id': '1967483817044222128',
                    'voice_setting': {
                        'voice_id': body.voice_id,
                        'sample_rate': 8000,
                    },
                    'language_boost': body.language_boost,
                },
            },
            'parameters': {
                'transcript': {
                    'enable': True,
                    'protocol_version': 'v2',
                    'enable_words': True,
                    'redundant': False,
                },
                'enable_dump': True,
                'data_channel': 'rtm',
                'audio_scenario': 'default',
                'enable_metrics': True,
                'silence_config': {
                    'action': 'think',
                    'content': '',
                    'timeout_ms': 4000,
                },
                'enable_flexible': True,
                'enable_error_message': True,
            },
            'idle_timeout': 120,
            'turn_detection': {
                'mode': 'default',
                'config': {
                    'start_of_speech': {
                        'mode': 'vad',
                        'vad_config': {
                            'interrupt_duration_ms': 160,
                            'speaking_interrupt_duration_ms': 160,
                            'prefix_padding_ms': 800,
                        },
                    },
                    'end_of_speech': {
                        'mode': 'semantic',
                        'semantic_config': {
                            'silence_duration_ms': 240,
                            'max_wait_ms': 3000,
                        },
                    },
                },
            },
            'advanced_features': {
                'enable_rtm': True,
                'enable_sal': False,
                'enable_tools': True,
            },
        },
    }


def _serialize(a: AgentV2) -> dict:
    props = json.loads(a.properties) if a.properties else None
    return {
        'id': a.id,
        'agent_id': a.agent_id,
        'agent_name': a.agent_name,
        'app_id': a.app_id,
        'system_content': a.system_content,
        'greeting_message': a.greeting_message,
        'failure_message': a.failure_message,
        'voice_id': a.voice_id,
        'properties': _mask_properties(props) if props else props,
        'created_at': a.created_at,
        'updated_at': a.updated_at,
    }


def _record_from_data(data: dict) -> dict:
    props = data.get('properties', {})
    llm = props.get('llm', {})
    system_msgs = llm.get('system_messages', [])
    system_content = next(
        (m.get('content') for m in system_msgs if m.get('role') == 'system'), None
    )
    voice_id = (
        props.get('tts', {}).get('params', {}).get('voice_setting', {}).get('voice_id')
    )
    return {
        'agent_id': data['agent_id'],
        'agent_name': data['agent_name'],
        'app_id': current_app_id(),
        'system_content': system_content,
        'greeting_message': llm.get('greeting_message'),
        'failure_message': llm.get('failure_message'),
        'voice_id': voice_id,
        'properties': json.dumps(props, ensure_ascii=False),
        'created_at': data.get('created_at'),
        'updated_at': data.get('updated_at'),
    }


# ── Endpoints ─────────────────────────────────────────────────────

@router.post('')
async def create_agent(body: CreateAgentRequest, db: AsyncSession = Depends(get_db)):
    payload = _build_payload(body)

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(AGENT_BASE_URL, json=payload, headers=_headers())

    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    result = resp.json()
    code = result.get('code') if 'code' in result else result.get('reason')
    if code not in (0, '0'):
        raise HTTPException(status_code=400, detail=result.get('message', result.get('detail', 'Agora API error')))

    fields = _record_from_data(result['data'])
    fields['app_id'] = current_app_id()
    record = AgentV2(**fields)
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return _serialize(record)


@router.get('')
async def list_agents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AgentV2).where(agent_scope_filter()).order_by(AgentV2.id.desc())
    )
    rows = result.scalars().all()
    if not rows:
        return await sync_agents(db)
    return [_serialize(r) for r in rows]


async def _fetch_agent_detail(client: httpx.AsyncClient, agent_id: str) -> dict | None:
    """请求单个 agent 详情，返回 data 字段（含完整 properties）。"""
    try:
        resp = await client.get(
            f'{AGENT_BASE_URL}/{agent_id}',
            headers=_headers(),
            timeout=15,
        )
        if resp.status_code == 200:
            body = resp.json()
            return body.get('data')
    except Exception:
        pass
    return None


def _extract_list_items(body: dict) -> list[dict]:
    data = body.get('data')
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get('list') or data.get('items') or data.get('agents') or []
    return []


class CreateAgentWithPropertiesRequest(BaseModel):
    agent_name: str
    properties: dict


def _donor_secret(donor: dict | None, path: list[str]) -> str:
    node: object = donor or {}
    for key in path:
        if not isinstance(node, dict):
            return ''
        node = node.get(key)
    return node if isinstance(node, str) else ''


async def _fill_missing_secrets(props: dict, db: AsyncSession) -> dict:
    """UI 创建时 properties 不含密钥。优先用环境变量，否则从同环境已有 agent 复制。"""
    llm = props.get('llm') if isinstance(props.get('llm'), dict) else None
    tts = props.get('tts') if isinstance(props.get('tts'), dict) else None
    tts_params = tts.get('params') if isinstance(tts, dict) and isinstance(tts.get('params'), dict) else None

    need_llm_key = bool(llm) and not llm.get('api_key')
    need_tts_key = bool(tts_params) and not tts_params.get('key')
    donor: dict | None = None
    if need_llm_key or need_tts_key:
        result = await db.execute(
            select(AgentV2).where(agent_scope_filter()).order_by(AgentV2.id.desc()).limit(30)
        )
        for rec in result.scalars().all():
            if not rec.properties:
                continue
            try:
                parsed = json.loads(rec.properties)
            except Exception:
                continue
            if isinstance(parsed, dict):
                donor = parsed
                break

    if llm is not None:
        if not llm.get('api_key'):
            llm['api_key'] = settings.effective_openai_api_key or _donor_secret(donor, ['llm', 'api_key'])
        if not llm.get('url'):
            llm['url'] = settings.openai_compatible_chat_completions_url
        params = llm.get('params')
        if isinstance(params, dict) and not params.get('model'):
            params['model'] = settings.agent_llm_model
    if tts_params is not None and not tts_params.get('key'):
        tts_params['key'] = settings.minimax_api_key or _donor_secret(donor, ['tts', 'params', 'key'])
    return props


@router.post('/create-with-properties')
async def create_agent_with_properties(
    body: CreateAgentWithPropertiesRequest,
    db: AsyncSession = Depends(get_db),
):
    payload = {
        'agent_name': body.agent_name,
        'agent_type': 'CALL_AGENT',
        'properties': await _fill_missing_secrets(body.properties, db),
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(AGENT_BASE_URL, json=payload, headers=_headers())

    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    result = resp.json()
    code = result.get('code') if 'code' in result else result.get('reason')
    if code not in (0, '0'):
        raise HTTPException(status_code=400, detail=result.get('message', result.get('detail', 'Agora API error')))

    fields = _record_from_data(result['data'])
    fields['app_id'] = current_app_id()
    record = AgentV2(**fields)
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return _serialize(record)


@router.post('/sync')
async def sync_agents(db: AsyncSession = Depends(get_db)):
    """
    1. 从 Agora 拉取全量 agent 列表
    2. 对数据库中不存在的 agent，并发请求详情接口获取完整 properties
    3. 对已存在但 properties 为空的记录，同样补充详情
    4. 写入/更新数据库后返回完整列表
    """
    # ── Step 1: 拉取 Agora 列表 ──────────────────────────────────
    agora_items: list[dict] = []
    page = 1
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            try:
                resp = await client.get(
                    AGENT_BASE_URL,
                    params={'page': page, 'page_size': 100},
                    headers=_headers(),
                )
                if resp.status_code != 200:
                    break
                items = _extract_list_items(resp.json())
                agora_items.extend(items)
                if len(items) < 100:
                    break
                page += 1
            except Exception:
                break

    if not agora_items:
        result = await db.execute(
            select(AgentV2).where(agent_scope_filter()).order_by(AgentV2.id.desc())
        )
        return [_serialize(r) for r in result.scalars().all()]

    # ── Step 2: 查询数据库已有记录 ────────────────────────────────
    existing_result = await db.execute(select(AgentV2))
    existing_records: dict[str, AgentV2] = {r.agent_id: r for r in existing_result.scalars().all()}

    def _properties_incomplete(rec: AgentV2) -> bool:
        """properties 为 None、空字符串、或空 JSON 对象 {} 时视为未同步。"""
        if not rec.properties:
            return True
        try:
            parsed = json.loads(rec.properties)
            return not parsed or 'llm' not in parsed
        except Exception:
            return True

    # 找出需要请求详情的 agent_id：
    # - 数据库中不存在的
    # - 已存在但 properties 不完整的（补全）
    agora_ids = [item['agent_id'] for item in agora_items if item.get('agent_id')]
    need_detail = [
        aid for aid in agora_ids
        if aid not in existing_records or _properties_incomplete(existing_records[aid])
    ]

    # ── Step 3: 并发拉取详情 ──────────────────────────────────────
    detail_map: dict[str, dict] = {}
    if need_detail:
        async with httpx.AsyncClient(timeout=15) as client:
            results = await asyncio.gather(*[_fetch_agent_detail(client, aid) for aid in need_detail])
        for aid, detail in zip(need_detail, results):
            if detail:
                detail_map[aid] = detail

    # ── Step 4: 写入 / 更新数据库 ─────────────────────────────────
    for aid in agora_ids:
        detail = detail_map.get(aid)
        rec = existing_records.get(aid)
        if rec is None:
            if not is_admin():
                continue
            source = detail or next((i for i in agora_items if i.get('agent_id') == aid), {})
            if source:
                fields = _record_from_data(source)
                fields['app_id'] = current_app_id()
                stmt = pg_insert(AgentV2).values(**fields)
                stmt = stmt.on_conflict_do_update(
                    index_elements=['agent_id'],
                    set_={k: stmt.excluded[k] for k in (
                        'agent_name', 'system_content', 'greeting_message',
                        'failure_message', 'voice_id', 'properties', 'updated_at',
                    )},
                )
                await db.execute(stmt)
            continue

        if rec.app_id and rec.app_id != current_app_id() and not is_admin():
            continue
        if detail:
            fields = _record_from_data(detail)
            rec.agent_name = fields.get('agent_name') or rec.agent_name
            if not rec.app_id:
                rec.app_id = current_app_id()
            rec.system_content = fields['system_content']
            rec.greeting_message = fields['greeting_message']
            rec.failure_message = fields['failure_message']
            rec.voice_id = fields['voice_id']
            rec.properties = fields['properties']
            rec.updated_at = fields['updated_at']
        elif not rec.app_id:
            rec.app_id = current_app_id()

    await db.commit()

    result = await db.execute(
        select(AgentV2).where(agent_scope_filter()).order_by(AgentV2.id.desc())
    )
    return [_serialize(r) for r in result.scalars().all()]


SENSITIVE_PLACEHOLDER = '****'  # 兼容旧前端可能提交的占位符
SENSITIVE_NAME_RE = re.compile(r'key|token|secret|password|credential', re.IGNORECASE)


def _is_sensitive_field(name: str) -> bool:
    return bool(SENSITIVE_NAME_RE.search(name))


def _mask_secret(value: str) -> str:
    """只保留前 4 位，其余替换为 *，用于返回给前端展示。"""
    if not isinstance(value, str) or not value:
        return value
    return value[:4] + '*' * max(len(value) - 4, 4)


def _mask_properties(props: dict) -> dict:
    """递归遍历 properties，对所有字段名包含 key/token/secret/password/credential
    的字符串值做脱敏，不依赖固定路径（不同 TTS/LLM 供应商放置敏感字段的位置不同，
    例如 llm.api_key、tts.params.key、tts.headers.X-Api-Key 等）。"""
    def walk(node):
        if isinstance(node, dict):
            return {
                k: _mask_secret(v) if isinstance(v, str) and v and _is_sensitive_field(k) else walk(v)
                for k, v in node.items()
            }
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(props)


def _restore_sensitive(new_props: dict, original_props: dict) -> dict:
    """把用户未修改的敏感字段（前端提交的仍是脱敏后的值）从原始 properties 还原。"""
    def walk(new_node, orig_node):
        if isinstance(new_node, dict) and isinstance(orig_node, dict):
            result = {}
            for k, v in new_node.items():
                orig_v = orig_node.get(k)
                if (
                    isinstance(v, str) and _is_sensitive_field(k)
                    and isinstance(orig_v, str) and orig_v
                    and (v == SENSITIVE_PLACEHOLDER or v == _mask_secret(orig_v))
                ):
                    result[k] = orig_v
                elif isinstance(v, (dict, list)):
                    result[k] = walk(v, orig_v)
                else:
                    result[k] = v
            return result
        if isinstance(new_node, list):
            orig_list = orig_node if isinstance(orig_node, list) else []
            return [
                walk(v, orig_list[i] if i < len(orig_list) else None)
                for i, v in enumerate(new_node)
            ]
        return new_node

    return walk(new_props, original_props)


@router.put('/{agent_id}/properties')
async def update_agent_properties(
    agent_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AgentV2).where(AgentV2.agent_id == agent_id))
    record = result.scalar_one_or_none()
    if not record or not resource_visible(record.app_id):
        raise HTTPException(status_code=404, detail='Agent not found')

    original_props = json.loads(record.properties) if record.properties else {}
    new_props = _restore_sensitive(body, original_props)

    # PATCH 到 Agora（忽略失败，DB 仍保存）
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.patch(
                f'{AGENT_BASE_URL}/{agent_id}',
                json={'properties': new_props},
                headers=_headers(),
            )
    except Exception:
        pass

    record.properties = json.dumps(new_props, ensure_ascii=False)
    llm = new_props.get('llm', {})
    system_msgs = llm.get('system_messages', [])
    record.system_content = next(
        (m.get('content') for m in system_msgs if m.get('role') == 'system'), record.system_content
    )
    record.greeting_message = llm.get('greeting_message', record.greeting_message)
    record.failure_message = llm.get('failure_message', record.failure_message)
    record.voice_id = (
        new_props.get('tts', {}).get('params', {}).get('voice_setting', {}).get('voice_id')
        or record.voice_id
    )
    await db.commit()
    await db.refresh(record)
    return _serialize(record)


@router.delete('/{agent_id}')
async def delete_agent(agent_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AgentV2).where(AgentV2.agent_id == agent_id))
    record = result.scalar_one_or_none()
    if not record or not resource_visible(record.app_id):
        raise HTTPException(status_code=404, detail='Agent not found')

    async with httpx.AsyncClient(timeout=15) as client:
        agora_resp = await client.delete(
            f'{AGENT_BASE_URL}/{agent_id}',
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
