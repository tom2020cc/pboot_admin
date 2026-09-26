// Run after backend build, with the local Vite server on port 5278.
// All API requests are intercepted. No live credentials, AI requests or website writes are used.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const backendRequire = createRequire(path.join(root, 'backend/package.json'));
const { chromium } = backendRequire('playwright');
const { DataSource } = backendRequire('typeorm');
const initSqlJs = backendRequire('sql.js');
const { SiteInformationDraft } = require('../backend/dist/site-information/site-information.entity');
const { SiteInformationService } = require('../backend/dist/site-information/site-information.service');
const { INFORMATION_FIELDS } = require('../backend/dist/site-information/site-information.fields');

(async () => {
  const output = path.join(root, 'tmp/site-information');
  fs.mkdirSync(output, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(output, 'fixture-'));
  const pbFile = path.join(fixture, 'data/pb.db');
  fs.mkdirSync(path.dirname(pbFile), { recursive: true });
  const languages = ['cn', 'en', 'es', 'fr', 'ar', 'pt', 'ru', 'id', 'tr', 'vi'];
  for (const language of languages) {
    fs.mkdirSync(path.join(fixture, 'template', language, 'html'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'template', language, 'html/index.html'), '<h1>Fixture</h1>');
  }
  const SQL = await initSqlJs();
  const pb = new SQL.Database();
  pb.run('CREATE TABLE ay_area (id INTEGER PRIMARY KEY, acode TEXT,pcode TEXT,name TEXT,domain TEXT)');
  for (const group of ['site', 'company']) pb.run(`CREATE TABLE ay_${group} (id INTEGER PRIMARY KEY,acode TEXT,${INFORMATION_FIELDS.filter(field => field.section === group).map(field => `${field.key} TEXT NOT NULL`).join(',')})`);
  for (const [index, language] of languages.entries()) {
    pb.run('INSERT INTO ay_area VALUES (?,?,?,?,?)', [index + 1, language, '0', language, `${language}.example.test`]);
    if (language === 'fr') continue;
    const data = { site: { title: 'ShanBo', subtitle: '山博钻机设备', domain: `${language}.example.test`, theme: language, logo: '/static/logo.jpg', keywords: '水井钻机,岩芯钻机', description: '山博钻机设备的站点介绍。', copyright: 'ShanBo 版权所有' },
      company: { name: '山博机械设备有限公司', address: '中国山东省济宁市', phone: '8615165139199', mobile: '8615165139199', email: 'test@example.test' } };
    for (const group of ['site', 'company']) {
      const keys = INFORMATION_FIELDS.filter(field => field.section === group).map(field => field.key);
      pb.run(`INSERT INTO ay_${group} (acode,${keys.join(',')}) VALUES (${['?', ...keys.map(() => '?')].join(',')})`, [language, ...keys.map(key => data[group][key] || '')]);
    }
  }
  fs.writeFileSync(pbFile, pb.export()); pb.close();
  const source = new DataSource({ type: 'sqljs', entities: [SiteInformationDraft], synchronize: true });
  await source.initialize();
  const site = { id: 1, name: '山博钻机（隔离测试）', enabled: true, rootPath: fixture, dbPath: pbFile, publicBaseUrl: 'http://example.test', isDefault: true, code: 'fixture' };
  const sites = { getCurrentSite: () => site, getCurrentSiteId: () => 1, isDefaultSite: () => true, getCurrentSiteStorageDir: () => path.join(fixture, 'api') };
  let failFrench = true;
  const models = [{ value: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek Chat', displayLabel: 'DeepSeek Chat', available: true, operational: true, healthStatus: 'ok', priority: 1, recommended: true, quotaStatus: 'check-console', quotaText: '测试模型' }];
  const translator = { models: () => models, translate: async (fields, language) => {
    if (language === 'fr' && failFrench) throw new Error('Fixture translation failure');
    return { fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ? `${language}: ${value}` : ''])), model: 'deepseek-chat', fallbackUsed: false };
  } };
  const service = new SiteInformationService(source.getRepository(SiteInformationDraft), sites, { getSiteId: () => 1 }, translator);
  const logoFile = path.resolve(root, '../shanbo-rig.c/static/logo_2.jpg');
  const logo = fs.existsSync(logoFile) ? fs.readFileSync(logoFile) : fs.readFileSync(path.join(root, 'frontend/src/assets/logo.svg'));
  const browser = await chromium.launch({ headless: true });
  const report = { assertions: [], views: [], unexpectedRequests: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addInitScript(() => { localStorage.setItem('localToken', 'isolated-ui-fixture'); localStorage.setItem('pbootActiveSiteId', '1'); });
    await context.route('http://localhost:5108/**', async route => {
      const request = route.request(); const url = new URL(request.url()); let body; let status = 200;
      try {
        const dto = request.method() === 'POST' && !url.pathname.startsWith('/img-upload') ? request.postDataJSON() : undefined;
        if (url.pathname === '/site-information') body = await service.read();
        else if (url.pathname === '/site-information/setup') body = request.method() === 'POST' ? await service.setup(dto) : await service.previewSetup();
        else if (url.pathname === '/site-information/models') body = models;
        else if (url.pathname === '/site-information/save') body = await service.save(dto);
        else if (url.pathname === '/site-information/import') body = await service.import(dto);
        else if (url.pathname === '/site-information/translate') body = await service.translate(dto);
        else if (url.pathname === '/site-information/sync') body = await service.sync(dto);
        else if (url.pathname === '/sites') body = [site];
        else if (url.pathname === '/sites/current/languages') body = languages.map(code => ({ code: code === 'cn' ? 'zh-CN' : code, acode: code, name: code }));
        else if (url.pathname === '/auth/profile') body = { email: 'fixture@example.test' };
        else if (url.pathname === '/project-identity') body = { project: 'pboot-admin-center', environment: 'local' };
        else if (url.pathname === '/img-upload/imgs') {
          fs.mkdirSync(path.join(fixture, 'api/uploads'), { recursive: true });
          fs.writeFileSync(path.join(fixture, 'api/uploads', 'fixture-logo.jpg'), logo); body = ['fixture-logo.jpg'];
        } else if (url.pathname === '/sites/static-file' || url.pathname.startsWith('/img-upload/file/')) {
          await route.fulfill({ status: 200, contentType: fs.existsSync(logoFile) ? 'image/jpeg' : 'image/svg+xml', body: logo }); return;
        } else { report.unexpectedRequests.push(url.pathname); status = 404; body = { message: 'Unexpected fixture endpoint' }; }
      } catch (error) { status = error.getStatus?.() || 400; body = { message: error.message }; }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    // No test request may reach a real remote service.
    await context.route(/https:\/\//, route => route.abort());
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const waitMessage = text => page.getByText(text, { exact: false }).last().waitFor();
    const click = text => page.getByRole('button', { name: text, exact: true }).click();
    const confirm = () => page.getByRole('button', { name: '确认', exact: true }).click();
    const tab = text => page.getByRole('tab', { name: new RegExp(`^${text}`) }).click();
    await page.goto('http://localhost:5278/#/site-information');
    await page.getByRole('textbox', { name: '站点标题', exact: true }).waitFor();
    assert.equal(await page.getByRole('menuitem', { name: '模板栏目绑定', exact: true }).count(), 0);
    await click('一键配置多语言');
    await page.getByRole('dialog', { name: '配置多语言站点资料', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'setup-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'setup-mobile.png'), fullPage: true, animations: 'disabled' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.getByRole('button', { name: '配置并同步到 PB (1)', exact: true }).click();
    await confirm(); await waitMessage('已配置 1 个语言的 PB 资料');
    assert.equal((await service.read()).profiles.find(item => item.language === 'fr').data.site.theme, 'fr');
    report.assertions.push('setup previews and creates French records; retired binding entry absent');
    await page.locator('.information-form .el-image img').waitFor();
    await page.screenshot({ path: path.join(output, 'desktop-site.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('textbox', { name: '站点标题', exact: true }).fill('本地测试标题');
    await tab('公司信息');
    await page.getByRole('textbox', { name: '公司名称', exact: true }).fill('本地测试公司');
    await click('保存当前语言'); await waitMessage('已保存到管理后台');
    await click('重新加载'); await page.getByRole('textbox', { name: '公司名称', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '公司名称', exact: true }).inputValue(), '本地测试公司');
    report.assertions.push('draft persistence after reload');
    await page.locator('.el-message').last().waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(output, 'desktop-company.png'), fullPage: true, animations: 'disabled' });
    await tab('English'); await tab('站点信息');
    await page.getByRole('textbox', { name: '站点副标题', exact: true }).fill('Unsaved English draft');
    await tab('中文'); await click('保存当前语言'); await waitMessage('已保存到管理后台'); await tab('English');
    assert.equal(await page.getByRole('textbox', { name: '站点副标题', exact: true }).inputValue(), 'Unsaved English draft');
    report.assertions.push('saving CN preserves other language unsaved edits');
    await click('只翻译当前语言'); await confirm(); await waitMessage('翻译完成：成功 1');
    assert.equal(await page.getByRole('textbox', { name: '站点标题', exact: true }).inputValue(), 'en: 本地测试标题');
    assert.equal(await page.getByRole('textbox', { name: '站点域名', exact: true }).inputValue(), 'en.example.test');
    report.assertions.push('translate current uses CN and preserves domain');
    await click('一键翻译'); await click('开始翻译'); await confirm(); await waitMessage('翻译完成：成功 8，失败 1');
    failFrench = false;
    await click('重试失败语言 (1)'); await waitMessage('翻译完成：成功 1，失败 0');
    report.assertions.push('batch translates 9 languages and retries failed language');
    await tab('中文');
    await page.locator('input[type=file]').setInputFiles({ name: 'logo.jpg', mimeType: 'image/jpeg', buffer: logo });
    await waitMessage('站点 Logo上传成功'); await click('保存当前语言'); await waitMessage('已保存到管理后台');
    await page.getByRole('button', { name: '同步到 PB', exact: false }).hover();
    await page.getByRole('menuitem', { name: '同步全部待同步语言', exact: true }).click();
    await confirm(); await waitMessage('已同步 10 个语言的资料');
    const state = await service.read();
    assert.ok(state.profiles.every(item => !item.pending));
    assert.match(state.profiles.find(item => item.language === 'cn').data.site.logo, /^\/static\/codex\/site-information\//);
    report.assertions.push('upload and publish all fixture languages');
    await page.getByRole('textbox', { name: '站点标题', exact: true }).fill('discard me');
    await click('从 PB 读取当前语言'); await confirm(); await waitMessage('已读取 PB 当前资料');
    assert.equal(await page.getByRole('textbox', { name: '站点标题', exact: true }).inputValue(), '本地测试标题');
    report.assertions.push('explicit PB import replaces only selected language');
    await page.locator('.el-message').last().waitFor({ state: 'hidden' });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width < 760) await page.waitForFunction(() => document.querySelector('.el-aside').getBoundingClientRect().width < 75);
      await page.screenshot({ path: path.join(output, `responsive-${width}.png`), fullPage: true, animations: 'disabled' });
      const bounds = await page.locator('.information-page').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
      assert.ok(bounds.scroll <= bounds.width + 2, `content overflow at ${width}: ${JSON.stringify(bounds)}`);
      report.views.push({ viewport: width, ...bounds });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(report.unexpectedRequests, []);
    fs.writeFileSync(path.join(output, 'ui-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); await source.destroy(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
