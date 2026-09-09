// All API responses are fixtures: no paid translations or PB database writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, '../artifacts/menu-translations');
const languages = [
  { acode: 'cn', code: 'zh-CN', name: '中文' }, { acode: 'en', code: 'en', name: 'English' },
  { acode: 'id', code: 'id', name: 'Bahasa Indonesia' }, { acode: 'vi', code: 'vi', name: 'Tiếng Việt' },
  { acode: 'tr', code: 'tr', name: 'Türkçe' },
];
const translated = { id: 'Mesin bor sumur air', vi: 'Máy khoan giếng nước', tr: 'Su kuyusu sondaj makinesi' };
const menus = languages.map((lang, index) => ({
  id: index + 1, code: `pboot:${lang.acode}:${index * 100 + 1}`, name: lang.acode === 'vi' || lang.acode === 'en' ? 'Water Well Drilling Rig' : '水井钻机',
  parentId: 0, href: `/${lang.acode}-Water-Well-Rig`, icon: [], show: true, orderNum: 1,
}));

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(() => { localStorage.setItem('localToken', 'fixture-only'); localStorage.setItem('pbootActiveSiteId', '2'); });
    const page = await context.newPage();
    const errors = [], requests = [];
    let listReads = 0, heldRequest, release;
    const waitForRelease = () => new Promise(resolve => { release = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await page.route('http://localhost:5108/**', async route => {
      const req = route.request(), url = new URL(req.url()); let body = {}, status = 200;
      if (req.method() === 'OPTIONS') body = {};
      else if (url.pathname === '/auth/profile') body = { email: 'fixture@example.invalid' };
      else if (url.pathname === '/sites') body = [{ id: 2, name: '山铂钻机', enabled: true, isDefault: true }];
      else if (url.pathname === '/sites/current/languages') body = languages;
      else if (url.pathname === '/menus/translation-models') body = [{ value: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', available: true, operational: true, recommended: true, priority: 1 }];
      else if (url.pathname === '/menus' && req.method() === 'GET') { body = menus; listReads++; }
      else if (url.pathname === '/menus/translate-all' && req.method() === 'POST') {
        assert.equal(req.headers()['x-pboot-site-id'], '2');
        const payload = req.postDataJSON(); assert.equal(payload.model, 'deepseek-chat');
        assert.equal(payload.targetAcodes.length, 1);
        const acode = payload.targetAcodes[0]; requests.push(acode);
        if (requests.length === 1) { heldRequest = acode; await waitForRelease(); }
        if (acode === 'id' && requests.filter(code => code === 'id').length === 1) {
          body = { results: [], failures: [{ acode, message: '栏目翻译校验失败：仍含中文，未保存该语言' }] };
        } else {
          menus.find(menu => menu.code.startsWith(`pboot:${acode}:`)).name = translated[acode];
          body = { results: [{ acode, created: 0, updated: 1, translated: 1, skipped: 0, model: 'deepseek-chat' }], failures: [] };
        }
      } else { errors.push(`Unexpected API ${req.method()} ${url.pathname}`); status = 500; }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });
    });
    await page.goto('http://localhost:5278/?siteId=2#/menus');
    await page.locator('.el-radio-button').filter({ hasText: 'Bahasa Indonesia 1' }).click();
    await page.getByRole('button', { name: '一键翻译栏目', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '从中文翻译栏目', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('checkbox', { name: 'Bahasa Indonesia' }).isChecked(), true);
    assert.equal(await dialog.getByRole('checkbox', { name: 'English' }).isChecked(), false);
    await dialog.locator('.el-checkbox').filter({ hasText: 'Tiếng Việt' }).click();
    await dialog.locator('.el-checkbox').filter({ hasText: 'Türkçe' }).click();
    await dialog.getByRole('button', { name: '开始翻译', exact: true }).click();
    await page.getByRole('button', { name: '开始翻译', exact: true }).last().click();
    await page.waitForFunction(() => document.querySelector('.translation-results')?.textContent.includes('翻译中'));
    assert.equal(heldRequest, 'id');
    assert.equal(await page.getByRole('button', { name: '同步全部到网站', exact: true }).isDisabled(), true);
    assert.equal(await dialog.getByRole('checkbox', { name: 'English' }).isDisabled(), true);
    release();
    await page.waitForFunction(() => document.querySelector('.translation-results')?.textContent.includes('新增 0 个，更新 1 个') && document.querySelector('.el-progress__text')?.textContent.includes('100%'));
    assert.deepEqual(requests, ['id', 'vi', 'tr']);
    await dialog.getByText('仍含中文', { exact: false }).waitFor();
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
    await page.screenshot({ path: path.join(output, 'desktop-partial.png'), fullPage: true });
    await dialog.getByRole('button', { name: '重试失败语言', exact: true }).click();
    await page.getByRole('button', { name: '开始翻译', exact: true }).last().click();
    await page.waitForFunction(() => document.querySelector('.translation-results')?.textContent.includes('已保存'));
    assert.deepEqual(requests, ['id', 'vi', 'tr', 'id']);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    for (const lang of languages.filter(lang => translated[lang.acode])) {
      await page.locator('.el-radio-button').filter({ hasText: `${lang.name} 1` }).click();
      await page.locator('.menu-name').getByText(translated[lang.acode], { exact: true }).waitFor();
    }
    assert(listReads >= 5, 'list refreshed after each result, including failures');
    await page.locator('.el-radio-button').filter({ hasText: '中文 1' }).click();
    await page.locator('.menu-name').getByText('水井钻机', { exact: true }).waitFor();
    await page.locator('.el-radio-button').filter({ hasText: 'English 1' }).click();
    await page.locator('.menu-name').getByText('Water Well Drilling Rig', { exact: true }).waitFor();
    await page.getByRole('button', { name: '一键翻译栏目', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
    const box = await dialog.boundingBox(); assert(box.x >= 0 && box.x + box.width <= 391);
    const checkboxBoxes = await dialog.getByRole('checkbox').evaluateAll(inputs => inputs.map(el => {
      const label = el.closest('label').getBoundingClientRect(); return { x: label.x, right: label.right, bottom: label.bottom };
    }));
    assert(checkboxBoxes.every(rect => rect.x >= box.x && rect.right <= box.x + box.width));
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, requests, listReads, output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
