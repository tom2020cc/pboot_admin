const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { chromium } = require(path.join(root, 'backend/node_modules/playwright'));
const env = require(path.join(root, 'backend/node_modules/dotenv')).parse(fs.readFileSync(path.join(root, 'backend/.env')));
const { JwtService } = require(path.join(root, 'backend/node_modules/@nestjs/jwt'));
const initSql = require(path.join(root, 'backend/node_modules/sql.js'));

async function main() {
  const SQL = await initSql();
  const db = new SQL.Database(fs.readFileSync(path.join(root, 'backend/dev.sqlite')));
  const [id, email] = db.exec('SELECT id,email FROM user ORDER BY id LIMIT 1')[0].values[0];
  db.close();
  const token = new JwtService({ secret: env.JWT_SECRET }).sign({ sub: id, email }, { expiresIn: '10m' });
  const report = [];
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://localhost:5278/#/login');
      await page.locator('.environment-ribbon.local').waitFor();
      assert.match(await page.title(), /本地调试/);
      const loginOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(loginOverflow, false, `Login overflow at ${width}`);
      await page.screenshot({ path: path.join(root, `tmp/environment-login-${width}.png`) });
      await page.getByRole('link', { name: '配置差异与部署' }).click();
      await page.getByRole('heading', { name: '本地与宝塔配置', exact: true }).waitFor();
      assert.equal(await page.locator('.comparison-row').count(), 12);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Guide overflow at ${width}`);
      await page.screenshot({ path: path.join(root, `tmp/environment-guide-${width}.png`) });
      await page.getByRole('link', { name: '本地检查命令', exact: true }).click();
      await page.waitForTimeout(600);
      assert.ok(page.url().endsWith('#/environment-guide'), 'Chapter navigation must not break hash routing');
      if (width === 1440) {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: '下载配置与部署教程' }).click();
        const download = await pending;
        assert.ok(download.suggestedFilename().endsWith('.md'));
        assert.match(fs.readFileSync(await download.path(), 'utf8'), /APP_ENVIRONMENT=baota/);
      }
      assert.deepEqual(errors, []);
      report.push({ viewport: width, login: 'pass', guide: 'pass', horizontalOverflow: false, errors });
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addInitScript(value => { if (window === window.top) localStorage.setItem('localToken', value); }, token);
    const page = await context.newPage();
    for (const route of ['products', 'quotations', 'brochures']) {
      await page.goto(`http://localhost:5278/#/${route}`);
      await page.locator('.environment-ribbon.local').waitFor();
      await page.waitForTimeout(800);
      assert.ok(!page.url().includes('/login'));
      report.push({ route, environment: 'local' });
    }
    for (const [port, route] of [[5388, '/'], [5388, '/models-config.html'], [5389, '/'], [5389, '/server-security.html']]) {
      await page.goto(`http://localhost:${port}${route}`);
      await page.locator('#deployment-environment[data-environment="local"]').waitFor();
      assert.match(await page.locator('#deployment-environment').innerText(), /本地调试/);
      report.push({ port, route, environment: 'local' });
    }

    await page.route('**/project-identity', route => route.fulfill({ json: { project: 'pboot-admin-center', environment: 'baota' } }));
    await page.goto('http://localhost:5278/#/login');
    await page.locator('.environment-ribbon.baota').waitFor();
    assert.match(await page.locator('.environment-ribbon').innerText(), /本地页面 · 连接线上接口/);
    await page.screenshot({path: path.join(root, 'tmp/environment-baota-simulated.png')});
    await page.unroute('**/project-identity');
    await page.route('**/project-identity', route => route.fulfill({ json: { project: 'pboot-admin-center' } }));
    await page.reload();
    await page.getByRole('status').filter({hasText: '环境未确认'}).waitFor();
    report.push({ simulatedBaota: 'pass', legacyApiUnknown: 'pass' });
    await context.close();
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(root, 'tmp/environment-browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
