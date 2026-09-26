import { BadRequestException } from '@nestjs/common';

// ay_area accepts several hosts; ay_site is a single public URL/host.
export function domainHost(input: string): string {
  const value = String(input || '').trim();
  if (!value) return '';
  if (/[\s,，\\?#]/.test(value)) throw new BadRequestException('域名只能填写网站根地址，不能含路径、参数或多个地址');
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); }
  catch { throw new BadRequestException('域名格式无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' ||
      !/^[a-z0-9.-]+$/i.test(url.hostname) || url.hostname.includes('..')) throw new BadRequestException('请填写有效的网站根域名');
  return url.hostname.toLowerCase().replace(/\.$/, '') + (url.port ? `:${url.port}` : '');
}

export function boundHosts(input: string): string[] {
  return [...new Set(String(input || '').split(/[,，]/).map(domainHost).filter(Boolean))];
}

export function primaryDomain(binding: string, previous = ''): string {
  const host = boundHosts(binding)[0] || '';
  if (!host) return '';
  const scheme = previous.trim().match(/^https?:\/\//i)?.[0].toLowerCase() || '';
  return scheme + host;
}

export function replacePrimaryDomain(binding: string, primary: string): string {
  const host = domainHost(primary);
  if (!host) return '';
  const hosts = boundHosts(binding);
  // Changing the main domain retains aliases (www etc.); selecting an alias promotes it.
  const aliases = hosts.includes(host) ? hosts : hosts.slice(1);
  return [...new Set([host, ...aliases])].join(',');
}

export function assertDomainAvailable(db: any, language: string, binding: string) {
  const hosts = boundHosts(binding);
  const statement = db.prepare("SELECT acode,domain FROM ay_area WHERE acode<>? AND coalesce(pcode,'0')='0'");
  try {
    statement.bind([language]);
    while (statement.step()) {
      const other = statement.getAsObject();
      if (boundHosts(String(other.domain || '')).some(host => hosts.includes(host))) {
        throw new BadRequestException(`域名已绑定到 ${other.acode} 区域，请先解除重复绑定`);
      }
    }
  } finally { statement.free(); }
}
