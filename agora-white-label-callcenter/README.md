# Smart Campaign Manager

基于 **声网 Agora Conversational AI / SIP 外呼 API** 的全球化 AI 智能外呼活动管理平台。系统可创建 AI 语音坐席（Agent）、绑定电话号码、面向全球任意地区/语言批量发起外呼活动（Campaign），并对通话记录、转录文本、结构化提取结果进行实时统计与配额（Quota）核验。平台本身不绑定任何特定国家或语种，坐席语言、话术、配额维度均由使用方按具体调查项目自行配置。

> 说明：仓库中历史遗留的 `services/parsers/`（除 docx）、`schemas/survey.py`、`schemas/quota.py`、`schemas/callback.py`、`app/models/survey.py`、`app/models/quota.py` 等 v1 组件已不再被 `main.py` 引用，属于旧版"Voice Agent Stub"架构的遗留代码，本文档只描述当前实际生效的 v2 架构。

---

## 功能概览

| 模块 | 描述 |
|------|------|
| **AI 语音坐席（Agent）** | 创建/编辑 Agora Conversational AI Agent（ASR + LLM + TTS + 打断/静音检测配置），支持问卷上传后由 Claude 自动生成任意语言的访谈 Prompt |
| **电话号码 / SIP 中继** | 管理外呼所用的号码资源（SIP Gateway），与 Agora 号码资源同步，支持多国号码 |
| **外呼活动（Campaign）** | 创建/同步/中断外呼活动，绑定 Agent + 号码 + 拨打名单，配置挂断规则、录音与结构化输出 Schema |
| **通话记录同步** | 增量拉取 Agora 通话记录（水位线机制），持久化转录文本、录音地址、结构化提取结果 |
| **配额（Quota）管理** | 按调查方自定义维度（如地区/性别/年龄等，维度与取值均可自由配置）设定名额，AI 从通话转录中提取变量并自动匹配、计数，满额后自动通知坐席关闭该配额分支 |
| **数据看板** | 每日拨打量、接通率、通话时长、通话分类分布等统计 |
| **来电路由** | 管理号码与 Agent 的呼入绑定关系 |
| **实时体验测试** | 通过浏览器 RTC 直接与 Agent 语音对话，测试效果，无需真实外呼 |
| **CSV 导入 / 录音迁移** | 导入历史通话 CSV 数据；批量把录音从临时链接迁移到自有 S3 存储 |
| **多语言界面** | 界面本地化支持英语 / 中文 / 日语 / 韩语（i18next），可按需扩展其他语言；坐席通话语言与界面语言相互独立，由 Prompt/TTS/ASR 配置决定 |

---

## 技术栈

### 前端 (`frontend/`)

| 技术 | 版本 |
|------|------|
| React | 19 |
| Vite | 8 |
| TypeScript | 5.9 |
| React Router | 7 |
| TanStack Query | 5 |
| Tailwind CSS | 3 |
| Recharts | 2 |
| agora-rtc-sdk-ng / agora-rtm-sdk | 4 / 2 |
| i18next | 26 |

### 后端 (`backend/`)

| 技术 | 版本 |
|------|------|
| FastAPI | 0.115 |
| SQLAlchemy (async) | 2.0 |
| asyncpg（生产）/ aiosqlite（本地） | 0.30 / 0.20 |
| Alembic | 1.13 |
| Pydantic Settings | 2.5 |
| Anthropic SDK（Claude，Prompt/配额生成） | 0.34 |
| OpenAI SDK（Agent LLM、转录配额判定） | ≥1.50 |
| httpx | 0.27 |
| boto3（S3 录音迁移） | ≥1.35 |
| pdfplumber / python-docx / openpyxl | 问卷解析 |

### 外部服务依赖

- **Agora Conversational AI / SIP 外呼 REST API**（`agora_conversational_base_url`，默认 `https://api.agora.io/conversational-ai/v2`）— 承载 Agent、Campaign、通话、号码、来电绑定等核心业务，本项目数据库中的大部分表都是该 API 返回结果的本地缓存/镜像。支持全球多地区号码与外呼线路。
- **Anthropic Claude**（`claude-sonnet-4-6`）— 问卷解析生成访谈 Prompt（支持任意语言问卷）、AI 配额推荐。
- **OpenAI**（默认 `gpt-4o-mini`，Agent 对话 LLM 默认 `gpt-5.4-nano`）— Agent 对话生成、通话转录的配额维度提取。
- **AWS S3**（可选）— 录音文件永久存储。

---

## 目录结构

```
agora-white-label-callcenter/
├── frontend/
│   └── src/
│       ├── types/index.ts              # 全局 TypeScript 类型
│       ├── pages/
│       │   ├── auth/                   # 登录
│       │   ├── campaigns/              # 活动列表/详情/坐席Prompt/配额洞察
│       │   ├── agents/                 # AI 坐席管理
│       │   ├── phone-numbers/          # 号码/SIP中继管理
│       │   ├── inbound-routing/        # 来电路由绑定
│       │   ├── call-history/           # 通话记录
│       │   ├── quotas/、surveys/       # 旧版问卷式配额编辑向导（部分页面仍在使用）
│       │   ├── dashboard/              # 数据看板（AnalyticsDashboard 为当前主看板）
│       │   ├── import/                 # CSV 导入 / 录音迁移
│       │   └── settings/               # 系统设置
│       ├── components/
│       │   ├── Layout.tsx              # 侧边栏导航
│       │   └── ui/                     # Badge, ProgressBar
│       ├── i18n/locales/               # en / zh / ja / ko（界面本地化，可扩展）
│       └── lib/                        # utils、auth（登录态）
├── backend/
│   └── app/
│       ├── main.py                     # FastAPI 入口 + CORS + lifespan（建表 + 启动后台轮询任务）
│       ├── core/
│       │   ├── config.py               # Pydantic Settings（.env）
│       │   └── database.py             # 异步 SQLAlchemy engine + init_db（建表与增量DDL）
│       ├── models/                     # ORM 模型（详见下方"数据库结构"）
│       ├── api/
│       │   ├── agents.py               # AI 坐席 CRUD，代理 Agora Agent API
│       │   ├── agora_campaigns.py      # 问卷解析 + AI Prompt生成 + AI配额推荐（无状态）
│       │   ├── campaigns_v2.py         # 外呼活动 CRUD，代理 Agora Campaign API
│       │   ├── calls_v2.py             # 通话记录同步与查询，代理 Agora Calls API
│       │   ├── quota_v2.py             # 配额单元管理 + 转录配额评估触发
│       │   ├── phone_numbers.py        # 号码/SIP中继 CRUD，代理 Agora 号码 API
│       │   ├── inbound_routing.py      # 来电路由（号码-坐席绑定）
│       │   ├── dashboard.py            # 统计看板数据
│       │   ├── live_test.py            # 浏览器 RTC 实时体验测试
│       │   ├── import_csv.py           # CSV 批量导入 + S3 录音迁移
│       │   ├── settings_api.py         # .env 编辑（遗留，部分字段已不生效）
│       │   └── websocket.py            # WS /ws/campaigns/{id}（当前未被实际广播使用，遗留通道）
│       └── services/
│           ├── voice_prompt_generator.py       # Claude 流式生成访谈 Prompt + 提取变量Schema
│           ├── calls_structured_output_poll.py # 后台轮询：补全通话转录/结构化输出
│           ├── quota_transcript_eval.py        # LLM 从转录中提取配额维度并匹配计数
│           ├── quota_transcript_eval_poll.py   # 后台轮询：批量触发配额转录评估
│           ├── quota_agent_notifier.py         # 配额满额后自动更新坐席 Prompt 并通知 Agora
│           ├── ws_hub.py                       # WebSocket 广播 Hub（当前无调用方）
│           └── parsers/docx_parser.py          # DOCX 问卷文本提取
├── scripts/
│   ├── run_db_migration.py             # 追加字段的手动迁移脚本（幂等）
│   └── migrate_audio_s3.py             # 批量把录音从临时链接迁移到 S3
├── seed.py                             # 旧版（v1）测试数据脚本，与当前 v2 模型不兼容，仅供参考
└── Dockerfile                          # 前后端一体镜像（Vite build + FastAPI + nginx）
```

上一级仓库根目录另有 `docker-compose.yml`（Postgres + 本应用容器）与 `quick-deploy.sh`（一键构建部署脚本），用于生产部署，见下方"部署"章节。

---

## 数据库结构

数据库通过 SQLAlchemy 异步 ORM 定义，开发环境默认 SQLite（`dev.db`），生产环境使用 PostgreSQL（`asyncpg`）。`init_db()` 会在启动时自动建表，并对新增字段执行幂等的 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`（因此新增字段无需单独跑迁移工具，但仍保留 `scripts/run_db_migration.py` 作为手动兜底）。

> 注：以下 v2 系列表大多是 Agora 云端资源（Agent / Campaign / 号码 / 通话）在本地的**镜像缓存**——真正的业务状态和执行都在 Agora 侧，本地表主要用于快速查询、离线展示和补充本地专属字段（如配额、导入标记等）。

### `agent_v2` — AI 语音坐席

对应 Agora Conversational AI 的 Agent 资源。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 自增主键 |
| `agent_id` | VARCHAR(64) UNIQUE | Agora 返回的坐席 ID |
| `agent_name` | VARCHAR(255) | 坐席名称 |
| `app_id` | VARCHAR(64) | Agora App ID |
| `system_content` | TEXT | LLM 系统提示词（访谈 Prompt，任意语言） |
| `greeting_message` | TEXT | 开场白 |
| `failure_message` | TEXT | 异常/失败话术 |
| `voice_id` | VARCHAR(128) | TTS 音色 ID |
| `properties` | TEXT (JSON) | 完整 ASR/LLM/TTS/VAD 配置（含敏感 key，会被脱敏展示为 `****`） |
| `created_at` / `updated_at` | VARCHAR(64) | 时间戳 |

### `campaigns_v2` — 外呼活动

对应 Agora 的 Campaign（外呼任务）资源，是活动的核心表。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 自增主键 |
| `campaign_id` | VARCHAR(64) UNIQUE | Agora 返回的活动 ID |
| `campaign_name` | VARCHAR(255) | 活动名称 |
| `questionnaire_type` | VARCHAR(32) | 本地元数据：`create_agent_by_ai` / `existing_agent`（新）或 `file_upload` / `url_load`（旧，兼容） |
| `quota_mode` | VARCHAR(32) | 本地元数据：`manual` / `ai_auto`（新）或 `hybrid` / `ai`（旧） |
| `total_numbers` | INTEGER | 拨打名单总数 |
| `phone_number_id` / `phone_number` | VARCHAR(64) | 绑定的外呼号码（同步自 Agora） |
| `agent_id` / `agent_name` | VARCHAR(64/255) | 绑定的坐席（同步自 Agora） |
| `start_immediately` | BOOLEAN | 是否立即开始 |
| `max_call_duration_seconds` | INTEGER | 单通最大时长 |
| `silence_timeout_seconds` | INTEGER | 静音超时秒数 |
| `end_call_on_silence_timeout` | BOOLEAN | 静音是否自动挂断 |
| `ring_timeout_seconds` | INTEGER | 振铃超时秒数 |
| `end_call_on_user_request` / `end_call_on_ai_assistant` | BOOLEAN | 挂断触发条件 |
| `structured_output` | TEXT (JSON) | 结构化输出 Schema（供 Agora 从通话中抽取变量） |
| `enable_transcript` / `enable_recording` | BOOLEAN | 是否启用转录 / 录音 |
| `status` | VARCHAR(32) | 活动状态（同步自 Agora，如 `running` / `interrupted` / `completed`） |
| `created_at` / `updated_at` | VARCHAR(64) | 时间戳 |
| `is_imported` | BOOLEAN | 是否为 CSV 历史导入数据 |
| `imported_at` | TEXT | 导入时间 |

关联：一个 Campaign 对应多条 `calls_v2` 记录（通过 `campaign_id`）、多条 `quota_v2` 配额单元、一条 `calls_v2_sync_state` 同步水位。

### `calls_v2` — 通话记录

对应 Agora 每一通电话的详情，从 Agora Calls API 增量同步而来。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 自增主键 |
| `campaign_id` | VARCHAR(64) 索引 | 所属活动（逻辑外键 → `campaigns_v2.campaign_id`） |
| `call_id` | VARCHAR(64) UNIQUE | Agora 通话 ID |
| `sip_call_id` | VARCHAR(128) | SIP 通话 ID |
| `agent_id` / `agent_session_id` / `agent_name` | VARCHAR | 参与坐席信息 |
| `from_number` / `to_number` | VARCHAR(64) | 主被叫号码 |
| `call_category` | VARCHAR(64) | 通话分类（`answered` / `voicemail` / `no_answer` / `failed` 等） |
| `hangup_reason` | VARCHAR(128) | 挂断原因 |
| `duration_seconds` | INTEGER | 通话时长 |
| `answered_ts` / `call_ts` / `start_ts` / `end_ts` | BIGINT | 各阶段时间戳（毫秒/秒，取决于 Agora 返回） |
| `channel_name` | VARCHAR(255) | RTC 频道名 |
| `transcript` | TEXT (JSON) | 通话转录（对话逐句记录） |
| `record_file_url` | TEXT | 录音地址（`http(s)://...` 或迁移后的 `s3://...`） |
| `structured_output` | TEXT (JSON) | Agora 结构化提取结果 |
| `structured_output_status` | VARCHAR(64) | 提取状态（`completed` / `failed` / `disabled` 等，非终态时会被后台轮询持续补全） |
| `quota_checked` | BOOLEAN | 是否已跑过配额转录评估（每通最多处理一次） |
| `quota_check_detail` | TEXT (JSON) | 配额评估详情（状态、使用模型、命中项、错误信息） |
| `is_imported` | BOOLEAN | 是否为 CSV 历史导入数据 |
| `original_record_url` | TEXT | 迁移到 S3 前的原始录音地址（保留追溯） |

### `calls_v2_sync_state` — 通话同步水位线

每个活动一条记录，记录增量同步 Agora 通话列表所用的时间戳水位，避免每次全量拉取。

| 字段 | 类型 | 说明 |
|------|------|------|
| `campaign_id` | VARCHAR(64) PK | 所属活动（逻辑外键 → `campaigns_v2.campaign_id`） |
| `last_call_ts` | BIGINT | 已同步到的最新通话时间戳 |
| `updated_at` | DATETIME | 最后更新时间 |

### `quota_v2` — 配额单元

调查/外呼配额的抽样名额，一行代表一个"维度组合"格子（维度与取值完全由调查方自定义，如地区/性别/年龄，也可以是行业、客户等级等任意业务维度），绑定到某个 Campaign。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 自增主键 |
| `campaign_id` | VARCHAR(128) 索引 | 所属活动（逻辑外键 → `campaigns_v2.campaign_id`） |
| `label` | VARCHAR(512) | 人类可读的维度组合描述，如 `Region=North America, Gender=Female, Age=30-39` |
| `filters` | TEXT (JSON) | 维度过滤条件，如 `{"Region":"North America","Gender":"Female","Age":"30-39"}`，全部匹配才算命中该格 |
| `target` | INTEGER | 目标名额数 |
| `completed` | INTEGER | 当前已完成数（每次转录评估命中后 +1） |
| `hit_evidence` | TEXT (JSON) | 命中记录列表：`[{call_id, at, confidence, evidence, variables}, ...]` |
| `created_at` | DATETIME | 创建时间 |

### `phone_numbers_v2` — 号码 / SIP 中继

对应 Agora 的号码资源，支持全球各地区号码接入。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 自增主键 |
| `number_id` | VARCHAR(64) UNIQUE | Agora 号码资源 ID |
| `name` | VARCHAR(255) | 号码名称 |
| `phone_number` | VARCHAR(64) | 实际号码（含国家/地区码） |
| `type` | VARCHAR(32) | 号码类型 |
| `sip_gateway_host` | VARCHAR(255) | SIP 网关地址 |
| `sip_signaling_port` | INTEGER | SIP 信令端口 |
| `outbound_protocol` | VARCHAR(32) | 外呼协议 |
| `created_at` / `updated_at` | VARCHAR(64) | 时间戳 |

关联：`campaigns_v2.phone_number_id` 引用本表；来电路由（agent-号码绑定关系）本身**不落库**，实时查询 Agora API。

### 遗留表（不建议新功能依赖，仅为兼容旧数据保留）

| 表 | 模型文件 | 说明 |
|------|------|------|
| `agora_campaigns` | `models/agora_campaign.py` | 旧版活动模型（字段与 `campaigns_v2` 高度重叠），仅在 `models/__init__.py` 中被导入，未见任何路由使用 |
| `campaign_calls` | `models/campaign_call.py` | 旧版通话记录模型，字段与 `calls_v2` 类似，未见任何路由使用 |
| （v1）`survey` / `quota_cell` | `models/survey.py`（如仍存在）、`schemas/survey.py`、`schemas/quota.py` | 旧版"问卷式调查"模型，已被 `campaigns_v2` + `quota_v2` 取代，`seed.py` 仍引用它，运行前需注意与当前 schema 不兼容 |

---

## 快速开始（本地开发）

### 前置依赖

- Python 3.11+
- Node.js 20+
- （可选）PostgreSQL 16，本地开发默认用内置 SQLite 即可

### 1. 克隆仓库

```bash
git clone <repo-url>
cd agora-white-label-callcenter
```

### 2. 后端

```bash
cd backend
cp .env.example .env        # 按下方"环境变量"章节填写
pip install -r requirements.txt
uvicorn app.main:app --reload
# 后端运行于 http://localhost:8000，首次启动会自动建表（dev.db）
```

### 3. 前端

```bash
cd frontend
npm install
npm run dev
# 前端运行于 http://localhost:5173，通过 VITE_API_URL 指向后端（frontend/.env）
```

浏览器访问 `http://localhost:5173`，首次会跳转到登录页（`isAuthenticated()` 判断本地登录态）。

---

## 环境变量（`backend/.env`）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./dev.db` | 数据库连接（生产建议 `postgresql+asyncpg://...`） |
| `OPENROUTER_API_KEY` | — | **推荐**：OpenRouter API Key，同时用于 Claude（Anthropic Messages）与 GPT（OpenAI 兼容协议） |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI 兼容协议基地址 |
| `OPENROUTER_ANTHROPIC_BASE_URL` | `https://openrouter.ai/api` | Anthropic SDK / Messages 基地址 |
| `ANTHROPIC_MODEL` | `anthropic/claude-sonnet-4.6` | Prompt 生成 / 配额推荐所用模型 |
| `AGENT_LLM_MODEL` | `openai/gpt-4o-mini` | Agora Voice Agent 对话 LLM 模型 |
| `ANTHROPIC_API_KEY` | — | 未配 OpenRouter 时的 Anthropic 官方密钥（兼容回退） |
| `AGORA_CONVERSATIONAL_API_KEY` | — | 调用 Agora Conversational AI / SIP 外呼 REST API 的鉴权凭证（必填） |
| `AGORA_PROJECT_ID` | — | Agora 项目 ID（必填） |
| `AGORA_APP_CERTIFICATE` | — | Agora App 证书（用于生成 RTC/RTM Token 等） |
| `AGORA_CONVERSATIONAL_BASE_URL` | `https://api.agora.io/conversational-ai/v2` | Agora Conversational AI API 基地址 |
| `OPENAI_API_KEY` | — | 未配 OpenRouter 时的 OpenAI 官方密钥（兼容回退） |
| `QUOTA_TRANSCRIPT_MODEL` | `openai/gpt-4o-mini` | 转录配额提取所用模型 |
| `QUOTA_TRANSCRIPT_MIN_CONFIDENCE` | `0.5` | 判定命中所需的最低置信度（0-1） |
| `POLL_INTERVAL_SECONDS` | `5` | 遗留字段（v1 轮询间隔，当前代码未使用） |
| `MAX_CONCURRENT_CALLS` | `10` | 遗留字段（v1 并发外呼上限，当前代码未使用） |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | 录音迁移到 S3 所需的 AWS 凭证（可选功能） |
| `AWS_S3_BUCKET` / `AWS_S3_REGION` / `AWS_S3_PREFIX` | — | 目标 S3 桶配置 |

`frontend/.env`：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_API_URL` | `http://localhost:8000` | 后端 API 地址 |

---

## 主要数据流

```
创建坐席 Agent → 调用 Claude 解析问卷/生成 Prompt（支持任意语言问卷） → 保存到 agent_v2（system_content/greeting）
                → 调用 Agora Agent API 创建远端坐席

创建外呼活动 → 绑定 agent_id + phone_number_id + 拨打名单 + 结构化输出 Schema
             → 调用 Agora Campaign API → 写入 campaigns_v2

活动运行中 → 前端定时轮询 /api/calls-v2/{id}/sync
           → 增量拉取 Agora 通话列表（依据 calls_v2_sync_state 水位）
           → 写入/更新 calls_v2，补全转录、录音、结构化输出

后台轮询任务：
  calls_structured_output_poll   → 定期补全未完成的 transcript / structured_output
  quota_transcript_eval_poll     → 定期对未评估的通话跑 LLM 配额提取
                                  → 命中维度组合 → quota_v2.completed +1，写入 hit_evidence
                                  → 满额 → quota_agent_notifier 自动更新坐席 Prompt 并同步到 Agora

数据看板 → /api/dashboard/stats 从 calls_v2 聚合每日拨打量/接通率/时长/分类分布
```

---

## 部署（生产）

仓库根目录（`agora-white-label-callcenter` 的上一级）提供了一体化容器部署方案：

- **`docker-compose.yml`**：编排 `agora-callcenter-postgres`（PostgreSQL 16）+ `agora-callcenter-app`（本项目镜像），仅在内部 Docker 网络 `whip-network` 中互通，**不直接暴露端口到宿主机**，需配合外层网关（如 nginx/Traefik）转发。
- **`Dockerfile`**：多阶段构建 —— 第一阶段用 Node 20 构建前端静态资源（支持 `APP_VITE_BASE_PATH` 自定义部署子路径）；第二阶段基于 `python:3.11-slim` 安装后端依赖并用内置 nginx 在容器内 `:8080` 端口同时服务前端静态文件与反向代理 `/api/` `/ws` 到本地 `uvicorn :8000`。
- **`quick-deploy.sh`**：一键构建部署脚本。

```bash
# 首次部署前，准备根目录 .env（AGORA_*、OPENROUTER_API_KEY 等）
cp agora-white-label-callcenter/backend/.env.example .env
vim .env

# 部署到默认路径 /callcenter/
./quick-deploy.sh

# 或自定义部署子路径
APP_PREFIX=/my-callcenter/ ./quick-deploy.sh
```

部署后需通过外层网关按同样的路径前缀反代到容器内 `:8080`，例如：
- 前端页面：`https://<域名>/callcenter/`
- 接口：`https://<域名>/callcenter/api/...`

生产环境数据库自动切换为 `postgresql+asyncpg://campaign:campaign123@agora-callcenter-postgres:5432/campaign_db`（见 `docker-compose.yml`，建议部署前修改默认密码）。

---

## 其他脚本

```bash
# 补充新增字段（一般 init_db 已自动处理，仅作手动兜底）
cd backend && python scripts/run_db_migration.py

# 把通话录音从临时链接批量迁移到自有 S3（先 dry-run 确认）
cd backend && python scripts/migrate_audio_s3.py --dry-run
cd backend && python scripts/migrate_audio_s3.py

# 前端类型检查 / 构建
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

> `seed.py` 为旧版（v1）测试数据脚本，引用的 `models/survey.py`、`models/quota.py` 与当前 v2 架构不兼容，不建议直接运行。

---

## 已知问题 / 待办

- [ ] `api/websocket.py` 与 `services/ws_hub.py` 构成的 WebSocket 实时推送通道当前未被任何业务代码调用（前端改为轮询 REST 接口），属于遗留基础设施
- [ ] `api/settings_api.py` 中部分环境变量键（`VOICE_AGENT_*`、`AGORA_PIPELINE_ID` 等）已不被 v2 代码路径使用
- [ ] `models/agora_campaign.py`、`models/campaign_call.py` 与 v1 问卷相关模型/схема 属于遗留代码，可评估是否清理
- [ ] `seed.py` 需要迁移到 v2 模型才能继续使用

---

## License

MIT
