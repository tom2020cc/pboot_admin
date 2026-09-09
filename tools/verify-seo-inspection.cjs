// Exercise the real SEO UI with fixture reports and all API calls intercepted.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { addCategorySeoIssues, calculateSeoHealth } = require('./seo_publish_tool/server');
const issues = [];
addCategorySeoIssues(issues, { name: '水井钻机' }, 'https://example.test/rigs/', { acode: 'cn', recordKind: 'menu', recordId: '15', editUrl: 'http://localhost:5278/?siteId=2#/menus/edit/595' });
const report = { config: { siteName: '山铂钻机', localTestBaseUrl: 'http://fixture.test', siteBaseUrl: 'https://example.test' }, siteRoot: '/fixture', dbRelativePath: 'data/fixture.db', languages: [{ acode: 'cn', name: '中文', count: 1 }], types: [{ name: '产品', count: 1 }], urls: [], issues, stats: { menus: 1, contents: 0, urls: 0, issues: issues.length, highIssues: 0, health: calculateSeoHealth({ menus: 1, contents: 0 }, issues) } };
(async () => {
  const browser = await chromium.launch({ headless: true });
  const output = path.resolve(__dirname, '../artifacts/seo-inspection'); fs.mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
    const errors = []; let empty = false, reports = 0, writes = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') writes++;
      if (url.pathname === '/api/report') {
        reports++;
        assert.equal(url.searchParams.get('siteId'), '2');
        const data = empty ? { ...report, issues: [], stats: { menus: 0, contents: 0, urls: 0, issues: 0, highIssues: 0, health: calculateSeoHealth({ menus: 0, contents: 0 }, []) } } : report;
        await route.fulfill({ json: data });
      } else if (url.pathname === '/api/ai/status') {
        await route.fulfill({ json: { models: [], job: { state: 'idle' } } });
      } else {
        // A disconnected external-service panel must not prevent manual database checks.
        await route.fulfill({ status: 503, json: { message: 'Fixture external service unavailable' } });
      }
    });
    await page.goto('http://localhost:5388/audit.html?siteId=2');
    await page.locator('#issues .issue').first().waitFor();
    assert(reports >= 1, 'Initial inspection must not depend on external-service status');
    assert.equal(await page.locator('#auditRefreshBtn').isVisible(), true);
    assert.equal(await page.locator('input[value="image-alt"]').count(), 0);
    assert.equal(await page.locator('#issues .issue').count(), 3);
    assert.equal(new URL(await page.locator('.issue-edit').first().getAttribute('href')).searchParams.get('siteId'), '2');
    await page.locator('#languageFilter').selectOption('cn');
    await page.locator('#typeFilter').selectOption('栏目');
    await page.locator('#severityFilter').selectOption('medium');
    assert.equal(await page.locator('#issues .issue').count(), 1);
    assert((await page.locator('#issues').innerText()).includes('缺少 SEO 描述'));
    await page.locator('#severityFilter').selectOption('');
    await page.locator('#issueSearchInput').fill('category-seo-keywords-missing');
    assert.equal(await page.locator('#issues .issue').count(), 1);
    await page.locator('#issueSearchInput').fill('');
    await page.locator('#issues').screenshot({ path: path.join(output, 'category-issues.png') });
    empty = true;
    await page.locator('#auditRefreshBtn').click();
    await page.waitForFunction(() => document.getElementById('healthScore').textContent === '暂无数据');
    assert((await page.locator('#healthDetail').innerText()).includes('0 条记录'));
    assert.equal(await page.locator('#issues .issue').count(), 0);
    assert.equal(writes, 0); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, reports, writes, output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
