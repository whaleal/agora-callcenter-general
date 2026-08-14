#!/usr/bin/env bash
#
# 在本机（含 Apple Silicon Mac）交叉构建 linux/amd64 镜像并打包为 tar。
#
# 用法:
#   ./scripts/build-release.sh
#   APP_PREFIX=/callcenter/ VERSION=20260727 ./scripts/build-release.sh
#
# 产物目录: dist/release/<VERSION>/
#   - agora-callcenter-app-<VERSION>.tar.gz
#   - postgres-16-alpine.tar.gz   (可用 SKIP_POSTGRES=1 跳过)
#   - docker-compose.yml
#   - .env.example
#   - manifest.txt
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLATFORM="${PLATFORM:-linux/amd64}"
APP_PREFIX="${APP_PREFIX:-/callcenter/}"
VERSION="${VERSION:-$(date +%Y%m%d%H%M%S)}"
APP_IMAGE="${APP_IMAGE:-agora-callcenter-app:${VERSION}}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
SKIP_POSTGRES="${SKIP_POSTGRES:-0}"
OUT_DIR="${ROOT_DIR}/dist/release/${VERSION}"

if [[ "$APP_PREFIX" != /* ]]; then
  echo "错误: APP_PREFIX 必须以 / 开头，例如 /callcenter/"
  exit 1
fi
if [[ "$APP_PREFIX" != */ ]]; then
  APP_PREFIX="${APP_PREFIX}/"
fi

mkdir -p "$OUT_DIR"

echo "==> Root:      ${ROOT_DIR}"
echo "==> Platform:  ${PLATFORM}"
echo "==> App image: ${APP_IMAGE}"
echo "==> Prefix:    ${APP_PREFIX}"
echo "==> Out dir:   ${OUT_DIR}"

echo "==> Build app image (cross-platform ${PLATFORM})"
docker build \
  --platform "$PLATFORM" \
  --build-arg "APP_VITE_BASE_PATH=${APP_PREFIX}" \
  -t "$APP_IMAGE" \
  -f "${ROOT_DIR}/agora-white-label-callcenter/Dockerfile" \
  "${ROOT_DIR}/agora-white-label-callcenter"

APP_TAR="${OUT_DIR}/agora-callcenter-app-${VERSION}.tar"
echo "==> Save app image -> ${APP_TAR}.gz"
docker save "$APP_IMAGE" -o "$APP_TAR"
gzip -f "$APP_TAR"

if [[ "$SKIP_POSTGRES" != "1" ]]; then
  echo "==> Pull & save postgres (${PLATFORM})"
  docker pull --platform "$PLATFORM" "$POSTGRES_IMAGE"
  PG_TAR="${OUT_DIR}/postgres-16-alpine.tar"
  docker save "$POSTGRES_IMAGE" -o "$PG_TAR"
  gzip -f "$PG_TAR"
else
  echo "==> Skip postgres image packaging (SKIP_POSTGRES=1)"
fi

cp "${ROOT_DIR}/deploy/docker-compose.yml" "${OUT_DIR}/docker-compose.yml"
cp "${ROOT_DIR}/agora-white-label-callcenter/backend/.env.example" "${OUT_DIR}/.env.example"

cat > "${OUT_DIR}/manifest.txt" <<EOF
version=${VERSION}
platform=${PLATFORM}
app_image=${APP_IMAGE}
postgres_image=${POSTGRES_IMAGE}
app_prefix=${APP_PREFIX}
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
host=$(uname -s)/$(uname -m)
EOF

# Also write a small env file for compose image overrides
cat > "${OUT_DIR}/.env.compose" <<EOF
APP_IMAGE=${APP_IMAGE}
POSTGRES_IMAGE=${POSTGRES_IMAGE}
HOST_PORT=8080
EOF

echo "==> Done. Release package: ${OUT_DIR}"
ls -lh "$OUT_DIR"
