#!/usr/bin/env bash
# Prepare a fresh checkout for the BaoTa PM2 manager. Does not start another daemon.
set -euo pipefail
umask 027
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
[[ "$ROOT" == /www/wwwroot/pboot_admin_center ]] || { echo 'Unexpected project path.'; exit 2; }
[[ $(id -u) == 0 ]] || { echo 'Run from the server administrator terminal.'; exit 2; }
[[ ! -e "$ROOT/data/pboot-admin.sqlite" ]] || { echo 'Database already exists; use the upgrade process.'; exit 2; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22 || (a===22 && b<12)) process.exit(2)'
command -v pm2 >/dev/null
if ! command -v pnpm >/dev/null; then npm install --global pnpm@9.15.9; fi
install -d "$ROOT/data" "$ROOT/backups" "$ROOT/managed-sites" "$ROOT/backend/uploads"
export PBOOT_INSTALL_ROOT="$ROOT"
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.env.PBOOT_INSTALL_ROOT;
const env = [
  'NODE_ENV=production', 'DB_TYPE=sqljs', `DB_SQLJS_LOCATION=${root}/data/pboot-admin.sqlite`,
  'BACKEND_PORT=5108', 'BACKEND_HOST=127.0.0.1', 'REQUEST_BODY_LIMIT=20mb',
  `JWT_SECRET=${crypto.randomBytes(48).toString('hex')}`, 'CORS_ORIGINS=', 'ENABLE_SWAGGER=false',
  `MANAGED_SITES_DIR=${root}/managed-sites`, `BACKEND_DB_BACKUP_DIR=${root}/backups/backend_database`,
  'RESOURCE_QUARANTINE_ROOT=/www/backup/pboot-resource-quarantine',
  'SEO_TOOL_PORT=5388', 'SEO_TOOL_HOST=127.0.0.1', 'FTP_TOOL_PORT=5389',
  `SEO_WORKER_TOKEN=${crypto.randomBytes(48).toString('hex')}`, 'SEO_WORKER_API_URL=http://127.0.0.1:5108',
  'OPENAI_API_KEY=', 'DEEPSEEK_API_KEY=', 'ZHIPU_API_KEY=', 'DASHSCOPE_API_KEY=', 'BRAVE_SEARCH_API_KEY=', '',
];
const files = [
  [path.join(root, 'backend/.env'), env.join('\n')],
  [path.join(root, 'frontend/.env.production.local'), 'VITE_API_BASE_URL=/api\n'],
];
for (const [file, data] of files) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, data, { mode: 0o600, flag: 'wx' });
}
NODE
for directory in backend frontend tools/seo_publish_tool tools/ftp_publish_tool; do
  pnpm --dir "$ROOT/$directory" install --frozen-lockfile --prod=false
done
pnpm --dir "$ROOT/backend" run build
pnpm --dir "$ROOT/frontend" run build
echo 'Build ready. Use the installed BaoTa PM2 manager to start deploy/baota.ecosystem.cjs.'
echo 'No separate PM2 runtime, systemd unit, public listener or business site was created.'
