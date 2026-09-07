"""
When a quota cell's completed count reaches its target, prepend a closure notice
to the campaign agent's system prompt via the Agora API.
"""
from __future__ import annotations

import json
import logging

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.agent_v2 import AgentV2
from app.models.campaign_v2 import CampaignV2
from app.services.agora_http import agora_headers as _headers

logger = logging.getLogger(__name__)

AGENT_BASE_URL = (
    f'{settings.agora_conversational_base_url}/projects'
    f'/{settings.agora_project_id}/agents'
)


def _detect_language(text: str) -> str:
    """Return 'korean' if Korean chars dominate, else 'chinese'."""
    korean = sum(
        1 for c in text
        if '가' <= c <= '힯' or 'ᄀ' <= c <= 'ᇿ' or '㄰' <= c <= '㆏'
    )
    chinese = sum(1 for c in text if '一' <= c <= '鿿')
    return 'korean' if korean > chinese else 'chinese'


def _closure_prefix(label: str, lang: str) -> str:
    if lang == 'korean':
        return (
            f'【중요】더 이상 {label} 조건의 새 응답자를 받지 않습니다. '
            f'통화 중 상대방이 {label} 조건에 해당할 경우 다음과 같이 말하고 통화를 종료하세요: '
            f'"감사합니다. 귀하가 속한 {label} 조건의 조사가 이미 완료되었습니다. '
            f'다음에도 협조해 주시기 바랍니다."'
        )
    return (
        f'【重要】不再接受{label}的新受访者。'
        f'如果当前通话中对方符合{label}条件，请告知对方：'
        f'"感谢您，您所在的{label}的调查已经结束了，下次请您继续配合。"，然后礼貌结束通话。'
    )


async def notify_quota_reached(
    db: AsyncSession,
    campaign_id: str,
    cell_label: str,
) -> None:
    """
    Prepend a quota-closed notice to the campaign agent's system prompt.
    Safe to call multiple times — skips if the label is already present.
    """
    camp = (await db.execute(
        select(CampaignV2).where(CampaignV2.campaign_id == campaign_id),
    )).scalar_one_or_none()
    if not camp or not camp.agent_id:
        logger.warning(
            'notify_quota_reached: campaign %s has no agent_id, skipping', campaign_id,
        )
        return

    agent = (await db.execute(
        select(AgentV2).where(AgentV2.agent_id == camp.agent_id),
    )).scalar_one_or_none()
    if not agent or not agent.properties:
        logger.warning(
            'notify_quota_reached: agent %s not found or missing properties', camp.agent_id,
        )
        return

    props = json.loads(agent.properties)
    llm = props.get('llm', {})
    system_msgs = llm.get('system_messages', [])
    current_content: str = next(
        (m.get('content', '') for m in system_msgs if m.get('role') == 'system'),
        agent.system_content or '',
    )

    lang = _detect_language(current_content)

    # Idempotency: skip if this label's closure message is already in the prompt
    already_zh = f'不再接受{cell_label}' in current_content
    already_ko = f'{cell_label} 조건의 새 응답자를 받지 않습니다' in current_content
    if already_zh or already_ko:
        logger.info(
            'notify_quota_reached: label %r already in system prompt, skipping', cell_label,
        )
        return

    prefix = _closure_prefix(cell_label, lang)
    new_content = prefix + '\n\n' + current_content

    # Update system_messages in-place
    patched = False
    for msg in system_msgs:
        if msg.get('role') == 'system':
            msg['content'] = new_content
            patched = True
            break
    if not patched:
        system_msgs.insert(0, {'role': 'system', 'content': new_content})
        llm['system_messages'] = system_msgs
        props['llm'] = llm

    # PATCH Agora (best-effort)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.patch(
                f'{AGENT_BASE_URL}/{camp.agent_id}',
                json={'properties': props},
                headers=_headers(),
            )
        logger.info(
            'notify_quota_reached: patched agent %s for quota %r, status=%d',
            camp.agent_id, cell_label, resp.status_code,
        )
    except Exception as exc:
        logger.warning(
            'notify_quota_reached: PATCH agora agent %s failed: %s', camp.agent_id, exc,
        )

    # Always persist to DB so the UI reflects the change
    agent.properties = json.dumps(props, ensure_ascii=False)
    agent.system_content = new_content
    await db.commit()
