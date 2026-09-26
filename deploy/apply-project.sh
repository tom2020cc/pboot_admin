#!/usr/bin/env bash
# Apply uploaded management code only. Never copy environment files or databases.
set -Eeuo pipefail
trap 'echo "PBOOT_BUILD_FAILED line=$LINENO exit=$?"' ERR
cd "$(dirname "$(readlink -f "$0")")/.."
if ! grep -Eq '^APP_ENVIRONMENT=["\x27]?baota["\x27]?\s*$' backend/.env; then
  echo 'PBOOT_BUILD_FAILED: backend/.env must keep APP_ENVIRONMENT=baota'
  exit 1
fi
if ! command -v pnpm >/dev/null; then
  for node_bin in /www/server/nvm/versions/node/*/bin /www/server/nodejs/*/bin; do
    if [ -x "$node_bin/pnpm" ]; then export PATH="$node_bin:$PATH"; fi
  done
fi
command -v node pnpm pm2
deploy_user_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
test -n "$deploy_user_home"
pm2_cmd() { env HOME="$deploy_user_home" PM2_HOME="${PM2_HOME:-$deploy_user_home/.pm2}" pm2 "$@"; }
echo 'PBOOT_BUILD_STARTED'
for module in backend frontend tools/seo_publish_tool tools/ftp_publish_tool; do
  if [ -f "$module/pnpm-lock.yaml" ]; then
    pnpm --dir "$module" install --frozen-lockfile
  fi
done
echo 'PBOOT_BUILD_BACKEND'
pnpm --dir backend run build
echo 'PBOOT_BUILD_FRONTEND'
pnpm --dir frontend run build
test -s backend/dist/main.js
test -s frontend/dist/index.html
echo 'PBOOT_BUILD_RESTART'
required_apps=(pboot-admin-api)
pm2_cmd restart pboot-admin-api
for app in pboot-seo-tool pboot-seo-content-worker pboot-ftp-tool; do
  if pm2_cmd describe "$app" >/dev/null 2>&1; then
    required_apps+=("$app")
    pm2_cmd restart "$app"
  fi
done
echo 'PBOOT_BUILD_VERIFY'
healthy=0
for attempt in {1..30}; do
  if pm2_cmd jlist | node deploy/check-running-services.cjs "${required_apps[@]}"; then
    healthy=$((healthy + 1))
    if [ "$healthy" -ge 2 ]; then break; fi
  else
    healthy=0
  fi
  sleep 2
done
test "$healthy" -ge 2
echo 'PBOOT_BUILD_DONE'
