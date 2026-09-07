from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.agent_v2 import AgentV2
from app.models.case_study import CaseStudyCallQc, CaseStudyFilterLog, CaseStudyRun
from app.services.case_study_fork import fork_agent_from_run, resolve_prompt_ref, unified_diff
from app.services.case_study_runner import run_for_date
from app.services.case_study_util import loads_json, yesterday_biz_date
from app.services.env_scope import current_app_id

router = APIRouter(prefix='/api/case-study', tags=['case-study'])


def _infer_notice(run: CaseStudyRun) -> str | None:
    detail = loads_json(run.optimizer_detail, default={}) or {}
    if isinstance(detail, dict) and detail.get('notice'):
        return str(detail['notice'])
    s = run.summary or ''
    if '少于最少' in s or 'fewer than the minimum' in s.lower() or 'QC summary only' in s:
        return 'insufficient_samples'
    if run.status == 'skipped' or '无成功接通' in s or 'No answered calls' in s:
        return 'no_usable_calls'
    return None


def _serialize_run(run: CaseStudyRun, *, detail: bool = False) -> dict:
    notice = _infer_notice(run)
    extra = loads_json(run.optimizer_detail, default={}) or {}
    min_effective = extra.get('min_effective') if isinstance(extra, dict) else None
    out = {
        'id': run.id,
        'biz_date': run.biz_date,
        'agent_id': run.agent_id,
        'agent_name': run.agent_name,
        'app_id': run.app_id,
        'calls_total': run.calls_total,
        'answered_count': run.answered_count,
        'effective_count': run.effective_count,
        'min_effective': int(min_effective or settings.case_study_min_effective_calls),
        'status': run.status,
        'summary': run.summary,
        'notice': notice,
        'has_suggestion': bool(run.suggested_system_content),
        'forked_agents': loads_json(run.forked_agent_ids, default=[]) or [],
        'error': run.error,
        'created_at': run.created_at,
    }
    if detail:
        out['baseline_system_content'] = run.baseline_system_content
        out['suggested_system_content'] = run.suggested_system_content
        out['optimizer_detail'] = loads_json(run.optimizer_detail, default=None)
    return out


async def _get_run(db: AsyncSession, run_id: int) -> CaseStudyRun:
    run = (await db.execute(
        select(CaseStudyRun).where(CaseStudyRun.id == run_id)
    )).scalar_one_or_none()
    if not run or run.app_id != current_app_id():
        raise HTTPException(status_code=404, detail='run not found')
    return run


class TriggerBody(BaseModel):
    biz_date: str | None = None
    agent_id: str | None = None


@router.post('/runs')
async def trigger_runs(body: TriggerBody | None = None, db: AsyncSession = Depends(get_db)):
    body = body or TriggerBody()
    biz_date = (body.biz_date or '').strip() or yesterday_biz_date()
    if body.agent_id:
        agent = (await db.execute(
            select(AgentV2).where(AgentV2.agent_id == body.agent_id)
        )).scalar_one_or_none()
        if not agent or agent.app_id != current_app_id():
            raise HTTPException(status_code=404, detail='agent not found')
    results = await run_for_date(
        db,
        biz_date,
        agent_id=body.agent_id,
        skip_if_ready=False,
    )
    return {
        'biz_date': biz_date,
        'count': len(results),
        'items': [_serialize_run(r) for r in results],
    }


@router.get('/runs')
async def list_runs(
    db: AsyncSession = Depends(get_db),
    agent_id: str | None = Query(default=None),
    biz_date: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
):
    q = select(CaseStudyRun).where(CaseStudyRun.app_id == current_app_id())
    if agent_id:
        q = q.where(CaseStudyRun.agent_id == agent_id)
    if biz_date:
        q = q.where(CaseStudyRun.biz_date == biz_date)
    if status:
        q = q.where(CaseStudyRun.status == status)
    q = q.order_by(CaseStudyRun.id.desc()).limit(limit)
    rows = list((await db.execute(q)).scalars().all())
    return {'items': [_serialize_run(r) for r in rows]}


@router.get('/runs/{run_id}')
async def get_run(run_id: int, db: AsyncSession = Depends(get_db)):
    run = await _get_run(db, run_id)
    return _serialize_run(run, detail=True)


@router.get('/runs/{run_id}/filter-log')
async def get_filter_log(run_id: int, db: AsyncSession = Depends(get_db)):
    await _get_run(db, run_id)
    rows = list((await db.execute(
        select(CaseStudyFilterLog)
        .where(CaseStudyFilterLog.run_id == run_id)
        .order_by(CaseStudyFilterLog.seq.asc())
    )).scalars().all())
    return {
        'items': [
            {
                'seq': r.seq,
                'stage': r.stage,
                'action': r.action,
                'input_count': r.input_count,
                'passed_count': r.passed_count,
                'dropped_count': r.dropped_count,
                'detail': loads_json(r.detail, default=None),
                'message': r.message,
            }
            for r in rows
        ],
    }


@router.get('/runs/{run_id}/calls')
async def get_run_calls(run_id: int, db: AsyncSession = Depends(get_db)):
    await _get_run(db, run_id)
    rows = list((await db.execute(
        select(CaseStudyCallQc)
        .where(CaseStudyCallQc.run_id == run_id)
        .order_by(CaseStudyCallQc.id.asc())
    )).scalars().all())
    return {
        'items': [
            {
                'call_id': r.call_id,
                'campaign_id': r.campaign_id,
                'db_passed': r.db_passed,
                'effective': r.effective,
                'drop_stage': r.drop_stage,
                'drop_reason': r.drop_reason,
                'transcript_score': r.transcript_score,
                'audio_score': r.audio_score,
                'criteria_passed': r.criteria_passed,
                'evidence': r.evidence,
                'success_criteria_text': r.success_criteria_text,
                'duration_seconds': r.duration_seconds,
                'call_category': r.call_category,
                'rubric': loads_json(r.rubric, default=None),
            }
            for r in rows
        ],
    }


@router.get('/diff')
async def get_diff(
    left: str = Query(...),
    right: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    left_label, left_text = await resolve_prompt_ref(db, left)
    right_label, right_text = await resolve_prompt_ref(db, right)
    return {
        'left_ref': left,
        'right_ref': right,
        'left_label': left_label,
        'right_label': right_label,
        'left_text': left_text,
        'right_text': right_text,
        'unified_diff': unified_diff(left_text, right_text, left_label, right_label),
    }


class ForkBody(BaseModel):
    agent_name: str | None = None


@router.post('/runs/{run_id}/fork')
async def fork_run(run_id: int, body: ForkBody | None = None, db: AsyncSession = Depends(get_db)):
    run = await _get_run(db, run_id)
    body = body or ForkBody()
    agent = await fork_agent_from_run(db, run, body.agent_name)
    return {
        'run': _serialize_run(run, detail=False),
        'agent': {
            'agent_id': agent.agent_id,
            'agent_name': agent.agent_name,
            'app_id': agent.app_id,
        },
    }
