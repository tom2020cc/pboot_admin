#!/usr/bin/env node
// 提交当前项目尚未确认接收的中文页面，一次最多 100 条，不循环、不自动启动服务。
// SEO_TOOL_PORT=5388 SEO_SITE_ID=1 node auto-submit-baidu.js
const fs = require('fs');
const path = require('path');
let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'seo.config.json'), 'utf8')); } catch {}
const port = Number(process.env.SEO_TOOL_PORT || config.localPort || 5388);
const siteId = String(process.env.SEO_SITE_ID || '').trim();
async function request(route, body) {
  const url = new URL(route, `http://127.0.0.1:${port}`);
  if (siteId) url.searchParams.set('siteId', siteId);
  const response = await fetch(url, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000) });
  let data;
  try { data = await response.json(); } catch { throw new Error('SEO 工具未就绪或需要登录，请通过页面操作。'); }
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data;
}
async function main() {
  if (!siteId || !/^\d+$/.test(siteId)) throw new Error('请用 SEO_SITE_ID 指定项目，避免多网站时提交错误站点。');
  const status = await request('/api/baidu/status');
  if (!status.ready) throw new Error('请先在百度页面保存当前中文站的 Token。');
  const urls = status.urls.slice(0, 100);
  console.log(`中文站：${status.site}；待提交 ${status.pending} 条。`);
  if (!urls.length) { console.log('没有新的待提交页面。'); return; }
  const result = await request('/api/baidu/push', { site: status.site, urls });
  console.log(result.message);
  if (!result.ok) process.exitCode = 1;
}
main().catch(() => { console.error('提交未完成。请确认 SEO 服务已启动、SEO_SITE_ID 正确，并在百度页面查看具体配置与提交反馈。'); process.exitCode = 1; });
