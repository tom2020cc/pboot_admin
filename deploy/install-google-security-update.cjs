const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = '/www/wwwroot/pboot_admin_center';
const files = [
  'tools/seo_publish_tool/server.js', 'tools/seo_publish_tool/public/index.html', 'tools/seo_publish_tool/google-scope.js', 'tools/seo_publish_tool/google.test.cjs',
  'tools/ftp_publish_tool/server.js', 'tools/ftp_publish_tool/public/index.html', 'tools/ftp_publish_tool/public/security.html',
  'tools/ftp_publish_tool/server-security.js', 'tools/ftp_publish_tool/server-security.test.cjs',
  'tools/ftp_publish_tool/public/server-security.html', 'tools/ftp_publish_tool/public/server-security.js',
  'deploy/install-google-security-update.cjs',
];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const origins = { seo: 'https://seo-admin.shanbo-rig.com', ftp: 'https://ftp-admin.shanbo-rig.com' };
const cookies = {};
async function request(tool, route, body) {
  const response = await fetch(origins[tool] + route, { redirect: 'manual', signal: AbortSignal.timeout(120000),
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookies[tool] || '', Origin: origins[tool], 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok, `${tool}${route}: HTTP ${response.status} ${data.message || ''}`);
  return data;
}
async function login(tool) {
  const credentials = JSON.parse(fs.readFileSync('/root/pboot-admin-initial-login.json', 'utf8'));
  const response = await fetch(origins[tool] + '/_tool-auth/login', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { Origin: origins[tool], 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...credentials, returnTo: '/' }) });
  assert.equal(response.status, 303, 'Tool login failed');
  cookies[tool] = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookies[tool]);
}
async function idle() {
  for (const site of require(root + '/tools/site-runtime').readManagedSites()) {
    const suffix = '?siteId=' + encodeURIComponent(site.id);
    const seo = await request('seo', '/api/ai/status' + suffix);
    assert.ok(seo.job && seo.job.state !== 'running' && !seo.job.running, 'SEO task is running');
    assert.ok(!(await request('ftp', '/api/upload/status' + suffix)).running, 'FTP upload is running');
    assert.ok(!(await request('ftp', '/api/security/status' + suffix)).running, 'FTP scan is running');
  }
}
async function main() {
  const stage = fs.realpathSync(process.argv[2]);
  assert.match(stage, /^\/www\/backup\/pboot-pdf-stage-[a-z0-9-]+$/);
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'brochure-update-manifest.json')));
  assert.deepEqual(Object.keys(manifest.files).sort(), [...files].sort());
  for (const file of files) {
    const source = path.join(stage, file), dest = path.join(root, file);
    assert.equal(hash(fs.readFileSync(source)), manifest.files[file], 'Upload mismatch: ' + file);
    if (manifest.expected[file] === null) assert.ok(!fs.existsSync(dest), 'New file exists: ' + file);
    else assert.equal(hash(fs.readFileSync(dest, 'utf8').replace(/\r\n/g, '\n')), manifest.expected[file], 'Server source changed: ' + file);
    if (!file.endsWith('.html')) execFileSync(process.execPath, ['--check', source]);
  }
  await login('seo'); await login('ftp'); await idle();
  for (const file of files) fs.copyFileSync(path.join(stage, file), path.join(root, file));
  execFileSync(process.execPath, ['--test',
    'tools/seo_publish_tool/google.test.cjs', 'tools/seo_publish_tool/inspection.test.js', 'tools/seo_publish_tool/ai-connection.test.cjs',
    'tools/ftp_publish_tool/security-monitor.test.js', 'tools/ftp_publish_tool/site-runtime.test.js',
    'tools/ftp_publish_tool/upload-to-ftp.test.js', 'tools/ftp_publish_tool/server-security.test.cjs'], { cwd: root, stdio: 'inherit' });
  await idle();
  execFileSync('pm2', ['restart', 'pboot-seo-tool', 'pboot-ftp-tool'], { cwd: root, stdio: 'ignore' });
  for (const tool of ['seo', 'ftp']) {
    for (let i = 0; ; i++) {
      try { await login(tool); break; } catch (error) { if (i > 15) throw error; await new Promise(r => setTimeout(r, 1000)); }
    }
  }
  const sites = require(root + '/tools/site-runtime').readManagedSites();
  for (const site of sites) {
    const suffix = '?siteId=' + encodeURIComponent(site.id);
    const report = await request('seo', '/api/report' + suffix);
    console.log(JSON.stringify({ siteId: site.id, seoStats: report.stats, seoIssues: report.issues?.length }));
    const gsc = await request('seo', '/api/search-console/status' + suffix);
    console.log(JSON.stringify({ siteId: site.id, googleAccountConfigured: gsc.enabled, property: gsc.siteUrl }));
    const security = await request('ftp', '/api/server-security/status' + suffix);
    assert.equal(String(security.site.id), String(site.id));
    console.log(JSON.stringify({ siteId: site.id, serverRoot: security.site.root, monitorEnabled: security.settings.enabled }));
  }
  console.log('GOOGLE_SECURITY_RELEASE_COMPLETE; no code backups; no GitHub; no PB content changes; monitoring defaults off');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
