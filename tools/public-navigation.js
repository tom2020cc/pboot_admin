function publicBase(configured, port) {
  const url = new URL(configured || `http://localhost:${port}/`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Public tool URLs must be HTTP(S) addresses without credentials.');
  }
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function buildPublicNavigation(env, ports, active, withSite = value => value) {
  const admin = publicBase(env.ADMIN_PUBLIC_URL, ports.frontendPort);
  const seo = publicBase(env.SEO_PUBLIC_URL, ports.seoPort);
  const ftp = publicBase(env.FTP_PUBLIC_URL, ports.ftpPort);
  const entries = [
    ['admin', '\u7ba1\u7406\u540e\u53f0', '#/', admin],
    ['sites', '\u7ad9\u70b9\u7ba1\u7406', '#/sites', admin],
    ['quotation', '\u62a5\u4ef7\u5355\u751f\u6210', '#/quotations', admin],
    ['brochure', '\u4ea7\u54c1\u751f\u6210PDF', '#/brochures', admin],
    ['seo', 'SEO \u68c0\u67e5', '', seo],
    ['models', '\u6a21\u578b\u603b\u89c8', 'models.html', seo],
    ['models-config', '\u6a21\u578b\u914d\u7f6e', 'models-config.html', seo],
    ['ftp', 'FTP \u53d1\u5e03', '', ftp],
    ['tutorial', '\u90e8\u7f72\u6559\u7a0b', '#/deployment-tutorial', admin],
  ];
  if (env.NODE_ENV !== 'production' || env.ENABLE_SWAGGER === 'true') {
    const backend = publicBase(env.BACKEND_PUBLIC_URL, ports.backendPort);
    entries.splice(1, 0, ['backend', '\u540e\u7aef\u63a5\u53e3', 'api-docs', backend]);
  }
  if (active === 'ftp') entries.push(['ftp-security', 'FTP \u5b89\u5168\u5de1\u68c0', 'security.html', ftp]);
  return entries.map(([id, label, route, base]) => ({
    id, label, url: withSite(new URL(route, base).toString()), active: id === active,
  }));
}

module.exports = { buildPublicNavigation };
