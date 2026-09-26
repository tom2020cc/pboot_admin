const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(__dirname, '../backend')] }));
const guide = require('../frontend/src/content/deployment-guide.json');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const output = path.join(root, 'docs/tutorial-assets/baota-2026-09-11');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };

async function check() {
  const server = http.createServer((req, res) => {
    const file = path.resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname);
    const target = file === dist ? path.join(dist, 'index.html') : file;
    if (!target.startsWith(dist + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const requests = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      // All API traffic is mocked. The check cannot modify a real website.
      requests.push({ method: route.request().method(), path: url.pathname });
      const json = url.pathname.endsWith('/auth/profile') ? { email: 'tutorial-test@example.com' } : [];
      return route.fulfill({ status: 200, json, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/#/deployment-tutorial`);
    await page.waitForURL('**/#/login?redirect=**');
    await page.evaluate(() => localStorage.setItem('localToken', 'isolated-tutorial-test'));
    await page.reload();
    await page.goto(`${origin}/#/deployment-tutorial`);
    await page.getByRole('heading', { level: 1, name: '部署教程' }).waitFor();
    await page.locator('.step-check input').first().check();
    await page.reload();
    await page.getByRole('heading', { level: 1, name: '部署教程' }).waitFor();
    assert.equal(await page.locator('.step-check input').first().isChecked(), true);
    await page.getByRole('textbox', { name: '搜索教程' }).fill('BASIC 401');
    assert.ok(await page.locator('.chapter-link').count() > 0);
    await page.getByRole('textbox', { name: '搜索教程' }).fill('no-such-result-123');
    await page.getByRole('status').filter({ hasText: '没有匹配' }).waitFor();
    await page.getByRole('textbox', { name: '搜索教程' }).fill('');
    for (const chapter of guide.chapters) {
      await page.goto(`${origin}/#/deployment-tutorial?chapter=${chapter.id}`);
      await page.getByRole('heading', { level: 2, name: chapter.title, exact: true }).waitFor();
      const pictures = page.locator('.guide-reading .figure-image img');
      for (const picture of await pictures.all()) {
        await picture.scrollIntoViewIfNeeded();
        await picture.evaluate(image => image.decode());
        assert.ok(await picture.evaluate(image => image.naturalWidth > 0));
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Desktop overflow: ${chapter.id}`);
    }
    await page.goto(`${origin}/#/deployment-tutorial?chapter=tool-access`);
    await page.locator('.guide-chapter').waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, '66-tutorial-desktop-top.png') });
    await page.screenshot({ path: path.join(output, '66-tutorial-desktop.png'), fullPage: true });
    const expand = page.locator('.guide-reading .figure-toolbar button').first();
    await expand.click();
    await page.getByRole('button', { name: '放大截图', exact: true }).click();
    assert.ok(await page.locator('.image-controls').innerText().then(text => text.includes('125%')));
    await page.getByRole('button', { name: 'Close this dialog' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载完整 Markdown 教程' }).click();
    const download = await downloadPromise;
    assert.ok(download.suggestedFilename().endsWith('.md'));
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.waitForFunction(count => document.querySelectorAll('.guide-chapter').length === count, guide.chapters.length);
    await page.emulateMedia({ media: 'print' });
    await page.locator('.guide-reading .figure-image img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await page.pdf({ path: path.join(output, 'tutorial-print-check.pdf'), format: 'A4', printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/#/deployment-tutorial?chapter=pboot-nginx`);
    await page.getByRole('heading', { level: 2, name: 'PB 从 Apache 迁到 Nginx' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.el-aside').getBoundingClientRect().width <= 65);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, '67-tutorial-mobile-top.png') });
    await page.screenshot({ path: path.join(output, '67-tutorial-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 1 && element.getBoundingClientRect().width > 0).slice(0, 15).map(element => ({ tag: element.tagName, className: element.className, width: element.getBoundingClientRect().width })) }));
    assert.ok(overflow.scrollWidth <= overflow.width + 1, `Mobile overflow: ${JSON.stringify(overflow)}`);
    assert.deepEqual(errors, []);
    assert.ok(requests.every(request => ['GET', 'OPTIONS'].includes(request.method)));
    console.log(JSON.stringify({ chapters: guide.chapters.length, steps: guide.chapters.flatMap(item => item.steps).length, errors, result: 'PASS', screenshots: output }, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
check().catch(error => { console.error(error); process.exitCode = 1; });
