// Mock all admin requests: no real translations, content changes or PB writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, '../artifacts/single-menu-translation');
const base = { publisher: 'admin', model: '3', listTemplate: '', detailTemplate: '', show: true, orderNum: 1,
  icon: [], thumbnail: '', largeImage: '', seoTitle: '', seoKeywords: '', seoDescription: '', sourceMenuId: 0 };
let current = { ...base, id: 882, parentId: 1, code: 'pboot:cn:501', name: '坑道钻机', href: '/Underground', urlName: 'Underground', pbootSyncPending: true };
const cn = { ...base, id: 1, parentId: 0, code: 'pboot:cn:1', name: '钻机', href: '/rigs', urlName: 'rigs' };
const en = { ...base, id: 11, parentId: 0, code: 'pboot:en:11', name: 'Drilling Rigs', href: '/en-rigs', urlName: 'en-rigs', sourceMenuId: 1 };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    await context.addInitScript(() => { localStorage.setItem('localToken', 'fixture-only'); localStorage.setItem('pbootActiveSiteId', '2'); });
    const page = await context.newPage(), errors = [], translations = [];
    let saves = 0, failSave = false;
    page.on('pageerror', error => errors.push(error.message));
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await page.route('http://localhost:5108/**', async route => {
      const req = route.request(), url = new URL(req.url()); let body = {}, status = 200;
      if (req.method() === 'OPTIONS') body = {};
      else if (url.pathname === '/auth/profile') body = { email: 'fixture@example.invalid' };
      else if (url.pathname === '/sites') body = [{ id: 2, name: '山铂钻机', enabled: true, isDefault: true }];
      else if (url.pathname === '/sites/current/languages') body = [{ acode: 'cn', code: 'zh-CN', name: '中文' }, { acode: 'en', code: 'en', name: 'English' }, { acode: 'vi', code: 'vi', name: 'Tiếng Việt' }];
      else if (url.pathname === '/menus/translation-models') body = [{ value: 'google-free', label: 'Google Translate', provider: 'google', available: true, operational: true }];
      else if (url.pathname === '/menus' && req.method() === 'GET') body = [cn, en, current];
      else if (url.pathname === '/menus/882' && req.method() === 'GET') body = current;
      else if (url.pathname === '/menus/11' && req.method() === 'GET') body = en;
      else if (url.pathname === '/menus/882' && req.method() === 'PATCH') {
        saves++;
        if (failSave) { status = 400; body = { message: '模拟保存失败' }; }
        else { current = { ...current, ...req.postDataJSON() }; body = current; }
      } else if (url.pathname === '/menus/882/translate' && req.method() === 'POST') {
        assert.equal(req.headers()['x-pboot-site-id'], '2');
        const data = req.postDataJSON(); assert.equal(data.model, 'google-free'); assert.equal(data.targetAcodes.length, 1);
        const acode = data.targetAcodes[0]; translations.push(acode);
        assert.equal(current.name, '坑道钻机新名称'); assert.equal(current.seoTitle, '坑道钻机产品资料');
        const fail = acode === 'vi' && translations.filter(code => code === 'vi').length === 1;
        body = { sourceCount: 1, source: 'cn', results: fail ? [] : [{ acode, translated: 1, created: 1, updated: 0, skipped: 0 }],
          failures: fail ? [{ acode, message: '模拟语言服务繁忙，请重试' }] : [] };
      } else { errors.push(`Unexpected API ${req.method()} ${url.pathname}`); status = 500; }
      await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    });
    const field = label => page.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: new RegExp(`^${label}$`) }) });
    const dialog = () => page.locator('.single-menu-translation-dialog');
    const open = () => page.getByRole('button', { name: '翻译当前栏目', exact: true }).click();
    const confirm = () => page.getByRole('button', { name: '确认翻译', exact: true }).click();
    await page.goto('http://localhost:5278/?siteId=2#/menus/edit/882');
    await page.waitForFunction(() => document.querySelector('input[placeholder="例如：产品中心"]')?.value === '坑道钻机');
    await field('菜单名称').locator('input').fill('坑道钻机新名称');
    await field('SEO 标题').locator('input').fill('坑道钻机产品资料');
    await open(); await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(saves, 0);
    await open(); await page.getByRole('button', { name: '保存并继续', exact: true }).click();
    await dialog().waitFor(); assert(page.url().endsWith('/menus/edit/882')); assert.equal(saves, 1);
    await dialog().getByRole('button', { name: '开始翻译', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.single-menu-translation-dialog .el-checkbox.is-checked').length === 2);
    await dialog().getByRole('button', { name: '开始翻译', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click(); assert.deepEqual(translations, []);
    await dialog().getByRole('button', { name: '开始翻译', exact: true }).click(); await confirm();
    await dialog().getByText('模拟语言服务繁忙，请重试', { exact: true }).waitFor(); assert.deepEqual(translations, ['en', 'vi']);
    await page.waitForFunction(() => !document.querySelector('.el-message-box__wrapper') || getComputedStyle(document.querySelector('.el-message-box__wrapper')).display === 'none');
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await page.screenshot({ path: path.join(output, 'desktop-results.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.el-aside').getBoundingClientRect().width < 70);
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    const bounds = await dialog().evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: innerWidth }));
    assert(bounds.left >= 0 && bounds.right <= bounds.width, JSON.stringify(bounds));
    const resultSize = await dialog().locator('.results').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert(resultSize.scroll <= resultSize.width + 2, JSON.stringify(resultSize));
    await page.screenshot({ path: path.join(output, 'mobile-results.png'), fullPage: true });
    await dialog().getByRole('button', { name: '重试失败语言', exact: true }).click(); await confirm();
    await dialog().getByRole('button', { name: '重试失败语言', exact: true }).waitFor({ state: 'detached' });
    assert.deepEqual(translations, ['en', 'vi', 'vi']); assert.equal(await dialog().getByText('已保存', { exact: true }).count(), 2);
    await dialog().getByRole('button', { name: '关闭', exact: true }).click();
    await page.setViewportSize({ width: 1600, height: 1100 });
    await field('菜单名称').locator('input').fill(''); await open(); await page.getByRole('button', { name: '保存并继续', exact: true }).click();
    await page.getByText('请输入菜单名称', { exact: true }).waitFor(); assert.equal(saves, 1);
    await field('菜单名称').locator('input').fill('保存失败不能继续翻译'); failSave = true;
    await open(); await page.getByRole('button', { name: '保存并继续', exact: true }).click();
    await page.getByText('模拟保存失败', { exact: true }).waitFor(); assert.equal(saves, 2); assert.equal(translations.length, 3);
    await page.goto('http://localhost:5278/#/menus/edit/11');
    await page.waitForFunction(() => document.querySelector('input[placeholder="例如：产品中心"]')?.value === 'Drilling Rigs');
    assert.equal(await page.getByRole('button', { name: '翻译当前栏目', exact: true }).count(), 0);
    assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, saves, translations, output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
