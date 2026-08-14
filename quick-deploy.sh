#!/usr/bin/env bash
#
# Agora Call Center - 主機一鍵構建並部署（前後端一體）
#
# 用法：
#   ./quick-deploy.sh
#   APP_PREFIX=/callcenter/ ./quick-deploy.sh
#
# 說明：
# - 默認把前端構建基路徑設置為 APP_PREFIX（默認 /），
#   需與前置網關 location 前綴保持一致。
# - FastAPI 僅容器內 127.0.0.1:8000；內層 nginx 監聽容器內 :8080，不映射到宿主機。
# - 僅 whip-network 內其它容器（如前置網關）可訪問 agora-callcenter-app:8080。
# - 構建：容器內 NODE_ENV=production + vite build --mode production。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
DEFAULT_PREFIX="/callcenter/"
APP_PREFIX="${APP_PREFIX:-$DEFAULT_PREFIX}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "錯誤: 未找到 ${COMPOSE_FILE}"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "錯誤: 未找到 ${ENV_FILE}"
  echo "請先執行:"
  echo "  cp agora-white-label-callcenter/backend/.env.example .env"
  echo "並填寫 OPENROUTER_API_KEY、AGORA_* 等變量後重試。"
  exit 1
fi

if [[ "$APP_PREFIX" != /* ]]; then
  echo "錯誤: APP_PREFIX 必須以 / 開頭，例如 /callcenter/"
  exit 1
fi
if [[ "$APP_PREFIX" != */ ]]; then
  APP_PREFIX="${APP_PREFIX}/"
fi

echo "==> Deploy dir: ${SCRIPT_DIR}"
echo "==> Frontend base path (APP_VITE_BASE_PATH): ${APP_PREFIX}"
echo "==> Ensure docker network whip-network exists"
docker network create whip-network >/dev/null 2>&1 || true

export APP_VITE_BASE_PATH="$APP_PREFIX"
export NODE_ENV=production

echo "==> Build image and start service (Vite --mode production)"
docker compose -f "$COMPOSE_FILE" build
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

echo "==> Done（未綁定宿主機端口；勿將 :8000/:8080 暴露到公網）"
echo "    公網訪問須走前置網關，與構建前綴一致，例如："
echo "    SPA:  https://<域名>${APP_PREFIX}"
echo "    API:  https://<域名>${APP_PREFIX%/}/api/...   （同頁請求即 ${APP_PREFIX%/}/api/... 相對當前 origin）"
