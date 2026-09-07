"""登录用户 app_id 下的资源归属判定。后台任务无用户时回退到 AGORA_PROJECT_ID。"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import or_, select, true as sql_true
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import current_app_id as tenant_current_app_id
from app.core.tenant import is_admin, is_system_context
from app.models.agent_v2 import AgentV2
from app.models.campaign_v2 import CampaignV2
from app.models.calls_v2 import CallV2
from app.models.phone_number_v2 import PhoneNumberV2


def current_app_id() -> str:
    return tenant_current_app_id()


def resource_visible(stamped_app_id: str | None) -> bool:
    if is_admin():
        return True
    return bool(stamped_app_id) and stamped_app_id == current_app_id()


async def load_local_agent_ids(db: AsyncSession) -> set[str]:
    """当前租户 Agent ID 集合。"""
    result = await db.execute(
        select(AgentV2.agent_id).where(agent_scope_filter())
    )
    return {row[0] for row in result.all() if row[0]}


def campaign_belongs(
    *,
    stamped_app_id: str | None,
    agent_id: str | None,
    local_agent_ids: set[str],
) -> bool:
    if is_admin():
        return True
    app_id = current_app_id()
    if stamped_app_id and stamped_app_id == app_id:
        return True
    if agent_id and agent_id in local_agent_ids:
        return True
    return False


def phone_belongs(
    *,
    stamped_app_id: str | None,
    number_id: str | None,
    binding_agent_id: str | None,
    local_agent_ids: set[str],
    campaign_phone_ids: set[str],
) -> bool:
    if is_admin():
        return True
    app_id = current_app_id()
    if stamped_app_id and stamped_app_id == app_id:
        return True
    if binding_agent_id and binding_agent_id in local_agent_ids:
        return True
    if number_id and number_id in campaign_phone_ids:
        return True
    return False


async def load_env_campaign_phone_ids(
    db: AsyncSession,
    local_agent_ids: set[str] | None = None,
) -> set[str]:
    """当前租户 Campaign 引用的 phone_number_id 集合。"""
    if local_agent_ids is None:
        local_agent_ids = await load_local_agent_ids(db)
    result = await db.execute(
        select(CampaignV2.phone_number_id).where(
            CampaignV2.phone_number_id.isnot(None),
            campaign_scope_filter(local_agent_ids),
        )
    )
    return {row[0] for row in result.all() if row[0]}


def _unscoped() -> bool:
    return is_admin() or is_system_context()


def agent_scope_filter():
    if _unscoped():
        return sql_true()
    return AgentV2.app_id == current_app_id()


def campaign_scope_filter(local_agent_ids: set[str]):
    if _unscoped():
        return sql_true()
    app_id = current_app_id()
    if local_agent_ids:
        return or_(
            CampaignV2.app_id == app_id,
            CampaignV2.agent_id.in_(local_agent_ids),
        )
    return CampaignV2.app_id == app_id


def phone_scope_filter(campaign_phone_ids: set[str]):
    if _unscoped():
        return sql_true()
    app_id = current_app_id()
    if campaign_phone_ids:
        return or_(
            PhoneNumberV2.app_id == app_id,
            PhoneNumberV2.number_id.in_(campaign_phone_ids),
        )
    return PhoneNumberV2.app_id == app_id


def call_scope_filter():
    if _unscoped():
        return sql_true()
    app_id = current_app_id()
    return or_(
        CallV2.campaign_id.in_(
            select(CampaignV2.campaign_id).where(CampaignV2.app_id == app_id)
        ),
        and_agent_owned(),
    )


def and_agent_owned():
    app_id = current_app_id()
    return CallV2.agent_id.in_(
        select(AgentV2.agent_id).where(AgentV2.app_id == app_id)
    )


async def agent_belongs_to_env(db: AsyncSession, agent_id: str) -> bool:
    if not agent_id:
        return False
    result = await db.execute(
        select(AgentV2.agent_id).where(
            AgentV2.agent_id == agent_id,
            agent_scope_filter(),
        )
    )
    return result.scalar_one_or_none() is not None


async def require_campaign_in_scope(db: AsyncSession, campaign_id: str) -> CampaignV2:
    rec = (
        await db.execute(select(CampaignV2).where(CampaignV2.campaign_id == campaign_id))
    ).scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail='Campaign not found')
    local_agent_ids = await load_local_agent_ids(db)
    if not campaign_belongs(
        stamped_app_id=rec.app_id,
        agent_id=rec.agent_id,
        local_agent_ids=local_agent_ids,
    ):
        raise HTTPException(status_code=404, detail='Campaign not found')
    return rec
