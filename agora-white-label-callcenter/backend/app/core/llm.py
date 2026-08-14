"""LLM client factories — OpenRouter first, with direct OpenAI / Anthropic fallback."""

from __future__ import annotations

import anthropic
import httpx
from openai import AsyncOpenAI

from app.core.config import settings


def make_async_openai_client(
    *,
    timeout: float = 120.0,
    max_retries: int = 1,
) -> AsyncOpenAI:
    api_key = settings.effective_openai_api_key
    if not api_key:
        raise RuntimeError('OPENROUTER_API_KEY (or OPENAI_API_KEY) 未配置')
    kwargs: dict = {
        'api_key': api_key,
        'timeout': timeout,
        'max_retries': max_retries,
    }
    base_url = settings.openai_compatible_base_url
    if base_url:
        kwargs['base_url'] = base_url
    return AsyncOpenAI(**kwargs)


def make_async_anthropic_client() -> anthropic.AsyncAnthropic:
    api_key = settings.effective_anthropic_api_key
    if not api_key:
        raise RuntimeError('OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) 未配置')
    kwargs: dict = {
        'api_key': api_key,
        # Disable SSL verification to work behind corporate proxies / VPNs
        'http_client': httpx.AsyncClient(verify=False),
    }
    base_url = settings.anthropic_sdk_base_url
    if base_url:
        kwargs['base_url'] = base_url
    return anthropic.AsyncAnthropic(**kwargs)
