// Browser fixtures only: never executes against a real database or server.
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
    let environment = 'local'; let state = {}; const runs = []; const dialogs = []; const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    await page.route('**/deployment-environment', route => route.fulfill({ json: { environment } }));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()); let result = {};
      if (url.pathname === '/api/sync/config') result = { currentSite: { id: 1, name: '测试站点' } };
      if (url.pathname === '/api/databases/inspect') {
        const b = route.request().postDataJSON();
        result = { token: b.scope, source: '/local/demo.db', online: { path: '/online/demo.db', name: 'demo.db', phpService: '/etc/init.d/php-fpm-82', affectedPhpSites: 2 } };
      }
      if (url.pathname === '/api/databases/run') { const body = route.request().postDataJSON(); runs.push(body); state = { scope: body.token, action: body.action, result: { path: '/online/new.db' }, finishedAt: new Date().toISOString() }; }
      if (url.pathname === '/api/databases/status') result = state;
      await route.fulfill({ json: result });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/databases.html?siteId=1`);
    for (const scope of ['manager', 'site']) {
      const card = page.locator(`[data-scope="${scope}"]`);
      await card.locator('[data-read]').click();
      await card.locator('[data-rename]').waitFor({ state: 'visible' });
      await card.locator('[data-name]').fill('new.db');
      await card.locator('[data-rename]').click();
      await page.getByRole('heading', { name: `${scope === 'manager' ? '管理后台数据库' : '当前 PB 网站数据库'}操作完成` }).waitFor();
    }
    assert.equal(runs.length, 2);
    assert.equal(runs[0].token, 'manager');
    assert.equal(runs[1].token, 'site');
    assert.equal(runs[1].allowPhpPause, true);
    assert.ok(dialogs[1].includes('2 个网站'));
    environment = 'baota'; await page.reload();
    await page.getByText('线上环境不显示本地同步操作，请从本地项目发起。').waitFor();
    assert.equal(await page.locator('#databaseCards').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS separate database actions, PHP maintenance notice, online buttons hidden');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
