const crypto = require('node:crypto');
const cheerio = require('cheerio');
const LANGUAGES = new Set(['cn', 'zh', 'en', 'es', 'fr', 'ru', 'ar', 'pt', 'id', 'tr', 'vi']);

function publicUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return null;
    if (!url.hostname.includes('.') || /[\[\]:]/.test(url.hostname) || /^\d+(\.\d+){3}$/.test(url.hostname)
      || /\.(localhost|local|test|internal)$/.test(url.hostname)) return null;
    return url;
  } catch { return null; }
}

function belongsToSite(value, config) {
  const url = publicUrl(value), base = publicUrl(config.siteBaseUrl);
  if (!url || !base || url.port !== base.port) return false;
  const root = base.hostname.replace(/^www\./, '');
  const prefix = url.hostname.endsWith('.' + root) ? url.hostname.slice(0, -root.length - 1) : '';
  const hostMatches = url.hostname === base.hostname
    || (config.useLanguageSubdomains !== false && LANGUAGES.has(prefix));
  const basePath = base.pathname.replace(/\/+$/, '');
  return hostMatches && (!basePath || url.pathname === basePath || url.pathname.startsWith(basePath + '/'));
}

function propertyContains(property, value) {
  const url = publicUrl(value);
  if (!url) return false;
  if (property.startsWith('sc-domain:')) {
    const host = property.slice(10);
    return !!host && (url.hostname === host || url.hostname.endsWith('.' + host));
  }
  const prefix = publicUrl(property);
  return !!prefix && prefix.origin === url.origin && url.href.startsWith(prefix.href);
}

function assertGoogleScope(config, property, value = '') {
  const base = publicUrl(config.siteBaseUrl);
  const root = base?.hostname.replace(/^www\./, '');
  const validDomain = property === `sc-domain:${root}` || property === `sc-domain:${base?.hostname}`;
  const validPrefix = !property.startsWith('sc-domain:') && belongsToSite(property, config);
  if (!base || (!validDomain && !validPrefix)) throw new Error('Search Console 属性不属于当前网站，请切换网站或修正属性。');
  if (value && (!belongsToSite(value, config) || !propertyContains(property, value))) {
    throw new Error('该 URL 不属于当前网站或所选 Search Console 属性，已阻止跨网站请求。');
  }
}

function tokenCacheKey(account, scope, siteId) {
  return crypto.createHash('sha256').update(JSON.stringify([String(siteId || ''), account.client_email,
    String(account.private_key).replace(/\\n/g, '\n'), scope])).digest('hex');
}

function indexingPageType(html) {
  const $ = cheerio.load(html);
  let found = '';
  const hasType = (node, type) => [node?.['@type']].flat().includes(type);
  function walk(node, inVideo = false, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 30) return;
    if (hasType(node, 'JobPosting')) found = 'JobPosting';
    if (inVideo && hasType(node, 'BroadcastEvent')) found = 'BroadcastEvent';
    const video = inVideo || hasType(node, 'VideoObject');
    for (const value of Object.values(node)) if (typeof value === 'object') walk(value, video, depth + 1);
  }
  $('script[type="application/ld+json"]').each((_, el) => { try { walk(JSON.parse($(el).html())); } catch {} });
  return found;
}

module.exports = { publicUrl, belongsToSite, propertyContains, assertGoogleScope, tokenCacheKey, indexingPageType };
