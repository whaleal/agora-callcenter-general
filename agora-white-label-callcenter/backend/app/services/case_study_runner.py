from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.calls_v2 import ANSWERED_CATEGORIES
from app.core.config import settings
from app.models.agent_v2 import AgentV2
from app.models.calls_v2 import CallV2
from app.models.case_study import CaseStudyRun
from app.services.case_study_collector import filter_answered_usable, load_agent_day_calls
from app.services.case_study_optimizer import generate_suggestions
from app.services.case_study_qc import run_ai_qc
from app.services.case_study_util import dumps_json, utc_now_iso
from app.services.env_scope import current_app_id, load_local_agent_ids

logger = logging.getLogger(__name__)


async def has_ready_snapshot(db: AsyncSession, biz_date: str, agent_id: str) -> bool:
    row = (await db.execute(
        select(CaseStudyRun.id).where(
            CaseStudyRun.biz_date == biz_date,
            CaseStudyRun.agent_id == agent_id,
            CaseStudyRun.status == 'ready',
        ).limit(1)
    )).scalar_one_or_none()
    return row is not None


async def run_for_agent(
    db: AsyncSession,
    *,
    biz_date: str,
    agent: AgentV2,
) -> CaseStudyRun:
    run = CaseStudyRun(
        biz_date=biz_date,
        agent_id=agent.agent_id,
        agent_name=agent.agent_name,
        app_id=current_app_id(),
        status='running',
        baseline_system_content=agent.system_content or '',
        created_at=utc_now_iso(),
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    try:
        calls = await load_agent_day_calls(db, agent.agent_id, biz_date)
        run.calls_total = len(calls)
        usable, db_logs, db_drops = filter_answered_usable(run.id, calls)
        run.answered_count = sum(
            1 for c in calls if (c.call_category or '') in ANSWERED_CATEGORIES
        )
        db.add_all(db_logs)
        db.add_all(db_drops)

        if not usable:
            run.status = 'skipped'
            run.summary = 'No answered calls with usable transcripts today. No prompt suggestion.'
            run.optimizer_detail = dumps_json({'notice': 'no_usable_calls'})
            run.effective_count = 0
            await db.commit()
            await db.refresh(run)
            return run

        next_seq = max(lg.seq for lg in db_logs) + 1
        qc_rows, qc_logs, effective_n, _ = await run_ai_qc(db, run.id, usable, next_seq)
        run.effective_count = effective_n
        db.add_all(qc_rows)
        db.add_all(qc_logs)

        qc_by_id = {r.call_id: r for r in qc_rows}
        effective_pairs: list[tuple[CallV2, object]] = []
        weak_pairs: list[tuple[CallV2, object]] = []
        for c in usable:
            q = qc_by_id.get(c.call_id)
            if not q:
                continue
            if q.effective:
                effective_pairs.append((c, q))
            else:
                weak_pairs.append((c, q))

        min_n = int(settings.case_study_min_effective_calls)
        if effective_n < min_n:
            run.status = 'ready'
            run.summary = (
                f'Effective calls {effective_n}, fewer than the minimum {min_n}. '
                'QC summary only — no prompt suggestion today.'
            )
            run.optimizer_detail = dumps_json({
                'notice': 'insufficient_samples',
                'effective_count': effective_n,
                'min_effective': min_n,
            })
            await db.commit()
            await db.refresh(run)
            return run

        detail = await generate_suggestions(
            baseline=run.baseline_system_content or '',
            effective_calls=effective_pairs,
            weak_calls=weak_pairs,
        )
        run.summary = detail.get('summary')
        run.suggested_system_content = detail.get('suggested_system_content')
        run.optimizer_detail = dumps_json({
            'section_patches': detail.get('section_patches'),
            'few_shot_examples': detail.get('few_shot_examples'),
        })
        run.status = 'ready'
        await db.commit()
        await db.refresh(run)
        return run
    except Exception as exc:
        logger.exception('case_study run failed agent=%s date=%s', agent.agent_id, biz_date)
        run.status = 'failed'
        run.error = str(exc)[:2000]
        await db.commit()
        await db.refresh(run)
        return run


async def run_for_date(
    db: AsyncSession,
    biz_date: str,
    *,
    agent_id: str | None = None,
    skip_if_ready: bool = False,
) -> list[CaseStudyRun]:
    local_ids = await load_local_agent_ids(db)
    q = select(AgentV2).where(AgentV2.app_id == current_app_id())
    if agent_id:
        q = q.where(AgentV2.agent_id == agent_id)
    agents = list((await db.execute(q.order_by(AgentV2.id.desc()))).scalars().all())
    if agent_id and not agents:
        return []
    if not agent_id:
        agents = [a for a in agents if a.agent_id in local_ids]

    results: list[CaseStudyRun] = []
    for agent in agents:
        if skip_if_ready and await has_ready_snapshot(db, biz_date, agent.agent_id):
            logger.info(
                'case_study skip existing ready snapshot %s %s', biz_date, agent.agent_id,
            )
            continue
        results.append(await run_for_agent(db, biz_date=biz_date, agent=agent))
    return results
