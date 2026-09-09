// All admin API calls are mocked; no real uploads, AI requests or PB writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, '../artifacts/menu-seo');
const fixtureImage = process.env.MENU_TEST_IMAGE;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const image = fixtureImage ? fs.readFileSync(fixtureImage) : png;
const base = { publisher: 'admin', model: '3', listTemplate: '', detailTemplate: '', show: true, orderNum: 1, icon: [], thumbnail: '', largeImage: '', seoTitle: '', seoKeywords: '', seoDescription: '' };
const cn = { ...base, id: 595, parentId: 594, code: 'pboot:cn:15', name: '水井钻机', href: '/Water-well-drilling-rig', urlName: 'Water-well-drilling-rig', icon: ['/static/thumb.jpg'], thumbnail: '/static/thumb.jpg', largeImage: '/static/banner.jpg', seoTitle: '水井钻机产品', seoKeywords: '水井钻机,钻探设备', seoDescription: '查看水井钻机型号及产品资料。' };
const en = { ...cn, id: 696, parentId: 695, code: 'pboot:en:62', name: 'Water Well Drilling Rigs', seoTitle: 'Water Well Drilling Rigs', seoKeywords: 'water well rigs,drilling equipment', seoDescription: 'Explore water well drilling rig models.' };
const menus = [{ ...base, id: 594, parentId: 0, code: 'pboot:cn:5', name: '钻机', href: '/Drilling-Rigs' }, cn, { ...base, id: 695, parentId: 0, code: 'pboot:en:52', name: 'Drilling Rigs', href: '/en-Drilling-Rigs' }, en];

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
    await context.addInitScript(() => { localStorage.setItem('localToken', 'fixture-only'); localStorage.setItem('pbootActiveSiteId', '1'); });
    const page = await context.newPage();
    const errors = []; let uploads = 0, drafts = 0, saved;
    page.on('pageerror', error => errors.push(error.message));
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await page.route('http://localhost:5108/**', async route => {
      const req = route.request(), url = new URL(req.url()); let body = {}, status = 200;
      if (req.method() === 'OPTIONS') body = {};
      else if (url.pathname === '/auth/profile') body = { email: 'fixture@example.invalid' };
      else if (url.pathname === '/sites') body = [{ id: 2, name: '山铂钻机', enabled: true, isDefault: true }];
      else if (url.pathname === '/sites/current/languages') body = [{ acode: 'cn', code: 'zh-CN', name: '中文' }, { acode: 'en', code: 'en', name: 'English' }];
      else if (url.pathname === '/menus/translation-models') body = [{ value: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', available: true, operational: true, recommended: true, priority: 1 }];
      else if (url.pathname === '/menus/optimize-seo' && req.method() === 'POST') {
        drafts++; assert.equal(req.headers()['x-pboot-site-id'], '2');
        assert.equal(req.postDataJSON().lang, 'cn'); assert.equal(req.postDataJSON().menuId, '595');
        body = { lang: 'cn', model: 'deepseek-chat', seoTitle: '水井钻机型号与产品资料', seoKeywords: '水井钻机,钻探设备,产品型号', seoDescription: '了解水井钻机产品型号、钻探参数与相关设备资料。' };
      } else if (url.pathname === '/menus/595' && req.method() === 'PATCH') {
        assert.equal(req.headers()['x-pboot-site-id'], '2'); saved = req.postDataJSON(); body = { ...cn, ...saved };
      } else if (url.pathname === '/menus' && req.method() === 'GET') body = menus;
      else if (url.pathname === '/menus/595' && req.method() === 'GET') body = cn;
      else if (url.pathname === '/menus/696' && req.method() === 'GET') body = en;
      else if (url.pathname === '/img-upload/imgs' && req.method() === 'POST') {
        uploads++; assert.equal(req.headers()['x-pboot-site-id'], '2'); body = [`fixture-${uploads}.jpg`];
      } else if (url.pathname === '/sites/static-file' || url.pathname.startsWith('/img-upload/file/')) {
        assert.equal(url.searchParams.get('siteId'), '2');
        await route.fulfill({ contentType: fixtureImage ? 'image/jpeg' : 'image/png', body: image, headers }); return;
      } else { errors.push(`Unexpected API ${req.method()} ${url.pathname}`); status = 500; }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });
    });
    const field = label => page.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: new RegExp(`^${label}$`) }) });
    const input = label => field(label).locator('input:not([type=file]), textarea').first();
    await page.goto('http://localhost:5278/?siteId=2#/menus/edit/595');
    await page.waitForFunction(() => document.querySelector('input[placeholder="栏目 SEO 标题"]')?.value === '水井钻机产品');
    assert.equal(await input('SEO 关键字').inputValue(), cn.seoKeywords);
    assert.equal(await page.evaluate(() => localStorage.getItem('pbootActiveSiteId')), '2');
    // Another tab may select a different site; this tab must keep its own request scope.
    await page.evaluate(() => localStorage.setItem('pbootActiveSiteId', '1'));
    assert.equal(await input('SEO 描述').inputValue(), cn.seoDescription);
    assert.equal(await input('栏目缩略图').inputValue(), cn.thumbnail);
    assert.equal(await input('栏目大图').inputValue(), cn.largeImage);
    assert.equal(await input('PB 栏目编码').isDisabled(), true);
    assert.equal(saved, undefined);
    await page.getByRole('button', { name: 'AI 优化中文 SEO', exact: true }).click();
    await page.getByText('中文栏目 SEO 草稿已优化，请检查后保存', { exact: true }).waitFor();
    assert.equal(await input('SEO 标题').inputValue(), '水井钻机型号与产品资料');
    assert.equal(await input('菜单名称').inputValue(), cn.name);
    assert.equal(await input('URL名称').inputValue(), cn.urlName);
    assert.equal(saved, undefined, 'AI must not save or publish');
    await page.getByRole('button', { name: '重置', exact: true }).click();
    assert.equal(await input('SEO 标题').inputValue(), cn.seoTitle);
    assert.equal(await input('PB 栏目编码').inputValue(), cn.code);
    await field('栏目缩略图').locator('input[type=file]').setInputFiles({ name: 'thumb.png', mimeType: 'image/png', buffer: png });
    await page.getByText('栏目缩略图上传成功', { exact: true }).waitFor();
    assert.equal(await input('栏目大图').inputValue(), cn.largeImage);
    await field('栏目大图').locator('input[type=file]').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: png });
    await page.getByText('栏目大图上传成功', { exact: true }).waitFor();
    assert.equal(await input('栏目缩略图').inputValue(), 'fixture-1.jpg');
    assert.equal(await input('栏目大图').inputValue(), 'fixture-2.jpg');
    await input('SEO 标题').fill('手动调整的中文 SEO 标题');
    await page.waitForFunction(() => [...document.querySelectorAll('.thumb-upload img')].length === 2 && [...document.querySelectorAll('.thumb-upload img')].every(img => img.complete && img.naturalWidth > 0));
    await page.waitForFunction(() => !document.querySelector('.el-message'));
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.el-aside').getBoundingClientRect().width < 70);
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
    const dimensions = await page.locator('.entity-form').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert(dimensions.scroll <= dimensions.width + 2, JSON.stringify(dimensions));
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByText('修改菜单成功', { exact: true }).waitFor();
    await page.waitForURL('**/#/menus');
    assert.equal(saved.thumbnail, 'fixture-1.jpg'); assert.equal(saved.largeImage, 'fixture-2.jpg');
    assert.deepEqual(saved.icon, ['fixture-1.jpg']); assert.equal(saved.seoTitle, '手动调整的中文 SEO 标题');
    assert.equal(saved.model, '3'); assert.equal(saved.code, cn.code);
    await page.goto('http://localhost:5278/#/menus/edit/696');
    await page.waitForFunction(() => document.querySelector('input[placeholder="栏目 SEO 标题"]')?.value === 'Water Well Drilling Rigs');
    assert.equal(await page.getByRole('button', { name: 'AI 优化中文 SEO', exact: true }).count(), 0);
    assert.equal(await page.locator('.entity-form input[type=file]').count(), 0);
    for (const label of ['SEO 标题', 'SEO 关键字', 'SEO 描述']) assert.equal(await input(label).getAttribute('readonly'), '');
    await page.goto('http://localhost:5278/#/menus/edit/595');
    await page.waitForFunction(() => document.querySelector('input[placeholder="栏目 SEO 标题"]')?.value === '水井钻机产品');
    assert.equal(await page.getByRole('button', { name: 'AI 优化中文 SEO', exact: true }).count(), 1);
    assert.equal(drafts, 1); assert.equal(uploads, 2); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, uploads, drafts, saved: Boolean(saved), output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
