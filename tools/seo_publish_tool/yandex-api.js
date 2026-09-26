function origin(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url.origin;
  } catch { throw new Error('Yandex 站点必须是完整的线上域名（包含 http/https）。'); }
}

function russianPages(report) {
  const pages = report.urls.filter(page => page.lang === 'ru');
  const origins = [...new Set(pages.map(page => new URL(page.url).origin))];
  if (origins.length !== 1) throw new Error('请先在区域管理配置唯一的 RU 线上域名，并同步俄语栏目到 PB。');
  const site = origin(origins[0]);
  if (report.urls.some(page => page.lang !== 'ru' && new URL(page.url).origin === site)) throw new Error('俄语与其他语言共用域名，请先配置独立俄语站，再提交 Yandex。');
  return { site, urls: [...new Set([site + '/', ...pages.map(page => page.url)])] };
}

function selectHost(hosts, site) {
  const expected = origin(site);
  if (!hosts.length) throw new Error('Token 有效，但该账号没有添加任何网站。请确认 OAuth 与 Webmaster 使用同一个账号，再添加并验证俄语站。');
  const match = hosts.find(item => {
    try { return origin(item.ascii_host_url || item.unicode_host_url) === expected; } catch { return false; }
  });
  if (!match) throw new Error(`请在 Yandex 添加并验证 ${expected}/。HTTP、HTTPS 和各子域名是不同站点。`);
  if (match.verified !== true || !match.host_id) throw new Error(`Yandex 尚未验证 ${expected}/ 的所有权，请先完成网站验证。`);
  return match;
}

function apiError(result) {
  const errors = {
    HOST_NOT_VERIFIED: '网站所有权未验证，请先完成验证',
    INVALID_USER_ID: 'Token 与账号不匹配，请重新保存当前账号的 Token',
    INVALID_OAUTH_TOKEN: 'Token 无效或已过期，请重新授权',
    INVALID_TOKEN: 'Token 无效或已过期，请重新授权',
    ACCESS_FORBIDDEN: 'Token 缺少 Webmaster 权限，请重新授权',
  };
  return errors[result.data?.error_code] || (result.status === 401 ? 'Token 无效或已过期，请重新授权'
    : result.status === 403 ? '账号或 Token 没有访问权限，请检查 Webmaster 授权'
    : result.status === 429 ? '已达到接口额度，请稍后重试'
    : `Yandex 未确认操作（HTTP ${result.status}）`);
}

function createApi(fetchImpl = fetch) {
  return async function request(pathname, token, options = {}) {
    if (!token) throw new Error('请先保存 Yandex OAuth Token。');
    // Only retry read requests. A timed-out submission may already have been accepted.
    const attempts = !options.method || options.method === 'GET' ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetchImpl(`https://api.webmaster.yandex.net/v4${pathname}`, {
          ...options, redirect: 'error',
          headers: { 'Content-Type': 'application/json', Authorization: `OAuth ${token}` },
          signal: AbortSignal.timeout(15000),
        });
        const data = await response.json().catch(() => null);
        return { ok: response.ok && !!data && !data.error_code, status: response.status, data };
      } catch {
        if (attempt + 1 === attempts) throw new Error('无法连接 Yandex API，尚未确认操作结果。请检查网络后重试；不要连续重复提交。');
      }
    }
  };
}

async function submitSitemap(api, { token, userId, hostId, site, sitemapUrl }) {
  const target = new URL(sitemapUrl);
  if (target.origin !== origin(site) || target.username || target.password || target.hash) throw new Error('网站地图必须属于当前俄语站，不能提交其他域名。');
  const result = await api(`/user/${encodeURIComponent(userId)}/hosts/${encodeURIComponent(hostId)}/user-added-sitemaps`, token, {
    method: 'POST', body: JSON.stringify({ url: target.href }),
  });
  const alreadyAdded = result.status === 409 && result.data?.error_code === 'SITEMAP_ALREADY_ADDED' && !!result.data.sitemap_id;
  const ok = (result.ok && result.status === 201 && !!result.data?.sitemap_id) || alreadyAdded;
  return { ok: Boolean(ok), status: result.status, sitemapUrl: target.href,
    message: ok ? `${alreadyAdded ? '此网站地图已在 Yandex 中，无需重复添加' : 'Yandex 已接收俄语站网站地图'}。接下来等待抓取；提交不代表已收录。` : apiError(result) };
}

module.exports = { origin, russianPages, selectHost, apiError, createApi, submitSitemap };
