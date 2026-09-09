// Isolated browser/API fixtures: never save products, publish to PB, or call paid services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { BrochurePdfService } = require('../backend/dist/brochure/brochure-pdf.service');
const output = path.resolve(__dirname, '../artifacts/brochures');
const fixture = process.env.BROCHURE_TEST_IMAGE;
if (!fixture) throw new Error('Set BROCHURE_TEST_IMAGE to a local JPEG fixture');
const jpeg = fs.readFileSync(fixture);
const landscape = process.env.BROCHURE_TEST_LANDSCAPE ? fs.readFileSync(process.env.BROCHURE_TEST_LANDSCAPE) : jpeg;
const base = { menuId: 10, thumbnail: '/static/thumb.jpg', largeImage: '/static/main.jpg', carouselImages: ['/static/main.jpg', '/static/detail.jpg'], carouselTitles: ['整机外观', '设备细节'], description: '', summary: '用于岩芯钻探的设备资料，具体配置以双方确认为准。', subtitle: '一体式岩芯钻机', content: '<table><tr><td>发动机型号</td><td>测试配置</td></tr></table>' };
const products = [
  { ...base, id: 223, title: 'CR1200I', parameterRows: [{ name: '钻探深度', value: '1200', unit: 'm' }, { name: '取芯能力', value: 'BQ 1600 / NQ 1200 / HQ 700', unit: 'm' }, { name: '提拔力', value: '160', unit: 'kN' }, { name: '内部参考价格', value: '9999999', unit: 'USD' }] },
  { ...base, id: 224, title: 'WRT600', subtitle: '水井钻机', parameterRows: [{ name: '钻探深度', value: '600', unit: 'm' }, { name: '钻孔直径', value: '105-450', unit: 'mm' }, { name: '回转扭矩', value: '12,000', unit: 'N.m' }] },
];
const profile = { siteId: 2, siteName: '山铂钻机', publicBaseUrl: 'http://shanbo-rig.c', companyName: 'SHANBO', logoUrl: '', website: 'https://example.invalid', contactName: '产品顾问', phone: '+86 000 0000 0000', whatsapp: '', email: 'demo@example.invalid' };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1660, height: 1100 } });
    await context.addInitScript(() => {
      if (window === window.top) {
        try { localStorage.setItem('localToken', 'fixture-only'); if (!localStorage.getItem('pbootActiveSiteId')) localStorage.setItem('pbootActiveSiteId', '2'); } catch { /* about:blank has no storage origin */ }
      }
      window.print = () => { window.__printed = true; };
    });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    let id = 0, uploads = 0, failedImage = false, pdfExports = 0;
    const pdfService = new BrochurePdfService();
    const saved = new Map();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await context.route('http://localhost:5108/**', async route => {
      const req = route.request(), url = new URL(req.url());
      let body = {}, status = 200;
      if (req.method() === 'OPTIONS') body = {};
      else if (url.pathname === '/sites') body = [{ id: 2, name: '山铂钻机', enabled: true, isDefault: true }, { id: 3, name: '其他站点', enabled: true }];
      else if (url.pathname === '/sites/current/languages') body = [{ acode: 'cn', code: 'zh-CN', name: '中文' }];
      else if (url.pathname === '/sites/current/profile') body = profile;
      else if (url.pathname === '/menus') body = [{ id: 10, name: '岩芯钻机', parentId: 0, code: 'pboot:cn:10' }];
      else if (url.pathname === '/products') body = products;
      else if (/^\/products\/\d+$/.test(url.pathname)) { assert.equal(req.method(), 'GET'); body = products.find(p => p.id === Number(url.pathname.split('/').pop())); }
      else if (url.pathname === '/img-upload/imgs') { assert.equal(req.headers()['x-pboot-site-id'], '2'); uploads++; body = [`fixture-${uploads}.jpg`]; }
      else if (url.pathname === '/sites/static-file' || url.pathname.startsWith('/img-upload/file/')) {
        assert.equal(url.searchParams.get('siteId'), '2');
        const bytes = url.searchParams.get('path') === 'detail.jpg' ? landscape : jpeg;
        await route.fulfill({ status: failedImage ? 404 : 200, contentType: failedImage ? 'text/plain' : 'image/jpeg', body: failedImage ? 'missing' : bytes, headers }); return;
      } else if (url.pathname === '/brochures/export-pdf') {
        assert.equal(req.headers()['x-pboot-site-id'], '2');
        const fields = await new Request(req.url(), { method: 'POST', headers: req.headers(), body: req.postDataBuffer() }).formData();
        const html = await fields.get('document').text();
        fs.writeFileSync(path.join(output, 'pdf-source.html'), html);
        assert(!html.includes('fixture-only'));
        const pdf = await pdfService.render(html); pdfExports++;
        await route.fulfill({ contentType: 'application/pdf', body: pdf, headers }); return;
      } else if (url.pathname.startsWith('/brochures')) {
        assert.equal(req.headers()['x-pboot-site-id'], '2');
        const key = Number(url.pathname.split('/')[2]);
        if (req.method() === 'POST' || req.method() === 'PATCH') {
          const data = req.postDataJSON().data;
          const row = { id: key || ++id, title: data.title, itemCount: data.items.length, data, createTime: new Date().toISOString(), updateTime: new Date().toISOString() };
          saved.set(row.id, row); body = row;
        } else if (req.method() === 'DELETE') { saved.delete(key); body = { id: key }; }
        else body = key ? saved.get(key) : [...saved.values()].map(({ data, ...row }) => row);
      } else { errors.push(`Unexpected API ${req.method()} ${url.pathname}`); status = 500; }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });
    });
    const page = await context.newPage();
    await page.goto('http://localhost:5278/?siteId=2#/brochures');
    await page.getByRole('button', { name: '从产品库导入', exact: true }).waitFor();
    await page.getByRole('button', { name: '从产品库导入', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '从产品库导入' });
    await dialog.getByText('CR1200I', { exact: true }).waitFor();
    await dialog.locator('thead .el-checkbox').click();
    await dialog.getByRole('button', { name: '导入 2 个产品' }).click();
    await page.getByRole('textbox', { name: '型号 / 名称', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '参数值 2', exact: true }).inputValue(), 'BQ 1600 / NQ 1200 / HQ 700');
    assert.equal(await page.locator('.spec-row').count(), 4, 'internal price must not be imported');
    await page.getByRole('textbox', { name: '资料标题', exact: true }).fill('钻机产品介绍 · 客户资料');
    await page.getByRole('textbox', { name: '参数值 2', exact: true }).fill('BQ 1600 / NQ 1200 / HQ 700 / 自定义测试');
    await page.getByRole('textbox', { name: '产品特点', exact: true }).fill('可按项目需求调整配置\n参数与图片独立编辑');
    await page.getByRole('button', { name: '添加参数', exact: true }).click();
    await page.getByRole('textbox', { name: '参数名称 5', exact: true }).fill('自定义参数');
    await page.getByRole('textbox', { name: '参数值 5', exact: true }).fill('可编辑字符串');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '添加图片', exact: true }).click();
    await (await chooser).setFiles({ name: 'customer.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await page.waitForFunction(() => document.querySelectorAll('.image-item').length === 4);
    await page.getByRole('textbox', { name: '图片说明 4', exact: true }).fill('自定义产品图片');
    await page.getByRole('button', { name: '图片前移', exact: true }).last().click();
    await page.getByRole('button', { name: '保存资料', exact: true }).click();
    await page.getByText('资料已保存', { exact: true }).waitFor();
    assert.equal(saved.size, 1);
    assert.equal(saved.get(1).data.items[0].images[2].src, 'fixture-1.jpg');
    assert.equal(saved.get(1).data.items[0].specs[1].value.includes('自定义测试'), true);
    assert.equal(products[0].parameterRows[1].value.includes('自定义测试'), false);
    await page.getByRole('button', { name: '另存为', exact: true }).click();
    await page.getByText('已另存为新资料', { exact: true }).waitFor();
    assert.equal(saved.size, 2);
    await page.reload();
    await page.getByRole('textbox', { name: '型号 / 名称', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '资料标题', exact: true }).inputValue(), saved.get(2).title);
    await page.waitForFunction(() => [...document.querySelectorAll('.image-item img')].every(i => i.complete && i.naturalWidth > 0));
    await page.locator('iframe[title="产品介绍预览"]').scrollIntoViewIfNeeded();
    await page.frameLocator('iframe[title="产品介绍预览"]').locator('body[data-pagination-state="ready"]').waitFor();
    await page.screenshot({ path: path.join(output, 'editor-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 2, `mobile overflow ${overflow}`);
    await page.screenshot({ path: path.join(output, 'editor-mobile.png'), fullPage: true });
    await page.locator('.el-radio-button').filter({ hasText: /^预览$/ }).click();
    await page.locator('iframe[title="产品介绍预览"]').scrollIntoViewIfNeeded();
    await page.frameLocator('iframe[title="产品介绍预览"]').getByRole('heading', { name: 'CR1200I', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'preview-mobile.png') });
    await page.setViewportSize({ width: 1660, height: 1100 });
    const downloadPromise = page.waitForEvent('download', { timeout: 105000 });
    await page.getByRole('button', { name: '下载 HTML', exact: true }).click();
    const download = await downloadPromise.catch(async error => {
      console.log('EXPORT DIAGNOSTICS', await page.locator('.workspace > .el-alert').allTextContents(), errors);
      for (const frame of page.frames()) console.log('FRAME', await frame.evaluate(() => ({ state: document.body?.dataset.paginationState, pages: document.querySelectorAll('.pagedjs_page').length, load: document.querySelector('.load-state')?.textContent })).catch(() => 'gone'));
      throw error;
    });
    const htmlPath = path.join(output, 'product-introduction.html');
    await download.saveAs(htmlPath);
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert(html.includes('data:image/jpeg;base64,'));
    assert(!html.includes('localhost:5108'));
    assert(!html.includes('fixture-only'));
    assert(!html.includes('>9999999'));
    const pdfDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
    await (await pdfDownloadPromise).saveAs(path.join(output, 'server-product-introduction.pdf'));
    assert.equal(pdfExports, 1);
    assert.equal(await page.evaluate(() => window.__printed === true), false, 'no OS print dialog');
    const utilityChecks = await page.evaluate(async () => {
      const m = await import('/src/utils/brochure.ts');
      const pagination = await import('/src/utils/brochure-pagination.ts');
      const draft = m.newBrochure(); draft.title = '<script>window.HACKED=1</script>';
      const item = m.newBrochureProduct(); item.title = '<img src=x onerror=alert(1)>'; item.description = '</script><script>alert(1)</script>'; item.images = [{ src: 'javascript:alert(1)', caption: 'bad' }]; draft.items = [item];
      const text = m.brochureHtml(draft);
      let rejected = false; try { await m.portableBrochure(draft, '', () => {}); } catch { rejected = true; }
      draft.companyName = '</style><img src=x onerror=alert(1)>'; item.images = [];
      const token = crypto.randomUUID();
      const frozen = await pagination.paginateForExport(m.brochureHtml(draft, false, token), token);
      const parsed = new DOMParser().parseFromString(frozen.html, 'text/html');
      const frozenSafe = !parsed.querySelector('img[onerror]') && parsed.querySelectorAll('script').length === 1;
      return { safe: !text.includes('<img src=x') && !text.includes('<script>window.HACKED'), frozenSafe, rejected, unsafe: m.brochureImageUrl('data:image/svg+xml,<svg/>'), external: m.brochureImageUrl('https://other.invalid/static/a.jpg', 'http://shanbo-rig.c'), invalidDraft: m.isBrochureDraft({ version: 1, items: [null] }) };
    });
    assert.deepEqual(utilityChecks, { safe: true, frozenSafe: true, rejected: true, unsafe: '', external: 'https://other.invalid/static/a.jpg', invalidDraft: false });
    failedImage = true;
    await page.getByRole('button', { name: '下载 HTML', exact: true }).click();
    await page.locator('.workspace > .el-alert').filter({ hasText: '图片未能导出' }).waitFor();
    failedImage = false;
    await page.locator('.el-radio-button').filter({ hasText: /^编辑与预览$/ }).click();
    await page.getByRole('button', { name: '新建', exact: true }).click();
    await page.getByText('暂无产品', { exact: true }).waitFor();
    await page.getByRole('button', { name: '已保存资料', exact: true }).click();
    await page.getByRole('button', { name: '打开资料', exact: true }).first().click();
    await page.getByRole('textbox', { name: '型号 / 名称', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '参数值 2', exact: true }).inputValue(), saved.get(1).data.items[0].specs[1].value);
    await page.getByRole('button', { name: '已保存资料', exact: true }).click();
    await page.getByRole('button', { name: '删除资料', exact: true }).last().click();
    await page.locator('.el-message-box').getByRole('button', { name: '确定', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.el-drawer tbody tr').length === 1);
    assert.equal(saved.size, 1);
    assert.deepEqual(errors, []);

    // Verify the actual standalone artifact offline and the print layout, not just a UI toast.
    const offline = await browser.newContext({ viewport: { width: 1200, height: 1100 } });
    await offline.route(/^https?:/, route => route.abort());
    const documentPage = await offline.newPage();
    await documentPage.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
    await documentPage.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
    await documentPage.setViewportSize({ width: 1660, height: 1100 });
    assert.equal(await documentPage.locator('.document').evaluate(el => el.clientWidth), 1500);
    assert.equal(await documentPage.locator('.pagedjs_page').count(), 6);
    await documentPage.screenshot({ path: path.join(output, 'web-desktop.png'), fullPage: true });
    await documentPage.pdf({ path: path.join(output, 'product-introduction.pdf'), printBackground: true, preferCSSPageSize: true });
    await documentPage.setViewportSize({ width: 390, height: 844 });
    await documentPage.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2);
    await documentPage.screenshot({ path: path.join(output, 'web-mobile.png'), fullPage: true });
    const stress = await page.evaluate(async (source) => {
      const m = await import('/src/utils/brochure.ts');
      source.language = 'en'; source.title = 'Technical Product Introduction';
      source.items = [source.items[0]];
      source.items[0].images = [];
      source.items[0].description = 'Pagination verification. '.repeat(100);
      source.items[0].specs = Array.from({ length: 100 }, (_, index) => ({ name: `Parameter ${index + 1}`, value: `${index + 1} - BQ 1600 / NQ 1200 / HQ 700`, unit: 'm' }));
      return m.brochureHtml(source);
    }, saved.get(1).data);
    await documentPage.setViewportSize({ width: 1200, height: 1100 });
    await documentPage.setContent(stress);
    await documentPage.waitForFunction(() => document.body.dataset.paginationState === 'ready');
    assert(await documentPage.locator('.pages table').evaluateAll(tables => tables.every(table => table.querySelector('thead'))), 'continued tables repeat headers');
    await documentPage.pdf({ path: path.join(output, 'long-specifications.pdf'), printBackground: true, preferCSSPageSize: true });
    const oversized = await page.evaluate(async source => {
      const m = await import('/src/utils/brochure.ts');
      source.language = 'en'; source.title = 'Oversized text verification'; source.items = [source.items[0]];
      const item = source.items[0]; item.images = []; item.description = 'Long description content. '.repeat(450) + ' DESCRIPTION-END'; item.highlights = 'Extended feature. '.repeat(300) + ' FEATURE-END';
      item.specs = [{ name: 'A very long specification', value: 'Long specification text. '.repeat(120) + ' SPECIFICATION-END', unit: '' }, { name: 'Final parameter', value: 'LAST-ROW-PRESENT', unit: '' }];
      return m.brochureHtml(source);
    }, saved.get(1).data);
    await documentPage.setContent(oversized);
    await documentPage.waitForFunction(() => document.body.dataset.paginationState === 'ready');
    for (const marker of ['DESCRIPTION-END', 'FEATURE-END', 'SPECIFICATION-END', 'LAST-ROW-PRESENT']) assert((await documentPage.locator('.pages').innerText()).includes(marker), marker);
    await documentPage.pdf({ path: path.join(output, 'oversized-text.pdf'), printBackground: true, preferCSSPageSize: true });
    await offline.close();
    console.log('PASS: import, custom specs/images, upload, reorder, save/copy/reload/open/delete, scoped requests, HTML offline images, server PDF download without print dialog, desktop/mobile, XSS and export failure.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
