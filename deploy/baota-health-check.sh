#!/usr/bin/env bash
set -u

PROJECT_ROOT="/www/wwwroot/pboot_admin_center"

echo "== Runtime =="
node --version
pnpm --version

echo "== Required files =="
for target in \
  "$PROJECT_ROOT/backend/dist/main.js" \
  "$PROJECT_ROOT/backend/.env" \
  "$PROJECT_ROOT/frontend/dist/index.html" \
  "$PROJECT_ROOT/tools/seo_publish_tool/server.js" \
  "$PROJECT_ROOT/tools/ftp_publish_tool/server.js"; do
  if [ -f "$target" ]; then
    echo "OK   $target"
  else
    echo "MISS $target"
  fi
done

echo "== Local services =="
for endpoint in \
  "http://127.0.0.1:5108/project-identity" \
  "http://127.0.0.1:5388/" \
  "http://127.0.0.1:5389/"; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$endpoint" || true)"
  echo "$code $endpoint"
done

echo "== PM2 =="
pm2 status || true
