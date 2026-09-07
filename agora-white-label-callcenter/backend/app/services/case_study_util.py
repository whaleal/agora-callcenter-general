from __future__ import annotations

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.config import settings


def ts_to_seconds(ts: int | None) -> int | None:
    if ts is None:
        return None
    return ts // 1000 if ts > 9_999_999_999 else ts


def biz_day_bounds(biz_date: str) -> tuple[int, int, int, int]:
    """Return (start_sec, end_sec, start_ms, end_ms) for a YYYY-MM-DD in Case Study TZ."""
    tz = ZoneInfo(settings.case_study_timezone)
    start = datetime.strptime(biz_date, '%Y-%m-%d').replace(tzinfo=tz)
    end = start + timedelta(days=1)
    start_s = int(start.timestamp())
    end_s = int(end.timestamp())
    return start_s, end_s, start_s * 1000, end_s * 1000


def yesterday_biz_date() -> str:
    tz = ZoneInfo(settings.case_study_timezone)
    return (datetime.now(tz) - timedelta(days=1)).strftime('%Y-%m-%d')


def today_biz_date() -> str:
    tz = ZoneInfo(settings.case_study_timezone)
    return datetime.now(tz).strftime('%Y-%m-%d')


def utc_now_iso() -> str:
    from datetime import timezone
    return datetime.now(timezone.utc).isoformat()


def loads_json(raw: str | None, default=None):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def dumps_json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)


def parse_call_success(structured_output: str | None):
    if not structured_output:
        return None
    try:
        so = json.loads(structured_output)
    except Exception:
        return None
    if isinstance(so, dict):
        return so.get('call_success')
    if isinstance(so, list) and so and isinstance(so[0], dict):
        return so[0].get('call_success')
    return None


def parse_success_criteria(campaign_structured_output: str | None) -> str:
    data = loads_json(campaign_structured_output, default=None)
    if not isinstance(data, dict):
        return ''
    cse = data.get('call_success_evaluation') or {}
    if isinstance(cse, dict):
        return str(cse.get('criteria') or '').strip()
    return ''


def format_transcript(raw: str | None, limit: int = 8000) -> str:
    data = loads_json(raw, default=[])
    lines: list[str] = []
    if isinstance(data, list):
        for m in data:
            if isinstance(m, dict):
                role = m.get('role') or m.get('speaker') or 'unknown'
                text = m.get('content') if m.get('content') is not None else m.get('text')
                text = str(text or '').strip()
                if text:
                    lines.append(f'{role}: {text}')
            elif m is not None and str(m).strip():
                lines.append(str(m).strip())
    else:
        lines.append(str(data)[:limit])
    text = '\n'.join(lines)
    return text[:limit]


def audio_format_from_url(url: str) -> str:
    lower = (url or '').split('?', 1)[0].lower()
    for ext in ('wav', 'mp3', 'm4a', 'ogg', 'webm', 'aac'):
        if lower.endswith('.' + ext):
            return ext
    return 'wav'
