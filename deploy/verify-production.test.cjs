const test = require('node:test');
const assert = require('node:assert/strict');
const { origin, verify } = require('./verify-production.cjs');

test('production verifier only accepts HTTPS origins without credentials', () => {
  assert.equal(origin('https://admin.example.com'), 'https://admin.example.com');
  for (const url of ['http://admin.example.com', 'https://user:pass@example.com', 'https://example.com/a', 'https://example.com/?key=x']) {
    assert.throws(() => origin(url));
  }
});

test('production checks never send generation or publishing requests', async t => {
  const settings = {
    admin: 'https://admin.example.com', seo: 'https://seo.example.com', ftp: 'https://ftp.example.com',
    credentials: { email: 'admin@example.com', password: 'test-only-secret' },
  };
  const calls = [];
  let wrongNavigation = false;
  const sessions = new Set();
  t.mock.method(console, 'log', () => {});
  t.mock.method(global, 'fetch', async (address, options) => {
    const url = new URL(address);
    calls.push({ address, method: options.method || 'GET' });
    if (url.protocol === 'http:') return new Response(null, { status: 301, headers: { location: address.replace('http:', 'https:') } });
    if (url.pathname === '/api/auth/login') return Response.json({ access_token: 'test-token' });
    if (url.origin === settings.admin) return Response.json([]);
    if (url.pathname === '/_tool-auth/login' && options.method === 'POST') {
      sessions.add(url.origin);
      return new Response(null, { status: 303, headers: { 'Set-Cookie': '__Host-pboot_tool_session=' + 'a'.repeat(64) + '; Path=/; HttpOnly; Secure; SameSite=Lax', Location: '/' } });
    }
    if (url.pathname === '/_tool-auth/logout') {
      sessions.delete(url.origin); return new Response(null, { status: 303 });
    }
    if (url.pathname === '/_tool-auth/login') return new Response('使用管理后台账号登录');
    if (!options.headers?.Cookie || !sessions.has(url.origin)) return new Response(null, { status: url.pathname.startsWith('/api/') ? 401 : 303, headers: { Location: '/_tool-auth/login' } });
    if (url.pathname === '/api/config') return Response.json({
      setupRequired: true,
      navigation: ['admin', 'sites', 'quotation', 'brochure', 'seo', 'models', 'models-config', 'ftp'].map(id => ({
        id, url: wrongNavigation ? 'http://localhost:5278' : ['seo', 'models', 'models-config'].includes(id) ? settings.seo : id === 'ftp' ? settings.ftp : settings.admin,
      })),
    });
    return Response.json({ ftp: { running: true } });
  });
  await verify(settings);
  assert.deepEqual(calls.filter(call => call.method !== 'GET').map(call => new URL(call.address).pathname), ['/api/auth/login', '/_tool-auth/login', '/_tool-auth/login', '/_tool-auth/logout', '/_tool-auth/logout']);
  wrongNavigation = true;
  await assert.rejects(verify(settings), /Wrong destination/);
});
