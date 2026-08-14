#!/usr/bin/env bash
#
# 将本机打包的 release 通过 scp 上传到远端，docker load 后用 compose 启动。
# 远端不执行 docker build。
#
# 用法:
#   ./scripts/deploy-remote.sh <VERSION>
#   REMOTE=mtt@35.187.239.40 SSH_KEY=~/.ssh/jianyu-server-ssh-key \
#     ENV_FILE=./.env ./scripts/deploy-remote.sh 20260727160000
#
# 环境变量:
#   REMOTE         默认 mtt@35.187.239.40
#   SSH_KEY        默认 ~/.ssh/jianyu-server-ssh-key
#   REMOTE_DIR     默认 ~/agora-callcenter
#   ENV_FILE       必填：要上传的 .env（含密钥）
#   SKIP_POSTGRES  若构建时跳过了 postgres 包，部署时远端会 docker pull
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "用法: $0 <VERSION>"
  echo "可用版本:"
  ls -1 "${ROOT_DIR}/dist/release" 2>/dev/null || echo "  (无，请先运行 ./scripts/build-release.sh)"
  exit 1
fi

PKG_DIR="${ROOT_DIR}/dist/release/${VERSION}"
if [[ ! -d "$PKG_DIR" ]]; then
  echo "错误: 未找到 ${PKG_DIR}"
  exit 1
fi

REMOTE="${REMOTE:-mtt@35.187.239.40}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/jianyu-server-ssh-key}"
REMOTE_DIR="${REMOTE_DIR:-/home/mtt/agora-callcenter}"
ENV_FILE="${ENV_FILE:-}"
SKIP_POSTGRES="${SKIP_POSTGRES:-0}"

if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "错误: 请设置 ENV_FILE 指向本地 .env（含 OPENROUTER/AGORA 等密钥）"
  echo "  例: ENV_FILE=./.env $0 ${VERSION}"
  exit 1
fi

SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no)
SCP=(scp -i "$SSH_KEY" -o StrictHostKeyChecking=no)

echo "==> Remote:  ${REMOTE}"
echo "==> Package: ${PKG_DIR}"
echo "==> Env:     ${ENV_FILE}"

echo "==> Ensure remote dir"
"${SSH[@]}" "$REMOTE" "mkdir -p ${REMOTE_DIR}/images"

echo "==> Upload release artifacts"
"${SCP[@]}" \
  "${PKG_DIR}/docker-compose.yml" \
  "${PKG_DIR}/.env.compose" \
  "${PKG_DIR}/manifest.txt" \
  "${PKG_DIR}/.env.example" \
  "${REMOTE}:${REMOTE_DIR}/"

"${SCP[@]}" "$ENV_FILE" "${REMOTE}:${REMOTE_DIR}/.env"

# Upload image tarballs
shopt -s nullglob
APP_TGZ=( "${PKG_DIR}"/agora-callcenter-app-*.tar.gz )
if [[ ${#APP_TGZ[@]} -eq 0 ]]; then
  echo "错误: 未找到 app 镜像包"
  exit 1
fi

echo "==> Upload app image: ${APP_TGZ[0]}"
"${SCP[@]}" "${APP_TGZ[0]}" "${REMOTE}:${REMOTE_DIR}/images/"

PG_TGZ="${PKG_DIR}/postgres-16-alpine.tar.gz"
if [[ -f "$PG_TGZ" ]]; then
  echo "==> Upload postgres image: ${PG_TGZ}"
  "${SCP[@]}" "$PG_TGZ" "${REMOTE}:${REMOTE_DIR}/images/"
else
  echo "==> No local postgres package (will pull on remote if needed)"
fi

echo "==> Remote: load images + compose up"
"${SSH[@]}" "$REMOTE" "bash -s" <<REMOTE_SCRIPT
set -euo pipefail
cd ${REMOTE_DIR}

# Merge compose image overrides into shell env for docker compose
set -a
# shellcheck disable=SC1091
source .env.compose
set +a

echo "==> docker load app (${VERSION})"
# 只加载本次版本，避免 images/ 下旧 tar 被 glob 误加载
gunzip -c "images/agora-callcenter-app-${VERSION}.tar.gz" | docker load

if ls images/postgres-16-alpine.tar.gz >/dev/null 2>&1; then
  echo "==> docker load postgres"
  gunzip -c images/postgres-16-alpine.tar.gz | docker load
else
  echo "==> pull postgres (no local package)"
  docker pull "\${POSTGRES_IMAGE:-postgres:16-alpine}"
fi

docker network create whip-network >/dev/null 2>&1 || true

echo "==> docker compose up"
docker compose --env-file .env.compose -f docker-compose.yml up -d --force-recreate --remove-orphans agora-callcenter-app
docker compose --env-file .env.compose -f docker-compose.yml up -d --remove-orphans

echo "==> status"
docker compose --env-file .env.compose -f docker-compose.yml ps
sleep 4
curl -s -o /dev/null -w "page: HTTP %{http_code}\\n" http://127.0.0.1:\${HOST_PORT:-8080}/callcenter/ || true
curl -s -o /dev/null -w "api:  HTTP %{http_code}\\n" http://127.0.0.1:\${HOST_PORT:-8080}/callcenter/api/settings || true
REMOTE_SCRIPT

echo "==> Deploy finished: http://${REMOTE#*@}:8080/callcenter/"
