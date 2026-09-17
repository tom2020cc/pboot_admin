const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = '/www/wwwroot/pboot_admin_center';
const files = ['tools/ftp_publish_tool/server-security.js', 'tools/ftp_publish_tool/server.js',
  'tools/ftp_publish_tool/public/server-security.html', 'tools/ftp_publish_tool/public/server-security.js',
  'tools/ftp_publish_tool/server-file-actions.js', 'tools/ftp_publish_tool/server-file-actions.test.cjs',
  'tools/ftp_publish_tool/server-security.test.cjs', 'deploy/install-server-actions.cjs'];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const origin = 'https://ftp-admin.shanbo-rig.com';
let cookie;
async function login() {
  const credentials = JSON.parse(fs.readFileSync('/root/pboot-admin-initial-login.json', 'utf8'));
  const r = await fetch(origin + '/_tool-auth/login', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...credentials, returnTo: '/' }) });
  assert.equal(r.status, 303); cookie = r.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
}
async function status(endpoint, id) {
  const r = await fetch(origin + '/api/' + endpoint + '/status?siteId=' + encodeURIComponent(id), { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) });
  assert.ok(r.ok); return r.json();
}
async function idle() {
  for (const site of require(root + '/tools/site-runtime').readManagedSites()) {
    for (const name of ['upload', 'security', 'server-security']) {
      const value = await status(name, site.id); assert.ok(!value.running && !value.job?.running, name + ' is busy');
    }
  }
}
async function main() {
  assert.equal(fs.realpathSync(root), root);
  const stage = fs.realpathSync(process.argv[2]); assert.match(stage, /^\/www\/backup\/pboot-pdf-stage-[a-z0-9-]+$/);
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'brochure-update-manifest.json')));
  assert.deepEqual(Object.keys(manifest.files).sort(), [...files].sort());
  for (const file of files) {
    const dest = path.join(root, file); assert.equal(hash(fs.readFileSync(path.join(stage, file))), manifest.files[file]);
    if (manifest.expected[file] === null) assert.ok(!fs.existsSync(dest), 'New file already exists: ' + file);
    else assert.equal(hash(fs.readFileSync(dest, 'utf8').replace(/\r\n/g, '\n')), manifest.expected[file], 'Source changed: ' + file);
  }
  await login(); await idle();
  const initial = await status('server-security', 1);
  for (const file of files) fs.copyFileSync(path.join(stage, file), path.join(root, file));
  execFileSync(process.execPath, ['--test', 'tools/ftp_publish_tool/server-file-actions.test.cjs', 'tools/ftp_publish_tool/server-security.test.cjs',
    'tools/ftp_publish_tool/security-monitor.test.js', 'tools/ftp_publish_tool/site-runtime.test.js', 'tools/ftp_publish_tool/upload-to-ftp.test.js',
    'tools/tool-auth.test.cjs'], { cwd: root, stdio: 'inherit' });
  await idle(); execFileSync('pm2', ['restart', 'pboot-ftp-tool'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; ; i++) { try { await login(); break; } catch (e) { if (i >= 15) throw e; await new Promise(r => setTimeout(r, 1000)); } }
  const current = await status('server-security', 1);
  assert.deepEqual(current.trusted, []); assert.deepEqual(current.quarantine, []);
  assert.equal(current.report?.id, initial.report?.id);
  const page = await fetch(origin + '/server-security.html?siteId=1', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) });
  assert.ok(page.ok); assert.match(await page.text(), /删除（移入隔离）/);
  const denied = await fetch(origin + '/api/server-security/read?siteId=1', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{}' });
  assert.equal(denied.status, 401);
  console.log('SERVER_ACTIONS_COMPLETE; Linux tests passed; no real files trusted or deleted; no backup; no GitHub; existing report unchanged');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
