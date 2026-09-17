const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

async function install(stage) {
  const root = '/www/wwwroot/pboot_admin_center';
  assert.equal(fs.realpathSync(stage), '/www/backup/pboot-tool-auth-stage-20260912');
  assert.equal(fs.realpathSync(root), root);
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'tool-auth-manifest.json'), 'utf8'));
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  for (const [name, hash] of Object.entries(manifest.baseline)) {
    assert.ok(!path.isAbsolute(name) && !name.includes('..'));
    assert.equal(digest(fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n')), hash, 'Source changed: ' + name);
  }
  for (const item of manifest.files) {
    assert.ok(!path.isAbsolute(item.file) && !item.file.includes('..'));
    assert.equal(digest(fs.readFileSync(path.join(stage, item.file))), item.sha256, 'Package mismatch: ' + item.file);
  }
  for (const [port, endpoint, key] of [[5389, '/api/upload/status', 'running'], [5389, '/api/security/status', 'running'], [5388, '/api/ai/status', 'job']]) {
    const response = await fetch('http://127.0.0.1:' + port + endpoint + '?siteId=1', { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, 'Pre-update status check failed');
    const data = await response.json();
    assert.notEqual(key === 'job' ? data.job?.running : data[key], true, 'A tool job is running; postpone the update');
  }
  execFileSync(process.execPath, ['--test', 'tools/tool-auth.test.cjs', 'deploy/verify-production.test.cjs'], { cwd: stage, stdio: 'inherit' });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const backup = '/www/backup/pboot-tool-auth-before-' + stamp;
  fs.mkdirSync(backup, { mode: 0o700 });
  const existing = manifest.files.map(item => path.join(root, item.file)).filter(file => fs.existsSync(file));
  const configs = ['seo-admin', 'ftp-admin'].map(name => '/www/server/panel/vhost/nginx/' + name + '.shanbo-rig.com.conf');
  execFileSync('tar', ['-czf', backup + '/before.tgz', '-C', '/', ...existing.concat(configs).map(file => file.slice(1))]);
  fs.chmodSync(backup + '/before.tgz', 0o600);
  for (const item of manifest.files) {
    const dest = path.join(root, item.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(stage, item.file), dest);
  }
  execFileSync('pm2', ['restart', 'pboot-seo-tool', 'pboot-ftp-tool'], { cwd: root, stdio: 'inherit' });
  for (const port of [5388, 5389]) {
    let ready = false;
    for (let retry = 0; retry < 20; retry++) {
      try {
        const login = await fetch('http://127.0.0.1:' + port + '/_tool-auth/login', { redirect: 'manual', signal: AbortSignal.timeout(2000) });
        const api = await fetch('http://127.0.0.1:' + port + '/api/config', { redirect: 'manual', signal: AbortSignal.timeout(2000) });
        ready = login.status === 200 && (await login.text()).includes('使用管理后台账号登录') && api.status === 401;
        if (ready) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'New authentication not ready on ' + port + '; KEEP Basic authentication enabled');
    console.log('PASS loopback ' + port + ': visible login 200; anonymous API 401');
  }
  console.log('Backup: ' + backup + '/before.tgz');
  console.log('NEW_LOGIN_READY: remove only PbootTools Basic auth in each Baota proxy project, then run verify-production.cjs.');
}

if (require.main === module) install(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
