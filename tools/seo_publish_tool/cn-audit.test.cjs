const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPage, fetchPage, aiInput } = require('./cn-audit');
const report = { audit: { localHome: 'http://local.test/', publicHome: 'https://cn.example.com/' }, urls: [
  { lang: 'cn', url: 'https://cn.example.com/product.html', localUrl: 'http://local.test/product.html' },
  { lang: 'en', url: 'https://en.example.com/product.html', localUrl: 'http://local.test/en-product.html' },
] };
test('CN page guard allows known Chinese pages and refuses foreign paths, credentials and query overrides', () => {
  assertPage('https://cn.example.com/#top', report);
  assertPage('http://local.test/product.html', report);
  for (const value of ['https://en.example.com/product.html', 'http://local.test/en-product.html',
    'https://cn.example.com/?lang=en', 'https://user:secret@cn.example.com/', 'file:///tmp/a', 'https://other.test/']) {
    assert.throws(() => assertPage(value, report));
  }
  assert.throws(() => assertPage('https://cn.example.com/', { urls: [] }));
});
test('foreign redirect is rejected before contacting its destination', async () => {
  const calls = [];
  await assert.rejects(fetchPage('https://cn.example.com/', report, async url => {
    calls.push(url.href);
    return new Response(null, { status: 302, headers: { location: 'https://en.example.com/product.html' } });
  }), /CN/);
  assert.deepEqual(calls, ['https://cn.example.com/']);
});
test('known Chinese redirects work; loops stop', async () => {
  let calls = 0;
  const result = await fetchPage('https://cn.example.com/', report, async () => ++calls === 1
    ? new Response(null, { status: 301, headers: { location: '/product.html' } }) : new Response('<h1>中文</h1>', { headers: { 'content-type': 'text/html' } }));
  assert.equal(result.finalUrl, 'https://cn.example.com/product.html');
  assert.equal(calls, 2);
  await assert.rejects(fetchPage('https://cn.example.com/', report, async () => new Response(null,
    { status: 302, headers: { location: '/' } })), /次数过多/);
});
test('audit optimization locks language even when client sends another mode', () => {
  const input = aiInput({ mode: 'generate-languages', targetAcode: 'en', problems: ['description'], model: 'test', dryRun: true });
  assert.equal(input.mode, 'fix-cn'); assert.equal(input.targetAcode, 'cn');
  assert.equal(input.dryRun, true); assert.deepEqual(input.problems, ['description']);
});

test('server error pages and non-HTML responses are never scored as healthy pages', async () => {
  await assert.rejects(fetchPage('https://cn.example.com/', report, async () =>
    new Response('<title>404</title>', { status: 404, headers: { 'content-type': 'text/html' } })), /HTTP 404/);
  await assert.rejects(fetchPage('https://cn.example.com/', report, async () =>
    new Response('{}', { headers: { 'content-type': 'application/json' } })), /HTML/);
});
