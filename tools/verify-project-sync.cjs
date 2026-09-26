// Isolated UI check: no real FTP or panel requests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('../backend/node_modules/playwright');
const root = path.join(__dirname, 'ftp_publish_tool/public');
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://local').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.end(''); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; const runs = [];
    let state = {};
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()); let result = {};
      if (url.pathname === '/api/sync/config') result = { config: { project: { passwordSet: true }, sites: {} }, sites: [{ code: 'demo', name: '测试站点', isDefault: true }], sections: [{ id: 'seo', label: 'SEO 配置' }, { id: 'state', label: '状态' }] };
      if (url.pathname === '/api/sync/status') result = state;
      if (url.pathname === '/api/sync/plan') result = { plan: { ready: true, preset: route.request().postDataJSON().preset, toUploadCount: 0, files: [], counts: {}, notes: [] } };
      if (url.pathname === '/api/sync/run') { runs.push(route.request().postDataJSON()); state = { preset: 'project-code', phase: 'awaiting-build', finishedAt: new Date().toISOString(), checklist: { title: '代码已上传，等待上线' } }; }
      await route.fulfill({ json: result });
    });
    await page.route('**/deployment-environment', route => route.fulfill({ json: { environment: 'local' } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/sync.html`);
    await page.locator('#projectRunBtn').click();
    await page.getByRole('heading', { name: '代码已上传，等待上线' }).waitFor();
    assert.equal(runs.length, 1, 'unchanged source must still be deployable');
    assert.equal(await page.locator('#cardProjectConfig h2').innerText(), '② 项目配置同步');
    assert.equal(await page.locator('#cardManaged h2').innerText(), '③ 站点配置同步');
    assert.equal(await page.locator('input.section-check[value="state"]').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS three sections, unchanged-code retry, pending status, no UI errors');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
