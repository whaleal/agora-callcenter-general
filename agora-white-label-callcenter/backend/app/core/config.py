from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ENV_FILE = _BACKEND_DIR / '.env'


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding='utf-8',
        extra='ignore',
    )

    database_url: str = 'sqlite+aiosqlite:///./dev.db'
    anthropic_api_key: str = ''
    agora_api_key: str = ''
    agora_conversational_api_key: str = ''
    agora_conversational_base_url: str = 'https://api.agora.io/conversational-ai/v2'
    agora_project_id: str = '783e5e2007af491aaa66d68a62c81188'
    agora_pipeline_id: str = '367139eca6ee44fc9eb26232d3da210e'
    agora_phone_number: str = '031186778285'
    voice_agent_base_url: str = 'http://localhost:9000'
    voice_agent_api_key: str = ''
    webhook_secret: str = 'changeme'
    poll_interval_seconds: int = 5
    max_concurrent_calls: int = 10
    openai_api_key: str = ''
    minimax_api_key: str = ''

    # OpenRouter（优先）：一套 key 同时走 OpenAI 兼容协议与 Anthropic Messages 协议
    openrouter_api_key: str = ''
    openrouter_base_url: str = 'https://openrouter.ai/api/v1'
    openrouter_anthropic_base_url: str = 'https://openrouter.ai/api'

    # 模型 ID（OpenRouter 使用 provider/model；直连官方时可改回官方名称）
    anthropic_model: str = 'anthropic/claude-sonnet-4.6'
    agent_llm_model: str = 'openai/gpt-4o-mini'
    quota_transcript_model: str = 'openai/gpt-4o-mini'
    quota_transcript_min_confidence: float = 0.5
    structured_output_poll_interval_seconds: int = 20
    structured_output_poll_batch_size: int = 80
    quota_transcript_eval_poll_interval_seconds: int = 20
    quota_transcript_eval_poll_batch_limit: int = 200

    # AWS S3 (for audio migration)
    aws_access_key_id: str = ''
    aws_secret_access_key: str = ''
    aws_s3_bucket: str = 'taiwanplus'
    aws_s3_region: str = 'ap-southeast-1'
    aws_s3_prefix: str = 'recordings/'

    # Auth（签名密钥由 app.core.jwt_keys 首次启动时自动生成，不放配置）
    jwt_expire_minutes: int = 10080  # 7 days
    email_code_ttl_seconds: int = 600
    email_code_resend_seconds: int = 60
    operation_log_retention_days: int = 30

    # SMTP（未配置 SMTP_HOST 时 send-code 会在响应里返回 dev_code，仅用于本地开发）
    smtp_host: str = ''
    smtp_port: int = 587
    smtp_user: str = ''
    smtp_password: str = ''
    smtp_from: str = ''
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False

    @property
    def use_openrouter(self) -> bool:
        return bool((self.openrouter_api_key or '').strip())

    @property
    def smtp_enabled(self) -> bool:
        return bool((self.smtp_host or '').strip())

    @property
    def smtp_implicit_ssl(self) -> bool:
        """465/994 是隐式 SSL；587 才是 STARTTLS。"""
        if self.smtp_use_ssl:
            return True
        return int(self.smtp_port) in {465, 994}

    @property
    def effective_openai_api_key(self) -> str:
        """OpenAI 兼容调用：优先 OpenRouter，否则回退 OPENAI_API_KEY。"""
        return (self.openrouter_api_key or self.openai_api_key or '').strip()

    @property
    def effective_anthropic_api_key(self) -> str:
        """Anthropic Messages 调用：优先 OpenRouter，否则回退 ANTHROPIC_API_KEY。"""
        return (self.openrouter_api_key or self.anthropic_api_key or '').strip()

    @property
    def openai_compatible_base_url(self) -> str | None:
        if self.use_openrouter:
            return self.openrouter_base_url.rstrip('/')
        return None

    @property
    def openai_compatible_chat_completions_url(self) -> str:
        if self.use_openrouter:
            return f'{self.openrouter_base_url.rstrip("/")}/chat/completions'
        return 'https://api.openai.com/v1/chat/completions'

    @property
    def anthropic_sdk_base_url(self) -> str | None:
        if self.use_openrouter:
            return self.openrouter_anthropic_base_url.rstrip('/')
        return None


settings = Settings()
