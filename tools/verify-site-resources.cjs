// Mocked API UI regression. Does not remove, publish, or restore any real site file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, '../tmp/site-resources-check');
const entries = ['candidate', 'referenced', 'review', 'protected'].map((status, index) => ({
  path: `static/products/${status}.jpg`, kind: 'image', size: (index + 1) * 2048, modifiedAt: '2026-01-01T10:00:00Z', status,
  reason: ['未发现引用，仍需人工核对', '发现名称引用：PB 数据 ay_content', '目录或动态路径引用：template/cn/product.html', '最近 7 天创建或变更，暂时保护'][index],
}));
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(() => { localStorage.setItem('localToken', 'fixture-only'); localStorage.setItem('pbootActiveSiteId', '2'); });
    const page = await context.newPage();
    const errors = []; let moved = false; let restored = false; let cleans = 0; let restores = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost:5108/**', async route => {
      const req = route.request(), url = new URL(req.url()); let data;
      if (req.method() === 'OPTIONS') data = {};
      else if (url.pathname === '/auth/profile') data = { email: 'ui-test@example.invalid' };
      else if (url.pathname === '/sites') data = [{ id: 2, name: '山铂钻机（测试）', enabled: true, isDefault: true }];
      else if (url.pathname === '/sites/current/languages') data = [{ code: 'zh-CN', acode: 'cn', name: '中文' }];
      else if (url.pathname === '/sites/current/resources/scan') {
        assert.equal(req.headers()['x-pboot-site-id'], '2');
        data = { id: 'fixture-scan', siteId: 2, siteName: '山铂钻机（测试）', root: 'E:/phpstudy_pro/WWW/shanbo-rig.c', createdAt: '2026-09-05T10:00:00Z', entries, graceDays: 7, referenceSources: 1260 };
      } else if (url.pathname === '/sites/current/resources/clean') {
        assert.deepEqual(req.postDataJSON(), { scanId: 'fixture-scan', paths: ['static/products/candidate.jpg'] });
        assert.equal(req.headers()['x-pboot-site-id'], '2'); cleans++; moved = true;
        data = { id: 'fixture-batch', moved: 1, errors: [] };
      } else if (url.pathname === '/sites/current/resources/history') data = moved ? [{ id: 'fixture-batch', createdAt: '2026-09-05T10:10:00Z', entries: [{ path: 'static/products/candidate.jpg', state: restored ? 'restored' : 'moved', recoverable: !restored }] }] : [];
      else if (url.pathname === '/sites/current/resources/restore/fixture-batch') { restores++; restored = true; data = { restored: 1, errors: [] }; }
      else throw new Error(`Unexpected request: ${req.method()} ${url.pathname}`);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    });
    await page.goto('http://localhost:5278/#/site-resources');
    const clean = page.locator('#app').getByRole('button', { name: '移入隔离区', exact: true });
    assert.equal(await clean.isDisabled(), true);
    await page.getByRole('button', { name: '扫描资源', exact: true }).click();
    await page.getByText('static/products/candidate.jpg', { exact: true }).waitFor();
    assert.equal(await clean.isDisabled(), true);
    await page.locator('.resource-toolbar .el-select').click();
    await page.getByRole('option', { name: '全部资源', exact: true }).click();
    const rows = page.locator('.resource-table .el-table__body-wrapper .el-table__row');
    assert.equal(await rows.count(), 4);
    for (let i = 1; i < 4; i++) assert.equal(await rows.nth(i).getByRole('checkbox').isDisabled(), true);
    await rows.nth(0).locator('.el-checkbox').click();
    assert.equal(await clean.isEnabled(), true);
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    await clean.click();
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(cleans, 0);
    await clean.click();
    await page.getByRole('dialog').getByRole('button', { name: '移入隔离区', exact: true }).click();
    await page.getByText('fixture-batch', { exact: true }).waitFor();
    assert.equal(cleans, 1);
    await page.getByRole('button', { name: '恢复', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '恢复', exact: true }).click();
    await page.getByText('已恢复 1 项').waitFor();
    assert.equal(restores, 1);
    await page.screenshot({ path: path.join(output, 'history.png') });
    await page.getByRole('tab', { name: '扫描结果' }).click();
    await page.getByRole('button', { name: '扫描资源', exact: true }).click();
    await page.getByText('static/products/candidate.jpg', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.el-aside').getBoundingClientRect().width < 70);
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
    await page.waitForFunction(() => !document.querySelector('.el-message'));
    await page.screenshot({ path: path.join(output, 'mobile.png') });
    const dimensions = await page.locator('.resources-page').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width + 2, JSON.stringify(dimensions));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ['empty default selection', 'protected checkboxes disabled', 'confirmation cancellation', 'exact selected paths/site payload', 'quarantine history', 'restore', 'mobile overflow'], output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
