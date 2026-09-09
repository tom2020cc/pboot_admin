// Run against a local Vite server. Every API call is mocked; this never publishes to PB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, '../tmp/product-list-check');
const languages = ['zh-CN', 'en', 'es', 'fr', 'ru', 'ar', 'pt', 'id', 'tr', 'vi'];
const products = ['complete', 'partial', 'untranslated'].map((status, index) => ({
  id: index + 1, title: `CR${index + 1}00`, menuId: 1, show: true, orderNum: index,
  carouselImages: [], thumbnail: '', lang: 'zh-CN',
  translationProgress: { status, total: 9, completed: status === 'complete' ? 9 : status === 'partial' ? 6 : 0,
    completedLanguages: [], missing: status === 'complete' ? [] : (status === 'partial' ? ['id', 'tr', 'vi'] : languages.slice(1)).map(lang => ({ lang, fields: ['详情'] })) },
}));
const menus = [
  { id: 1, parentId: 0, code: 'pboot:cn:1', name: '钻机', href: '/rigs', model: '3' },
  { id: 2, parentId: 1, code: 'pboot:cn:2', name: '岩芯钻机', href: '/core', model: '3' },
  { id: 3, parentId: 0, code: 'pboot:en:3', name: 'Rigs', href: '/en-rigs', model: '3' },
];
const preview = { siteId: 2, siteName: '测试项目', menuId: 1, menuName: '钻机', totalProducts: 3,
  totalLanguages: 10, readyCount: 18, skipped: [{ productId: 2, title: 'CR200', lang: 'vi', reason: '缺少详情' }], blocked: [],
  created: 0, updated: 0, syncedCount: 0, backupPath: '', deleted: 0 };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(() => {
      localStorage.setItem('localToken', 'ui-test-fixture-only');
      localStorage.setItem('pbootActiveSiteId', '2');
    });
    const page = await context.newPage();
    const errors = [];
    const syncRequests = [];
    let blocked = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost:5108/**', async route => {
      const req = route.request();
      const url = new URL(req.url());
      let data;
      if (req.method() === 'OPTIONS') data = {};
      else if (url.pathname === '/auth/profile') data = { email: 'ui-test@example.invalid' };
      else if (url.pathname === '/sites') data = [{ id: 2, name: '测试项目', code: 'fixture', enabled: true, isDefault: true }];
      else if (url.pathname === '/sites/current/languages') data = languages.map(code => ({ code, name: code, acode: code === 'zh-CN' ? 'cn' : code }));
      else if (url.pathname === '/menus') data = menus;
      else if (url.pathname === '/products') data = products;
      else if (url.pathname === '/products/pboot-stats') data = { localCount: 3, syncCount: 0, diff: -3 };
      else if (url.pathname === '/products/translation-models') data = [];
      else if (url.pathname === '/products/pboot-scope/preview-all') {
        assert.equal(req.postDataJSON().menuId > 0, true);
        data = { ...preview, blocked: blocked ? [{ productId: 1, title: 'CR100', lang: 'en', reason: '对应栏目尚未写入 PB' }] : [] };
      } else if (url.pathname === '/products/pboot-scope/sync-all') {
        syncRequests.push(req.postDataJSON());
        assert.equal(req.headers()['x-pboot-site-id'], '2');
        data = { ...preview, syncedCount: 18, created: 8, updated: 10, backupPath: 'test-backup.db' };
      } else throw new Error(`Unexpected API request: ${req.method()} ${url.pathname}`);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: {
        'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*',
      } });
    });
    await page.goto(process.env.PRODUCT_LIST_URL || 'http://localhost:5278/#/products');
    await page.getByText('部分未翻译', { exact: true }).waitFor();
    assert.equal(await page.locator('.product-translation-status').count(), 3);
    await page.getByText('部分未翻译', { exact: true }).hover();
    await page.getByText('Bahasa Indonesia：缺少详情').waitFor();
    await page.locator('.progress-select').click();
    await page.getByRole('option', { name: '未完成翻译', exact: true }).click();
    assert.equal(await page.locator('.product-translation-status').count(), 2);
    await page.locator('.progress-select').click();
    await page.getByRole('option', { name: '已全部翻译', exact: true }).click();
    assert.equal(await page.locator('.product-translation-status').count(), 1);
    await page.locator('.progress-select').click();
    await page.getByRole('option', { name: '全部翻译状态', exact: true }).click();
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    await page.getByRole('button', { name: '一键同步到 PB', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: '同步全部语言', exact: true });
    assert.equal(await confirm.isDisabled(), true);
    await dialog.locator('.el-select').click();
    const options = page.getByRole('option');
    assert.equal(await options.filter({ hasText: 'Rigs' }).count(), 0);
    await page.getByRole('option', { name: '钻机', exact: true }).click();
    await dialog.getByText('个可同步版本').waitFor();
    await dialog.getByText('跳过 1 个内容未完整的语言版本').click();
    await dialog.getByText('CR200 / Tiếng Việt：缺少详情').waitFor();
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await page.screenshot({ path: path.join(output, 'scope.png') });
    await confirm.click();
    await dialog.getByText('同步完成：新增 8，更新 10，跳过 1 个语言版本').waitFor();
    assert.deepEqual(syncRequests, [{ menuId: 1 }]);
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    blocked = true;
    await page.getByRole('button', { name: '一键同步到 PB', exact: true }).click();
    await dialog.locator('.el-select').click();
    await page.getByRole('option', { name: '钻机', exact: true }).click();
    await dialog.getByText('栏目或 URL 检查未通过，本次不能同步').waitFor();
    assert.equal(await confirm.isDisabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.scrollIntoViewIfNeeded();
    const box = await dialog.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
    await page.screenshot({ path: path.join(output, 'mobile-scope.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ['status labels', 'missing languages', 'filters', 'Chinese-only category picker', 'sync payload/site context', 'result counts', 'blocked preflight', 'mobile modal'], output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
