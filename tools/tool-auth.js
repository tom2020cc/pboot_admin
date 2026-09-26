const crypto = require('node:crypto');
const { deploymentEnvironment } = require('./deployment-environment');
const { AsyncLocalStorage } = require('node:async_hooks');
const identity = new AsyncLocalStorage();
const requestToken = Symbol('tool-user-token');

const LOGIN = '/_tool-auth/login';
const LOGOUT = '/_tool-auth/logout';
const COOKIE = '__Host-pboot_tool_session';
const TTL = 8 * 60 * 60 * 1000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeReturn(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]|%5c|%0[ad]/i.test(value)) return '/';
  try {
    const url = new URL(value, 'https://tool.invalid');
    if (url.origin !== 'https://tool.invalid' || url.pathname.startsWith('/_tool-auth/')) return '/';
    return url.pathname + url.search;
  } catch { return '/'; }
}

function createToolAuth({ env = process.env, tool, fetchImpl = fetch, now = Date.now } = {}) {
  const enabled = env.NODE_ENV === 'production' || env.TOOL_AUTH_ENABLED === 'true';
  if (!enabled) return async () => false;
  const origin = new URL(tool === 'ftp' ? env.FTP_PUBLIC_URL : env.SEO_PUBLIC_URL);
  const admin = new URL(env.ADMIN_PUBLIC_URL);
  if ([origin, admin].some(u => u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/')) {
    throw new Error('Tool authentication requires credential-free HTTPS public origins.');
  }
  const port = Number(env.BACKEND_PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid backend port');
  const backend = `http://127.0.0.1:${port}/auth`;
  const sessions = new Map();
  const attempts = new Map();
  let globalAttempts = { count: 0, until: 0 };
  const title = `${deploymentEnvironment(env).label} · ${tool === 'ftp' ? 'FTP 发布' : 'SEO 与模型管理'}`;

  function headers(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }

  function json(res, status, message) {
    headers(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message, loginUrl: LOGIN, code: 'TOOL_AUTH_REQUIRED' }));
  }

  function redirect(res, target) {
    headers(res);
    res.writeHead(303, { Location: target });
    res.end();
  }

  function page(res, status, target, message = '', signedIn = false) {
    headers(res);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · 登录</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#243143;font:15px/1.7 system-ui,sans-serif}header{border-bottom:1px solid #dfe5ec;background:white;padding:18px 24px;display:flex;gap:12px;align-items:center}.brand{color:#16864d;font-weight:750}main{max-width:440px;margin:64px auto;padding:28px;background:white;border:1px solid #dfe5ec;border-radius:8px}h1{font-size:24px;margin:0 0 8px}p{color:#657184;margin:0 0 22px}label{display:block;margin:16px 0 6px}input,button{width:100%;font:inherit;border-radius:4px;padding:10px 12px}input{border:1px solid #bcc8d6}input:focus{outline:2px solid #90bcff}button{margin-top:24px;border:0;background:#1677ff;color:white;cursor:pointer}a{color:#1664cb;overflow-wrap:anywhere}.error{padding:10px 12px;color:#a32d32;background:#fff1f0;border:1px solid #ffc9c4;border-radius:4px}.back{display:block;margin-top:20px;text-align:center}footer{color:#687588;text-align:center;font-size:13px}@media(max-width:500px){main{margin:24px 16px;padding:24px}header{padding:14px 16px}}
</style></head><body><header><span class="brand">PbootCMS</span><span>管理中心</span></header><main><h1>${title}</h1><p>${signedIn ? '当前已登录' : '使用管理后台账号登录'}</p>${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ''}${signedIn ? `<a href="${escapeHtml(target)}">继续进入工具</a><form method="post" action="${LOGOUT}"><button type="submit">退出当前工具</button></form>` : `<form method="post" action="${LOGIN}"><input type="hidden" name="returnTo" value="${escapeHtml(target)}"><label for="email">账号邮箱</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="254"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button type="submit">登录并继续</button></form>`}<a class="back" href="${escapeHtml(admin.origin)}/#/">返回管理后台</a></main><footer>${escapeHtml(origin.hostname)}</footer></body></html>`);
  }

  function sessionId(req) {
    const cookie = String(req.headers.cookie || '');
    const values = cookie.split(';').map(v => v.trim()).filter(v => v.startsWith(COOKIE + '='));
    if (values.length !== 1) return '';
    const value = values[0].slice(COOKIE.length + 1);
    return /^[a-f0-9]{64}$/.test(value) ? value : '';
  }

  function cookie(res, id) {
    res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${id ? TTL / 1000 : 0}`);
  }

  async function backendRequest(route, options) {
    return fetchImpl(backend + route, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
  }

  async function validSession(req) {
    const bearer = /^Bearer ([A-Za-z0-9._-]+)$/.exec(String(req.headers.authorization || ''));
    if (bearer) {
      const response = await backendRequest('/profile', { headers: { Authorization: `Bearer ${bearer[1]}` } });
      if (response.status >= 500) throw new Error('Backend unavailable');
      if (response.ok) req[requestToken] = bearer[1];
      return response.ok;
    }
    const id = sessionId(req);
    const session = sessions.get(id);
    if (!session) return false;
    if (session.expires <= now()) { sessions.delete(id); return false; }
    // Recheck against the existing account guard, so deleted users and expired JWTs lose access.
    const response = await backendRequest('/profile', { headers: { Authorization: `Bearer ${session.token}` } });
    if (response.status >= 500) throw new Error('Backend unavailable');
    if (!response.ok) { sessions.delete(id); return false; }
    req[requestToken] = session.token;
    return true;
  }

  function rateLimited(req) {
    const time = now();
    for (const [key, item] of attempts) if (item.until <= time) attempts.delete(key);
    if (globalAttempts.until <= time) globalAttempts = { count: 0, until: time + 5 * 60 * 1000 };
    const address = String(req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown');
    const item = attempts.get(address) || { count: 0, until: time + 15 * 60 * 1000 };
    if (attempts.size >= 2000 && !attempts.has(address)) return true;
    if (item.count >= 10 || globalAttempts.count >= 100) return true;
    item.count++;
    globalAttempts.count++;
    attempts.set(address, item);
    return false;
  }

  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) throw new Error('FORM');
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw new Error('FORM');
      chunks.push(chunk);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  }

  return async function authenticate(req, res) {
    let url;
    try { url = new URL(req.url, origin); } catch { json(res, 400, '请求地址不正确'); return true; }
    const path = url.pathname;
    const target = safeReturn(url.searchParams.get('returnTo') || '/');
    try {
      const explicitBearer = /^Bearer [A-Za-z0-9._-]+$/.test(String(req.headers.authorization || ''));
      const internalBearer = explicitBearer && !req.headers.origin && path.startsWith('/api/');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin.origin && !internalBearer) {
        json(res, 403, '请求来源不匹配，请从当前工具页面操作'); return true;
      }
      if (path === LOGOUT && req.method === 'POST') {
        sessions.delete(sessionId(req)); cookie(res, ''); redirect(res, LOGIN); return true;
      }
      if (path === LOGIN && req.method === 'POST') {
        if (rateLimited(req)) { res.setHeader('Retry-After', '900'); page(res, 429, '/', '尝试次数较多，请稍后再试'); return true; }
        let form;
        try { form = await body(req); } catch { page(res, 400, '/', '登录表单无效或过大'); return true; }
        const returnTo = safeReturn(form.get('returnTo'));
        const email = (form.get('email') || '').trim();
        const password = form.get('password') || '';
        if (!email || email.length > 254 || !password || password.length > 1024) { page(res, 400, returnTo, '请输入账号邮箱和密码'); return true; }
        const result = await backendRequest('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        if (result.status >= 500) throw new Error('Backend unavailable');
        if (!result.ok) { page(res, 401, returnTo, '账号或密码不正确，请使用管理后台账号'); return true; }
        const value = await result.json();
        const token = value.access_token || value.data?.access_token;
        if (typeof token !== 'string' || !token) throw new Error('Invalid authentication response');
        const profile = await backendRequest('/profile', { headers: { Authorization: `Bearer ${token}` } });
        if (!profile.ok) throw new Error('Invalid authentication response');
        sessions.delete(sessionId(req));
        for (const [id, session] of sessions) if (session.expires <= now()) sessions.delete(id);
        if (sessions.size >= 1000) { page(res, 503, returnTo, '登录会话已达上限，请稍后重试'); return true; }
        const id = crypto.randomBytes(32).toString('hex');
        sessions.set(id, { token, expires: now() + TTL });
        cookie(res, id); redirect(res, returnTo); return true;
      }
      const authenticated = await validSession(req);
      if (path === LOGIN && ['GET', 'HEAD'].includes(req.method)) { page(res, 200, target, '', authenticated); return true; }
      if (authenticated) { headers(res); return false; }
      cookie(res, '');
      if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method)) json(res, 401, '登录已失效，请重新登录当前工具');
      else redirect(res, `${LOGIN}?returnTo=${encodeURIComponent(safeReturn(req.url))}`);
      return true;
    } catch {
      if (path.startsWith('/api/')) json(res, 503, '管理后台认证服务暂时不可用，请稍后重试');
      else page(res, 503, target, '管理后台认证服务暂时不可用，请稍后重试');
      return true;
    }
  };
}

function runWithToolIdentity(req, callback) {
  return identity.run(req[requestToken] || '', callback);
}

function toolRequestHeaders(address) {
  const url = new URL(address);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/api/')) {
    throw new Error('Tool credentials can only be forwarded to loopback APIs');
  }
  const token = identity.getStore();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

module.exports = { createToolAuth, safeReturn, runWithToolIdentity, toolRequestHeaders };
