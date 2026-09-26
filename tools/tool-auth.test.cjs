const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createToolAuth, safeReturn, runWithToolIdentity, toolRequestHeaders } = require('./tool-auth');

const env = { NODE_ENV: 'production', SEO_PUBLIC_URL: 'https://seo.example.test', FTP_PUBLIC_URL: 'https://ftp.example.test', ADMIN_PUBLIC_URL: 'https://admin.example.test', BACKEND_PORT: '5108' };

async function fixture(t, tool = 'seo') {
  let clock = 1;
  const state = { revoked: false, unavailable: false, calls: [] };
  const gate = createToolAuth({ env, tool, now: () => clock, fetchImpl: async (url, init) => {
    state.calls.push({ url, init });
    if (state.unavailable) throw new Error('private diagnostic');
    if (url.endsWith('/login')) {
      const body = JSON.parse(init.body);
      return body.email === 'admin@example.test' && body.password === 'test-password'
        ? Response.json({ access_token: 'server-only-token' }) : Response.json({}, { status: 400 });
    }
    assert.equal(url, 'http://127.0.0.1:5108/auth/profile');
    assert.equal(init.headers.Authorization, 'Bearer server-only-token');
    return Response.json({}, { status: state.revoked ? 401 : 200 });
  } });
  const server = http.createServer(async (req, res) => {
    if (await gate(req, res)) return;
    if (req.url === '/api/bridge') {
      await runWithToolIdentity(req, async () => {
        await Promise.resolve();
        res.end(JSON.stringify(toolRequestHeaders('http://127.0.0.1:5389/api/config')));
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"private":true}');
  });
  // Windows can allocate low ephemeral ports that Fetch reserves for other protocols.
  do {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    if (!new Set([2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]).has(server.address().port)) break;
    await new Promise(resolve => server.close(resolve));
  } while (true);
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = tool === 'ftp' ? env.FTP_PUBLIC_URL : env.SEO_PUBLIC_URL;
  const request = (path = '/', options = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { redirect: 'manual', ...options });
  const login = (values = {}, extra = {}) => request('/_tool-auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...extra }, body: new URLSearchParams({ email: 'admin@example.test', password: 'test-password', returnTo: '/models.html?siteId=1', ...values }) });
  return { state, request, login, origin, advance: ms => { clock += ms; } };
}

test('local development is unchanged; production cannot disable the login gate', async () => {
  assert.equal(await createToolAuth({ env: { NODE_ENV: 'development' } })({}, {}), false);
  assert.throws(() => createToolAuth({ env: { NODE_ENV: 'production', TOOL_AUTH_ENABLED: 'false' }, tool: 'seo' }));
  assert.throws(() => createToolAuth({ env: { ...env, SEO_PUBLIC_URL: 'http://seo.example.test' }, tool: 'seo' }));
});

test('anonymous HTML redirects to a visible login form without Basic challenge', async t => {
  const f = await fixture(t);
  const page = await f.request('/models.html?siteId=1');
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('www-authenticate'), null);
  assert.equal(page.headers.get('location'), '/_tool-auth/login?returnTo=%2Fmodels.html%3FsiteId%3D1');
  const login = await f.request(page.headers.get('location'));
  const html = await login.text();
  assert.equal(login.status, 200);
  assert.match(html, /使用管理后台账号登录/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /name="returnTo" value="\/models.html\?siteId=1"/);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.equal(login.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(login.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('API, assets, and forged cookies cannot bypass authentication', async t => {
  const f = await fixture(t);
  for (const headers of [{}, { Authorization: 'Basic YTpi' }, { Cookie: '__Host-pboot_tool_session=' + 'a'.repeat(64) }]) {
    assert.equal((await f.request('/api/config', { headers })).status, 401);
  }
  assert.equal((await f.request('/models-config.js')).status, 303);
  assert.equal(f.state.calls.length, 0);
});

test('login reuses backend account guard and sets opaque secure host-only cookie', async t => {
  const f = await fixture(t);
  const login = await f.login();
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), '/models.html?siteId=1');
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /^__Host-pboot_tool_session=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800$/);
  assert.doesNotMatch(cookie, /server-only-token|test-password|Domain=/);
  assert.deepEqual(f.state.calls.map(c => c.url), ['http://127.0.0.1:5108/auth/login', 'http://127.0.0.1:5108/auth/profile']);
  assert.equal((await f.request('/api/config', { headers: { Cookie: cookie.split(';')[0] } })).status, 200);
});

test('wrong password is generic and never echoed', async t => {
  const f = await fixture(t);
  const response = await f.login({ password: 'private-wrong-password' });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
  const html = await response.text();
  assert.match(html, /账号或密码不正确/);
  assert.doesNotMatch(html, /private-wrong-password|private diagnostic/);
});

test('cross-origin and missing-origin mutations are rejected, including logout', async t => {
  const f = await fixture(t);
  for (const path of ['/_tool-auth/login', '/_tool-auth/logout', '/api/config']) {
    for (const headers of [{}, { Origin: 'https://evil.example.test' }]) {
      assert.equal((await f.request(path, { method: 'POST', headers })).status, 403);
    }
  }
  assert.equal(f.state.calls.length, 0);
});

test('same-origin mutations succeed only with an authenticated session', async t => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request('/api/config', { method: 'POST', headers: { Origin: f.origin, Cookie: cookie } })).status, 200);
});

test('logout revokes the current tool session', async t => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  const response = await f.request('/_tool-auth/logout', { method: 'POST', headers: { Origin: f.origin, Cookie: cookie } });
  assert.equal(response.status, 303);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.request('/api/config', { headers: { Cookie: cookie } })).status, 401);
});

test('deleted backend users, expired tokens, and expired sessions are rejected', async t => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  f.state.revoked = true;
  assert.equal((await f.request('/api/config', { headers: { Cookie: cookie } })).status, 401);
  f.state.revoked = false;
  const next = (await f.login()).headers.get('set-cookie').split(';')[0];
  f.advance(8 * 60 * 60 * 1000);
  assert.equal((await f.request('/api/config', { headers: { Cookie: next } })).status, 401);
});

test('authentication service outage fails closed with a useful message', async t => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  f.state.unavailable = true;
  const response = await f.request('/api/config', { headers: { Cookie: cookie } });
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /认证服务暂时不可用/);
  assert.equal((await f.login()).status, 503);
});

test('excessive login attempts are rate limited before backend calls', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.login({ password: 'wrong' })).status, 401);
  const response = await f.login();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '900');
  assert.equal(f.state.calls.length, 10);
});

test('invalid and oversized login payloads are refused', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/_tool-auth/login', { method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  assert.equal((await f.login({ email: 'x'.repeat(9000) })).status, 400);
  assert.equal(f.state.calls.length, 0);
});

test('FTP has its own hostname and session; another tool session is invalid', async t => {
  const seo = await fixture(t);
  const ftp = await fixture(t, 'ftp');
  const cookie = (await seo.login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await ftp.request('/api/config', { headers: { Cookie: cookie } })).status, 401);
  assert.match(await (await ftp.request('/_tool-auth/login')).text(), /FTP 发布/);
  assert.equal((await ftp.login({ returnTo: '/?siteId=1' })).headers.get('location'), '/?siteId=1');
});

test('return targets cannot redirect outside the tool or inject HTML', async t => {
  for (const path of ['https://evil.test', '//evil.test', '/\\evil.test', '/%5cevil.test', '/\r\nevil', '/_tool-auth/login']) assert.equal(safeReturn(path), '/');
  assert.equal(safeReturn('/models.html?siteId=1'), '/models.html?siteId=1');
  const f = await fixture(t);
  assert.equal((await f.login({ returnTo: '//evil.test' })).headers.get('location'), '/');
  const html = await (await f.request('/_tool-auth/login?returnTo=' + encodeURIComponent('/?x="<script>'))).text();
  assert.doesNotMatch(html, /<script>/);
});

test('verified bearer identity preserves SEO to FTP API calls without sharing browser cookies', async t => {
  const f = await fixture(t);
  const cookie = (await f.login()).headers.get('set-cookie').split(';')[0];
  const bridge = await f.request('/api/bridge', { headers: { Cookie: cookie } });
  assert.deepEqual(await bridge.json(), { Authorization: 'Bearer server-only-token' });
  assert.deepEqual(toolRequestHeaders('http://127.0.0.1:5389/api/config'), {});
  const api = await f.request('/api/config', { method: 'POST', headers: { Authorization: 'Bearer server-only-token' } });
  assert.equal(api.status, 200);
  f.state.revoked = true;
  assert.equal((await f.request('/api/config', { headers: { Authorization: 'Bearer server-only-token' } })).status, 401);
  assert.throws(() => toolRequestHeaders('https://external.test/api/config'));
  assert.throws(() => toolRequestHeaders('http://127.0.0.1:5389/private'));
});
