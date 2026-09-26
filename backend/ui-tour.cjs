const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'tmp', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5278';

const PAGES = [
  ['dashboard', '/#/'],
  ['sites', '/#/sites'],
  ['site-information', '/#/site-information'],
  ['site-resources', '/#/site-resources'],
  ['menus', '/#/menus'],
  ['news', '/#/news'],
  ['products', '/#/products'],
  ['product-fields', '/#/product-fields'],
  ['pages', '/#/pages'],
  ['videos', '/#/videos'],
  ['seo-content', '/#/seo-content'],
  ['uploads', '/#/uploads'],
  ['users', '/#/users'],
  ['deployment-tutorial', '/#/deployment-tutorial'],
  ['quotations', '/#/quotations'],
  ['brochures', '/#/brochures'],
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  const log = [];
  page.on('console', m => { if (m.type() === 'error') log.push('  [console] ' + m.text().replace(/\s+/g, ' ').slice(0, 220)); });
  page.on('pageerror', e => log.push('  [pageerror] ' + e.message.replace(/\s+/g, ' ').slice(0, 220)));
  page.on('response', r => { if (r.status() >= 400) log.push('  [http ' + r.status() + '] ' + r.url().replace(BASE, '').slice(0, 160)); });

  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[type="email"]', 'admin@qq.com').catch(() => {});
  await page.fill('input[type="password"]', 'Tom1993');
  await page.screenshot({ path: path.join(OUT, '00-login.png') });
  await page.click('button:has-text("登录")');
  await page.waitForTimeout(3000);
  console.log('after login URL:', page.url());
  if (page.url().includes('login')) {
    console.log('LOGIN FAILED. body:', (await page.locator('body').innerText()).slice(0, 400));
    await browser.close();
    return;
  }

  for (const [name, route] of PAGES) {
    log.length = 0;
    await page.goto(BASE + route, { waitUntil: 'networkidle' }).catch(e => log.push('  [goto] ' + e.message.slice(0, 120)));
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    console.log('\n=== ' + name + ' === ' + route);
    console.log('  text: ' + text.slice(0, 400));
    if (log.length) console.log(log.slice(0, 8).join('\n'));
  }
  await browser.close();
})();
