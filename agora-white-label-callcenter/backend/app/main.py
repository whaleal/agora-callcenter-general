from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi

from app.core.auth_middleware import AuthMiddleware
from app.core.config import settings
from app.core.database import init_db
from app.core.operation_log_middleware import OperationLogMiddleware
from app.api import auth, websocket, settings_api, phone_numbers, agents, campaigns_v2, quota_v2, calls_v2, agora_campaigns, inbound_routing, dashboard, live_test, import_csv, usage, operation_logs
from app.services.calls_structured_output_poll import start_structured_output_poll
from app.services.quota_transcript_eval_poll import start_quota_transcript_eval_poll
from app.services.maintenance import start_maintenance

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    if settings.smtp_enabled:
        logger.info(
            'SMTP enabled: %s:%s ssl=%s from=%s',
            settings.smtp_host,
            settings.smtp_port,
            settings.smtp_implicit_ssl,
            (settings.smtp_from or settings.smtp_user or '').strip(),
        )
    else:
        logger.warning('SMTP not configured: set SMTP_HOST in backend/.env (not .env.example)')
    start_structured_output_poll()
    start_quota_transcript_eval_poll()
    start_maintenance()
    yield


app = FastAPI(title='Campaign Manager API', lifespan=lifespan)

app.add_middleware(AuthMiddleware)
app.add_middleware(OperationLogMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
    ],
    # 内网其它机器用 IP 打开前端时 Origin 不是 localhost，必须放行否则 OPTIONS 预检会 400
    allow_origin_regex=r'https?://(localhost|127\.0\.0\.1|(\d{1,3}\.){3}\d{1,3})(:\d+)?',
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(auth.router)
app.include_router(websocket.router)
app.include_router(settings_api.router)
app.include_router(phone_numbers.router)
app.include_router(agents.router)
app.include_router(campaigns_v2.router)
app.include_router(quota_v2.router)
app.include_router(calls_v2.router)
app.include_router(agora_campaigns.router)
app.include_router(inbound_routing.router)
app.include_router(dashboard.router)
app.include_router(live_test.router)
app.include_router(import_csv.router)
app.include_router(usage.router)
app.include_router(operation_logs.router)


@app.get('/health', openapi_extra={'security': []})
async def health():
    return {'status': 'ok'}


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        routes=app.routes,
    )
    schema.setdefault('components', {})['securitySchemes'] = {
        'BearerAuth': {'type': 'http', 'scheme': 'bearer', 'bearerFormat': 'JWT'},
    }
    schema['security'] = [{'BearerAuth': []}]
    app.openapi_schema = schema
    return schema


app.openapi = custom_openapi
