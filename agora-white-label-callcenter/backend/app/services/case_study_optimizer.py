from __future__ import annotations

import json
import logging
from typing import Any

from app.core.config import settings
from app.core.llm import make_async_anthropic_client, make_async_openai_client
from app.models.calls_v2 import CallV2
from app.models.case_study import CaseStudyCallQc
from app.services.case_study_util import format_transcript, loads_json
from app.services.voice_prompt_generator import PROMPT_SECTION_KEYS

logger = logging.getLogger(__name__)

_SECTION_ENUM = [
    'question_sop',
    'core_guidelines',
    'interview_script',
    'closing_remarks',
    'global_execution_logic',
    'randomization_rules',
    'data_mapping',
]

_OPTIMIZER_SYSTEM = """You improve system prompts for an AI outbound telephone survey agent.
You MUST keep the questionnaire questions, option lists, and data-mapping codes intact.
Prefer small patches to question_sop, core_guidelines, and a short few-shot appendix.
Do not rewrite greeting unless opening quality is clearly poor.
Do NOT return a full replacement prompt. Return compact structured fields only.
The summary field MUST be written in English.
lessons_appendix: a short ENGLISH appendix (max ~40 lines) that can be appended to the current prompt.
"""

_OPTIMIZER_SCHEMA = {
    'name': 'prompt_suggestion',
    'strict': True,
    'schema': {
        'type': 'object',
        'additionalProperties': False,
        'properties': {
            'summary': {'type': 'string'},
            'section_patches': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'additionalProperties': False,
                    'properties': {
                        'section': {'type': 'string', 'enum': _SECTION_ENUM},
                        'change': {'type': 'string'},
                    },
                    'required': ['section', 'change'],
                },
            },
            'few_shot_examples': {
                'type': 'array',
                'items': {'type': 'string'},
            },
            'lessons_appendix': {'type': 'string'},
        },
        'required': [
            'summary',
            'section_patches',
            'few_shot_examples',
            'lessons_appendix',
        ],
    },
}

_OPTIMIZER_TOOL = {
    'name': 'submit_prompt_suggestion',
    'description': 'Submit compact prompt improvement fields. Never include the full system prompt.',
    'input_schema': {
        'type': 'object',
        'additionalProperties': False,
        'properties': {
            'summary': {'type': 'string'},
            'section_patches': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'additionalProperties': False,
                    'properties': {
                        'section': {'type': 'string', 'enum': _SECTION_ENUM},
                        'change': {'type': 'string'},
                    },
                    'required': ['section', 'change'],
                },
            },
            'few_shot_examples': {
                'type': 'array',
                'items': {'type': 'string'},
            },
            'lessons_appendix': {'type': 'string'},
        },
        'required': [
            'summary',
            'section_patches',
            'few_shot_examples',
            'lessons_appendix',
        ],
    },
}


def _call_brief(call: CallV2, qc: CaseStudyCallQc) -> str:
    rubric = loads_json(qc.rubric, default={}) or {}
    tr = format_transcript(call.transcript, limit=2500)
    return (
        f'call_id={call.call_id} duration={call.duration_seconds}s '
        f'effective={qc.effective} evidence={qc.evidence or ""}\n'
        f'rubric={json.dumps(rubric, ensure_ascii=False)[:600]}\n'
        f'transcript:\n{tr}'
    )


def _escape_newlines_in_strings(s: str) -> str:
    out: list[str] = []
    in_str = False
    escape = False
    for ch in s:
        if in_str:
            if escape:
                out.append(ch)
                escape = False
            elif ch == '\\':
                out.append(ch)
                escape = True
            elif ch == '"':
                out.append(ch)
                in_str = False
            elif ch == '\n':
                out.append('\\n')
            elif ch == '\r':
                out.append('\\r')
            elif ch == '\t':
                out.append('\\t')
            else:
                out.append(ch)
        else:
            out.append(ch)
            if ch == '"':
                in_str = True
    return ''.join(out)


def _loads_llm_json(raw: str) -> dict[str, Any]:
    text = (raw or '').strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
    start = text.find('{')
    end = text.rfind('}')
    if start >= 0 and end > start:
        text = text[start:end + 1]
    candidates = [text, _escape_newlines_in_strings(text)]
    last_err: Exception | None = None
    for cand in candidates:
        try:
            data = json.loads(cand)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError as exc:
            last_err = exc
    preview = (raw or '')[:400].replace('\n', '\\n')
    raise json.JSONDecodeError(
        f'optimizer JSON parse failed ({last_err}); preview={preview}',
        raw or '',
        getattr(last_err, 'pos', 0) or 0,
    )


def _assemble_suggested(baseline: str, data: dict[str, Any]) -> str:
    parts: list[str] = []
    lessons = str(data.get('lessons_appendix') or '').strip()
    if lessons:
        parts.append(lessons)
    patches = data.get('section_patches') or []
    if isinstance(patches, list) and patches:
        parts.append('Operator notes (keep questionnaire items unchanged):')
        for p in patches:
            if not isinstance(p, dict):
                continue
            section = str(p.get('section') or 'general').strip()
            change = str(p.get('change') or '').strip()
            if change:
                parts.append(f'- [{section}] {change}')
    examples = data.get('few_shot_examples') or []
    if isinstance(examples, list) and examples:
        parts.append('Few-shot examples from high-quality calls:')
        for i, ex in enumerate(examples, 1):
            text = str(ex or '').strip()
            if text:
                parts.append(f'{i}. {text}')
    if not parts:
        return baseline
    block = '## Lessons from high-quality calls\n' + '\n'.join(parts)
    if '## Lessons from high-quality calls' in (baseline or ''):
        return baseline.rstrip()
    return ((baseline or '').rstrip() + '\n\n' + block).strip()


async def _call_via_json_schema(user: str) -> dict[str, Any]:
    client = make_async_openai_client(timeout=180.0, max_retries=1)
    resp = await client.chat.completions.create(
        model=settings.anthropic_model,
        temperature=0.2,
        max_tokens=4096,
        response_format={'type': 'json_schema', 'json_schema': _OPTIMIZER_SCHEMA},
        messages=[
            {'role': 'system', 'content': _OPTIMIZER_SYSTEM},
            {'role': 'user', 'content': user},
        ],
    )
    text = (resp.choices[0].message.content or '').strip()
    return _loads_llm_json(text)


async def _call_via_tool(user: str) -> dict[str, Any]:
    client = make_async_anthropic_client()
    resp = await client.messages.create(
        model=settings.anthropic_model,
        max_tokens=4096,
        system=_OPTIMIZER_SYSTEM,
        tools=[_OPTIMIZER_TOOL],
        tool_choice={'type': 'tool', 'name': 'submit_prompt_suggestion'},
        messages=[{'role': 'user', 'content': user}],
    )
    for block in resp.content:
        if getattr(block, 'type', None) == 'tool_use' and getattr(block, 'input', None):
            data = block.input
            if isinstance(data, dict):
                return data
    text = ''.join(
        getattr(block, 'text', '') or ''
        for block in resp.content
        if getattr(block, 'type', None) == 'text'
    )
    return _loads_llm_json(text)


async def _call_optimizer(user: str) -> dict[str, Any]:
    try:
        return await _call_via_json_schema(user)
    except Exception as exc:
        logger.warning('optimizer json_schema failed, trying Anthropic tool_use: %s', exc)
    return await _call_via_tool(user)


async def generate_suggestions(
    *,
    baseline: str,
    effective_calls: list[tuple[CallV2, CaseStudyCallQc]],
    weak_calls: list[tuple[CallV2, CaseStudyCallQc]],
) -> dict[str, Any]:
    if not settings.effective_openai_api_key and not settings.effective_anthropic_api_key:
        raise RuntimeError('OPENROUTER_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY) is not configured')

    gold_parts = [_call_brief(c, q) for c, q in effective_calls[:8]]
    weak_parts = [_call_brief(c, q) for c, q in weak_calls[:3]]
    user = (
        f'Known prompt section keys (keep structure if present): {", ".join(PROMPT_SECTION_KEYS)}\n\n'
        f'=== CURRENT SYSTEM PROMPT ===\n{baseline[:24000]}\n\n'
        f'=== HIGH-QUALITY CALLS ({len(effective_calls)}) ===\n'
        + '\n\n---\n\n'.join(gold_parts)
    )
    if weak_parts:
        user += (
            f'\n\n=== LOW-QUALITY PATTERNS TO AVOID ({len(weak_calls)}) ===\n'
            + '\n\n---\n\n'.join(weak_parts)
        )

    data = await _call_optimizer(user)
    patches = data.get('section_patches') or []
    examples = data.get('few_shot_examples') or []
    if not isinstance(patches, list):
        patches = []
    if not isinstance(examples, list):
        examples = []
    suggested = _assemble_suggested(baseline, data)
    summary = str(data.get('summary') or '').strip()
    if not summary:
        summary = '- Prompt suggestion generated from effective calls. Review Diff to inspect changes.'
    return {
        'summary': summary,
        'section_patches': patches,
        'few_shot_examples': examples,
        'suggested_system_content': suggested,
    }
