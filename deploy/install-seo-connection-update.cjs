const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = '/www/wwwroot/pboot_admin_center';
const base = 'https://seo-admin.shanbo-rig.com';
const files = ['tools/seo_publish_tool/ai-seo.js', 'tools/seo_publish_tool/public/models-config.html',
  'tools/seo_publish_tool/ai-connection.test.cjs', 'deploy/install-seo-connection-update.cjs'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
const request = (url, options = {}) => fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'manual', ...options });
let cookie = '';
const credentials = () => JSON.parse(fs.readFileSync('/root/pboot-admin-initial-login.json', 'utf8'));
async function login() {
  const response = await request(base + '/_tool-auth/login', { method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...credentials(), returnTo: '/models-config.html' }) });
  assert.equal(response.status, 303, 'Tool login failed');
  cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
}
async function idle() {
  const sites = require(root + '/tools/site-runtime').readManagedSites();
  for (const site of sites.length ? sites : [{ id: '' }]) {
    const response = await request(`${base}/api/ai/status?siteId=${encodeURIComponent(site.id)}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, 'Cannot check active SEO jobs');
    const { job } = await response.json();
    assert.ok(job && job.state !== 'running' && job.running !== true, 'SEO job running: postpone release');
  }
}
async function main() {
  assert.equal(fs.realpathSync(root), root);
  const stage = fs.realpathSync(process.argv[2]);
  assert.match(stage, /^\/www\/backup\/pboot-pdf-stage-[a-z0-9-]+$/);
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'brochure-update-manifest.json')));
  assert.deepEqual(Object.keys(manifest.files).sort(), [...files].sort());
  assert.deepEqual(Object.keys(manifest.expected).sort(), [...files].sort());
  for (const file of files) {
    const source = path.join(stage, file), dest = path.join(root, file);
    assert.equal(hash(fs.readFileSync(source)), manifest.files[file], 'Upload mismatch: ' + file);
    if (manifest.expected[file] === null) assert.ok(!fs.existsSync(dest), 'New file already exists: ' + file);
    else assert.equal(hash(fs.readFileSync(dest, 'utf8').replace(/\r\n/g, '\n')), manifest.expected[file], 'Server source changed: ' + file);
    if (!file.endsWith('.html')) run(process.execPath, ['--check', source]);
  }
  await login(); await idle();
  for (const file of files) fs.copyFileSync(path.join(stage, file), path.join(root, file));
  run(process.execPath, ['--test', 'tools/seo_publish_tool/ai-connection.test.cjs', 'tools/seo_publish_tool/inspection.test.js']);
  await idle();
  run('pm2', ['restart', 'pboot-seo-tool']);
  cookie = '';
  let ready = false;
  for (let n = 0; n < 15; n++) {
    try { ready = (await request(base + '/api/ai/status')).status === 401; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready, 'SEO service did not become ready');
  await login();
  const response = await request(base + '/api/ai/test', { method: 'POST', signal: AbortSignal.timeout(50000),
    headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-chat' }) });
  const result = await response.json();
  assert.ok(response.ok && result.ok, 'Production DeepSeek probe failed: ' + (result.message || response.status));
  console.log(JSON.stringify({ productionProbe: 'passed', attempts: result.attempts, elapsedMs: result.elapsedMs }));
  console.log('SEO_CONNECTION_RELEASE_COMPLETE; backup=disabled; no content/database changes; API/FTP/worker not restarted');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (cookie) await request(base + '/_tool-auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } }).catch(() => {});
});
