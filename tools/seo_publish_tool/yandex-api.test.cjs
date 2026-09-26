const test = require('node:test');
const assert = require('node:assert/strict');
const { russianPages, selectHost, createApi, submitSitemap } = require('./yandex-api');
const site = 'https://ru.example.com';
test('Russian scope includes homepage, deduplicates and excludes other languages', () => {
  assert.deepEqual(russianPages({ urls: [{ lang: 'ru', url: site + '/rig/' }, { lang: 'ru', url: site + '/rig/' }, { lang: 'en', url: 'https://example.com/rig/' }] }), { site, urls: [site + '/', site + '/rig/'] });
  assert.throws(() => russianPages({ urls: [] }), /RU/);
  assert.throws(() => russianPages({ urls: [{ lang: 'ru', url: site + '/' }, { lang: 'cn', url: site + '/cn/' }] }), /共用域名/);
});
test('Host match uses official fields, exact scheme and verified ownership', () => {
  const good = { host_id: 'https:ru.example.com:443', ascii_host_url: site + '/', verified: true };
  const http = { ...good, ascii_host_url: 'http://ru.example.com/' };
  assert.equal(selectHost([http, good], site), good);
  assert.throws(() => selectHost([http], site), /HTTP/);
  assert.throws(() => selectHost([{ ...good, verified: false }], site), /所有权/);
  assert.throws(() => selectHost([], site), /同一个账号/);
});
test('Sitemap uses user-added-sitemaps and requires confirmed ID', async () => {
  const args = { token: 'test-token', userId: '123', hostId: 'https:ru.example.com:443', site, sitemapUrl: site + '/sitemap-ru.xml' };
  const api = createApi(async (url, options) => {
    assert.match(url, /\/user-added-sitemaps$/);
    assert.equal(options.headers.Authorization, 'OAuth test-token');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { url: args.sitemapUrl });
    return new Response(JSON.stringify({ sitemap_id: 'abc' }), { status: 201 });
  });
  assert.equal((await submitSitemap(api, args)).ok, true);
  assert.equal((await submitSitemap(async () => ({ ok: true, status: 200, data: {} }), args)).ok, false);
  assert.equal((await submitSitemap(async () => ({ ok: false, status: 409, data: { error_code: 'SITEMAP_ALREADY_ADDED', sitemap_id: 'abc' } }), args)).ok, true);
  await assert.rejects(() => submitSitemap(api, { ...args, sitemapUrl: 'https://en.example.com/sitemap.xml' }), /其他域名/);
});
test('API failures cannot leak Token or be mistaken for success', async () => {
  const token = 'secret-test';
  const broken = createApi(async () => { throw new Error(token); });
  await assert.rejects(() => broken('/user/', token), error => !error.message.includes(token));
  const invalid = createApi(async () => new Response('<html>error</html>'));
  assert.equal((await invalid('/user/', token)).ok, false);
});
test('Only idempotent reads retry a transient transport failure', async () => {
  let attempts = 0;
  const api = createApi(async () => {
    if (++attempts === 1) throw new Error('network');
    return new Response(JSON.stringify({ user_id: 1 }));
  });
  assert.equal((await api('/user/', 'test')).ok, true);
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(() => api('/submit', 'test', { method: 'POST' }), /尚未确认/);
  assert.equal(attempts, 1);
});
test('Server IndexNow path submits only Russian URLs and homepage to Yandex', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('./server'), 'utf8');
  const handler = source.slice(source.indexOf('async function pushIndexNow('), source.indexOf('// ===== Bing Webmaster'));
  const calls = [];
  const context = vm.createContext({ URL, Map, Set, path: require('node:path'), yandexScope: require('./yandex-api'),
    inspectSite: async () => ({ siteRoot: '/test', config: {}, urls: [{ lang: 'ru', url: site + '/rig/' }, { lang: 'cn', url: 'https://cn.example.com/rig/' }, { lang: 'en', url: 'https://example.com/rig/' }] }),
    ensureIndexNowKeys: (_config, _root, hosts) => ({ config: { indexNow: {} }, keyFiles: hosts.map(host => ({ host, key: 'test', keyFile: 'test.txt' })) }),
    verifyIndexNowKey: async () => ({ ok: true }),
    submitIndexNowPayload: async (endpoint, payload) => { calls.push({ endpoint, payload }); return { ok: true, status: 200, pushed: payload.urlList.length }; },
  });
  vm.runInContext(handler, context);
  const result = await context.pushIndexNow({ engine: 'yandex' });
  assert.equal(result.successfulHosts, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, 'https://yandex.com/indexnow');
  assert.deepEqual(Array.from(calls[0].payload.urlList), [site + '/', site + '/rig/']);
});
