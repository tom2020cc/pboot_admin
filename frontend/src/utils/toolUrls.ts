export function buildToolUrls(origin: string, env: Record<string, string | undefined>, apiBase: string) {
  const current = new URL(origin);
  const externalBase = (configured: string | undefined, port: string | undefined, fallback: number) => {
    const url = new URL(configured || current.origin, current.origin);
    if (!configured) url.port = String(Number(port) > 0 && Number(port) <= 65535 ? Number(port) : fallback);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('工具地址只支持 HTTP 或 HTTPS');
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.toString();
  };
  const seo = externalBase(env.VITE_SEO_TOOL_URL, env.VITE_SEO_TOOL_PORT, 5388);
  const ftp = externalBase(env.VITE_FTP_TOOL_URL, env.VITE_FTP_TOOL_PORT, 5389);
  return {
    admin: `${current.origin}/#/`,
    sites: `${current.origin}/#/sites`,
    quotation: `${current.origin}/#/quotations`,
    brochure: `${current.origin}/#/brochures`,
    backend: new URL(`${apiBase.replace(/\/+$/, '')}/api-docs`, current.origin).toString(),
    seo,
    models: new URL('models.html', seo).toString(),
    modelsConfig: new URL('models-config.html', seo).toString(),
    ftp,
  };
}
