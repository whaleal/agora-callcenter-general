from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.agent_v2 import AgentV2
from app.models.case_study import CaseStudyRun
from app.services.env_scope import current_app_id
from app.services.case_study_util import dumps_json, loads_json

logger = logging.getLogger(__name__)

AGENT_BASE_URL = (
    f'{settings.agora_conversational_base_url}/projects'
    f'/{settings.agora_project_id}/agents'
)


def _headers() -> dict:
    return {
        'Authorization': f'Basic {settings.agora_conversational_api_key}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }


def _record_from_data(data: dict) -> dict:
    props = data.get('properties', {})
    llm = props.get('llm', {}) if isinstance(props, dict) else {}
    system_msgs = llm.get('system_messages', []) if isinstance(llm, dict) else []
    system_content = next(
        (m.get('content') for m in system_msgs if isinstance(m, dict) and m.get('role') == 'system'),
        None,
    )
    voice_id = None
    if isinstance(props, dict):
        voice_id = (
            props.get('tts', {})
            .get('params', {})
            .get('voice_setting', {})
            .get('voice_id')
        )
    return {
        'agent_id': data['agent_id'],
        'agent_name': data['agent_name'],
        'app_id': data.get('app_id') or current_app_id(),
        'system_content': system_content,
        'greeting_message': llm.get('greeting_message') if isinstance(llm, dict) else None,
        'failure_message': llm.get('failure_message') if isinstance(llm, dict) else None,
        'voice_id': voice_id,
        'properties': json.dumps(props, ensure_ascii=False),
        'created_at': data.get('created_at') or datetime.now(timezone.utc).isoformat(),
        'updated_at': data.get('updated_at'),
    }


def apply_prompt_to_properties(props: dict, system_content: str) -> dict:
    llm = props.setdefault('llm', {})
    if not isinstance(llm, dict):
        llm = {}
        props['llm'] = llm
    msgs = llm.get('system_messages')
    if not isinstance(msgs, list):
        msgs = []
    patched = False
    for msg in msgs:
        if isinstance(msg, dict) and msg.get('role') == 'system':
            msg['content'] = system_content
            patched = True
            break
    if not patched:
        msgs.insert(0, {'role': 'system', 'content': system_content})
    llm['system_messages'] = msgs
    return props


def unified_diff(left: str, right: str, left_label: str, right_label: str) -> list[str]:
    import difflib
    return list(difflib.unified_diff(
        (left or '').splitlines(),
        (right or '').splitlines(),
        fromfile=left_label,
        tofile=right_label,
        lineterm='',
    ))


async def resolve_prompt_ref(db: AsyncSession, ref: str) -> tuple[str, str]:
    """
    ref: run:{id}:baseline | run:{id}:suggested | agent:{agent_id}
    Returns (label, text)
    """
    ref = (ref or '').strip()
    if ref.startswith('run:'):
        parts = ref.split(':')
        if len(parts) < 3:
            raise HTTPException(status_code=400, detail='run ref must be run:{id}:baseline|suggested')
        run_id = int(parts[1])
        kind = parts[2]
        run = (await db.execute(select(CaseStudyRun).where(CaseStudyRun.id == run_id))).scalar_one_or_none()
        if not run or run.app_id != current_app_id():
            raise HTTPException(status_code=404, detail='run not found')
        if kind == 'baseline':
            return f'run#{run.id} baseline {run.biz_date}', run.baseline_system_content or ''
        if kind == 'suggested':
            return f'run#{run.id} suggested {run.biz_date}', run.suggested_system_content or ''
        raise HTTPException(status_code=400, detail='run kind must be baseline or suggested')
    if ref.startswith('agent:'):
        agent_id = ref.split(':', 1)[1]
        agent = (await db.execute(select(AgentV2).where(AgentV2.agent_id == agent_id))).scalar_one_or_none()
        if not agent or agent.app_id != current_app_id():
            raise HTTPException(status_code=404, detail='agent not found')
        return f'agent {agent.agent_name}', agent.system_content or ''
    raise HTTPException(status_code=400, detail='ref must be run:{id}:baseline|suggested or agent:{id}')


async def fork_agent_from_run(
    db: AsyncSession,
    run: CaseStudyRun,
    agent_name: str | None = None,
) -> AgentV2:
    if not run.suggested_system_content:
        raise HTTPException(status_code=400, detail='this run has no suggested prompt')
    source = (await db.execute(
        select(AgentV2).where(AgentV2.agent_id == run.agent_id)
    )).scalar_one_or_none()
    if not source or source.app_id != current_app_id():
        raise HTTPException(status_code=404, detail='source agent not found')
    if not source.properties:
        raise HTTPException(status_code=400, detail='source agent has no properties')

    props = json.loads(source.properties)
    props = apply_prompt_to_properties(props, run.suggested_system_content)
    name = (agent_name or '').strip() or f'{source.agent_name} · Case Study {run.biz_date}'

    payload = {
        'agent_name': name,
        'agent_type': 'CALL_AGENT',
        'properties': props,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(AGENT_BASE_URL, json=payload, headers=_headers())
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    result = resp.json()
    code = result.get('code') if 'code' in result else result.get('reason')
    if code not in (0, '0'):
        raise HTTPException(
            status_code=400,
            detail=result.get('message', result.get('detail', 'Agora API error')),
        )
    fields = _record_from_data(result['data'])
    fields['app_id'] = current_app_id()
    record = AgentV2(**fields)
    db.add(record)

    prev = loads_json(run.forked_agent_ids, default=[]) or []
    if not isinstance(prev, list):
        prev = []
    prev.append({
        'agent_id': fields['agent_id'],
        'agent_name': name,
        'at': datetime.now(timezone.utc).isoformat(),
    })
    run.forked_agent_ids = dumps_json(prev)
    await db.commit()
    await db.refresh(record)
    await db.refresh(run)
    return record
