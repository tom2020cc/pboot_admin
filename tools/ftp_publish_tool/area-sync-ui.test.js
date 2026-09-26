const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'public/area-sync.js'), 'utf8');

async function page(supported = true) {
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { disabled: false, hidden: true }); return nodes.get(id); };
  let state = { running: false, areaSyncSupported: supported };
  const sent = [];
  vm.runInNewContext(source, { setTimeout, window: { FtpTool: {
    $, escapeHtml: s => String(s).replaceAll('<', '&lt;'), renderNavigation() {}, setStatus() {},
    api: async url => url === '/deployment-environment' ? { environment: 'local' }
      : url === '/api/sync/config' ? { currentSite: { id: 1, name: '测试站点' }, navigation: [] } : state,
    postJson: async (url, body) => {
      sent.push({ url, body });
      if (url.endsWith('/inspect')) return { token: 'preview-token', siteName: '测试站点', areas: [
        { acode: 'en', name: '英文', domain: 'example.com', is_default: 1 },
      ], online: { path: '/fixture/site.db', areas: [] } };
      state = { running: false, areaSyncSupported: true, siteId: 1, action: 'sync-areas', result: { synced: 1, added: 1, preserved: 0, verified: true } };
      return { started: true };
    },
  } } });
  await new Promise(resolve => setImmediate(resolve));
  return { $, sent };
}

test('preview then one explicit confirmation submits only area sync and displays verified result', async () => {
  const { $, sent } = await page();
  assert.equal($('areaRun').disabled, true);
  await $('areaPreview').onclick();
  assert.equal($('areaRun').disabled, false);
  assert.equal($('areaPlan').hidden, false);
  assert.match($('areaTarget').textContent, /\/fixture\/site.db/);
  await $('areaRun').onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1).body)), { token: 'preview-token', action: 'sync-areas', confirm: true });
  assert.match($('areaResultTitle').textContent, /同步完成/);
  assert.equal($('areaRun').disabled, true);
  await $('areaRun').onclick();
  assert.equal(sent.length, 2, 'cannot submit twice without a new preview');
});

test('old publishing service blocks both buttons before any remote operation', async () => {
  const { $, sent } = await page(false);
  assert.equal($('areaPreview').disabled, true);
  assert.equal($('areaRun').disabled, true);
  assert.match($('areaResultTitle').textContent, /重启/);
  await $('areaPreview').onclick();
  await $('areaRun').onclick();
  assert.equal(sent.length, 0);
});
