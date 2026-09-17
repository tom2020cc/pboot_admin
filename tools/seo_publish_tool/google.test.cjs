const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scope = require('./google-scope');
const runtime = require('../site-runtime');
const api = require('./server')._googleTest;
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; api.googleTokenCache.clear(); });
const config = { siteBaseUrl: 'https://rig.example.com', useLanguageSubdomains: true };
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { client_email: 'fixture@example.com', private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'google-test-'));
  try {
    fs.mkdirSync(path.join(root, 'seo'));
    fs.writeFileSync(path.join(root, 'seo/seo.config.json'), JSON.stringify({ ...config, googleIndexing: { serviceAccount: account } }));
    return await runtime.runForSite({ id: 91, directory: root, isDefault: false }, run);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('site scope allows configured language hosts, not tools or unrelated sites', () => {
  for (const url of ['https://rig.example.com/x', 'https://cn.rig.example.com/x']) assert(scope.belongsToSite(url, config));
  for (const url of ['https://admin.rig.example.com/x', 'https://excavator.example.com/x', 'https://rig.example.com.evil.org/x',
    'https://user:password@rig.example.com/', 'https://rig.example.com:8080/']) assert(!scope.belongsToSite(url, config));
});
test('properties and URL prefixes enforce host and path boundaries', () => {
  scope.assertGoogleScope(config, 'sc-domain:rig.example.com', 'https://cn.rig.example.com/x');
  assert.throws(() => scope.assertGoogleScope(config, 'sc-domain:example.com'));
  assert.throws(() => scope.assertGoogleScope(config, 'https://rig.example.com/', 'https://cn.rig.example.com/'));
  assert.throws(() => scope.assertGoogleScope(config, 'https://rig.example.com/products/', 'https://rig.example.com/products-other/'));
  assert(!scope.belongsToSite('https://rig.example.com/else/', { ...config, siteBaseUrl: 'https://rig.example.com/sub' }));
});
test('token cache isolates account, key, scope and current site', async () => {
  let calls = 0;
  global.fetch = async () => Response.json({ access_token: 't' + ++calls, expires_in: 3600 });
  const run = (id, a = account, s = 'read') => runtime.runForSite({ id }, () => api.getGoogleAccessToken(a, s));
  assert.equal(await run(1), 't1'); assert.equal(await run(1), 't1');
  assert.equal(await run(2), 't2'); assert.equal(await run(1, { ...account, client_email: 'other@example.com' }), 't3');
  assert.equal(await run(1, account, 'write'), 't4');
  assert.notEqual(scope.tokenCacheKey(account, 'read', 1), scope.tokenCacheKey({ ...account, private_key: 'rotated' }, 'read', 1));
});
test('sitemap uses official endpoint, checks property permission and accepts empty success', () => fixture(async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push([url, options]);
    if (url.includes('oauth2')) return Response.json({ access_token: 'test' });
    if (options.method === 'PUT') return new Response('', { status: 200 });
    return Response.json({ permissionLevel: 'siteFullUser' });
  };
  const result = await api.submitSearchConsoleSitemap('sc-domain:rig.example.com', 'https://rig.example.com/sitemap.xml');
  assert.equal(result.ok, true);
  const put = calls.find(([, o]) => o.method === 'PUT');
  assert.equal(put[0], 'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Arig.example.com/sitemaps/https%3A%2F%2Frig.example.com%2Fsitemap.xml');
  assert.equal(put[1].body, undefined);
}));
test('restricted account cannot submit sitemap', () => fixture(async () => {
  global.fetch = async (url, options) => {
    assert.notEqual(options.method, 'PUT');
    return Response.json(url.includes('oauth2') ? { access_token: 'test' } : { permissionLevel: 'siteRestrictedUser' });
  };
  assert.equal((await api.submitSearchConsoleSitemap('sc-domain:rig.example.com', 'https://rig.example.com/sitemap.xml')).ok, false);
}));
test('wrong site rejected before Google network request', () => fixture(async () => {
  global.fetch = () => { throw new Error('should not request'); };
  await assert.rejects(api.submitSearchConsoleSitemap('sc-domain:rig.example.com', 'https://other.example.com/sitemap.xml'), /当前网站/);
}));
test('403 permission and disabled API diagnostics are actionable', () => fixture(async () => {
  global.fetch = async url => Response.json(url.includes('oauth2') ? { access_token: 'test' } : { error: { message: 'Permission denied' } }, { status: url.includes('oauth2') ? 200 : 403 });
  assert.equal((await api.testSearchConsoleProperty('sc-domain:rig.example.com')).reason, 'permission');
}));
test('crawled/discovered but not indexed never counted as indexed', () => {
  for (const coverageState of ['Crawled - currently not indexed', 'Discovered - currently not indexed', '未编入索引']) {
    assert.equal(api.diagnoseSearchConsoleInspection({ verdict: 'NEUTRAL', coverageState }).indexed, false);
  }
  assert.equal(api.diagnoseSearchConsoleInspection({ verdict: 'PASS', coverageState: '已编入索引' }).indexed, true);
  assert.equal(api.diagnoseSearchConsoleInspection({ verdict: 'PASS', indexingState: 'BLOCKED_BY_META_TAG' }).indexed, false);
});
test('malformed inspection response is not saved as a real diagnosis', () => fixture(async () => {
  global.fetch = async url => Response.json(url.includes('oauth2') ? { access_token: 'test' } : {});
  assert.equal((await api.inspectSearchConsoleUrl('https://rig.example.com/x', 'sc-domain:rig.example.com')).ok, false);
}));
test('notification metadata is read from root and is not index status', async () => {
  global.fetch = async url => Response.json(url.includes('oauth2') ? { access_token: 'test' } : { latestUpdate: { type: 'URL_UPDATED', notifyTime: '2026-01-01' } });
  const result = await api.getGoogleIndexingMetadata(account, 'https://rig.example.com/x');
  assert.equal(result.notified, true); assert.equal(result.latestTime, '2026-01-01');
});
test('only actual supported JSON-LD page types pass the eligibility check', () => {
  const html = obj => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
  assert.equal(scope.indexingPageType(html({ '@type': 'Product' })), '');
  assert.equal(scope.indexingPageType('JobPosting'), '');
  assert.equal(scope.indexingPageType(html({ '@type': 'JobPosting' })), 'JobPosting');
  assert.equal(scope.indexingPageType(html({ '@type': 'BroadcastEvent' })), '');
  assert.equal(scope.indexingPageType(html({ '@type': 'VideoObject', publication: { '@type': 'BroadcastEvent' } })), 'BroadcastEvent');
});
test('ordinary product page does not consume Indexing API quota', () => fixture(async () => {
  global.fetch = async url => { assert.equal(url, 'https://rig.example.com/x'); return new Response('<h1>Product</h1>'); };
  await assert.rejects(api.checkIndexingEligibility('https://rig.example.com/x'), /Sitemap/);
}));
