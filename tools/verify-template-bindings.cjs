// All admin API requests are mocked. No real site templates are written by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, '../artifacts/template-bindings');
const base = '/sites/current/template-bindings';
const binding = (lang, scode, menuId) => ({ sourceScode: scode, menuId, targetScode: scode, issue: '', references: [{ file: `${lang}/html/index.html`, lang, tag: 'nav', attribute: 'parent', scode, line: 31 }] });

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(() => { localStorage.setItem('localToken', 'fixture-only'); localStorage.setItem('pbootActiveSiteId', '2'); });
    const page = await context.newPage(); const errors = []; let saves = 0, previews = 0, applies = 0, failPreview = false;
    page.on('pageerror', error => errors.push(error.message));
    const data = {
      siteId: 2, siteName: '山铂钻机（测试）', revision: 'none', templateVersion: 'fixture-v1', fileCount: 42,
      warnings: ['动态栏目引用保持原样；本次不修改 PB 核心程序。'],
      groups: [{ id: 'cn:19', label: '岩芯钻机', cn: binding('cn', '19', 1), en: binding('en', '66', 2) }, { id: 'cn:5', label: '产品展示', cn: binding('cn', '5', 4), en: binding('en', '52', 5) }],
      menus: [
        { id: 1, lang: 'cn', scode: '19', name: '岩芯钻机', parentId: 4, model: '3' },
        { id: 2, lang: 'en', scode: '66', name: 'Core Drilling Rig', parentId: 5, model: '3' },
        { id: 3, lang: 'cn', scode: '81', name: '岩芯钻机新栏目', parentId: 4, model: '3' },
        { id: 4, lang: 'cn', scode: '5', name: '产品展示', parentId: 0, model: '3' },
        { id: 5, lang: 'en', scode: '52', name: 'Products', parentId: 0, model: '3' },
      ],
    };
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await page.route('http://localhost:5108/**', async route => {
      const req = route.request(), url = new URL(req.url()); let body = {}, status = 200;
      if (req.method() === 'OPTIONS') body = {};
      else if (url.pathname === '/auth/profile') body = { email: 'fixture@example.invalid' };
      else if (url.pathname === '/sites') body = [{ id: 2, name: data.siteName, enabled: true, isDefault: true }];
      else if (url.pathname === '/sites/current/languages') body = [{ code: 'zh-CN', acode: 'cn', name: '中文' }];
      else if (url.pathname === base) body = data;
      else if (url.pathname === base + '/save') {
        saves++; assert.equal(req.headers()['x-pboot-site-id'], '2'); data.revision = 'saved'; body = data;
      } else if (url.pathname === base + '/preview') {
        previews++; assert.equal(req.postDataJSON().bindings[0].cnMenuId, 3);
        if (failPreview) { status = 400; body = { message: 'PB 栏目缺失，请先同步栏目' }; }
        else body = { previewId: 'fixture-preview', siteName: data.siteName, changedFiles: 1, changedReferences: 1, files: [{ file: 'cn/html/index.html', changes: [{ line: 31, tag: 'nav', attribute: 'parent', before: '19', after: '81' }] }] };
      } else if (url.pathname === base + '/apply') {
        applies++; assert.deepEqual(req.postDataJSON(), { previewId: 'fixture-preview' });
        assert.equal(req.headers()['x-pboot-site-id'], '2');
        data.groups[0].cn = binding('cn', '81', 3); data.revision = 'applied'; data.templateVersion = 'fixture-v2';
        body = { changedFiles: 1, changedReferences: 1, backupPath: '/managed-sites/2/backups/template-bindings/fixture', message: '模板栏目已更新' };
      } else { errors.push('Unexpected API ' + url.pathname); status = 500; }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });
    });
    await page.goto('http://localhost:5278/#/template-bindings');
    await page.getByRole('combobox', { name: '岩芯钻机 中文 CN' }).waitFor();
    assert.equal(saves + applies + previews, 0, 'Opening page must be read-only');
    await page.getByRole('button', { name: '保存绑定', exact: true }).click();
    await page.getByText('绑定已保存，模板文件未修改', { exact: true }).waitFor(); assert.equal(saves, 1); assert.equal(applies, 0);
    await page.getByRole('combobox', { name: '岩芯钻机 中文 CN' }).click();
    await page.getByRole('option', { name: '产品展示 / 岩芯钻机新栏目 [81]', exact: true }).click();
    await page.getByText('未保存', { exact: true }).waitFor();
    await page.getByRole('button', { name: '预览更新', exact: true }).click();
    await page.getByRole('dialog').getByText('parent=81', { exact: true }).waitFor(); assert.equal(applies, 0);
    await page.screenshot({ path: path.join(output, 'preview.png') });
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); assert.equal(applies, 0);
    await page.getByRole('button', { name: '预览更新', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '备份并更新模板', exact: true }).click();
    await page.getByText('模板栏目已更新', { exact: true }).waitFor(); assert.equal(applies, 1);
    await page.getByText('原编码 81', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: '搜索栏目或模板文件' }).fill('岩芯');
    assert.equal(await page.locator('.binding-table .el-table__body-wrapper .el-table__row').count(), 1);
    await page.getByRole('textbox', { name: '搜索栏目或模板文件' }).fill('');
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
    await page.waitForFunction(() => !document.querySelector('.el-message'));
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    failPreview = true;
    await page.getByRole('button', { name: '预览更新', exact: true }).click();
    await page.getByText('PB 栏目缺失，请先同步栏目', { exact: true }).first().waitFor();
    assert.equal(applies, 1, 'Preview failure must not trigger template writes');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.el-aside').getBoundingClientRect().width < 70);
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
    await page.screenshot({ path: path.join(output, 'mobile.png') });
    const dimensions = await page.locator('.bindings-page').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert(dimensions.scroll <= dimensions.width + 2, JSON.stringify(dimensions));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, saves, previews, applies, output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
