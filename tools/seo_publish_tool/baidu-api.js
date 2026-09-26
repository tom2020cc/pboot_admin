const fs = require('fs');

function siteOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('请填写完整的中文站地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
    || url.pathname !== '/' || url.search || url.hash) throw new Error('中文站地址只能包含协议和域名。');
  return url.origin;
}

function chinesePages(report) {
  const pages = report.urls.filter(page => page.lang === 'cn');
  const origins = [...new Set(pages.map(page => new URL(page.url).origin))];
  if (origins.length !== 1) throw new Error('未找到唯一的 CN 线上域名，请先检查区域管理中的中文站域名。');
  const site = siteOrigin(origins[0]);
  if (report.urls.some(page => page.lang !== 'cn' && new URL(page.url).origin === site)) {
    throw new Error('中文与其他语言共用域名，请先配置独立的中文站域名，再使用百度提交。');
  }
  return { site, urls: [...new Set([site + '/', ...pages.map(page => page.url)])] };
}

function readHistory(file) {
  if (!fs.existsSync(file)) return { accepted: {}, lastResult: null };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { accepted: data.accepted || {}, lastResult: data.lastResult || null };
}

function createBaiduApi(fetchImpl = fetch) {
  return async function submit({ site, token, urls }) {
    const origin = siteOrigin(site);
    if (!token) throw new Error('请先保存此中文站的百度推送 Token。');
    const list = [...new Set(urls)];
    if (!list.length || list.length > 100) throw new Error('每次提交 1–100 个中文站页面。');
    for (const value of list) {
      let url;
      try { url = new URL(value); } catch { throw new Error('提交列表存在无效网址，已停止提交。'); }
      if (url.origin !== origin || url.username || url.password || url.hash) {
        throw new Error('提交列表混入其他站点、协议或无效网址，已停止提交。');
      }
    }
    let response, text;
    try {
      response = await fetchImpl(`http://data.zz.baidu.com/urls?site=${encodeURIComponent(origin)}&token=${encodeURIComponent(token)}`, {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'text/plain' },
        body: list.join('\n'), signal: AbortSignal.timeout(30000),
      });
      text = await response.text();
    } catch {
      throw new Error('未收到百度接口的确认结果，请稍后查看百度平台反馈；不要连续重复提交。');
    }
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    const validCount = Number.isInteger(data.success) && data.success >= 0 && data.success <= list.length;
    const success = validCount ? data.success : 0;
    const remain = Number.isInteger(data.remain) && data.remain >= 0 ? data.remain : null;
    const notValid = Array.isArray(data.not_valid) ? data.not_valid.filter(url => list.includes(url)) : [];
    const notSameSite = Array.isArray(data.not_same_site) ? data.not_same_site.filter(url => list.includes(url)) : [];
    const accepted = response.ok && !data.error && validCount;
    const ok = Boolean(accepted && success === list.length && !notValid.length && !notSameSite.length);
    const errorText = String(data.message || '').split(token).join('[已隐藏]').replace(/token=[^\s&]+/gi, 'token=[已隐藏]').slice(0, 180);
    const help = /site init fail/i.test(errorText)
      ? '。百度返回站点初始化失败，尚未确认接收。请在百度普通收录中检查此中文站状态，稍后先测试首页；持续失败可向百度反馈。'
      : '';
    return { ok, status: response.status, submitted: list.length, success, remain, notValid, notSameSite,
      message: accepted
        ? `百度接收 ${success}/${list.length} 条${remain === null ? '' : `，今日剩余额度 ${remain}`}。${ok ? '提交成功不代表已经收录。' : '未全部接收，请到百度平台查看反馈后处理。'}`
        : `百度未确认接收（HTTP ${response.status}${data.error ? `，错误 ${data.error}` : ''}）${errorText ? `：${errorText}` : '。请检查 Token、站点权限和接口额度。'}${help}` };
  };
}

module.exports = { siteOrigin, chinesePages, readHistory, createBaiduApi };
