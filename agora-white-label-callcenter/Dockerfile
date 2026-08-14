# ── Stage 1: Build Frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ .
ARG APP_VITE_BASE_PATH=/
RUN npx vite build --base="${APP_VITE_BASE_PATH}"

# ── Stage 2: Runtime (Python + nginx) ────────────────────────────────────────
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends nginx && rm -rf /var/lib/apt/lists/*

# Python backend
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .

# Frontend static files
COPY --from=frontend-build /build/frontend/dist /usr/share/nginx/html

# nginx: match APP_VITE_BASE_PATH — subpath deploy needs /prefix/api + alias for static assets
ARG APP_VITE_BASE_PATH=/
RUN /bin/sh -c '\
BASE="${APP_VITE_BASE_PATH:-/}"; \
BASE="${BASE%/}"; \
{ \
  echo "server {"; \
  echo "    listen 8080;"; \
  echo "    root /usr/share/nginx/html;"; \
  echo "    index index.html;"; \
  echo "    client_max_body_size 50M;"; \
  echo; \
  if [ "$BASE" = "" ] || [ "$BASE" = "/" ]; then \
    echo "    location /api/ {"; \
    echo "        proxy_pass http://127.0.0.1:8000/api/;"; \
    echo "        proxy_set_header Host \$host;"; \
    echo "        proxy_set_header X-Real-IP \$remote_addr;"; \
    echo "        proxy_http_version 1.1;"; \
    echo "        proxy_set_header Upgrade \$http_upgrade;"; \
    echo "        proxy_set_header Connection \"upgrade\";"; \
    echo "    }"; \
    echo; \
    echo "    location /ws {"; \
    echo "        proxy_pass http://127.0.0.1:8000/ws;"; \
    echo "        proxy_http_version 1.1;"; \
    echo "        proxy_set_header Upgrade \$http_upgrade;"; \
    echo "        proxy_set_header Connection \"upgrade\";"; \
    echo "        proxy_read_timeout 3600s;"; \
    echo "    }"; \
    echo; \
    echo "    location / {"; \
    echo "        try_files \$uri \$uri/ /index.html;"; \
    echo "    }"; \
  else \
    echo "    location ${BASE}/api/ {"; \
    echo "        proxy_pass http://127.0.0.1:8000/api/;"; \
    echo "        proxy_set_header Host \$host;"; \
    echo "        proxy_set_header X-Real-IP \$remote_addr;"; \
    echo "        proxy_http_version 1.1;"; \
    echo "        proxy_set_header Upgrade \$http_upgrade;"; \
    echo "        proxy_set_header Connection \"upgrade\";"; \
    echo "    }"; \
    echo; \
    echo "    location ${BASE}/ws {"; \
    echo "        proxy_pass http://127.0.0.1:8000/ws;"; \
    echo "        proxy_http_version 1.1;"; \
    echo "        proxy_set_header Upgrade \$http_upgrade;"; \
    echo "        proxy_set_header Connection \"upgrade\";"; \
    echo "        proxy_read_timeout 3600s;"; \
    echo "    }"; \
    echo; \
    echo "    location ${BASE}/ {"; \
    echo "        alias /usr/share/nginx/html/;"; \
    echo "        try_files \$uri \$uri/ ${BASE}/index.html;"; \
    echo "    }"; \
    echo; \
    echo "    location = ${BASE} {"; \
    echo "        return 301 ${BASE}/;"; \
    echo "    }"; \
  fi; \
  echo "}"; \
} > /etc/nginx/sites-enabled/default'

# Entrypoint: start uvicorn then nginx (foreground)
RUN printf '#!/bin/sh\nset -e\ncd /app/backend\nuvicorn app.main:app --host 127.0.0.1 --port 8000 &\nnginx -g "daemon off;"\n' \
    > /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 8080
CMD ["/entrypoint.sh"]
