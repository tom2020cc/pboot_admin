// Fixture-only browser regression: all backend requests are intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, '../artifacts/menu-lifecycle');
const base = { publisher: 'admin', model: '3', listTemplate: 'productlist.html', detailTemplate: 'product.html',
  show: true, orderNum: 1, icon: [], thumbnail: '', largeImage: '', seoTitle: '', seoKeywords: '', seoDescription: '', sourceMenuId: 0 };
let menus = [
  { ...base, id: 1, parentId: 0, code: 'pboot:cn:1', name: '钻机', href: '/rigs', urlName: 'rigs' },
  { ...base, id: 11, parentId: 0, code: 'pboot:en:11', sourceMenuId: 1, name: 'Drilling Rigs', href: '/en-rigs', urlName: 'en-rigs' },
  { ...base, id: 882, parentId: 1, code: '', name: '未绑定旧栏目', href: '/legacy', urlName: 'legacy' },
];

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    await context.addInitScript(() => { localStorage.setItem('localToken', 'fixture-only'); localStorage.setItem('pbootActiveSiteId', '2'); });
    const page = await context.newPage(), errors = [], calls = { creates: 0, deletes: 0, restores: 0, pushes: 0 };
    page.on('pageerror', error => errors.push(error.message));
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await page.route('http://localhost:5108/**', async route => {
      const req = route.request(), url = new URL(req.url()); let body = {}, status = 200;
      const id = Number(url.pathname.split('/')[2]);
      if (req.method() === 'OPTIONS') body = {};
      else if (url.pathname === '/auth/profile') body = { email: 'fixture@example.invalid' };
      else if (url.pathname === '/sites') body = [{ id: 2, name: '山铂钻机', enabled: true, isDefault: true }];
      else if (url.pathname === '/sites/current/languages') body = [{ acode: 'cn', code: 'zh-CN', name: '中文' }, { acode: 'en', code: 'en', name: 'English' }];
      else if (url.pathname === '/menus/translation-models') body = [{ value: 'google-free', label: 'Google', provider: 'google', available: true, operational: true }];
      else if (url.pathname === '/menus/pboot-models') body = [{ value: '2', label: '新闻' }, { value: '3', label: '产品' }];
      else if (url.pathname === '/menus' && req.method() === 'GET') body = menus;
      else if (url.pathname === '/menus' && req.method() === 'POST') {
        const data = req.postDataJSON(); assert.equal(data.code, ''); assert.equal(data.model, '3'); assert.equal(data.parentId, 1);
        calls.creates++; body = { ...data, id: 900, code: 'pboot:cn:900', pbootSyncPending: true };
        menus.push(body);
      } else if (url.pathname.endsWith('/delete-preview')) body = { canDelete: true, reason: '', items: menus.filter(item => item.id === id || item.sourceMenuId === id).map(item => ({ ...item, acode: item.code.split(':')[1] || 'cn' })) };
      else if (url.pathname === '/menus/900' && req.method() === 'DELETE') {
        calls.deletes++; menus = menus.map(item => item.id === id || item.sourceMenuId === id ? { ...item, pendingDelete: true } : item);
      } else if (url.pathname === '/menus/900/restore') {
        calls.restores++; menus = menus.map(item => item.id === id || item.sourceMenuId === id ? { ...item, pendingDelete: false } : item);
      } else if (url.pathname === '/menus/900/pboot-sync') {
        calls.pushes++; menus = menus.filter(item => item.id !== id && item.sourceMenuId !== id);
        body = { acode: 'cn', scode: '900', deleted: 2, created: 0, updated: 0 };
      } else if (url.pathname === '/menus/911' && req.method() === 'GET') body = menus.find(item => item.id === 911);
      else { errors.push(`Unexpected API ${req.method()} ${url.pathname}`); status = 500; }
      await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    });
    const row = text => page.locator('.data-table .el-table__row').filter({ hasText: text });
    const field = label => page.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: new RegExp(`^${label}$`) }) });
    await page.goto('http://localhost:5278/?siteId=2#/menus');
    await row('未绑定旧栏目').getByText('未绑定，请编辑保存').waitFor();
    await page.getByRole('button', { name: '添加菜单', exact: true }).click();
    await field('菜单名称').locator('input').fill('坑道钻机测试');
    await field('菜单路径').locator('input').fill('/underground-test');
    await field('URL名称').locator('input').fill('underground-test');
    await field('上级菜单').locator('.el-select').click();
    await page.getByRole('option', { name: '钻机（作为子栏目）', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.el-form-item:has(input[placeholder="选择栏目内容类型"])') || document.body.innerText.includes('产品'));
    await page.screenshot({ path: path.join(output, 'create-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.el-aside').getBoundingClientRect().width < 70);
    const size = await page.locator('.entity-form').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert(size.scroll <= size.width + 2, JSON.stringify(size));
    await page.screenshot({ path: path.join(output, 'create-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: '新建菜单', exact: true }).click();
    await page.waitForURL('**/#/menus'); await row('坑道钻机测试').getByText('新增待同步').waitFor();
    assert.equal(calls.creates, 1);
    menus.push({ ...menus.find(item => item.id === 900), id: 911, parentId: 11, code: 'pboot:en:911', sourceMenuId: 900,
      name: 'Underground Rig', href: '/en-underground-test', urlName: 'en-underground-test' });
    await page.setViewportSize({ width: 1600, height: 1100 }); await page.reload();
    await row('坑道钻机测试').getByRole('button', { name: '删除', exact: true }).click();
    await page.getByText(/将标记删除 2 个关联栏目/).waitFor();
    await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(calls.deletes, 0);
    await row('坑道钻机测试').getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '标记待删除', exact: true }).click();
    await row('坑道钻机测试').getByRole('button', { name: '撤销删除', exact: true }).waitFor();
    assert.equal(calls.deletes, 1); assert.equal(calls.pushes, 0);
    await page.screenshot({ path: path.join(output, 'pending-delete.png'), fullPage: true });
    await row('坑道钻机测试').getByRole('button', { name: '撤销删除', exact: true }).click();
    await row('坑道钻机测试').getByRole('button', { name: '编辑', exact: true }).waitFor(); assert.equal(calls.restores, 1);
    await page.goto('http://localhost:5278/#/menus/edit/911');
    await page.waitForFunction(() => document.querySelector('input[placeholder="例如：产品中心"]')?.value === 'Underground Rig');
    assert.equal(await field('中文来源').locator('.el-select__wrapper.is-disabled').count(), 1);
    assert.equal(await field('上级菜单').locator('.el-select__wrapper.is-disabled').count(), 1);
    await page.goto('http://localhost:5278/#/menus');
    await row('坑道钻机测试').getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '标记待删除', exact: true }).click();
    await row('坑道钻机测试').getByRole('button', { name: '撤销删除', exact: true }).waitFor();
    await row('坑道钻机测试').getByRole('button', { name: '同步网站', exact: true }).click();
    await page.getByRole('button', { name: '开始同步', exact: true }).click();
    await row('坑道钻机测试').waitFor({ state: 'detached' });
    assert.deepEqual(menus.map(item => item.id), [1, 11, 882]); assert.equal(calls.pushes, 1); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, calls, output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
