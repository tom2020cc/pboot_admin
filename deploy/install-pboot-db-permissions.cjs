const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = '/www/wwwroot/pboot_admin_center';
const stage = process.argv[2];
const sourceFiles = ['backend/src/product/product-fields.service.ts', 'backend/src/product/product-fields.service.spec.ts'];
const allowed = new Set([...sourceFiles, 'deploy/install-pboot-db-permissions.cjs']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });

async function main() {
  assert.equal(fs.realpathSync(root), root);
  assert.equal(fs.realpathSync(stage), '/www/backup/pboot-pdf-stage-db-permissions-20260914');
  assert.equal(process.getuid(), 0, 'Linux ownership regression must run as the production API user (root)');
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'brochure-update-manifest.json')));
  assert.deepEqual(Object.keys(manifest.files).sort(), [...allowed].sort());
  assert.deepEqual(Object.keys(manifest.expected).sort(), [...allowed].sort());
  for (const [file, expected] of Object.entries(manifest.files)) {
    assert.ok(allowed.has(file));
    assert.equal(hash(fs.readFileSync(path.join(stage, file))), expected, 'Package checksum: ' + file);
    const destination = path.join(root, file);
    if (manifest.expected[file] === null) assert.ok(!fs.existsSync(destination), 'New file already exists: ' + file);
    else assert.equal(hash(fs.readFileSync(destination, 'utf8').replace(/\r\n/g, '\n')), manifest.expected[file], 'Server source changed: ' + file);
  }
  const next = root + '/backend/dist-db-permissions-next';
  assert.ok(!fs.existsSync(next), 'Build directory already exists');
  for (const file of allowed) fs.copyFileSync(path.join(stage, file), path.join(root, file));
  run('pnpm', ['--dir', 'backend', 'exec', 'jest', '--runInBand', 'product-fields.service.spec.ts', 'product-folder-parameters.spec.ts']);
  run('pnpm', ['--dir', 'backend', 'exec', 'tsc', '-p', 'tsconfig.build.json', '--outDir', 'dist-db-permissions-next', '--incremental', 'false']);
  const compiled = ['product/product-fields.service.js', 'product/product-fields.service.js.map', 'product/product-fields.service.d.ts'];
  for (const file of compiled) assert.ok(fs.statSync(path.join(next, file)).isFile());
  for (const file of compiled) fs.copyFileSync(path.join(next, file), path.join(root, 'backend/dist', file));
  run('pm2', ['restart', 'pboot-admin-api']);
  assert.equal(fs.realpathSync(next), next);
  fs.rmSync(next, { recursive: true });

  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { ready = (await fetch('http://127.0.0.1:5108/sites', { signal: AbortSignal.timeout(2000) })).status === 401; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready, 'API not ready after restart');
  const credentials = JSON.parse(fs.readFileSync('/root/pboot-admin-initial-login.json', 'utf8'));
  const login = await fetch('https://admin.shanbo-rig.com/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials), signal: AbortSignal.timeout(15000),
  });
  assert.ok(login.ok, 'Central admin login failed');
  const loginData = await login.json();
  const token = loginData.access_token || loginData.data?.access_token;
  assert.equal(typeof token, 'string');
  const fields = await fetch('https://admin.shanbo-rig.com/api/product-fields', {
    headers: { Authorization: `Bearer ${token}`, 'X-Site-Id': '1' }, signal: AbortSignal.timeout(15000),
  });
  assert.equal(fields.status, 200, 'Read-only product fields smoke check failed');

  const database = '/www/wwwroot/shanbo-rig.com/data/1412def6361bfd54fd4f519f81ba2d22.db';
  assert.equal(fs.realpathSync(database), database);
  const phpCheck = '$p=$argv[1];clearstatcache(true,$p);if(!is_writable($p)||!is_writable(dirname($p))){fwrite(STDERR,"PHP database write access failed\\n");exit(1);}echo "PASS PHP database and directory write access (no database write performed)\\n";';
  run('runuser', ['-u', 'www', '--', '/www/server/php/82/bin/php', '-r', phpCheck, database]);
  assert.equal((await fetch('https://shanbo-rig.com/admin.php', { signal: AbortSignal.timeout(15000) })).status, 200);
  console.log('DB_PERMISSIONS_RELEASE_COMPLETE: POSIX ownership tests passed; API ready; PB login page reachable.');
  console.log('No database contents, accounts, PHP configuration or other websites modified. No code backup or GitHub push.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
