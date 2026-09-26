const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), front = createRequire(path.join(root, 'frontend/package.json'));
const { chromium } = require('../backend/node_modules/playwright');
const output = path.join(root, '.cache-tutorial-update/folder-directory-check');
fs.mkdirSync(output, { recursive: true });

async function main() {
  const vite = await import(pathToFileURL(front.resolve('vite')).href);
  const createServer = vite.createServer || vite.default.createServer;
  const server = await createServer({ root: path.join(root, 'frontend'), server: { host: '127.0.0.1', port: 0 }, define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') } });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], directories = [], scans = [], imports = [];
    let failRoot = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('localToken', 'fixture-token'); if (!localStorage.getItem('pbootActiveSiteId')) localStorage.setItem('pbootActiveSiteId', '1'); });
    await page.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url()), endpoint = url.pathname.slice(4);
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const siteId = Number(req.headers()['x-pboot-site-id'] || 1), siteRoot = `/www/wwwroot/site-${siteId}`;
      let data;
      if (endpoint === '/sites') data = [1, 2].map(id => ({ id, name: `测试网站${id}`, code: `site-${id}`, enabled: true, isDefault: id === 1 }));
      else if (endpoint === '/sites/current/languages') data = [{ code: 'zh-CN', name: '中文', acode: 'cn' }];
      else if (endpoint === '/auth/profile') data = { email: 'fixture@example.invalid' };
      else if (endpoint === '/menus') data = [{ id: 5, name: '钻机', model: '3', code: 'pboot:cn:5', siteId, show: true }];
      else if (endpoint === '/products/translation-models') data = [];
      else if (endpoint === '/product-fields') data = { siteId, fields: [] };
      else if (endpoint === '/products/folder-import/directories') {
        assert.equal(Number(url.searchParams.get('siteId')), siteId);
        const directory = url.searchParams.get('directory') || siteRoot;
        directories.push({ siteId, directory });
        if (failRoot || directory.includes('outside')) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '只能浏览当前网站根目录及其子目录' }) });
        data = { siteId, siteName: `测试网站${siteId}`, rootPath: siteRoot, currentPath: directory, relativePath: directory.slice(siteRoot.length), parentPath: directory === siteRoot ? null : path.posix.dirname(directory), directories: directory === siteRoot ? [{ name: 'static', path: siteRoot + '/static' }] : directory.endsWith('/static') ? [{ name: 'Rigs 中文', path: siteRoot + '/static/Rigs 中文' }] : [] };
      } else if (endpoint === '/products/folder-import/scan') {
        scans.push({ ...req.postDataJSON(), siteId });
        data = { sourceDirectory: scans.at(-1).sourceDirectory, menuId: 5, menuName: '钻机', total: 1, importable: 1, blocked: 0, duplicates: 0, items: [{ modelName: 'WR400RC', relativePath: 'WR400RC', thumbnailImage: '0.jpg', thumbnailWillGenerate: true, largeImage: '00.jpg', carouselImages: ['1.jpg'], detailImages: [], parameterFiles: [], parameters: [{key:'custom:liftingForce',label:'提升力',unit:'T',value:'40',fieldName:'ext_param_lift_t',fieldLabel:'提升力（T）',create:true}], errors: [], warnings: [], parameterType: 'custom', duplicate: false }] };
      } else if (endpoint === '/products/folder-import') {
        imports.push({ ...req.postDataJSON(), siteId });
        data = { createdCount: 0, skippedCount: 1, failedCount: 0, failed: [] };
      } else { errors.push('Unexpected API ' + endpoint); return route.fulfill({ status: 404, body: 'Unexpected fixture request' }); }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/#/products/create`);
    try { await page.getByRole('button', { name: '文件夹批量导入', exact: true }).click(); }
    catch (error) { console.log(errors, await page.locator('body').innerText()); await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
    const dialog = page.getByRole('dialog', { name: '文件夹批量导入产品' });
    assert.equal(await dialog.getByRole('radio', { name: '按型号资料', exact: true }).isChecked(), true);
    await page.waitForFunction(() => document.querySelector('input[aria-label="产品资料目录"]')?.value === '/www/wwwroot/site-1');
    await dialog.getByText('本机后台目录', { exact: true }).waitFor();
    assert.match(await dialog.locator('[aria-label="目标网站栏目"]').innerText(), /测试网站1[\s\S]*钻机/);
    await dialog.getByRole('button', { name: '选择服务器子目录' }).click();
    await dialog.getByRole('button', { name: 'static', exact: true }).click();
    await dialog.getByRole('button', { name: 'Rigs 中文', exact: true }).click();
    await dialog.getByText('此目录没有子目录', { exact: true }).waitFor();
    await dialog.getByText('浏览中，未选用', { exact: true }).waitFor();
    assert.equal(await dialog.locator('[aria-label="当前导入目录"] [aria-current="location"]').innerText(), 'site-1');
    assert.equal(await dialog.locator('[aria-label="浏览位置"] [aria-current="location"]').innerText(), 'Rigs 中文');
    await dialog.getByRole('button', { name: '使用此目录', exact: true }).click();
    assert.equal(await dialog.locator('[aria-label="当前导入目录"] [aria-current="location"]').innerText(), 'Rigs 中文');
    await dialog.getByText('根目录下第 2 级', {exact: true}).waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: '产品资料目录', exact: true }).inputValue(), '/www/wwwroot/site-1/static/Rigs 中文');
    assert.equal(imports.length, 0); assert.equal(scans.length, 0);
    await dialog.getByRole('spinbutton', { name: '缩略图宽度', exact: true }).fill('800');
    await dialog.getByRole('spinbutton', { name: '缩略图高度', exact: true }).fill('600');
    await dialog.getByRole('button', { name: '扫描资料目录', exact: true }).click();
    await dialog.getByRole('button', { name: '导入 1 个产品', exact: true }).waitFor();
    await dialog.getByText('将新建独立字段并同步 PB：提升力（T） · ext_param_lift_t', {exact:true}).waitFor();
    assert.deepEqual(scans.at(-1), { sourceDirectory: '/www/wwwroot/site-1/static/Rigs 中文', menuId: 5, parameterType: 'auto', thumbnailWidth: 800, thumbnailHeight: 600, siteId: 1 });
    await dialog.getByRole('spinbutton', { name: '缩略图宽度', exact: true }).fill('640');
    await dialog.getByRole('spinbutton', { name: '缩略图宽度', exact: true }).press('Tab');
    assert.equal(await dialog.getByRole('button', { name: '导入 0 个产品', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: '扫描资料目录', exact: true }).click();
    await dialog.getByRole('button', { name: '导入 1 个产品', exact: true }).click();
    await page.getByText(/已有 0.jpg 保持不变，缺少时生成 640 × 600/).waitFor();
    assert.match(await page.locator('.folder-import-confirm').innerText(), /导入目录：\/www\/wwwroot\/site-1\/static\/Rigs 中文[\s\S]*目标网站：测试网站1[\s\S]*目标中文栏目：钻机/);
    await page.getByRole('button', { name: '确认导入', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.el-message')?.textContent.includes('导入完成'));
    assert.equal(imports[0].thumbnailWidth, 640); assert.equal(imports[0].thumbnailHeight, 600);
    assert.equal(imports[0].siteId, 1);
    // A browse error must not replace the manually entered source or a previous listing.
    await dialog.getByRole('textbox', { name: '产品资料目录', exact: true }).fill('/outside/materials');
    await dialog.getByText('网站根目录外', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '选择服务器子目录' }).click();
    await dialog.getByRole('alert').filter({ hasText: '只能浏览当前网站' }).waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: '产品资料目录', exact: true }).inputValue(), '/outside/materials');
    assert.equal(await dialog.getByRole('button', { name: '使用此目录', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: '使用当前网站根目录', exact: true }).click();
    await dialog.getByRole('button', { name: 'static', exact: true }).waitFor();
    await page.mouse.move(0, 0);
    await page.locator('.el-message').waitFor({ state: 'hidden' });
    await page.locator('.el-popper:visible').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(output, 'directory-desktop.png') });
    const desktopOverflow = await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 2);
    assert.equal(desktopOverflow, false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'directory-mobile.png') });
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 2), false, 'Mobile dialog overflow');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.site-switcher').getByRole('combobox').press('Enter');
    await page.getByRole('option', { name: /测试网站2/ }).click();
    await page.getByRole('button', { name: '文件夹批量导入', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="产品资料目录"]')?.value === '/www/wwwroot/site-2');
    assert.equal(directories.at(-1).siteId, 2);
    failRoot = true;
    await dialog.getByRole('button', { name: '使用当前网站根目录', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: '只能浏览当前网站' }).waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: '产品资料目录', exact: true }).inputValue(), '/www/wwwroot/site-2');
    assert.deepEqual(errors, []);
    console.log('PASS current-site root, subdirectory selection, read-only browse/scan, custom size payload, scan invalidation, failed-path preservation, site switch, desktop/mobile');
  } finally { await browser.close(); await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
