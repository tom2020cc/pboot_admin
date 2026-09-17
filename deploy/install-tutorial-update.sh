#!/usr/bin/env bash
set -euo pipefail
ROOT=/www/wwwroot/pboot_admin_center
STAGE=${1:?Pass the verified staging directory}
RELEASE_BACKUP=${2:-}
test "$(realpath "$ROOT")" = "$ROOT"
test "$(realpath "$STAGE")" = /www/backup/pboot-tutorial-stage-20260912
export PATH=/www/server/nvm/versions/node/v22.23.2/bin:$PATH
export PM2_HOME=/root/.pm2
node - "$ROOT" "$STAGE" <<'NODE'
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [root, stage] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'tutorial-update-manifest.json')));
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
for (const [name, expected] of Object.entries(manifest.expected)) {
  const current = fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
  if (hash(current) !== expected) throw new Error(`Changed on server, stop before overwrite: ${name}`);
}
for (const [name, expected] of Object.entries(manifest.files)) {
  if (path.isAbsolute(name) || name.split('/').includes('..')) throw new Error('Invalid update path');
  if (hash(fs.readFileSync(path.join(stage, name))) !== expected) throw new Error(`Invalid upload: ${name}`);
}
console.log('Source preconditions and upload checksums passed.');
NODE
BACKUP=""
if [ "$RELEASE_BACKUP" = --backup ]; then
  RELEASE_BACKUP=""
  BACKUP="/www/backup/pboot-tutorial-before-$(date +%Y%m%d-%H%M%S).tgz"
  tar -czf "$BACKUP" -C "$ROOT" frontend/src frontend/dist tools/public-navigation.js docs/BAOTA_MULTI_SITE_DEPLOY_ZH.md docs/deployment.md
elif [ -n "$RELEASE_BACKUP" ]; then
  [[ "$RELEASE_BACKUP" =~ ^/www/backup/pboot-pdf-release-[0-9]+$ ]]
  test "$(realpath "$RELEASE_BACKUP")" = "$RELEASE_BACKUP"
  test -f "$RELEASE_BACKUP/source-static.tgz"
  BACKUP="$RELEASE_BACKUP/tutorial-changed-source.tgz"
  test ! -e "$BACKUP"
  # One release keeps one backup directory; archive only files this tutorial changes.
  node - "$ROOT" "$STAGE" "$BACKUP" <<'NODE'
const fs = require('fs'), path = require('path'), {execFileSync} = require('child_process');
const [root, stage, backup] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'tutorial-update-manifest.json')));
const changed = Object.keys(manifest.files).filter(name => fs.existsSync(path.join(root, name)) && !fs.readFileSync(path.join(root, name)).equals(fs.readFileSync(path.join(stage, name))));
execFileSync('tar', ['-czf', backup, '-C', root, '--null', '-T', '-'], {input:changed.map(name=>name+'\0').join('')});
NODE
fi
if [ -n "$BACKUP" ]; then chmod 600 "$BACKUP"; fi
node - "$ROOT" "$STAGE" <<'NODE'
const fs = require('fs'), path = require('path');
const [root, stage] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'tutorial-update-manifest.json')));
for (const name of Object.keys(manifest.files)) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.copyFileSync(path.join(stage, name), path.join(root, name));
}
NODE
cd "$ROOT"
node --test deploy/tutorial-content.test.cjs tools/public-navigation.test.cjs deploy/fresh-install-ui.test.cjs
pnpm --dir frontend run type-check
test ! -e "$ROOT/frontend/dist-tutorial-next"
pnpm --dir frontend run build-only --outDir dist-tutorial-next
# Keep prior chunks available for already-open admin tabs during the release.
node <<'NODE'
const fs = require('fs'), path = require('path');
function preserveChunks(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) preserveChunks(from, to);
    else if (entry.isFile()) {
      try { fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    } else throw new Error(`Unexpected asset type: ${from}`);
  }
}
preserveChunks('frontend/dist/assets', 'frontend/dist-tutorial-next/assets');
NODE
find frontend/dist-tutorial-next -type d -exec chmod 755 {} +
find frontend/dist-tutorial-next -type f -exec chmod 644 {} +
PREVIOUS=""
if [ -n "$BACKUP" ]; then
  PREVIOUS="${RELEASE_BACKUP:+$RELEASE_BACKUP/frontend-before-tutorial}"
  PREVIOUS="${PREVIOUS:-$ROOT/frontend/dist-before-tutorial-$(date +%Y%m%d-%H%M%S)}"
  test ! -e "$PREVIOUS"
  mv "$ROOT/frontend/dist" "$PREVIOUS"
  if ! mv "$ROOT/frontend/dist-tutorial-next" "$ROOT/frontend/dist"; then
    mv "$PREVIOUS" "$ROOT/frontend/dist"
    exit 1
  fi
else
  node <<'NODE'
const fs = require('fs');
const next = '/www/wwwroot/pboot_admin_center/frontend/dist-tutorial-next';
const live = '/www/wwwroot/pboot_admin_center/frontend/dist';
fs.cpSync(next, live, {recursive:true, filter:source=>source !== next+'/index.html'});
fs.renameSync(next+'/index.html', live+'/index.html');
fs.rmSync(next, {recursive:true});
NODE
fi
if [ "$(node -p "require('$STAGE/tutorial-update-manifest.json').kind || 'full'")" != "content-only" ]; then
  pm2 restart pboot-seo-tool pboot-ftp-tool --update-env
  pm2 save
fi
printf '\nTUTORIAL_RELEASE_COMPLETE\nBackup: %s\nPrevious static files: %s\n' "${BACKUP:-disabled}" "${PREVIOUS:-not archived}"
