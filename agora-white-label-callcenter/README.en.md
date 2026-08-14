# Smart Campaign Manager

A global AI-powered outbound call center campaign management platform built on **Agora's Conversational AI / SIP calling REST API**. The system lets you create AI voice agents, bind phone numbers, launch outbound call campaigns for any region or language, and get real-time statistics and quota (sampling quota) tracking based on call transcripts and structured extraction. The platform itself is not tied to any specific country or language — agent language, scripts, and quota dimensions are entirely configurable per project.

> Note: legacy v1 components still present in the repo (`services/parsers/` except docx, `schemas/survey.py`, `schemas/quota.py`, `schemas/callback.py`, `app/models/survey.py`, `app/models/quota.py`) are no longer referenced by `main.py` — they belong to an older "Voice Agent stub" architecture. This document describes only the currently active v2 architecture.

---

## Feature Overview

| Module | Description |
|--------|-------------|
| **AI Voice Agent** | Create/edit Agora Conversational AI agents (ASR + LLM + TTS + interruption/silence-detection config); upload a questionnaire and Claude auto-generates an interview prompt in any language |
| **Phone Numbers / SIP Trunks** | Manage outbound number resources (SIP gateway), synced with Agora's number inventory; supports numbers from any country |
| **Outbound Campaigns** | Create/sync/interrupt campaigns; bind an agent + phone number + dial list; configure hangup rules, recording, and structured-output schema |
| **Call Log Sync** | Incrementally pulls call records from Agora (watermark-based), persisting transcripts, recording URLs, and structured extraction results |
| **Quota Management** | Define sampling quotas along fully custom dimensions (e.g. region/gender/age, or any business dimension) per campaign; an LLM extracts variables from call transcripts, matches them against quota cells, and auto-notifies the agent to close a cell once it's full |
| **Analytics Dashboard** | Daily dial volume, answer rate, call duration, and call-category distribution |
| **Inbound Routing** | Manage phone-number-to-agent binding for inbound calls |
| **Live Test** | Talk to an agent directly in the browser over RTC to validate behavior without placing a real call |
| **CSV Import / Recording Migration** | Bulk-import historical call CSV data; migrate recordings from temporary URLs to your own S3 bucket |
| **Multi-language UI** | UI localization for English / Chinese / Japanese / Korean (i18next), extensible to more; UI language is independent from the agent's conversational language, which is set via prompt/TTS/ASR config |

---

## Tech Stack

### Frontend (`frontend/`)

| Technology | Version |
|------------|---------|
| React | 19 |
| Vite | 8 |
| TypeScript | 5.9 |
| React Router | 7 |
| TanStack Query | 5 |
| Tailwind CSS | 3 |
| Recharts | 2 |
| agora-rtc-sdk-ng / agora-rtm-sdk | 4 / 2 |
| i18next | 26 |

### Backend (`backend/`)

| Technology | Version |
|------------|---------|
| FastAPI | 0.115 |
| SQLAlchemy (async) | 2.0 |
| asyncpg (prod) / aiosqlite (local) | 0.30 / 0.20 |
| Alembic | 1.13 |
| Pydantic Settings | 2.5 |
| Anthropic SDK (Claude — prompt/quota generation) | 0.34 |
| OpenAI SDK (agent LLM, transcript-based quota evaluation) | ≥1.50 |
| httpx | 0.27 |
| boto3 (S3 recording migration) | ≥1.35 |
| pdfplumber / python-docx / openpyxl | questionnaire parsing |

### External Service Dependencies

- **Agora Conversational AI / SIP Calling REST API** (`agora_conversational_base_url`, default `https://api.agora.io/conversational-ai/v2`) — the core of the platform: agents, campaigns, calls, phone numbers, and inbound bindings. Most database tables in this project are a local cache/mirror of this API's responses. Supports numbers/lines across regions worldwide.
- **Anthropic Claude** (`claude-sonnet-4-6`) — parses questionnaires and generates interview prompts (any language), and suggests quota configurations.
- **OpenAI** (default `gpt-4o-mini`; agent conversation LLM defaults to `gpt-5.4-nano`) — powers agent dialogue and extracts quota dimensions from call transcripts.
- **AWS S3** (optional) — permanent storage for call recordings.

---

## Directory Structure

```
agora-white-label-callcenter/
├── frontend/
│   └── src/
│       ├── types/index.ts              # Shared TypeScript types
│       ├── pages/
│       │   ├── auth/                   # Login
│       │   ├── campaigns/              # Campaign list/detail/agent prompt/quota insight
│       │   ├── agents/                 # AI agent management
│       │   ├── phone-numbers/          # Phone number / SIP trunk management
│       │   ├── inbound-routing/        # Inbound call routing bindings
│       │   ├── call-history/           # Call log
│       │   ├── quotas/, surveys/       # Legacy questionnaire-style quota wizard (some pages still in use)
│       │   ├── dashboard/              # Analytics dashboard (AnalyticsDashboard is the current main view)
│       │   ├── import/                 # CSV import / recording migration
│       │   └── settings/               # System settings
│       ├── components/
│       │   ├── Layout.tsx              # Sidebar navigation shell
│       │   └── ui/                     # Badge, ProgressBar
│       ├── i18n/locales/               # en / zh / ja / ko (UI localization, extensible)
│       └── lib/                        # utils, auth (login state)
├── backend/
│   └── app/
│       ├── main.py                     # FastAPI entrypoint + CORS + lifespan (creates tables, starts background pollers)
│       ├── core/
│       │   ├── config.py               # Pydantic Settings (.env)
│       │   └── database.py             # Async SQLAlchemy engine + init_db (table creation + incremental DDL)
│       ├── models/                     # ORM models (see "Database Schema" below)
│       ├── api/
│       │   ├── agents.py               # AI agent CRUD, proxies Agora Agent API
│       │   ├── agora_campaigns.py      # Questionnaire parsing + AI prompt generation + AI quota suggestion (stateless)
│       │   ├── campaigns_v2.py         # Outbound campaign CRUD, proxies Agora Campaign API
│       │   ├── calls_v2.py             # Call log sync/query, proxies Agora Calls API
│       │   ├── quota_v2.py             # Quota cell management + transcript-based quota evaluation trigger
│       │   ├── phone_numbers.py        # Phone number / SIP trunk CRUD, proxies Agora phone number API
│       │   ├── inbound_routing.py      # Inbound routing (number-to-agent binding)
│       │   ├── dashboard.py            # Dashboard statistics
│       │   ├── live_test.py            # Browser-based RTC live test
│       │   ├── import_csv.py           # Bulk CSV import + S3 recording migration
│       │   ├── settings_api.py         # .env editor (legacy, some fields are no longer active)
│       │   └── websocket.py            # WS /ws/campaigns/{id} (currently not used for actual broadcasts — legacy channel)
│       └── services/
│           ├── voice_prompt_generator.py       # Claude streaming interview-prompt generation + variable schema extraction
│           ├── calls_structured_output_poll.py # Background poller: backfills call transcript / structured output
│           ├── quota_transcript_eval.py        # LLM extracts quota dimensions from transcripts and matches quota cells
│           ├── quota_transcript_eval_poll.py   # Background poller: batches transcript-based quota evaluation
│           ├── quota_agent_notifier.py         # Auto-updates agent prompt and notifies Agora once a quota cell fills up
│           ├── ws_hub.py                       # WebSocket broadcast hub (currently no callers)
│           └── parsers/docx_parser.py          # DOCX questionnaire text extraction
├── scripts/
│   ├── run_db_migration.py             # Manual, idempotent column-migration fallback script
│   └── migrate_audio_s3.py             # Bulk-migrates recordings from temporary URLs to S3
├── seed.py                             # Legacy (v1) seed-data script, incompatible with the current v2 models — reference only
└── Dockerfile                          # Combined frontend+backend image (Vite build + FastAPI + nginx)
```

The parent repository directory (one level above `agora-white-label-callcenter`) also contains `docker-compose.yml` (Postgres + this app's container) and `quick-deploy.sh` (one-command build/deploy script) for production deployment — see "Deployment" below.

---

## Database Schema

The database is defined via SQLAlchemy's async ORM. Local development defaults to SQLite (`dev.db`); production uses PostgreSQL (`asyncpg`). `init_db()` creates all tables on startup and runs idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for newly added columns (so new fields generally don't require a separate migration step, though `scripts/run_db_migration.py` remains as a manual fallback).

> Note: most of the v2 tables below are a **local mirror/cache** of Agora cloud resources (agents / campaigns / phone numbers / calls) — the actual business state and execution live on Agora's side. Local tables exist mainly for fast querying, offline display, and to hold locally-owned fields (quotas, import flags, etc.).

### `agent_v2` — AI Voice Agent

Maps to an Agora Conversational AI Agent resource.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment primary key |
| `agent_id` | VARCHAR(64) UNIQUE | Agent ID returned by Agora |
| `agent_name` | VARCHAR(255) | Agent display name |
| `app_id` | VARCHAR(64) | Agora App ID |
| `system_content` | TEXT | LLM system prompt (interview script, any language) |
| `greeting_message` | TEXT | Opening greeting |
| `failure_message` | TEXT | Failure/fallback script |
| `voice_id` | VARCHAR(128) | TTS voice ID |
| `properties` | TEXT (JSON) | Full ASR/LLM/TTS/VAD config (contains sensitive keys, masked as `****` when displayed) |
| `created_at` / `updated_at` | VARCHAR(64) | Timestamps |

### `campaigns_v2` — Outbound Campaign

Maps to an Agora Campaign (outbound dialing task) resource; the central table of a campaign.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment primary key |
| `campaign_id` | VARCHAR(64) UNIQUE | Campaign ID returned by Agora |
| `campaign_name` | VARCHAR(255) | Campaign name |
| `questionnaire_type` | VARCHAR(32) | Local metadata: `create_agent_by_ai` / `existing_agent` (new) or `file_upload` / `url_load` (legacy, kept for compatibility) |
| `quota_mode` | VARCHAR(32) | Local metadata: `manual` / `ai_auto` (new) or `hybrid` / `ai` (legacy) |
| `total_numbers` | INTEGER | Total size of the dial list |
| `phone_number_id` / `phone_number` | VARCHAR(64) | Bound outbound number (synced from Agora) |
| `agent_id` / `agent_name` | VARCHAR(64/255) | Bound agent (synced from Agora) |
| `start_immediately` | BOOLEAN | Whether to start immediately |
| `max_call_duration_seconds` | INTEGER | Max duration per call |
| `silence_timeout_seconds` | INTEGER | Silence timeout in seconds |
| `end_call_on_silence_timeout` | BOOLEAN | Auto-hangup on silence timeout |
| `ring_timeout_seconds` | INTEGER | Ring timeout in seconds |
| `end_call_on_user_request` / `end_call_on_ai_assistant` | BOOLEAN | Hangup trigger conditions |
| `structured_output` | TEXT (JSON) | Structured-output schema (variables Agora extracts from calls) |
| `enable_transcript` / `enable_recording` | BOOLEAN | Whether transcript / recording is enabled |
| `status` | VARCHAR(32) | Campaign status (synced from Agora, e.g. `running` / `interrupted` / `completed`) |
| `created_at` / `updated_at` | VARCHAR(64) | Timestamps |
| `is_imported` | BOOLEAN | Whether this came from a CSV historical import |
| `imported_at` | TEXT | Import timestamp |

Relations: one campaign has many `calls_v2` rows (via `campaign_id`), many `quota_v2` cells, and one `calls_v2_sync_state` watermark row.

### `calls_v2` — Call Log

Maps to per-call detail from Agora's Calls API, synced incrementally.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment primary key |
| `campaign_id` | VARCHAR(64), indexed | Owning campaign (logical FK → `campaigns_v2.campaign_id`) |
| `call_id` | VARCHAR(64) UNIQUE | Agora call ID |
| `sip_call_id` | VARCHAR(128) | SIP call ID |
| `agent_id` / `agent_session_id` / `agent_name` | VARCHAR | Participating agent info |
| `from_number` / `to_number` | VARCHAR(64) | Caller / callee numbers |
| `call_category` | VARCHAR(64) | Call category (`answered` / `voicemail` / `no_answer` / `failed`, etc.) |
| `hangup_reason` | VARCHAR(128) | Hangup reason |
| `duration_seconds` | INTEGER | Call duration |
| `answered_ts` / `call_ts` / `start_ts` / `end_ts` | BIGINT | Various stage timestamps (units depend on Agora's response) |
| `channel_name` | VARCHAR(255) | RTC channel name |
| `transcript` | TEXT (JSON) | Call transcript (turn-by-turn) |
| `record_file_url` | TEXT | Recording URL (`http(s)://...` or, once migrated, `s3://...`) |
| `structured_output` | TEXT (JSON) | Agora's structured extraction result |
| `structured_output_status` | VARCHAR(64) | Extraction status (`completed` / `failed` / `disabled`, etc.; kept up to date by a background poller while non-terminal) |
| `quota_checked` | BOOLEAN | Whether transcript-based quota evaluation has run (each call is processed at most once) |
| `quota_check_detail` | TEXT (JSON) | Quota evaluation detail (status, model used, hits, errors) |
| `is_imported` | BOOLEAN | Whether this came from a CSV historical import |
| `original_record_url` | TEXT | Original recording URL prior to S3 migration (kept for traceability) |

### `calls_v2_sync_state` — Call Sync Watermark

One row per campaign, tracking the timestamp watermark used to incrementally sync Agora's call list, avoiding a full re-fetch every time.

| Column | Type | Description |
|--------|------|-------------|
| `campaign_id` | VARCHAR(64) PK | Owning campaign (logical FK → `campaigns_v2.campaign_id`) |
| `last_call_ts` | BIGINT | Timestamp of the most recently synced call |
| `updated_at` | DATETIME | Last update time |

### `quota_v2` — Quota Cell

Sampling quota for a survey/campaign; each row represents one "dimension combination" cell (dimensions and values are entirely user-defined — e.g. region/gender/age, or any other business dimension like industry or customer tier), bound to a campaign.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment primary key |
| `campaign_id` | VARCHAR(128), indexed | Owning campaign (logical FK → `campaigns_v2.campaign_id`) |
| `label` | VARCHAR(512) | Human-readable dimension combination, e.g. `Region=North America, Gender=Female, Age=30-39` |
| `filters` | TEXT (JSON) | Dimension filter, e.g. `{"Region":"North America","Gender":"Female","Age":"30-39"}` — a call must match ALL of these to hit this cell |
| `target` | INTEGER | Target quota count |
| `completed` | INTEGER | Number completed so far (incremented on each matching transcript evaluation) |
| `hit_evidence` | TEXT (JSON) | List of hit records: `[{call_id, at, confidence, evidence, variables}, ...]` |
| `created_at` | DATETIME | Creation time |

### `phone_numbers_v2` — Phone Numbers / SIP Trunks

Maps to Agora phone number resources; supports numbers from any region.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment primary key |
| `number_id` | VARCHAR(64) UNIQUE | Agora phone number resource ID |
| `name` | VARCHAR(255) | Number label |
| `phone_number` | VARCHAR(64) | Actual number (with country/region code) |
| `type` | VARCHAR(32) | Number type |
| `sip_gateway_host` | VARCHAR(255) | SIP gateway host |
| `sip_signaling_port` | INTEGER | SIP signaling port |
| `outbound_protocol` | VARCHAR(32) | Outbound protocol |
| `created_at` / `updated_at` | VARCHAR(64) | Timestamps |

Relations: `campaigns_v2.phone_number_id` references this table. Inbound routing (agent-to-number binding) itself is **not persisted locally** — it's queried live from the Agora API.

### Legacy Tables (do not build new features on these — kept only for compatibility with old data)

| Table | Model file | Notes |
|-------|-----------|-------|
| `agora_campaigns` | `models/agora_campaign.py` | Old campaign model with heavy field overlap with `campaigns_v2`; only imported in `models/__init__.py`, no router uses it |
| `campaign_calls` | `models/campaign_call.py` | Old call-log model similar to `calls_v2`; no router uses it |
| (v1) `survey` / `quota_cell` | `models/survey.py` (if still present), `schemas/survey.py`, `schemas/quota.py` | Old "questionnaire-style survey" model, superseded by `campaigns_v2` + `quota_v2`; `seed.py` still references it and is incompatible with the current schema |

---

## Getting Started (Local Development)

### Prerequisites

- Python 3.11+
- Node.js 20+
- (Optional) PostgreSQL 16 — local dev works fine with the built-in SQLite

### 1. Clone the repository

```bash
git clone <repo-url>
cd agora-white-label-callcenter
```

### 2. Backend

```bash
cd backend
cp .env.example .env        # fill in the values described in "Environment Variables" below
pip install -r requirements.txt
uvicorn app.main:app --reload
# Backend runs at http://localhost:8000; tables are created automatically on first run (dev.db)
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# Frontend runs at http://localhost:5173, pointing to the backend via VITE_API_URL (frontend/.env)
```

Open `http://localhost:5173` in your browser — you'll be redirected to the login page first (`isAuthenticated()` checks local login state).

---

## Environment Variables (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./dev.db` | Database connection (use `postgresql+asyncpg://...` in production) |
| `OPENROUTER_API_KEY` | — | **Recommended**: OpenRouter API key for both Claude (Anthropic Messages) and GPT (OpenAI-compatible) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible API base URL |
| `OPENROUTER_ANTHROPIC_BASE_URL` | `https://openrouter.ai/api` | Anthropic SDK / Messages base URL |
| `ANTHROPIC_MODEL` | `anthropic/claude-sonnet-4.6` | Model for prompt generation / quota suggestion |
| `AGENT_LLM_MODEL` | `openai/gpt-4o-mini` | Agora Voice Agent conversation LLM model |
| `ANTHROPIC_API_KEY` | — | Direct Anthropic key fallback when OpenRouter is unset |
| `AGORA_CONVERSATIONAL_API_KEY` | — | Credential for the Agora Conversational AI / SIP calling REST API (required) |
| `AGORA_PROJECT_ID` | — | Agora project ID (required) |
| `AGORA_APP_CERTIFICATE` | — | Agora App certificate (used for RTC/RTM token generation, etc.) |
| `AGORA_CONVERSATIONAL_BASE_URL` | `https://api.agora.io/conversational-ai/v2` | Base URL for the Agora Conversational AI API |
| `OPENAI_API_KEY` | — | Direct OpenAI key fallback when OpenRouter is unset |
| `QUOTA_TRANSCRIPT_MODEL` | `openai/gpt-4o-mini` | Model used for transcript-based quota extraction |
| `QUOTA_TRANSCRIPT_MIN_CONFIDENCE` | `0.5` | Minimum confidence (0-1) required to count a hit |
| `POLL_INTERVAL_SECONDS` | `5` | Legacy field (v1 polling interval, unused by current code) |
| `MAX_CONCURRENT_CALLS` | `10` | Legacy field (v1 concurrent-call cap, unused by current code) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | AWS credentials for recording migration to S3 (optional feature) |
| `AWS_S3_BUCKET` / `AWS_S3_REGION` / `AWS_S3_PREFIX` | — | Target S3 bucket configuration |

`frontend/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:8000` | Backend API base URL |

---

## Key Data Flows

```
Create agent → Claude parses the questionnaire / generates the prompt (any language) → saved to agent_v2 (system_content/greeting)
             → Agora Agent API creates the remote agent

Create campaign → bind agent_id + phone_number_id + dial list + structured-output schema
                → Agora Campaign API → written to campaigns_v2

Campaign running → frontend periodically polls /api/calls-v2/{id}/sync
                  → incrementally pulls Agora's call list (using the calls_v2_sync_state watermark)
                  → writes/updates calls_v2, backfilling transcript, recording, structured output

Background pollers:
  calls_structured_output_poll   → periodically backfills incomplete transcript / structured_output
  quota_transcript_eval_poll     → periodically runs LLM-based quota extraction on unevaluated calls
                                  → matched dimension combo → quota_v2.completed += 1, appended to hit_evidence
                                  → once full → quota_agent_notifier auto-updates the agent prompt and syncs to Agora

Analytics dashboard → /api/dashboard/stats aggregates daily dial volume / answer rate / duration / category distribution from calls_v2
```

---

## Deployment (Production)

The repository root (one level above `agora-white-label-callcenter`) ships an all-in-one container deployment setup:

- **`docker-compose.yml`** — orchestrates `agora-callcenter-postgres` (PostgreSQL 16) + `agora-callcenter-app` (this project's image), reachable only within the internal Docker network `whip-network` — **no ports are exposed to the host**, so it requires an upstream gateway (nginx/Traefik, etc.) for routing.
- **`Dockerfile`** — multi-stage build: stage 1 builds the frontend with Node 20 (supports a custom deployment sub-path via `APP_VITE_BASE_PATH`); stage 2, based on `python:3.11-slim`, installs backend dependencies and uses an embedded nginx on container port `:8080` to serve the frontend's static files while reverse-proxying `/api/` and `/ws` to the local `uvicorn :8000`.
- **`quick-deploy.sh`** — one-command build & deploy script.

```bash
# Before first deploy, prepare a root .env (AGORA_*, OPENROUTER_API_KEY, etc.)
cp agora-white-label-callcenter/backend/.env.example .env
vim .env

# Deploy under the default path /callcenter/
./quick-deploy.sh

# Or deploy under a custom sub-path
APP_PREFIX=/my-callcenter/ ./quick-deploy.sh
```

After deployment, configure your upstream gateway to reverse-proxy the same path prefix to the container's `:8080`, e.g.:
- Frontend: `https://<domain>/callcenter/`
- API: `https://<domain>/callcenter/api/...`

In production, the database connection automatically becomes `postgresql+asyncpg://campaign:campaign123@agora-callcenter-postgres:5432/campaign_db` (see `docker-compose.yml` — change the default password before going live).

---

## Other Scripts

```bash
# Backfill new columns manually (init_db already does this automatically — this is a fallback)
cd backend && python scripts/run_db_migration.py

# Bulk-migrate call recordings from temporary URLs to your own S3 bucket (dry-run first)
cd backend && python scripts/migrate_audio_s3.py --dry-run
cd backend && python scripts/migrate_audio_s3.py

# Frontend type check / build
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

> `seed.py` is a legacy (v1) seed-data script referencing `models/survey.py` / `models/quota.py`, which are incompatible with the current v2 architecture — running it directly is not recommended.

---

## Known Issues / TODO

- [ ] The WebSocket real-time push channel formed by `api/websocket.py` + `services/ws_hub.py` is not currently called by any business logic (the frontend now polls REST endpoints instead) — legacy infrastructure
- [ ] Some environment variable keys in `api/settings_api.py` (`VOICE_AGENT_*`, `AGORA_PIPELINE_ID`, etc.) are no longer used by the v2 code path
- [ ] `models/agora_campaign.py`, `models/campaign_call.py`, and the v1 questionnaire-related models/schemas are legacy code candidates for cleanup
- [ ] `seed.py` needs to be migrated to the v2 models to remain usable

---

## License

MIT
