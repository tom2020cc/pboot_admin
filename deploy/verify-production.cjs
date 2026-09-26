const fs = require('node:fs');
const assert = require('node:assert/strict');

function origin(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.username + url.password + url.search + url.hash, '');
  assert.equal(url.pathname, '/');
  return url.origin;
}

async function request(url, options = {}) {
  return fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...options });
}

async function verify({ admin, seo, ftp, credentials }) {
  const allowed = new Set([admin, seo, ftp]);
  for (const base of allowed) {
    const response = await request(base.replace('https:', 'http:'));
    assert.ok([301, 302, 307, 308].includes(response.status), `${base}: HTTPS redirect missing`);
    assert.equal(new URL(response.headers.get('location'), base).origin, base);
    console.log(`PASS HTTPS redirect: ${base}`);
  }
  assert.equal((await request(admin)).status, 200, 'Admin HTML unavailable');
  const login = await request(`${admin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  assert.ok(login.ok, 'Administrator login failed');
  const loginBody = await login.json();
  const token = loginBody.access_token || loginBody.data?.access_token;
  assert.equal(typeof token, 'string', 'Login token missing');
  const sites = await request(`${admin}/api/sites`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(sites.status, 200, 'Site list unavailable');
  const siteList = await sites.json();
  assert.ok(Array.isArray(siteList), 'Site list response is not an array');
  console.log('PASS administrator login and site list (credentials not printed)');

  const sessions = new Map();
  try {
  for (const base of [seo, ftp]) {
    const anonymous = await request(base);
    assert.equal(anonymous.status, 303, `${base}: expected visible login redirect`);
    assert.equal(anonymous.headers.get('www-authenticate'), null, 'Legacy Basic authentication remains enabled');
    assert.equal(new URL(anonymous.headers.get('location'), base).pathname, '/_tool-auth/login');
    const formPage = await request(`${base}/_tool-auth/login`);
    assert.equal(formPage.status, 200, 'Tool login form unavailable');
    assert.match(await formPage.text(), /使用管理后台账号登录/);
    assert.equal((await request(`${base}/api/config`)).status, 401, 'Anonymous API access must stay protected');
    const session = await request(`${base}/_tool-auth/login`, {
      method: 'POST', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...credentials, returnTo: '/?siteId=1' }),
    });
    assert.equal(session.status, 303, 'Tool account login failed');
    const cookie = session.headers.get('set-cookie') || '';
    assert.match(cookie, /^__Host-pboot_tool_session=[a-f0-9]{64};/);
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    const headers = { Cookie: cookie.split(';')[0] };
    sessions.set(base, headers);
    assert.equal((await request(base, { headers })).status, 200, `${base}: authenticated HTML unavailable`);
    const config = await request(`${base}/api/config`, { headers });
    assert.equal(config.status, 200, `${base}: configuration unavailable`);
    const data = await config.json();
    assert.ok(Array.isArray(data.navigation) && data.navigation.length >= 8, 'Tool navigation missing');
    assert.ok(!data.navigation.some(item => item.id === 'backend'), 'Production Swagger link should be hidden');
    const expected = { admin, sites: admin, quotation: admin, brochure: admin, seo, models: seo, 'models-config': seo, ftp };
    for (const [id, expectedOrigin] of Object.entries(expected)) {
      const item = data.navigation.find(entry => entry.id === id);
      assert.ok(item, `Navigation entry missing: ${id}`);
      assert.equal(new URL(item.url).origin, expectedOrigin, `Wrong destination for ${id}`);
    }
    for (const item of data.navigation) {
      assert.ok(allowed.has(new URL(item.url).origin), `Unexpected navigation origin: ${item.id}`);
    }
    console.log(`PASS authenticated tool and navigation: ${base}; setupRequired=${data.setupRequired === true}`);
  }
  const status = await request(`${seo}/api/ai/status`, { headers: sessions.get(seo) });
  assert.equal(status.status, 200, 'Model configuration status unavailable');
  const bridge = await request(`${seo}/api/publish/status?siteId=1`, { headers: sessions.get(seo) });
  assert.equal(bridge.status, 200, 'SEO to FTP bridge unavailable');
  assert.equal((await bridge.json()).ftp?.running, true, 'SEO to FTP authentication bridge failed');
  console.log('PASS model status endpoint (no provider calls requested)');
  } finally {
    for (const [base, headers] of sessions) {
      const logout = await request(`${base}/_tool-auth/logout`, { method: 'POST', headers: { ...headers, Origin: base } });
      assert.equal(logout.status, 303, 'Tool logout failed');
      assert.equal((await request(`${base}/api/config`, { headers })).status, 401, 'Logged-out session still valid');
    }
  }
  console.log('PRODUCTION CHECK COMPLETE: no model generation, site scan, publication or FTP transfer.');
}

if (require.main === module) {
  const [admin, seo, ftp, credentialFile] = process.argv.slice(2);
  Promise.resolve().then(() => verify({
    admin: origin(admin), seo: origin(seo), ftp: origin(ftp),
    credentials: JSON.parse(fs.readFileSync(credentialFile, 'utf8')),
  })).catch(error => {
    // Never dump response bodies, request headers or credential objects.
    console.error(`Production check failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { origin, verify };
