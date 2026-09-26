function createBingApi(fetcher = (...args) => fetch(...args)) {
  async function request(method, apiKey, params = {}, post = false) {
    if (!apiKey) throw new Error('请先配置共享或当前网站专用的 Bing API Key。');
    const url = new URL(`https://ssl.bing.com/webmaster/api.svc/json/${method}`);
    url.searchParams.set('apikey', apiKey);
    if (!post) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response;
    try {
      response = await fetcher(url.toString(), {
        method: post ? 'POST' : 'GET', signal: AbortSignal.timeout(30000),
        ...(post ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) } : {}),
      });
    } catch { throw new Error('无法连接 Bing API，请检查网络后重试。'); }
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`Bing 返回了无法识别的结果（HTTP ${response.status}），请稍后重试。`); }
    if (!response.ok || data?.ErrorCode || data?.Message || !data || !Object.hasOwn(data, 'd')) {
      throw new Error(`Bing API 请求未成功（HTTP ${response.status}）。请检查 API Key、当前网站地址和账号验证权限。`);
    }
    return data.d;
  }
  async function test(apiKey, siteUrl) {
    const sites = await request('GetUserSites', apiKey);
    const normalize = value => {
      try { const u = new URL(value); return u.origin + u.pathname.replace(/\/+$/, ''); }
      catch { return ''; }
    };
    const allowed = Array.isArray(sites) && sites.some(site => site.IsVerified === true && normalize(site.Url) === normalize(siteUrl) && normalize(siteUrl));
    return { ok: Boolean(allowed), siteUrl, message: allowed ? `账号连接成功，当前网站已验证：${siteUrl}`
      : `账号可连接，但当前网站尚未验证或站点地址不匹配：${siteUrl}。请先在 Bing 添加并验证这个网站。` };
  }
  async function sitemap(apiKey, siteUrl, sitemapUrl) {
    await request('SubmitFeed', apiKey, { siteUrl, feedUrl: sitemapUrl }, true);
    return { ok: true, siteUrl, sitemapUrl, message: `Bing 已接收网站地图：${sitemapUrl}。接下来等待抓取，提交成功不代表已收录。` };
  }
  async function inspect(apiKey, siteUrl, targetUrl) {
    const d = await request('GetUrlInfo', apiKey, { siteUrl, url: targetUrl });
    const rawDate = d?.LastCrawledDate || '';
    const match = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(rawDate);
    const date = match ? new Date(Number(match[1])) : new Date(rawDate);
    const lastCrawled = Number.isFinite(date.getTime()) && date.getFullYear() > 1970 ? date.toISOString() : '';
    // UrlInfo has crawl data, but no authoritative indexed boolean.
    return { ok: true, siteUrl, inspectionUrl: targetUrl, indexed: null, lastCrawled,
      httpCode: d?.HttpStatus || '',
      message: `${lastCrawled ? 'Bing 已有抓取记录' : 'Bing 暂未返回有效抓取时间'}；此接口无法确认是否已收录，请在 Bing“URL 检查”中查看。` };
  }
  return { test, sitemap, inspect };
}
module.exports = { createBingApi };
