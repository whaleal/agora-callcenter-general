"""本部署环境（AGORA_PROJECT_ID）下的资源归属判定。"""

from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.agent_v2 import AgentV2
from app.models.campaign_v2 import CampaignV2
from app.models.phone_number_v2 import PhoneNumberV2


def current_app_id() -> str:
    return settings.agora_project_id


async def load_local_agent_ids(db: AsyncSession) -> set[str]:
    """本环境 Agent ID 集合（app_id == 当前 AGORA_PROJECT_ID）。"""
    app_id = current_app_id()
    result = await db.execute(
        select(AgentV2.agent_id).where(AgentV2.app_id == app_id)
    )
    return {row[0] for row in result.all() if row[0]}


def campaign_belongs(
    *,
    stamped_app_id: str | None,
    agent_id: str | None,
    local_agent_ids: set[str],
) -> bool:
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
    """本环境 Campaign 引用的 phone_number_id 集合。"""
    if local_agent_ids is None:
        local_agent_ids = await load_local_agent_ids(db)
    result = await db.execute(
        select(CampaignV2.phone_number_id).where(
            CampaignV2.phone_number_id.isnot(None),
            campaign_scope_filter(local_agent_ids),
        )
    )
    return {row[0] for row in result.all() if row[0]}


def agent_scope_filter():
    """SQLAlchemy filter：Agent 属于本环境。"""
    return AgentV2.app_id == current_app_id()


def campaign_scope_filter(local_agent_ids: set[str]):
    """SQLAlchemy filter：Campaign 属于本环境。"""
    app_id = current_app_id()
    if local_agent_ids:
        return or_(
            CampaignV2.app_id == app_id,
            CampaignV2.agent_id.in_(local_agent_ids),
        )
    return CampaignV2.app_id == app_id


def phone_scope_filter(campaign_phone_ids: set[str]):
    """SQLAlchemy filter：PhoneNumber 属于本环境（stamp 或被本环境 campaign 引用）。"""
    app_id = current_app_id()
    if campaign_phone_ids:
        return or_(
            PhoneNumberV2.app_id == app_id,
            PhoneNumberV2.number_id.in_(campaign_phone_ids),
        )
    return PhoneNumberV2.app_id == app_id


async def agent_belongs_to_env(db: AsyncSession, agent_id: str) -> bool:
    if not agent_id:
        return False
    result = await db.execute(
        select(AgentV2.agent_id).where(
            AgentV2.agent_id == agent_id,
            AgentV2.app_id == current_app_id(),
        )
    )
    return result.scalar_one_or_none() is not None
