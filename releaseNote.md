# Release Notes — Agora Call Center 镜像化部署

## 概述

本仓库采用 **本机构建镜像 + scp 上传 + 远端 docker compose 启动** 的发版方式：

| 步骤 | 执行位置 | 说明 |
|------|----------|------|
| 1. 交叉构建 | 本机（Mac arm64 / Linux） | `docker build --platform linux/amd64` |
| 2. 导出镜像 | 本机 | `docker save` → `.tar.gz` |
| 3. 上传 | 本机 → 远端 | `scp` 镜像包 + compose + `.env` |
| 4. 加载并启动 | 远端 Linux | `docker load` + `docker compose up`（**远端不 build**） |

默认访问路径：`/callcenter/`（可通过 `APP_PREFIX` 调整）。

---

## 目录结构

```
agora-callcenter-general/
├── deploy/
│   └── docker-compose.yml      # 生产 compose（仅引用镜像，不 build）
├── scripts/
│   ├── build-release.sh        # 本机构建并打包
│   └── deploy-remote.sh        # 上传并远端部署
├── dist/release/<VERSION>/     # 构建产物（gitignore 建议忽略）
├── agora-white-label-callcenter/
│   └── Dockerfile
└── releaseNote.md              # 本文档
```

---

## 前置条件

### 本机

- Docker Desktop（或 Docker Engine）已安装，并能构建 `linux/amd64`
- Apple Silicon 上首次交叉构建可能较慢（QEMU），属正常现象
- SSH 私钥可登录目标机

### 远端

- Linux x86_64
- 已安装 Docker Engine + Compose 插件
- 用户已加入 `docker` 组（或可用 sudo）
- 防火墙放行 `8080`（或你自定义的 `HOST_PORT`）

安装 Docker（RHEL/CentOS/Rocky 示例）：

```bash
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
# 重新登录后 docker 无需 sudo
```

---

## 快速发版（推荐）

### 1. 准备 `.env`

```bash
cp agora-white-label-callcenter/backend/.env.example .env
# 至少填写：
#   OPENROUTER_API_KEY=sk-or-v1-...
#   AGORA_CONVERSATIONAL_API_KEY=...   # Key:Secret 的 Base64
#   AGORA_PROJECT_ID=...
```

### 2. 本机构建

```bash
chmod +x scripts/build-release.sh scripts/deploy-remote.sh

# 默认 APP_PREFIX=/callcenter/，版本号为时间戳
./scripts/build-release.sh

# 或指定版本与路径前缀
APP_PREFIX=/callcenter/ VERSION=v1.0.0 ./scripts/build-release.sh

# 若远端可访问 Docker Hub，可跳过打包 postgres（减小上传体积）
SKIP_POSTGRES=1 VERSION=v1.0.0 ./scripts/build-release.sh
```

产物示例：

```
dist/release/v1.0.0/
  agora-callcenter-app-v1.0.0.tar.gz
  postgres-16-alpine.tar.gz          # SKIP_POSTGRES=1 时没有
  docker-compose.yml
  .env.compose                       # APP_IMAGE / HOST_PORT 等
  .env.example
  manifest.txt
```

### 3. 上传并部署到远端

```bash
ENV_FILE=./.env \
REMOTE=mtt@35.187.239.40 \
SSH_KEY=~/.ssh/jianyu-server-ssh-key \
REMOTE_DIR=/home/mtt/agora-callcenter \
  ./scripts/deploy-remote.sh v1.0.0
```

远端默认目录：`/home/mtt/agora-callcenter`。

### 4. 验证

```bash
# 本机
curl -I http://35.187.239.40:8080/callcenter/

# 远端
ssh -i ~/.ssh/jianyu-server-ssh-key mtt@35.187.239.40 \
  'docker ps; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/callcenter/api/settings'
```

浏览器打开：http://35.187.239.40:8080/callcenter/  
默认登录：`agora` / `agora`（前端硬编码，非数据库用户）

---

## 手动步骤（等同于脚本）

便于排查或在无脚本环境操作。

```bash
# --- 本机 ---
VERSION=v1.0.0
APP_IMAGE=agora-callcenter-app:${VERSION}

docker build --platform linux/amd64 \
  --build-arg APP_VITE_BASE_PATH=/callcenter/ \
  -t "$APP_IMAGE" \
  -f agora-white-label-callcenter/Dockerfile \
  agora-white-label-callcenter

mkdir -p "dist/release/${VERSION}/images"
docker save "$APP_IMAGE" | gzip > "dist/release/${VERSION}/agora-callcenter-app-${VERSION}.tar.gz"
docker pull --platform linux/amd64 postgres:16-alpine
docker save postgres:16-alpine | gzip > "dist/release/${VERSION}/postgres-16-alpine.tar.gz"

scp -i ~/.ssh/jianyu-server-ssh-key \
  dist/release/${VERSION}/*.tar.gz \
  deploy/docker-compose.yml \
  .env \
  mtt@35.187.239.40:/home/mtt/agora-callcenter/

# --- 远端 ---
ssh -i ~/.ssh/jianyu-server-ssh-key mtt@35.187.239.40
cd ~/agora-callcenter
gunzip -c agora-callcenter-app-*.tar.gz | docker load
gunzip -c postgres-16-alpine.tar.gz | docker load
docker network create whip-network || true
export APP_IMAGE=agora-callcenter-app:v1.0.0
export POSTGRES_IMAGE=postgres:16-alpine
export HOST_PORT=8080
docker compose -f docker-compose.yml up -d
```

---

## 配置说明

### `deploy/docker-compose.yml`

| 变量 | 默认 | 说明 |
|------|------|------|
| `APP_IMAGE` | `agora-callcenter-app:latest` | 应用镜像名:tag |
| `POSTGRES_IMAGE` | `postgres:16-alpine` | 数据库镜像 |
| `HOST_PORT` | `8080` | 宿主机映射端口 |

由 `.env.compose` 注入；业务密钥在 `.env`。

### 业务 `.env` 关键变量

| 变量 | 必须 | 说明 |
|------|------|------|
| `OPENROUTER_API_KEY` | 推荐 | LLM（Claude + GPT）经 OpenRouter |
| `AGORA_CONVERSATIONAL_API_KEY` | 是 | Agora REST Basic（Key:Secret 的 Base64） |
| `AGORA_PROJECT_ID` | 是 | Agora 项目 ID |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 否 | 未配 OpenRouter 时的官方直连回退 |

完整列表见 `agora-white-label-callcenter/backend/.env.example`。

---

## 常用运维

```bash
# 查看日志
ssh -i ~/.ssh/jianyu-server-ssh-key mtt@35.187.239.40 \
  'cd ~/agora-callcenter && docker compose --env-file .env.compose logs -f --tail=100'

# 重启
ssh -i ~/.ssh/jianyu-server-ssh-key mtt@35.187.239.40 \
  'cd ~/agora-callcenter && docker compose --env-file .env.compose restart'

# 停服
ssh -i ~/.ssh/jianyu-server-ssh-key mtt@35.187.239.40 \
  'cd ~/agora-callcenter && docker compose --env-file .env.compose down'

# 更新密钥后重启 app（不重建镜像）
scp -i ~/.ssh/jianyu-server-ssh-key .env mtt@35.187.239.40:~/agora-callcenter/.env
ssh -i ~/.ssh/jianyu-server-ssh-key mtt@35.187.239.40 \
  'cd ~/agora-callcenter && docker compose --env-file .env.compose up -d --force-recreate agora-callcenter-app'
```

---

## 架构注意点

1. **跨平台**：Mac arm64 必须 `--platform linux/amd64`，否则远端 x86_64 无法运行。
2. **路径前缀**：`APP_VITE_BASE_PATH` 在 **构建时** 写入前端与 nginx；改前缀需重新 `build-release`。
3. **网络**：compose 使用外部网络 `whip-network`（脚本会自动创建），便于与网关等同网互通。
4. **数据持久化**：Postgres 使用 named volume `agora-callcenter-pgdata`；`compose down` 默认不删 volume。
5. **旧方案**：根目录 `docker-compose.yml` + `quick-deploy.sh` 仍保留，用于在服务器本地 build；生产推荐本 release 流程。

---

## 本次目标环境

| 项 | 值 |
|----|-----|
| 主机 | `mtt@35.187.239.40` |
| SSH | `ssh -i ~/.ssh/jianyu-server-ssh-key mtt@35.187.239.40` |
| 部署目录 | `/home/mtt/agora-callcenter` |
| 访问 | http://35.187.239.40:8080/callcenter/ |

---

## 变更摘要（镜像化部署）

- 新增 `deploy/docker-compose.yml`：镜像驱动、映射 `8080`
- 新增 `scripts/build-release.sh`：本机 `linux/amd64` 构建与打包
- 新增 `scripts/deploy-remote.sh`：scp + 远端 `docker load` + compose up
- 远端 **不再执行** `docker compose build`

---

## 应用变更（App ID 数据隔离）— 不影响部署方案

| 项 | 说明 |
|----|------|
| 部署流程 | **无变化**：仍用 `build-release.sh` + `deploy-remote.sh` |
| Compose / 网络 / 端口 | **无变化** |
| DB | 启动时 `init_db` 自动 `ADD COLUMN app_id`（campaigns / phone_numbers）；**无需手工 SQL** |
| 配置 | 仍依赖已有 `AGORA_PROJECT_ID`；隔离按该值过滤 sync/list |
| 运维注意 | 发版后建议先打开 Agents 页 sync，再 sync Campaigns / Phone Numbers |

发版命令不变，例如：

```bash
SKIP_POSTGRES=1 VERSION=vYYYYMMDDHHMMSS ./scripts/build-release.sh
ENV_FILE=./.env REMOTE=mtt@35.187.239.40 \
  SSH_KEY=~/.ssh/jianyu-server-ssh-key \
  ./scripts/deploy-remote.sh vYYYYMMDDHHMMSS
```
