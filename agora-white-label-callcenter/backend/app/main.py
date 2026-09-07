from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.database import init_db
from app.api import websocket, settings_api, phone_numbers, agents, campaigns_v2, quota_v2, calls_v2, agora_campaigns, inbound_routing, dashboard, live_test, import_csv, case_study, voices
from app.services.calls_structured_output_poll import start_structured_output_poll
from app.services.quota_transcript_eval_poll import start_quota_transcript_eval_poll
from app.services.case_study_scheduler import start_case_study_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    start_structured_output_poll()
    start_quota_transcript_eval_poll()
    start_case_study_scheduler()
    yield


app = FastAPI(title='Campaign Manager API', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        'http://localhost:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
    ],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

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
app.include_router(case_study.router)
app.include_router(voices.router)


@app.get('/health')
async def health():
    return {'status': 'ok'}
