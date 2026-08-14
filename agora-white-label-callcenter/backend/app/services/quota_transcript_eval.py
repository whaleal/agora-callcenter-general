"""
Transcript-only quota evaluation with OpenAI (gpt-4o-mini): extract dimensions,
strict schema + alias normalization, then match quota_v2 cells.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from openai import APIConnectionError, APITimeoutError, RateLimitError
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import HTTPException

from app.api.calls_v2 import sync_calls_v2_upstream
from app.core.config import settings
from app.core.llm import make_async_openai_client
from app.models.calls_v2 import CallV2
from app.models.campaign_v2 import CampaignV2
from app.models.quota_v2 import QuotaV2
from app.services import quota_agent_notifier

logger = logging.getLogger(__name__)

# Skip LLM: no valid conversation content
LLM_SKIP_CATEGORIES: frozenset[str] = frozenset(
    {
        'no_answer',
        'voicemail',
        'failed',
        'outbound_transferred_failed',
    },
)

# Synonyms / variants -> canonical value (must match quota filter literals).
# 维度名须与 quota_v2.filters 的 key 一致：例如「城市」与「地区」都常见，别名表分别挂上。
_REGION_ALIASES: dict[str, str] = {
    '대구': '大邱',
    '대구광역시': '大邱',
    '大邱市': '大邱',
    '大邱廣域市': '大邱',
    '서울': '首尔',
    '首爾': '首尔',
    '서울특별시': '首尔',
    '汉城': '首尔',
    '부산': '釜山',
    '부산광역시': '釜山',
    '釜山市': '釜山',
    '인천': '仁川',
    '仁川市': '仁川',
    '광주': '光州',
    '대전': '大田',
    '울산': '蔚山',
    '세종': '世宗',
    '제주': '济州',
    '제주도': '济州',
}

VALUE_ALIASES: dict[str, dict[str, str]] = {
    '地区': dict(_REGION_ALIASES),
    '城市': dict(_REGION_ALIASES),
    '性别': {
        '男': '男',
        '男性': '男',
        '男士': '男',
        '女': '女',
        '女性': '女',
        '女士': '女',
    },
}

# 任意维度名均可使用：仅当「标准值 ∈ 该维度的 allowed」时才采纳（与你在 quota 里写的字面量对齐）
VARIANT_TO_CANONICAL: dict[str, str] = {}
for _tbl in VALUE_ALIASES.values():
    for _k, _v in _tbl.items():
        VARIANT_TO_CANONICAL[_k] = _v


def _union_filter_keys(cells: list[QuotaV2]) -> list[str]:
    """全部来自 DB：本 campaign 所有 quota 格子 filters 的 key 并集（无任何写死字段名）。"""
    keys: set[str] = set()
    for c in cells:
        keys.update(c.filters_dict().keys())
    return sorted(keys)


def _allowed_values_per_key(cells: list[QuotaV2]) -> dict[str, set[str]]:
    """每个 filter 维度名 -> 你在 quota 配置里出现过的所有允许字面量（动态）。"""
    out: dict[str, set[str]] = {}
    for c in cells:
        fd = c.filters_dict()
        for k, v in fd.items():
            out.setdefault(k, set()).add(str(v))
    return out


def _normalize_key_value(dim: str, raw: str | None, allowed: set[str]) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s.lower() in ('null', 'unknown', 'n/a', '无', 'none'):
        return None
    if s in allowed:
        return s
    alias = VALUE_ALIASES.get(dim, {})
    if s in alias and alias[s] in allowed:
        return alias[s]
    for variant, canonical in alias.items():
        if canonical not in allowed:
            continue
        if s == variant:
            return canonical
    # 与维度名无关：口语/韩文等变体 → 标准值，仅当该标准值出现在本维度的 allowed 中
    gv = VARIANT_TO_CANONICAL.get(s)
    if gv is not None and gv in allowed:
        return gv
    for a in allowed:
        if a in s and len(a) >= 2:
            if s == a or (s.startswith(a) and len(s) <= len(a) + 2):
                return a
    return None


def transcript_to_text(raw: str | None) -> str:
    if not raw:
        return ''
    try:
        data = json.loads(raw)
    except Exception:
        return str(raw)[: 120_000]
    if not isinstance(data, list):
        return str(data)[: 120_000]
    lines: list[str] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        role = item.get('role', '?')
        content = (item.get('content') or '').strip()
        lines.append(f'[{role}] {content}')
    return '\n'.join(lines)[: 120_000]


def _build_json_schema_for_llm(union_keys: list[str]) -> dict[str, Any]:
    if not union_keys:
        return {}
    var_props: dict[str, Any] = {k: {'type': ['string', 'null']} for k in union_keys}
    return {
        'name': 'quota_transcript_extraction',
        'strict': True,
        'schema': {
            'type': 'object',
            'properties': {
                'variables': {
                    'type': 'object',
                    'properties': var_props,
                    'required': union_keys,
                    'additionalProperties': False,
                },
                'sufficient': {'type': 'boolean'},
                'confidence': {
                    'type': 'number',
                    'minimum': 0.0,
                    'maximum': 1.0,
                },
                'evidence': {'type': 'string'},
            },
            'required': ['variables', 'sufficient', 'confidence', 'evidence'],
            'additionalProperties': False,
        },
    }


def _system_prompt(allowed: dict[str, set[str]], cells_payload: list[dict]) -> str:
    dim_lines: list[str] = []
    for k, vals in sorted(allowed.items()):
        dim_lines.append(f'- {k!r}: 允许取值（仅允许这些字面量，语义匹配后需对应其中之一）: {sorted(vals)}')
    cell_lines = json.dumps(cells_payload, ensure_ascii=False, indent=2)
    return f"""\
你是电话调查数据抽取员。只根据下方「对话转写」做判断，**禁止**臆测或补全转写中未确定的信息。

配额格子（每格有一组必须同时满足的 filter）仅用于你理解需要抽取哪些维度，**不要**在输出中写格子 id：
{cell_lines}

维度与允许出现的确切取值为：
{chr(10).join(dim_lines)}

规则（必须遵守）：
1. 从转写中抽取上述维度的值；**无法从转写中唯一、确定地得出某维度时，该维度在 variables 中必须设为 null。**
2. 若**任一**应抽取维度无法确定，将 sufficient 设为 false，confidence 应偏低，evidence 说明缺少什么信息。
3. 只有当你能**有把握地**从转写中得出某维度，且其含义与允许取值中某一条一致时，才填该非 null 值（填写的字符串必须是允许集合中的**原样字面量**之一）。
4. evidence：简短引用能支撑你判断的转写原句（可拼接），不要杜撰。

输出必须符合给定 JSON schema。variables 的键必须齐全。"""


async def _call_openai(
    union_keys: list[str],
    allowed: dict[str, set[str]],
    cells_payload: list[dict],
    transcript_text: str,
) -> dict[str, Any]:
    if not settings.effective_openai_api_key:
        raise RuntimeError('OPENROUTER_API_KEY (or OPENAI_API_KEY) 未配置')
    if not union_keys:
        raise ValueError('无配额 filter 维度，跳过')

    body = _build_json_schema_for_llm(union_keys)
    client = make_async_openai_client(timeout=120.0, max_retries=1)
    user_msg = f"""以下是对话转写：\n\n{transcript_text}"""

    resp = await client.chat.completions.create(
        model=settings.quota_transcript_model,
        temperature=0.0,
        response_format={'type': 'json_schema', 'json_schema': body},
        messages=[
            {'role': 'system', 'content': _system_prompt(allowed, cells_payload)},
            {'role': 'user', 'content': user_msg},
        ],
    )
    text = (resp.choices[0].message.content or '').strip()
    return json.loads(text)


def _validate_and_match(
    cells: list[QuotaV2],
    allowed: dict[str, set[str]],
    raw_llm: dict[str, Any],
) -> tuple[dict[str, str | None], str | None, list[tuple[QuotaV2, dict]]]:
    """
    Returns (normalized_variables, error_note or None, hit list).
    error_note: human-readable; non-None 表示不应计有效 hit（信度不足/归一失败等）。
    """
    vars_in = raw_llm.get('variables') or {}
    if not isinstance(vars_in, dict):
        return {}, 'LLM variables 非对象', []

    min_conf = settings.quota_transcript_min_confidence
    try:
        conf = float(raw_llm.get('confidence', 0.0))
    except (TypeError, ValueError):
        conf = 0.0
    sufficient = bool(raw_llm.get('sufficient'))
    evidence = str(raw_llm.get('evidence') or '')[: 8000]
    note_insufficient = 'sufficient 为 false 或 confidence 低于阈值，不计 hit'

    if conf < min_conf or not sufficient:
        norm0 = {k: _normalize_key_value(k, vars_in.get(k), allowed.get(k, set())) for k in allowed}
        return norm0, note_insufficient, []

    problems: list[str] = []
    norm: dict[str, str | None] = {}
    for k, vals in allowed.items():
        raw_v = vars_in.get(k) if isinstance(vars_in, dict) else None
        n = _normalize_key_value(
            k,
            str(raw_v) if raw_v is not None and str(raw_v).strip() and str(raw_v).lower() not in (
                'null', 'none', 'unknown', 'n/a', '',
            ) else None,
            vals,
        )
        norm[k] = n
        if raw_v is not None and str(raw_v).strip() and str(raw_v).lower() not in (
            'null', 'none', 'unknown', 'n/a', '',
        ) and n is None:
            problems.append(
                f'维度 {k!r} 的抽取值 {raw_v!r} 无法归一到允许集 {sorted(vals)}',
            )

    if problems:
        return norm, '值归一失败: ' + '; '.join(problems), []

    hits: list[tuple[QuotaV2, dict]] = []
    for cell in cells:
        fd = cell.filters_dict()
        if not fd:
            continue
        ok = True
        for fk, fv in fd.items():
            if norm.get(fk) != str(fv):
                ok = False
                break
        if ok and conf >= min_conf and sufficient:
            meta = {
                'confidence': conf,
                'evidence': evidence,
                'variables': {x: norm.get(x) for x in fd},
            }
            hits.append((cell, meta))

    return norm, None, hits


def _append_hit_evidence_row(row: QuotaV2, call_id: str, meta: dict) -> None:
    prev: list[dict] = []
    if row.hit_evidence:
        try:
            p = json.loads(row.hit_evidence)
            if isinstance(p, list):
                prev = p
        except Exception:
            prev = []
    prev.append({
        'call_id': call_id,
        'at': datetime.now(timezone.utc).isoformat(),
        'confidence': meta.get('confidence'),
        'evidence': meta.get('evidence'),
        'variables': meta.get('variables'),
    })
    row.hit_evidence = json.dumps(prev, ensure_ascii=False)


async def run_transcript_eval_for_campaign(
    db: AsyncSession,
    campaign_id: str,
    *,
    limit: int = 200,
    prefetch_transcripts: bool = True,
) -> dict[str, Any]:
    cap = (await db.execute(
        select(CampaignV2).where(CampaignV2.campaign_id == campaign_id),
    )).scalar_one_or_none()
    if not cap:
        return {'ok': False, 'error': 'campaign not found', 'processed': 0, 'items': []}

    cells = (await db.execute(
        select(QuotaV2).where(QuotaV2.campaign_id == campaign_id).order_by(QuotaV2.id),
    )).scalars().all()

    if not cells:
        return {
            'ok': True, 'message': 'no quota cells', 'processed': 0, 'items': [],
            'campaign_id': campaign_id, 'status': cap.status,
        }

    union_keys = _union_filter_keys(cells)
    if not union_keys:
        return {
            'ok': False,
            'error': 'quota cells have empty filters (no dimensions)',
            'processed': 0, 'items': [],
            'campaign_id': campaign_id, 'status': cap.status,
        }

    prefetch_note: str | None = None
    if prefetch_transcripts:
        try:
            sync_payload = await sync_calls_v2_upstream(db, campaign_id)
            prefetch_note = f"synced upstream calls, detail rows touched={sync_payload.get('count', 0)}"
            logger.info('transcript-eval prefetch: %s', prefetch_note)
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning('transcript-eval prefetch sync skipped: %s', exc, exc_info=True)
            prefetch_note = f'prefetch sync failed (continuing with DB rows): {exc!s}'[: 500]

    allowed = _allowed_values_per_key(cells)
    cells_payload = [
        {'id': c.id, 'label': c.label, 'filters': c.filters_dict(), 'target': c.target, 'completed': c.completed}
        for c in cells
    ]

    q = (
        select(CallV2)
        .where(
            CallV2.campaign_id == campaign_id,
            or_(
                CallV2.quota_checked.is_(False),
                CallV2.quota_checked.is_(None),  # noqa: SIM300
            ),
        )
        .order_by(CallV2.id.asc())  # stable oldest-first
    )
    if limit:
        q = q.limit(limit)
    pending = (await db.execute(q)).scalars().all()
    if not pending:
        idle: dict[str, Any] = {
            'ok': True,
            'message': 'all calls already quota_checked; nothing to do',
            'processed': 0,
            'items': [],
            'campaign_id': campaign_id,
            'status': cap.status,
        }
        if prefetch_note is not None:
            idle['prefetch'] = prefetch_note
        return idle

    out_items: list[dict] = []
    newly_reached_labels: list[str] = []
    for call in pending:
        cat = (call.call_category or '').lower()
        ttext = transcript_to_text(call.transcript)
        if not ttext.strip():
            detail = {
                'status': 'skipped', 'reason': 'empty transcript',
            }
            call.quota_checked = True
            call.quota_check_detail = json.dumps(detail, ensure_ascii=False)
            out_items.append(
                {
                    'call_id': call.call_id,
                    'result': 'skipped', 'reason': 'empty_transcript', 'detail': detail,
                },
            )
            continue
        if cat in LLM_SKIP_CATEGORIES:
            detail = {
                'status': 'skipped', 'reason': f'call_category={cat}',
            }
            call.quota_checked = True
            call.quota_check_detail = json.dumps(detail, ensure_ascii=False)
            out_items.append(
                {
                    'call_id': call.call_id,
                    'result': 'skipped', 'reason': 'category', 'detail': detail,
                },
            )
            continue

        try:
            raw = await _call_openai(union_keys, allowed, cells_payload, ttext)
        except (APITimeoutError, APIConnectionError, RateLimitError) as exc:
            logger.warning('OpenAI transient error for %s: %s', call.call_id, exc)
            out_items.append(
                {
                    'call_id': call.call_id,
                    'result': 'error_retry',
                    'error': str(exc)[: 500],
                    'note': 'quota_checked 未标记，可稍后重试',
                },
            )
            continue
        except Exception as exc:  # noqa: BLE001
            logger.exception('OpenAI / parse failed for %s', call.call_id)
            detail = {
                'status': 'dead_letter', 'error': str(exc)[: 2000],
            }
            call.quota_checked = True
            call.quota_check_detail = json.dumps(detail, ensure_ascii=False)
            out_items.append(
                {
                    'call_id': call.call_id,
                    'result': 'dead_letter', 'error': str(exc)[: 500], 'detail': detail,
                },
            )
            continue

        norm, err_note, hit_list = _validate_and_match(cells, allowed, raw)

        if hit_list:
            st = 'hit'
        elif err_note:
            if '值归一' in err_note or 'LLM variables' in err_note:
                st = 'dead_letter'
            elif 'sufficient' in err_note or '阈值' in err_note:
                st = 'insufficient'
            else:
                st = 'dead_letter'
        else:
            st = 'no_hit'
        if st == 'hit':
            applied: list[dict] = []
            for c2, m2 in hit_list:
                c2.completed = (c2.completed or 0) + 1
                if (c2.target or 0) > 0 and c2.completed == c2.target:
                    newly_reached_labels.append(c2.label)
                _append_hit_evidence_row(c2, call.call_id, m2)
                applied.append(
                    {
                        'cell_id': c2.id, 'label': c2.label, 'new_completed': c2.completed,
                    },
                )
            call.quota_checked = True
            call.quota_check_detail = json.dumps(
                {
                    'status': 'hit',
                    'normalized': norm,
                    'llm': raw,
                    'hits': [
                        {
                            'cell_id': c2.id, 'label': c2.label, 'new_completed': c2.completed,
                            'confidence': m2.get('confidence'),
                            'evidence': (m2.get('evidence') or '')[: 500],
                        }
                        for c2, m2 in hit_list
                    ],
                },
                ensure_ascii=False,
            )
            out_items.append(
                {
                    'call_id': call.call_id, 'result': 'hit', 'norm': norm, 'llm': raw, 'hits': applied,
                },
            )
        else:
            call.quota_checked = True
            call.quota_check_detail = json.dumps(
                {
                    'status': st,
                    'normalized': norm,
                    'llm': raw,
                    'note': err_note or '',
                },
                ensure_ascii=False,
            )
            out_items.append(
                {
                    'call_id': call.call_id, 'result': st, 'norm': norm, 'llm': raw,
                },
            )

    await db.commit()

    for label in newly_reached_labels:
        try:
            await quota_agent_notifier.notify_quota_reached(db, campaign_id, label)
        except Exception as exc:
            logger.warning('notify_quota_reached failed for label %r: %s', label, exc)

    out: dict[str, Any] = {
        'ok': True,
        'processed': len(out_items),
        'items': out_items,
        'campaign_id': campaign_id,
        'status': cap.status,
        'total_pending_before_batch': len(pending),
    }
    if prefetch_note is not None:
        out['prefetch'] = prefetch_note
    return out
