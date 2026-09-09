const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const initSqlJs = require('../backend/node_modules/sql.js');
const root = process.env.SHANBO_RIG_ROOT || path.resolve(__dirname, '../../shanbo-rig.c');
const base = process.env.SHANBO_RIG_URL || 'http://shanbo-rig.c';
const output = path.resolve(__dirname, '../artifacts/public-product-list');

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const SQL = await initSqlJs();
  const dbName = process.env.SHANBO_RIG_DB || '1412def6361bfd54fd4f519f81ba2d22.db';
  assert(dbName, 'PB database not found');
  const db = new SQL.Database(fs.readFileSync(path.join(root, 'data', dbName)));
  const result = db.exec("select acode,scode,pcode,filename,name from ay_content_sort where acode in ('cn','en') and mcode='3'")[0];
  const sorts = result.values.map(row => Object.fromEntries(result.columns.map((key, i) => [key, String(row[i])])));
  db.close();
  const browser = await chromium.launch({ headless: true });
  const reports = [];
  try {
    for (const lang of ['cn', 'en']) {
      const context = await browser.newContext({ viewport: { width: 1820, height: 1080 } });
      await context.addCookies([{ name: 'lg', value: lang, url: base }]);
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await context.newPage();
      const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
      const prefix = lang === 'cn' ? '' : 'en-';
      for (const name of ['Drilling-Rigs', 'Core-Drilling-Rig', 'Integrated-Core-Drilling-Rig', 'Solar-Pile-Driver', 'Drilling-Rig-Parts']) {
        const sort = sorts.find(s => s.acode === lang && s.filename === prefix + name);
        assert(sort, `Missing test category ${prefix + name}`);
        const response = await page.goto(`${base}/?${sort.filename}/`, { waitUntil: 'domcontentloaded' });
        assert(response.ok(), `${name} HTTP error`);
        await page.locator('.product-grid').waitFor();
        assert.equal(await page.locator('html').getAttribute('lang'), lang === 'cn' ? 'zh-CN' : 'en');
        assert(!/\{(?:pboot|sort|page):/.test(await page.locator('body').innerText()), `${name}: unparsed template`);
        const categoryData = await page.locator('.product-categories').evaluate(el => [...el.querySelectorAll('nav')].map(nav => [...nav.querySelectorAll('a')].map(a => ({ text: a.textContent.trim(), href: a.href, active: a.classList.contains('subcat-active') }))));
        assert(categoryData.every(row => row.length), `${name}: empty category row`);
        assert.equal(new Set(categoryData.map(row => row.map(a => a.href).join('|'))).size, categoryData.length, 'Duplicate navigation rows');
        for (const row of categoryData) for (const link of row) {
          assert(sorts.some(s => s.acode === lang && link.href.endsWith(`?${s.filename}/`)), 'Category points to wrong language: ' + link.href);
        }
        const children = sorts.filter(s => s.acode === lang && s.pcode === sort.scode);
        if (name === 'Integrated-Core-Drilling-Rig') {
          assert.equal(categoryData.length, 2, 'Leaf must retain two-level navigation');
          assert.equal(await page.locator('.sort-top-siblings .subcat-active').count(), 1);
          assert.equal(await page.locator('.sort-sibling-children [aria-current="page"]').count(), 1);
        }
        if (name === 'Drilling-Rig-Parts') assert.equal(categoryData.flat().length, children.length, 'All categories, including those beyond ten, must be shown');
        const cards = await page.locator('.rig-product-card').count();
        if (!cards) assert.equal(await page.locator('.product-empty').count(), 1, 'Empty state missing');
        if (cards) {
          assert.equal(await page.locator('.product-empty').count(), 0, 'Incorrect empty state');
          await page.locator('.rig-product-card').first().scrollIntoViewIfNeeded();
          await page.waitForFunction(() => [...document.querySelectorAll('.rig-product-card:nth-child(-n+5) img')].every(img => img.complete));
          const images = await page.locator('.rig-product-card:nth-child(-n+5) img').evaluateAll(list => list.map(img => ({ width: img.clientWidth, height: img.clientHeight, nw: img.naturalWidth, nh: img.naturalHeight, fit: getComputedStyle(img).objectFit })));
          assert(images.every(img => img.nw && img.nh && Math.abs(img.width / img.height - img.nw / img.nh) < .02), 'Product images must preserve their natural aspect ratio');
        }
        reports.push({ lang, category: name, rows: categoryData.length, categories: categoryData.map(row => row.length), cards });
        if (name === 'Integrated-Core-Drilling-Rig') {
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: path.join(output, `${lang}-desktop.png`) });
          if (cards) {
            const link = await page.locator('.product-model a').first().getAttribute('href');
            await page.locator('.product-model a').first().click();
            assert(page.url().endsWith(link), 'Product title did not open detail');
            await page.goBack({ waitUntil: 'domcontentloaded' });
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(350);
          for (const image of await page.locator('.rig-product-card img').all()) {
            await image.scrollIntoViewIfNeeded();
            await image.evaluate(img => img.decode());
          }
          await page.evaluate(() => scrollTo(0, 0));
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          assert(!overflow, `${lang}: mobile horizontal overflow`);
          await page.screenshot({ path: path.join(output, `${lang}-mobile.png`), fullPage: true });
          const sibling = page.locator('.sort-sibling-children a:not(.subcat-active)').first();
          if (await sibling.count()) {
            const link = await sibling.getAttribute('href'); await sibling.click();
            await page.waitForLoadState('domcontentloaded');
            assert(page.url().endsWith(link), 'Sibling navigation failed');
            assert.equal(await page.locator('.sort-sibling-children [aria-current="page"]').count(), 1);
          }
          await page.setViewportSize({ width: 1820, height: 1080 });
        }
      }
      assert.deepEqual(pageErrors, [], 'Public page JavaScript errors');
      await context.close();
    }
    console.log(JSON.stringify({ reports, screenshots: output }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
