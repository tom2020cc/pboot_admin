const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBingApi } = require('./bing-api');
function api(data, observe = () => {}) {
  return createBingApi(async (url, options) => { observe(new URL(url), options); return { ok: true, status: 200, json: async () => data }; });
}
test('Sitemap uses documented SubmitFeed with feedUrl and accepts d:null', async () => {
  const result = await api({ d: null }, (url, options) => {
    assert(url.pathname.endsWith('/SubmitFeed'));
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { siteUrl: 'https://a.example/', feedUrl: 'https://a.example/sitemap.xml' });
  }).sitemap('test-only-key', 'https://a.example/', 'https://a.example/sitemap.xml');
  assert(result.ok);
});
test('shared account connection requires the exact verified site, not another project', async () => {
  const client = api({ d: [{ Url: 'https://a.example/', IsVerified: true }, { Url: 'https://b.example/', IsVerified: false }] });
  assert.equal((await client.test('test', 'https://a.example')).ok, true);
  assert.equal((await client.test('test', 'https://b.example/')).ok, false);
  assert.equal((await client.test('test', 'https://cn.a.example/')).ok, false);
});
test('crawl records and missing records are never treated as proven indexing status', async () => {
  const record = await api({ d: { IsPage: true, HttpStatus: 200, LastCrawledDate: '/Date(1700000000000-0700)/' } }, url => assert(url.pathname.endsWith('/GetUrlInfo'))).inspect('test', 'https://a.example/', 'https://a.example/p');
  assert.equal(record.indexed, null);
  assert.equal(record.lastCrawled, '2023-11-14T22:13:20.000Z');
  assert.equal(record.httpCode, 200);
  assert.equal((await api({ d: null }).inspect('test', 'https://a.example/', 'https://a.example/p')).indexed, null);
});
test('API faults, HTML and network errors cannot report success or disclose the key', async () => {
  await assert.rejects(() => api({ ErrorCode: 1, Message: 'secret' }).sitemap('secret', 'a', 'b'), error => !error.message.includes('secret'));
  await assert.rejects(() => api({}).sitemap('key', 'a', 'b'));
  const broken = createBingApi(async () => { throw new Error('url?apikey=secret'); });
  await assert.rejects(() => broken.test('secret', 'a'), error => !error.message.includes('secret'));
});
