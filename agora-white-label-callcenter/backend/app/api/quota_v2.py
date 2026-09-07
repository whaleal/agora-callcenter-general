"""
Quota V2 API — campaign-level quota cells with hit tracking.

POST /api/quota-v2/{campaign_id}/cells   — bulk-create / replace cells for a campaign
GET  /api/quota-v2/{campaign_id}/cells   — list cells with completion stats
POST /api/quota-v2/{campaign_id}/hit     — record a call result; increment all matching cells
DELETE /api/quota-v2/{campaign_id}/cells — delete all cells for a campaign
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

logger = logging.getLogger(__name__)
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.quota_v2 import QuotaV2
from app.services import quota_agent_notifier, quota_transcript_eval
from app.services.env_scope import require_campaign_in_scope

router = APIRouter(prefix='/api/quota-v2', tags=['quota-v2'])


# ── Schemas ───────────────────────────────────────────────────────────────────

class QuotaCellIn(BaseModel):
    label:   str
    filters: dict = {}
    target:  int  = 0


class QuotaCellOut(BaseModel):
    id:          int
    campaign_id: str
    label:       str
    filters:     dict
    target:      int
    completed:   int
    hit_evidence: list[dict] | None = None

    @classmethod
    def from_orm(cls, row: QuotaV2) -> 'QuotaCellOut':
        he: list[dict] | None = None
        if row.hit_evidence:
            try:
                p = json.loads(row.hit_evidence)
                if isinstance(p, list):
                    he = p
            except Exception:
                he = None
        return cls(
            id=row.id,
            campaign_id=row.campaign_id,
            label=row.label,
            filters=row.filters_dict(),
            target=row.target,
            completed=row.completed,
            hit_evidence=he,
        )


class BulkCreateRequest(BaseModel):
    cells: list[QuotaCellIn]


class HitRequest(BaseModel):
    """
    Pass the structured call result variables extracted by the voice agent.
    e.g. {"Region": "首尔", "性别": "男", "年龄": "19-29", "call_success": true}
    """
    variables: dict


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post('/{campaign_id}/cells', response_model=list[QuotaCellOut])
async def bulk_create_cells(
    campaign_id: str,
    body: BulkCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Replace all quota cells for a campaign (delete existing, insert new)."""
    await require_campaign_in_scope(db, campaign_id)
    await db.execute(delete(QuotaV2).where(QuotaV2.campaign_id == campaign_id))

    rows = [
        QuotaV2(
            campaign_id=campaign_id,
            label=cell.label,
            filters=json.dumps(cell.filters, ensure_ascii=False) if cell.filters else None,
            target=cell.target,
            completed=0,
        )
        for cell in body.cells
    ]
    db.add_all(rows)
    await db.commit()
    for r in rows:
        await db.refresh(r)

    return [QuotaCellOut.from_orm(r) for r in rows]


@router.get('/{campaign_id}/cells', response_model=list[QuotaCellOut])
async def list_cells(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
):
    await require_campaign_in_scope(db, campaign_id)
    result = await db.execute(
        select(QuotaV2)
        .where(QuotaV2.campaign_id == campaign_id)
        .order_by(QuotaV2.id)
    )
    rows = result.scalars().all()
    return [QuotaCellOut.from_orm(r) for r in rows]


@router.post('/{campaign_id}/hit', response_model=list[QuotaCellOut])
async def record_hit(
    campaign_id: str,
    body: HitRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Given a call result dict, find all quota cells whose filters match and
    increment their completed count by 1. Returns the updated cells.
    """
    await require_campaign_in_scope(db, campaign_id)
    result = await db.execute(
        select(QuotaV2).where(QuotaV2.campaign_id == campaign_id)
    )
    rows = result.scalars().all()

    updated: list[QuotaV2] = []
    newly_reached: list[str] = []
    for row in rows:
        if row.is_hit(body.variables):
            row.completed += 1
            if (row.target or 0) > 0 and row.completed == row.target:
                newly_reached.append(row.label)
            updated.append(row)

    if updated:
        await db.commit()
        for r in updated:
            await db.refresh(r)

    for label in newly_reached:
        try:
            await quota_agent_notifier.notify_quota_reached(db, campaign_id, label)
        except Exception as exc:
            logger.warning('notify_quota_reached failed for label %r: %s', label, exc)

    return [QuotaCellOut.from_orm(r) for r in updated]


@router.delete('/{campaign_id}/cells', status_code=204)
async def delete_cells(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
):
    await require_campaign_in_scope(db, campaign_id)
    await db.execute(delete(QuotaV2).where(QuotaV2.campaign_id == campaign_id))
    await db.commit()


@router.post('/{campaign_id}/transcript-eval')
async def eval_transcript_quota(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(200, ge=1, le=1000, description='Max calls to process in this request'),
    prefetch: bool = Query(
        True,
        description='If true, run Agora calls_v2 sync first so transcript/detail exists before LLM',
    ),
):
    """
    For each call (oldest first): use OpenAI (gpt-4o-mini) on **transcript only** to
    extract dimensions, match quota_v2 cells, increment completed + hit_evidence, set
    calls_v2.quota_checked. Skips: empty transcript, call_category in no_answer, voicemail, failed.
    """
    if not settings.effective_openai_api_key:
        raise HTTPException(503, detail='OPENROUTER_API_KEY (or OPENAI_API_KEY) 未配置')
    await require_campaign_in_scope(db, campaign_id)
    return await quota_transcript_eval.run_transcript_eval_for_campaign(
        db, campaign_id, limit=limit, prefetch_transcripts=prefetch,
    )
