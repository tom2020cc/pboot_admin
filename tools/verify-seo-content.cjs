// All backend requests are mocked. No real articles, AI calls or PB writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../backend/package.json'))('playwright');
const output = path.resolve(__dirname, '../artifacts/seo-content');
const config = { industry: '钻机', brand: '山铂', instructions: '以已核实参数为准', keywords: ['岩芯钻机'], feeds: [], model: 'writer', menuId: 10, intervalHours: 24, dailyLimit: 1, searchEnabled: false, dailyCollectLimit: 4, searchProvider: 'deepseek', researchModel: 'deepseek-v4-flash', maxOutputTokens: 6000, dailySearchLimit: 3, knowledge: '本站已核实资料', productIds: [] };
const site1 = { plan: { siteId: 1, enabled: true, revision: 1, config, nextRunAt: '' }, control: { paused: false, heartbeat: new Date().toISOString() },
  integrations: { searchConfigured: true, workerConfigured: true, deepseekConfigured: true, braveConfigured: false }, usage: { generateToday: 0, collectToday: 0, searchToday: 0 },
  editorial: { version: 'fixture-v1', rules: [{ id: 'writing', title: '中文 SEO 写作', text: '只依据本站已核实资料创作中文文章。禁止虚构事实、图片、ALT。' }] },
  articles: [{ id: 90, title: '岩芯钻机维护指南', menuId: 10, urlName: 'cn-original', updateTime: '2026-01-01T00:00:00.000Z' }], products: [{ id: 1, title: 'CR600P' }],
  models: [{ value: 'writer', label: '高质量写作模型', available: true }], menus: [{ id: 10, name: '行业资讯' }], sources: [], jobs: [] };
const site2 = { ...JSON.parse(JSON.stringify(site1)), plan: { siteId: 2, enabled: false, revision: 0, config: { ...config, industry: '挖掘机', brand: '独立挖掘机站', model: '', knowledge: '', productIds: [] }, nextRunAt: '' }, articles: [], products: [], sources: [], jobs: [] };
const draft = { title: '岩芯钻机选型注意事项', subtitle: '基于资料的选型参考', keywords: '岩芯钻机,选型', summary: '结合已核实资料整理的选型建议。', content: '<h2>选型</h2><p>依据已核实资料确认设备配置。</p>' };
(async () => {
  fs.mkdirSync(output, { recursive: true }); const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
    await context.addInitScript(() => { if (window.top !== window) return; localStorage.setItem('localToken', 'fixture-only'); if (!localStorage.getItem('pbootActiveSiteId')) localStorage.setItem('pbootActiveSiteId', '1'); });
    const page = await context.newPage(), errors = [], mutations = [];
    page.on('pageerror', e => errors.push(e.message));
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    await page.route('http://localhost:5108/**', async route => {
      const request = route.request(), url = new URL(request.url()); const method = request.method(); let body = {}, status = 200;
      const siteId = Number(request.headers()['x-pboot-site-id']); const data = method === 'GET' || method === 'OPTIONS' ? null : request.postDataJSON();
      if (method === 'OPTIONS') body = {};
      else if (url.pathname === '/auth/profile') body = { email: 'fixture@example.invalid' };
      else if (url.pathname === '/sites') body = [{ id: 1, name: '山铂钻机', enabled: true, isDefault: true }, { id: 2, name: '挖掘机网站', enabled: true }];
      else if (url.pathname === '/sites/current/languages') body = [{ acode: 'cn', code: 'zh-CN', name: '中文' }];
      else if (url.pathname === '/seo-content' && method === 'GET') body = siteId === 1 ? site1 : site2;
      else if (url.pathname.startsWith('/seo-content/')) {
        mutations.push({ siteId, path: url.pathname }); assert.equal(siteId, 1);
        if (url.pathname.endsWith('/sources')) { site1.sources.push({ ...data, id: 1, publishedAt: '' }); body = site1.sources[0]; }
        else if (url.pathname.endsWith('/plan')) { site1.plan.config = data.config; site1.plan.revision++; body = site1.plan; }
        else if (url.pathname.endsWith('/check')) { body = { issues: [], warnings: ['正文较短，请检查是否充分回答了读者的问题'], stats: { bodyChars: 80, headings: 1, matchedKeywords: ['岩芯钻机'], missingKeywords: [], comparedCount: 0 }, similar: [] }; }
        else if (url.pathname.endsWith('/history')) { body = site1.jobs.filter(j => j.snapshot.previous?.id === 90); }
        else if (url.pathname.endsWith('/jobs')) { site1.jobs.push({ id: data.newsId ? 'update-fixture' : 'draft-fixture', siteId: 1, kind: 'generate', status: 'draft', snapshot: { ...config, source: site1.sources[0], editorial: site1.editorial, ...(data.newsId ? { previous: { id: 90, urlName: 'cn-original', draft: { ...draft, title: '岩芯钻机维护指南', content: '<p>原文保留内容</p>' } } } : {}) }, draft: { ...draft }, revision: 1, createdAt: new Date().toISOString(), scheduledAt: '', error: '', tokens: 100, newsId: 0, attempts: 1, checks: [] }); body = site1.jobs.at(-1); }
        else if (url.pathname.endsWith('/draft')) { Object.assign(site1.jobs[0], { draft: data.draft, revision: site1.jobs[0].revision + 1 }); body = site1.jobs[0]; }
        else if (url.pathname.endsWith('/schedule')) { site1.jobs[0].status = 'scheduled'; site1.jobs[0].scheduledAt = data.scheduledAt; body = site1.jobs[0]; }
        else if (url.pathname.endsWith('/cancel')) { site1.jobs[0].status = 'draft'; site1.jobs[0].scheduledAt = ''; body = site1.jobs[0]; }
        else if (url.pathname.endsWith('/switch')) { site1.plan.enabled = data.enabled; body = site1.plan; }
        else { status = 500; errors.push(`Unhandled mutation ${url.pathname}`); }
      } else { status = 500; errors.push(`Unhandled API ${url.pathname}`); }
      await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    });
    await page.goto('http://localhost:5278/#/seo-content');
    await page.getByRole('button', { name: '保存配置' }).waitFor();
    await page.getByRole('button', { name: '运行检查' }).click();
    await page.getByText('任务进程凭据', { exact: true }).waitFor();
    await page.locator('.el-switch').filter({ has: page.getByRole('switch', { name: '关键词搜索', exact: true }) }).click();
    await page.getByRole('button', { name: '保存配置' }).click();
    await page.getByText('配置已保存', { exact: true }).waitFor();
    assert.equal(site1.plan.config.searchEnabled, true);
    await page.getByText('配置已保存', { exact: true }).waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(output, 'settings-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('tab', { name: /选题与素材/ }).click();
    await page.getByRole('button', { name: '新增素材' }).click();
    const dialog = page.getByRole('dialog', { name: '新增素材' });
    const field = (container, label) => container.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: new RegExp(`^${label}$`) }) });
    await field(dialog, '选题标题').locator('input').fill('岩芯钻机选型');
    await field(dialog, '核实过的事实资料').locator('textarea').fill('真实资料：型号参数以产品规格表为准。');
    await dialog.getByText('已核实事实，并确认有权使用这些资料', { exact: true }).click(); await dialog.getByRole('button', { name: '保存素材' }).click(); await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '生成草稿' }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await page.getByRole('button', { name: '编辑审核' }).click();
    const review = page.getByRole('dialog', { name: '中文文章审核' });
    await field(review, '标题').locator('input').fill('岩芯钻机选型注意事项修订');
    await review.getByRole('button', { name: '保存草稿' }).click();
    await page.getByText('草稿已保存', { exact: true }).waitFor();
    await review.getByText('基础检查通过', { exact: true }).waitFor();
    await page.getByText('草稿已保存', { exact: true }).waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(output, 'review-desktop.png'), fullPage: true, animations: 'disabled' });
    await review.getByText('已核实参数、事实、来源与内容使用权', { exact: true }).click();
    const dateInput = review.getByRole('combobox', { name: '发布时间' });
    await dateInput.fill('2030-09-10 10:00:00'); await dateInput.press('Tab');
    await review.getByRole('button', { name: '审核并排期' }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await review.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '撤销' }).waitFor();
    await page.screenshot({ path: path.join(output, 'jobs-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('tab', { name: 'SEO Skill', exact: true }).click();
    await page.getByRole('button', { name: '中文 SEO 写作' }).click();
    await page.getByText('只依据本站已核实资料创作中文文章。禁止虚构事实、图片、ALT。', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'skills-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('tab', { name: '文章库与更新' }).click();
    await page.getByRole('button', { name: '生成更新草稿', exact: true }).click();
    const update = page.getByRole('dialog', { name: '生成旧文更新草稿' });
    await update.getByRole('combobox', { name: '本次更新依据' }).click();
    await page.getByRole('option', { name: '岩芯钻机选型', exact: true }).click();
    await update.getByRole('button', { name: '生成更新草稿', exact: true }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await update.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '编辑审核', exact: true }).click();
    await page.getByText('更新前后对照 · #90 · cn-original', { exact: true }).click();
    await page.getByText('<p>原文保留内容</p>', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'update-desktop.png'), fullPage: true, animations: 'disabled' });
    assert.equal(site1.jobs.at(-1).snapshot.previous.id, 90);
    await review.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('tab', { name: '文章库与更新' }).click();
    await page.getByRole('button', { name: '更新记录' }).click();
    await page.getByRole('dialog', { name: '文章更新记录' }).getByText('待审核', { exact: true }).waitFor();
    await page.getByRole('dialog', { name: '文章更新记录' }).getByRole('button', { name: 'Close this dialog' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.el-aside')?.getBoundingClientRect().width <= 66);
    await page.getByRole('tab', { name: '计划设置' }).click();
    await page.screenshot({ path: path.join(output, 'settings-mobile.png'), fullPage: true, animations: 'disabled' });
    const bounds = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(bounds.scroll <= bounds.width + 2, JSON.stringify(bounds));
    await page.getByRole('tab', { name: /草稿与任务/ }).click();
    await page.getByRole('button', { name: '查看', exact: true }).click();
    await page.getByRole('dialog', { name: '中文文章审核' }).getByText('基础检查通过', { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const dialog = [...document.querySelectorAll('.seo-dialog')].find(el => el.getBoundingClientRect().width > 0);
      const rect = dialog?.getBoundingClientRect();
      return rect && rect.y >= 0 && rect.y + rect.height <= innerHeight;
    });
    const dialogBounds = await page.locator('.seo-dialog:visible').boundingBox();
    assert(dialogBounds.y >= 0 && dialogBounds.y + dialogBounds.height <= 845, JSON.stringify(dialogBounds));
    await page.screenshot({ path: path.join(output, 'review-mobile.png'), animations: 'disabled' });
    await page.getByRole('dialog', { name: '中文文章审核' }).getByRole('button', { name: '关闭', exact: true }).click();
    await page.evaluate(() => localStorage.setItem('pbootActiveSiteId', '2')); await page.reload();
    await page.getByRole('button', { name: '保存配置' }).waitFor();
    assert.equal(await page.getByRole('switch', { name: '关键词搜索', exact: true }).getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('input').filter({ hasText: '山铂' }).count(), 0);
    await page.getByRole('tab', { name: /草稿与任务/ }).click();
    assert.equal(await page.getByText('岩芯钻机选型注意事项修订', { exact: true }).count(), 0);
    assert.equal(mutations.filter(m => m.path.endsWith('/schedule')).length, 1);
    assert.equal(site1.jobs.filter(j => j.snapshot.previous?.id === 90).length, 1);
    assert.deepEqual(errors, []); console.log('SEO content UI: sources, model, review, schedule, site isolation, desktop/mobile passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
