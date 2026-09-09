// Real thumbnail controllers with temporary files/in-memory records. Pass "news" for the news workflow.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const backend = createRequire(path.resolve(__dirname, '../backend/package.json'));
const sharp = backend('sharp');
const { Test } = backend('@nestjs/testing');
const { ValidationPipe } = backend('@nestjs/common');
const { ProductController } = backend('./dist/product/product.controller');
const { ProductService } = backend('./dist/product/product.service');
const { NewsController } = backend('./dist/news/news.controller');
const { NewsService } = backend('./dist/news/news.service');
const isNews = process.argv[2] === 'news';
const kind = isNews ? 'news' : 'product';
const routeBase = isNews ? 'news' : 'products';
const label = isNews ? '新闻' : '产品';
const recordTitle = isNews ? '客户来访' : 'WRT600';
const previewDimensions = isNews ? [[500, 400]] : [[500, 400], [800, 1200]];
const Controller = isNews ? NewsController : ProductController;
const Service = isNews ? NewsService : ProductService;
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, `../artifacts/${kind}-thumbnails`);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-thumbnails-ui-'));
const menus = [{ id: 2, name: isNews ? '新闻中心' : '钻机', parentId: 0, model: isNews ? '2' : '3', code: 'pboot:cn:2', href: isNews ? '/article' : '/rigs' }];
const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.join(root, 'static'), { recursive: true });
  const original = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#e84131' } }).jpeg().toBuffer();
  const asset = { name: 'original.jpg', mimeType: 'image/jpeg', buffer: original };
  let saved;
  const imported = [];
  const service = new Service({
    find: async () => saved ? [saved] : [],
    findOneBy: async where => saved?.id === where.id && where.siteId === 2 ? saved : null,
  }, {}, { findOne: async ({ where }) => where.id === '2' && where.siteId === 2 ? menus[0] : null }, {}, {
    protectBeforeDangerousSync: async () => ({ backupPath: 'fixture' }),
  }, { getPbootSiteRoot: () => root, getPbootPublicBaseUrl: () => 'https://fixture.invalid' }, {
    getImportDefinitions: async () => [], prepareFolderParameters: async () => ({}),
  });
  service.currentSiteId = async () => 2;
  service.create = async data => { const product = { ...data, id: 1000 + imported.length }; imported.push(product); return product; };
  const module = await Test.createTestingModule({ controllers: [Controller], providers: [{ provide: Service, useValue: service }] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  const endpoint = await app.getUrl();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(() => {
      localStorage.setItem('localToken', 'fixture-only');
      localStorage.setItem('pbootActiveSiteId', '2');
    });
    const page = await context.newPage();
    const errors = [];
    const uploaded = [];
    let genericUploads = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost:5108/**', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers, body: '' });
      if (url.pathname === `/${routeBase}/thumbnail` || url.pathname.startsWith(`/${routeBase}/folder-import`)) {
        assert.equal(req.headers()['x-pboot-site-id'], '2');
        const response = await route.fetch({ url: `${endpoint}${url.pathname}` });
        const data = await response.json();
        if (url.pathname === `/${routeBase}/thumbnail`) {
          assert.equal(response.status(), 201, JSON.stringify(data));
          assert.ok(req.postDataBuffer().includes(Buffer.from('name="image"')));
          if (uploaded.length) assert.ok(req.postDataBuffer().includes(Buffer.from(`name="${isNews ? 'newsId' : 'productId'}"`)));
          uploaded.push(data.url);
        }
        return route.fulfill({ response, headers: { ...response.headers(), ...headers } });
      }
      if (url.pathname === '/sites/static-file') {
        assert.equal(url.searchParams.get('siteId'), '2');
        const target = path.resolve(root, 'static', url.searchParams.get('path'));
        assert.ok(target.startsWith(path.join(root, 'static') + path.sep));
        return route.fulfill({ contentType: 'image/jpeg', headers, body: fs.readFileSync(target) });
      }
      if (url.pathname.startsWith('/img-upload/file/')) return route.fulfill({ contentType: 'image/jpeg', headers, body: original });
      let data;
      if (url.pathname === '/auth/profile') data = { email: 'fixture@example.invalid' };
      else if (url.pathname === '/sites') data = [{ id: 2, name: '缩略图验证', enabled: true, isDefault: true }];
      else if (url.pathname === '/sites/current/languages') data = [{ code: 'zh-CN', name: '中文', acode: 'cn' }];
      else if (url.pathname === '/menus') data = menus;
      else if (url.pathname === '/product-fields') data = { siteId: 2, fields: [] };
      else if (url.pathname.endsWith('/translation-models')) data = [];
      else if (url.pathname.endsWith('/pboot-stats')) data = { localCount: 1, syncCount: 0, diff: -1 };
      else if (url.pathname === '/img-upload/imgs') {
        assert.ok(req.postDataBuffer().includes(Buffer.from('name="imgArr"')));
        genericUploads++;
        data = ['original.jpg'];
      } else if (url.pathname === `/${routeBase}`) {
        if (req.method() === 'POST') { saved = { ...req.postDataJSON(), id: 999 }; data = saved; }
        else data = saved ? [saved] : [];
      } else if (url.pathname === `/${routeBase}/999`) {
        if (req.method() === 'PATCH') saved = { ...req.postDataJSON(), id: 999 };
        data = saved;
      } else throw new Error(`Unexpected request: ${req.method()} ${url.pathname}`);
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(data) });
    });
    const readyImages = async count => page.waitForFunction(count => {
      const images = [...document.querySelectorAll('.thumb-upload img')];
      return images.length === count && images.every(image => image.complete && image.naturalWidth > 0);
    }, count);
    const dimensions = () => page.locator('.thumb-upload img').evaluateAll(images => images.map(image => [image.naturalWidth, image.naturalHeight]));

    await page.goto(`http://localhost:5278/#/${routeBase}/create`);
    await page.getByRole('heading', { name: `添加${label}`, exact: true }).waitFor();
    await page.locator('.entity-form .el-select').first().click();
    await page.getByRole('option', { name: `一级栏目 / ${menus[0].name}`, exact: true }).click();
    const coverInputs = page.locator('.thumb-upload input[type=file]');
    await coverInputs.first().setInputFiles(asset);
    await page.getByText(isNews ? '请先填写中文新闻标题，再上传缩略图' : '请先填写中文产品型号 / 标题，再上传缩略图', { exact: true }).waitFor();
    assert.equal(uploaded.length, 0);
    await page.locator('.el-tab-pane:visible .el-input input').first().fill(recordTitle);
    await coverInputs.first().setInputFiles({ ...asset, name: 'new-photo.jpg' });
    await readyImages(1);
    assert.deepEqual(await dimensions(), [[500, 400]]);
    assert.ok(uploaded[0].startsWith(`/static/codex/${kind}-images/2/${encodeURIComponent(recordTitle)}/thumbnail-`));
    if (isNews) {
      const editor = page.locator('.el-tab-pane:visible .source-editor');
      await editor.locator('input[type=file]').setInputFiles(asset);
      await editor.locator('.cm-content').getByText('/uploads/', { exact: false }).first().waitFor();
      await editor.locator('.el-switch').click();
      await page.waitForFunction(() => document.querySelector('.preview-content img')?.naturalWidth === 800);
      assert.equal(await page.locator('.preview-content img').evaluate(image => image.naturalHeight), 1200);
    } else {
      await coverInputs.nth(1).setInputFiles(asset);
    }
    await readyImages(previewDimensions.length);
    assert.deepEqual(await dimensions(), previewDimensions);
    await page.getByRole('heading', { name: `添加${label}`, exact: true }).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('.el-message').length === 0);
    await page.screenshot({ path: path.join(output, 'create-desktop.png') });
    await page.getByRole('button', { name: `新建${label}`, exact: true }).click();
    await page.waitForURL(`**/#/${routeBase}`);
    assert.equal(saved.thumbnail, uploaded[0]);
    if (isNews) assert.ok(saved.content.includes('/uploads/original.jpg'));
    else assert.equal(saved.largeImage, 'original.jpg');
    await page.goto(`http://localhost:5278/#/${routeBase}/edit/999`);
    await readyImages(previewDimensions.length);
    assert.deepEqual(await dimensions(), previewDimensions);
    const modelDirectory = path.join(root, 'static', 'codex', `${kind}-images`, '2', recordTitle);
    fs.writeFileSync(path.join(modelDirectory, '0.jpg'), original);
    const replacement = page.waitForResponse(response => response.url().endsWith(`/${routeBase}/thumbnail`) && response.request().method() === 'POST');
    await page.locator('.thumb-upload input[type=file]').first().setInputFiles({ ...asset, name: 'replacement.jpg' });
    assert.equal((await replacement).status(), 201);
    await page.waitForFunction(url => document.querySelector('.thumb-upload input:not([type=file])')?.value === url, uploaded[1]);
    assert.equal(uploaded.length, 2);
    assert.notEqual(uploaded[0], uploaded[1]);
    await readyImages(previewDimensions.length);
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.waitForURL(`**/#/${routeBase}`);
    assert.equal(saved.thumbnail, uploaded[1]);
    assert.deepEqual(fs.readFileSync(path.join(modelDirectory, '0.jpg')), original);
    await page.goto(`http://localhost:5278/#/${routeBase}/edit/999`);
    await readyImages(previewDimensions.length);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.thumb-upload').first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('.el-message').length === 0);
    await page.locator('.thumb-upload').first().screenshot({ path: path.join(output, 'edit-mobile.png') });

    const source = path.join(root, 'static', 'Imported Core');
    const importedDirectory = path.join(source, 'CR600P');
    fs.mkdirSync(importedDirectory, { recursive: true });
    fs.writeFileSync(path.join(importedDirectory, '1.jpg'), original);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`http://localhost:5278/#/${routeBase}/create`);
    await page.getByRole('button', { name: '文件夹批量导入', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('.el-input input').first().fill(source);
    await dialog.locator('.el-select').click();
    await page.getByRole('option', { name: menus[0].name, exact: true }).last().click();
    await dialog.getByRole('button', { name: '扫描资料目录', exact: true }).click();
    await dialog.getByText('待生成', { exact: true }).waitFor();
    assert.equal(fs.existsSync(path.join(importedDirectory, '0.jpg')), false);
    await page.screenshot({ path: path.join(output, 'scan-preview.png') });
    await dialog.getByRole('button', { name: isNews ? '导入 1 篇新闻' : '导入 1 个产品', exact: true }).click();
    await page.getByRole('button', { name: '确认导入', exact: true }).click();
    await page.getByText(/导入完成/).last().waitFor();
    assert.equal(imported.length, 1);
    assert.equal(imported[0].thumbnail, '/static/Imported%20Core/CR600P/0.jpg');
    const metadata = await sharp(path.join(importedDirectory, '0.jpg')).metadata();
    assert.deepEqual([metadata.width, metadata.height], [500, 400]);
    assert.equal(genericUploads, 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, kind, thumbnailUploads: uploaded.length, genericUploads, imported: imported.length, output }));
  } finally {
    await browser.close();
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'product-thumbnails-ui-')));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
