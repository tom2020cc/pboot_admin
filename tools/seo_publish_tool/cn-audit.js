function normalize(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请使用中文页面的 HTTP 或 HTTPS 地址。');
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

function assertPage(url, report) {
  const allowed = [report.audit?.publicHome, report.audit?.localHome,
    ...report.urls.filter(row => row.lang === 'cn').flatMap(row => [row.url, row.localUrl])].filter(Boolean);
  const normalized = normalize(url);
  if (!allowed.some(value => normalize(value) === normalized)) {
    throw new Error('这里只体检当前网站的 CN 中文页面。请从中文页面列表选择，或先同步中文资料后重新检查。');
  }
  return new URL(url);
}

async function fetchPage(target, report, fetchImpl = fetch) {
  let url = assertPage(target, report);
  const signal = AbortSignal.timeout(20000);
  for (let step = 0; step < 6; step++) {
    const response = await fetchImpl(url, { redirect: 'manual', signal,
      headers: { 'User-Agent': 'PbootCMS-SEO-Audit/2.0', Accept: 'text/html,application/xhtml+xml' } });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        if (response.body?.cancel) await response.body.cancel();
        throw new Error(!response.ok
          ? `中文页面访问失败（HTTP ${response.status}）。请先检查该环境的网站地址、域名绑定和页面路径，再重新体检。`
          : '该地址没有返回 HTML 网页，请选择中文网站的页面地址。');
      }
      return { response, finalUrl: url.href };
    }
    const location = response.headers.get('location');
    if (response.body?.cancel) await response.body.cancel();
    if (!location) throw new Error('中文页面返回重定向，但没有目标地址。');
    // Check before fetching: never follow a redirect into another language or website.
    url = assertPage(new URL(location, url).href, report);
  }
  throw new Error('中文页面重定向次数过多，请检查网站跳转配置。');
}

function aiInput(body = {}) {
  return { ...body, mode: 'fix-cn', targetAcode: 'cn' };
}
module.exports = { assertPage, fetchPage, aiInput };
