// Isolated UI fixture: never connects to or writes a real FTP server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('../backend/node_modules/playwright');
const root = path.join(__dirname, 'ftp_publish_tool/public');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/site-context.js') { res.end(''); return; }
  const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const item = (name, directory = false, blocked = '') => ({ name, path: name, directory, size: 1024, modified: '2026-09-22T03:00:00Z', blocked });
    let started = false;
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()); let result = {};
      if (url.pathname === '/api/config') result = { config: { host: 'ftp.example.test', remoteRoot: '/htdocs', passwordSet: true }, site: { name: '测试站点', id: 1 }, navigation: [] };
      if (url.pathname === '/api/plan') result = { total: 0, totalSizeText: '0 B', groups: [], files: [] };
      if (url.pathname === '/api/files/local') result = { siteId: 1, root: 'E:/sites/example.test', path: url.searchParams.get('path') || '', items: url.searchParams.get('path') ? [{ ...item('index.html'), path: 'template/index.html' }] : [item('template', true), item('static', true), item('config', true, '数据库与环境配置默认保留'), item('data', true, '数据库与环境配置默认保留'), item('index.php')] };
      if (url.pathname === '/api/files/remote') result = { root: '/htdocs', path: '', items: [item('template', true), item('static', true), item('index.php')] };
      if (url.pathname === '/api/files/plan') {
        const body = route.request().postDataJSON(); assert.deepEqual(body.paths, ['template/index.html']); assert.equal(body.siteId, 1);
        result = { templateDependencyVersion: 1, dependencies: [], token: 'fixture-plan', siteId: 1, siteName: '测试站点', localRoot: 'E:/sites/example.test', target: 'ftp.example.test:21/htdocs', total: 1, totalSize: 1024, files: [{ relativePath: 'template/index.html', size: 1024 }], skipped: [], includeEnvironment: false };
      }
      if (url.pathname === '/api/files/upload') { assert.equal(route.request().postDataJSON().token, 'fixture-plan'); started = true; result = { started: true }; }
      if (url.pathname === '/api/upload/status') result = { siteId: 1, running: false, uploaded: started ? 1 : 0, total: 1, logs: [], finishedAt: started ? '2026-09-22' : '' };
      await route.fulfill({ json: result });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#fmLocalItems button').first().waitFor();
    assert.equal(await page.locator('#fmLocalItems input[disabled]').count(), 2);
    await page.locator('#fmRemoteRefresh').click();
    await page.locator('#fmRemoteItems button').first().waitFor();
    await page.locator('#fmLocalItems button').filter({ hasText: 'template' }).click();
    await page.getByRole('checkbox', { name: '选择 index.html', exact: true }).check();
    await page.locator('#fmPlan').click();
    await page.locator('#fmUpload').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#fmUpload').disabled);
    assert.match(await page.locator('#fmPlanSummary').innerText(), /ftp.example.test/);
    const output = path.resolve(__dirname, '../artifacts/file-browser-desktop.png'); fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.locator('#fileManager').screenshot({ path: output });
    await page.locator('#fmUpload').click();
    await page.waitForFunction(() => document.querySelector('#fmMessage').textContent.includes('文件传输完成'));
    assert.equal(started, true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('#fileManager').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    assert.deepEqual(errors, []);
    console.log('File-browser UI passed: protected rows, directory navigation, selection, plan, simulated upload, mobile width. Screenshot: ' + output);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
