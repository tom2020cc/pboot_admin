// Isolated browser regression: API calls are mocked; no real account or remote writes.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { chromium } = createRequire(path.resolve(__dirname, '../backend/package.json'))('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => { localStorage.setItem('localToken', 'isolated-fixture'); localStorage.setItem('pbootActiveSiteId', '1'); });
    const profile = { domains: ['example.com'], codes: 'FIXTURE', phone: '' };
    const site = { id: 1, code: 'fixture', name: '测试站点', enabled: true, isDefault: true, environment: 'phpstudy', rootPath: 'C:/fixture', dbPath: 'C:/fixture/data/test.db', publicBaseUrl: 'http://fixture.local' };
    let fail = false, posted;
    const license = { siteId: 1, siteName: site.name, activeEnvironment: 'phpstudy', canSyncRemote: true, publicDomain: 'fixture.local', profiles: { phpstudy: { ...profile, domains: ['fixture.local'] }, baota: profile }, live: profile, revision: 'fixture-revision' };
    await context.route('http://localhost:5108/**', async route => {
      const request = route.request(), endpoint = new URL(request.url()).pathname;
      let body = {};
      if (endpoint === '/sites/current/system-license') {
        body = license;
        if (request.method() === 'POST') {
          posted = request.postDataJSON();
          body = { ...license, onlineSync: { ok: !fail, message: fail ? '配置已保存在本地，线上同步未确认成功：测试连接失败' : '线上授权码已同步并回读校验通过' } };
        }
      } else if (endpoint === '/sites') body = [site];
      else if (endpoint === '/sites/current') body = site;
      else if (endpoint.includes('menu')) body = [];
      else if (endpoint === '/auth/profile' || endpoint === '/user/profile') body = { id: 1, username: 'fixture', email: 'fixture@example.test' };
      else if (endpoint === '/project-identity') body = { project: 'pboot-admin-center', environment: 'local' };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await context.route('https://**', route => route.abort());
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:5278/#/sites');
    const button = page.getByRole('button', { name: '保存并同步线上授权码', exact: true });
    await button.click();
    await page.getByRole('alert').filter({ hasText: '线上授权码已同步并回读校验通过' }).first().waitFor();
    assert.equal(posted.siteId, 1); assert.equal(posted.apply, false); assert.equal(posted.syncRemote, true); assert.equal(posted.environment, 'baota');
    fail = true; await button.click();
    await page.getByRole('alert').filter({ hasText: '测试连接失败' }).waitFor();
    assert.equal(await button.isEnabled(), true);
    license.canSyncRemote = false; license.activeEnvironment = 'baota';
    await page.reload();
    await page.getByRole('button', { name: '保存并写入当前 PB' }).waitFor();
    assert.equal(await button.count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: online button submits only remote profile; success and failure are visible; retry remains available');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
