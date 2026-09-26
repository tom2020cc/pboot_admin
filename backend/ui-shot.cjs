const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'tmp', 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message.slice(0, 300)));
  page.on('requestfailed', r => errors.push('[reqfail] ' + r.url() + ' :: ' + (r.failure() || {}).errorText));

  await page.goto('http://localhost:5278/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '01-entry.png'), fullPage: true });
  console.log('URL:', page.url());
  console.log('TITLE:', await page.title());
  console.log('--- visible text ---');
  console.log((await page.locator('body').innerText()).slice(0, 1200));
  console.log('--- errors ---');
  console.log(errors.join('\n') || 'none');
  await browser.close();
})();
