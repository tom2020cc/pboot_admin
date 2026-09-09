// UI writes are mocked. Image GETs use an existing uploaded image on the running API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const asset = process.argv[2];
if (!asset) throw new Error('Pass an existing site-2 uploaded image path for the read-only display check.');
const filename = path.basename(asset);
const output = path.resolve(__dirname, '../tmp/editor-images-check');
const menus = [
  { id: 1, name: '新闻中心', parentId: 0, model: '2', code: 'pboot:cn:1', href: '/news' },
  { id: 2, name: '钻机', parentId: 0, model: '3', code: 'pboot:cn:2', href: '/rigs' },
];
const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
    await context.addInitScript(() => {
      localStorage.setItem('localToken', 'ui-fixture-only');
      localStorage.setItem('pbootActiveSiteId', '2');
    });
    const page = await context.newPage();
    const saved = {};
    const errors = [];
    let uploads = 0;
    let failNextImage = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost:5108/**', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.pathname.startsWith('/img-upload/file/')) {
        assert.equal(url.searchParams.get('siteId'), '2');
        assert.equal(req.headers().authorization, undefined);
        if (failNextImage) {
          failNextImage = false;
          return route.fulfill({ status: 503, headers, body: 'Temporary image failure' });
        }
        return route.continue();
      }
      let data;
      if (req.method() === 'OPTIONS') data = {};
      else if (url.pathname === '/auth/profile') data = { email: 'image-test@example.invalid' };
      else if (url.pathname === '/sites') data = [{ id: 2, name: '图片验证', code: 'test', enabled: true, isDefault: true }];
      else if (url.pathname === '/sites/current/languages') data = [{ code: 'zh-CN', name: '中文', acode: 'cn' }];
      else if (url.pathname === '/menus') data = menus;
      else if (url.pathname === '/product-fields') data = { siteId: 2, fields: [] };
      else if (url.pathname.endsWith('/translation-models')) data = [];
      else if (url.pathname.endsWith('/pboot-stats')) data = { localCount: 1, syncCount: 0, diff: -1 };
      else if (/^\/(products|news)\/thumbnail$/.test(url.pathname)) {
        assert.equal(req.method(), 'POST');
        assert.equal(req.headers()['x-pboot-site-id'], '2');
        assert.ok(req.postDataBuffer().includes(Buffer.from('name="image"')));
        uploads++;
        data = { url: filename, width: 500, height: 400 };
      }
      else if (url.pathname === '/img-upload/imgs') {
        assert.equal(req.method(), 'POST');
        assert.equal(req.headers()['x-pboot-site-id'], '2');
        assert.ok(req.postDataBuffer().includes(Buffer.from('name="imgArr"')));
        uploads++;
        data = [filename];
      } else if (/^\/(news|products)$/.test(url.pathname)) {
        const kind = url.pathname.slice(1);
        if (req.method() === 'POST') { saved[kind] = { ...req.postDataJSON(), id: 999 }; data = saved[kind]; }
        else data = saved[kind] ? [saved[kind]] : [];
      } else if (/^\/(news|products)\/999$/.test(url.pathname)) data = saved[url.pathname.split('/')[1]];
      else throw new Error(`Unexpected request: ${req.method()} ${url.pathname}`);
      await route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(data) });
    });
    const readyImages = async (selector, count) => {
      await page.waitForFunction(({ selector, count }) => {
        const images = [...document.querySelectorAll(selector)];
        return images.length === count && images.every(image => image.complete && image.naturalWidth > 0);
      }, { selector, count });
    };
    for (const [kind, title, category] of [['news', '新闻', '新闻中心'], ['products', '产品', '钻机']]) {
      await page.goto(`http://localhost:5278/#/${kind}/create`);
      await page.getByRole('heading', { name: `添加${title}`, exact: true }).waitFor();
      await page.locator('.entity-form .el-select').first().click();
      await page.getByRole('option', { name: `一级栏目 / ${category}`, exact: true }).click();
      await page.locator('.el-tab-pane:visible .el-input input').first().fill(`图片验证${title}`);
      failNextImage = kind === 'news';
      const coverInputs = page.locator('.thumb-upload input[type=file]');
      for (let index = 0; index < await coverInputs.count(); index++) await coverInputs.nth(index).setInputFiles(asset);
      if (kind === 'news') {
        await page.getByRole('button', { name: '重新加载图片' }).click();
      }
      await readyImages('.thumb-upload img', kind === 'news' ? 1 : 2);
      if (kind === 'products') {
        const carousel = page.locator('.carousel-upload input[type=file]');
        await carousel.setInputFiles(asset);
        await readyImages('.carousel-grid img', 1);
        await carousel.setInputFiles({ name: 'carousel-2.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(asset) });
        await readyImages('.carousel-grid img', 2);
      }
      assert.equal(await page.getByRole('button', { name: 'AI 补全图片 ALT', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'AI 优化中文 SEO', exact: true }).waitFor();
      await page.locator('.el-tab-pane:visible .el-input input').first().fill(`图片验证${title}`);
      const editor = page.locator('.el-tab-pane:visible .source-editor');
      await editor.locator('input[type=file]').setInputFiles({ name: 'detail "caption".jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(asset) });
      await editor.locator('.cm-content').getByText('/uploads/', { exact: false }).first().waitFor();
      await editor.locator('.el-switch').click();
      await readyImages('.preview-content img', 1);
      const alt = await editor.locator('.preview-content img').getAttribute('alt');
      assert.equal(alt, 'detail "caption".jpg');
      await page.getByRole('heading', { name: `添加${title}`, exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${kind}-create.png`) });
      await page.getByRole('button', { name: `新建${title}`, exact: true }).click();
      await page.waitForURL(`**/#/${kind}`);
      assert.equal(saved[kind].thumbnail, filename);
      assert.ok(saved[kind].content.includes(`/uploads/${filename}`));
      assert.ok(!saved[kind].content.includes('localhost'));
      if (kind === 'products') {
        assert.equal(saved[kind].largeImage, filename);
        assert.equal(saved[kind].carouselImages.length, 2);
      }
      await page.goto(`http://localhost:5278/#/${kind}/edit/999`);
      await page.reload();
      await readyImages('.thumb-upload img', kind === 'news' ? 1 : 2);
      if (kind === 'products') await readyImages('.carousel-grid img', 2);
      await page.locator('.el-tab-pane:visible .source-editor .el-switch').click();
      await readyImages('.preview-content img', 1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.thumb-upload').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'products-mobile.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, uploads, checks: ['news thumbnail', 'retry without losing draft', 'product thumbnail/large/carousel', 'body insertion and escaped ALT', 'portable saved URLs', 'reload edit forms', 'ALT-only removed'], output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
