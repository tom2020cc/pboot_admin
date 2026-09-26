// Isolated UI test: no real API credentials or online writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../backend/package.json'))('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => { localStorage.setItem('localToken', 'isolated-fixture'); localStorage.setItem('pbootActiveSiteId', '1'); });
    const site = { id: 1, code: 'fixture', name: '测试站点', environment: 'phpstudy', enabled: true, isDefault: true };
    const profiles = ['cn', 'en'].map(language => ({ language, data: { site: { title: language + '-title' }, company: { phone: '123' } }, revision: language + '-1', hasDraft: true, pending: false, exists: { site: true, company: true } }));
    const state = { siteId: 1, siteName: site.name, environment: 'phpstudy', canSyncOnline: true, onlineTarget: 'https://example.test', onlineTargetRevision: 'target-v1',
      profiles, languages: [{ code: 'cn', name: '中文' }, { code: 'en', name: 'English' }], themes: ['cn', 'en'],
      fields: [{ section: 'site', key: 'title', label: '站点标题', maxLength: 300 }, { section: 'company', key: 'phone', label: '电话', maxLength: 100 }] };
    const sent = []; let fail = false, saved = false;
    await context.route('http://localhost:5108/**', async route => {
      const req = route.request(), endpoint = new URL(req.url()).pathname;
      let body = {}, status = 200;
      if (endpoint === '/site-information') body = state;
      else if (endpoint === '/site-information/save') {
        const dto = req.postDataJSON(), profile = profiles.find(p => p.language === dto.language);
        profile.data = dto.data; profile.revision = dto.language + '-2'; saved = true; body = state;
      } else if (endpoint === '/site-information/sync-online') {
        const dto = req.postDataJSON(); sent.push(dto);
        if (fail) { status = 400; body = { message: '模拟线上连接失败' }; }
        else body = { siteId: 1, target: state.onlineTarget, languages: dto.items.map(i => i.language), imageCount: 1, verifiedAt: new Date().toISOString(), warnings: [] };
      } else if (endpoint === '/sites') body = [site];
      else if (endpoint === '/sites/current/languages') body = state.languages;
      else if (endpoint.includes('models') || endpoint.includes('menu')) body = [];
      else if (endpoint === '/auth/profile') body = { email: 'fixture@example.test' };
      else if (endpoint === '/project-identity') body = { project: 'pboot-admin-center', environment: 'local' };
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await context.route('https://**', route => route.abort());
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:5278/#/site-information');
    await page.getByRole('textbox', { name: '站点标题', exact: true }).fill('已编辑的标题');
    const button = page.getByRole('button', { name: '同步到线上', exact: true });
    const send = async name => {
      await button.hover(); await page.getByRole('menuitem', { name, exact: true }).click();
      await page.getByText(/https:\/\/example.test/).last().waitFor();
      await page.getByRole('button', { name: '确认', exact: true }).click();
    };
    await send('同步当前语言到线上');
    await page.getByRole('alert').filter({ hasText: '本次已同步 1 个语言' }).waitFor();
    assert.equal(saved, true); assert.equal(sent[0].siteId, 1); assert.equal(sent[0].targetRevision, 'target-v1');
    assert.deepEqual(sent[0].items, [{ language: 'cn', revision: 'cn-2' }]);
    await send('同步全部语言到线上');
    await page.getByRole('alert').filter({ hasText: '本次已同步 2 个语言' }).waitFor();
    assert.deepEqual(sent[1].items.map(i => i.language), ['cn','en']);
    fail = true; await send('同步当前语言到线上');
    await page.getByRole('alert').filter({ hasText: '模拟线上连接失败' }).first().waitFor();
    assert.equal(await page.getByRole('alert').filter({ hasText: '本次已同步' }).count(), 0);
    state.canSyncOnline = false; state.environment = 'baota'; site.environment = 'baota';
    await page.reload();
    await page.getByRole('button', { name: '同步到 PB', exact: true }).waitFor();
    assert.equal(await button.count(), 0); assert.deepEqual(errors, []);
    console.log('PASS: current/all language sync, save-before-sync, target confirmation, failure display and Baota visibility');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
