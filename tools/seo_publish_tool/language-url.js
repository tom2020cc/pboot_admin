function languageBaseUrl(config, acode, areas, usePublicUrl) {
  const clean = value => String(value || '').trim().replace(/\/+$/, '');
  const baseUrl = clean(usePublicUrl ? config.siteBaseUrl : config.localTestBaseUrl || config.siteBaseUrl);
  if (!usePublicUrl || !config.useLanguageSubdomains) return baseUrl;
  const defaultCode = String(areas.find(area => String(area.is_default) === '1')?.acode || 'en');
  const code = String(acode || defaultCode);
  const domain = String(areas.find(area => String(area.acode) === code)?.domain || '').trim();
  // Local default language can differ from the language served at the public root.
  if (domain) {
    const configured = new URL(/^https?:\/\//i.test(domain) ? domain : `${new URL(baseUrl).protocol}//${domain}`);
    if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password
      || configured.pathname !== '/' || configured.search || configured.hash) throw new Error(`语言 ${code} 的区域域名格式不正确，请在区域管理中检查。`);
    const host = configured.hostname;
    if (host === 'localhost' || /^127\./.test(host) || /\.(c|local|test|localhost)$/i.test(host)) {
      throw new Error(`语言 ${code} 的区域域名仍是本地域名，请先填写正确的线上域名。`);
    }
    return configured.origin;
  }
  if (code === defaultCode) return baseUrl;
  const parsed = new URL(baseUrl);
  parsed.hostname = `${code}.${parsed.hostname.replace(/^www\./i, '')}`;
  return clean(parsed.toString());
}
module.exports = { languageBaseUrl };
