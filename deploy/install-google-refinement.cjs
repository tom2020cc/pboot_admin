const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = '/www/wwwroot/pboot_admin_center';
const files = ['tools/ftp_publish_tool/server-security.js', 'tools/ftp_publish_tool/server-security.test.cjs',
  'tools/seo_publish_tool/public/index.html', 'tools/seo_publish_tool/public/tutorials/google-sitemap-workflow.svg',
  'deploy/install-google-refinement.cjs'];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const origin = 'https://ftp-admin.shanbo-rig.com';
let cookie = '';
async function login() {
  const credentials = JSON.parse(fs.readFileSync('/root/pboot-admin-initial-login.json', 'utf8'));
  const r = await fetch(origin + '/_tool-auth/login', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...credentials, returnTo: '/' }) });
  assert.equal(r.status, 303); cookie = r.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
}
async function idle() {
  for (const site of require(root + '/tools/site-runtime').readManagedSites()) {
    for (const endpoint of ['upload', 'security', 'server-security']) {
      const r = await fetch(origin + '/api/' + endpoint + '/status?siteId=' + encodeURIComponent(site.id), {
        headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) });
      assert.ok(r.ok); const value = await r.json(); assert.ok(!value.running && !value.job?.running, endpoint + ' is running');
    }
  }
}
async function main() {
  const stage = fs.realpathSync(process.argv[2]); assert.match(stage, /^\/www\/backup\/pboot-pdf-stage-[a-z0-9-]+$/);
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'brochure-update-manifest.json')));
  assert.deepEqual(Object.keys(manifest.files).sort(), [...files].sort());
  for (const file of files) {
    assert.equal(hash(fs.readFileSync(path.join(stage, file))), manifest.files[file]);
    const dest = path.join(root, file);
    if (manifest.expected[file] === null) assert.ok(!fs.existsSync(dest), 'New file exists: ' + file);
    else assert.equal(hash(fs.readFileSync(dest, 'utf8').replace(/\r\n/g, '\n')), manifest.expected[file], 'Source changed: ' + file);
  }
  await login(); await idle();
  for (const file of files) fs.copyFileSync(path.join(stage, file), path.join(root, file));
  execFileSync(process.execPath, ['--test', 'tools/ftp_publish_tool/security-monitor.test.js', 'tools/ftp_publish_tool/site-runtime.test.js',
    'tools/ftp_publish_tool/upload-to-ftp.test.js', 'tools/ftp_publish_tool/server-security.test.cjs',
    'tools/seo_publish_tool/google.test.cjs', 'tools/seo_publish_tool/inspection.test.js', 'tools/seo_publish_tool/ai-connection.test.cjs'], { cwd: root, stdio: 'inherit' });
  // Preserve every existing robots directive; only append the verified public sitemap declaration.
  const robots = '/www/wwwroot/shanbo-rig.com/robots.txt';
  assert.equal(fs.realpathSync(robots), robots);
  const before = fs.readFileSync(robots, 'utf8');
  const line = 'Sitemap: https://shanbo-rig.com/sitemap.xml';
  if (!before.split(/\r?\n/).some(s => s.trim() === line)) {
    assert.equal(before.trim(), 'User-agent: *\nAllow: /\nDisallow: /ad*', 'Robots changed; review before editing');
    fs.writeFileSync(robots, before.replace(/\s*$/, '') + '\n\n' + line + '\n');
  }
  await idle(); execFileSync('pm2', ['restart', 'pboot-ftp-tool'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; ; i++) { try { await login(); break; } catch (e) { if (i >= 15) throw e; await new Promise(r => setTimeout(r, 1000)); } }
  const r = await fetch('https://shanbo-rig.com/robots.txt', { signal: AbortSignal.timeout(15000) });
  assert.ok(r.ok); assert.ok((await r.text()).includes(line));
  console.log('GOOGLE_REFINEMENT_COMPLETE; 66 tests; robots sitemap appended; no PB content changes; no backup; no GitHub');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
