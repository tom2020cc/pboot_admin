import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { SitesService } from '../sites/sites.service';
import { InformationData } from './site-information.fields';
import { parseUploadedImage } from '../common/pboot-uploaded-images';

export type InformationAsset = { path: string; hash: string; bytes: Buffer };
export function informationOnlineTarget(sites: SitesService) {
  const site = sites.getCurrentSite();
  try {
    const config = JSON.parse(fs.readFileSync(path.join(sites.getCurrentSiteStorageDir('ftp'), 'ftp.config.json'), 'utf8'));
    const license = JSON.parse(fs.readFileSync(path.join(sites.getCurrentSiteStorageDir('state'), 'system-license.json'), 'utf8'));
    const domains = license.profiles?.baota?.domains;
    if (license.siteId !== site.id || !Array.isArray(domains) || !domains.length || domains.some(d => typeof d !== 'string' || !/^[a-z0-9.-]+$/.test(d))) throw new Error();
    if (!config.host || !config.user || !config.password || config.secure !== true) throw new Error();
    const revision = createHash('sha256').update(JSON.stringify([site.id, config, domains])).digest('hex');
    return { config, domains: domains as string[], revision, url: `https://${domains[0]}` };
  } catch { throw new BadRequestException('请先在站点管理填写线上域名，并在网站发布保存当前网站的 FTPS 加密连接'); }
}

export function prepareInformationOnline(sites: SitesService, items: { language: string; data: InformationData }[], onlineDomains: string[]) {
  const site = sites.getCurrentSite(), assets = new Map<string, InformationAsset>();
  let total = 0;
  const safeFile = (root: string, relative: string) => {
    const target = path.resolve(root, relative), rel = path.relative(root, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new BadRequestException('图片路径越过当前站点');
    let cursor = root;
    if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) throw new BadRequestException('图片目录无效');
    for (const part of rel.split(path.sep)) {
      cursor = path.join(cursor, part);
      if (!fs.existsSync(cursor) || fs.lstatSync(cursor).isSymbolicLink()) throw new BadRequestException(`图片不存在或路径无效：${relative}`);
    }
    const actual = path.relative(fs.realpathSync(root), fs.realpathSync(target));
    if (actual.startsWith('..') || path.isAbsolute(actual)) throw new BadRequestException('图片实际路径越过当前站点');
    return target;
  };
  const media = (input: string): string => {
    if (!input) return input;
    let value = input.trim(), file: string;
    const upload = parseUploadedImage(value);
    if (upload) {
      if (upload.siteId && upload.siteId !== site.id) throw new BadRequestException('图片属于其他站点');
      const root = path.join(sites.getCurrentSiteStorageDir('api'), 'uploads');
      if (fs.existsSync(path.join(root, upload.filename))) file = safeFile(root, upload.filename);
      else if (sites.isDefaultSite(site.id)) file = safeFile(path.join(process.cwd(), 'uploads'), upload.filename);
      else throw new BadRequestException('当前网站的上传图片不存在');
    } else {
      if (/^(https?:)?\/\//i.test(value)) {
        const url = new URL(value, 'https://placeholder.invalid');
        if (site.publicBaseUrl && url.origin === new URL(site.publicBaseUrl).origin) value = url.pathname;
        else {
          if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.local') || url.hostname.endsWith('.c')) throw new BadRequestException('图片包含本地地址，请上传到当前站点后重试');
          return input;
        }
      }
      try { value = decodeURIComponent(value.split(/[?#]/)[0]); } catch { throw new BadRequestException('图片路径编码无效'); }
      if (!/^\/?(?:static|uploads)\//i.test(value) || /[\\\x00-\x1f]/.test(value)) throw new BadRequestException('图片必须是当前网站图片或 HTTP(S) 外链');
      file = safeFile(site.rootPath, value.replace(/^\//, ''));
    }
    if (!/\.(jpg|jpeg|png|gif|webp|avif|bmp|ico|svg)$/i.test(file)) throw new BadRequestException('不支持的图片类型');
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new BadRequestException('图片不存在或超过 5 MB');
    const bytes = fs.readFileSync(file), digest = createHash('sha256').update(bytes).digest('hex');
    const destination = `static/codex/site-information-online/${digest}${path.extname(file).toLowerCase()}`;
    if (!assets.has(destination)) {
      total += bytes.length;
      if (total > 20 * 1024 * 1024 || assets.size >= 100) throw new BadRequestException('本次图片超过 20 MB 或 100 张，请按语言分批同步');
      assets.set(destination, { path: destination, hash: digest, bytes });
    }
    return '/' + destination;
  };
  const html = (value: string) => String(value || '').replace(/<img\b[^>]*>/gi, tag => tag.replace(/(\s+src\s*=\s*)(["'])(.*?)\2/i,
    (_match, prefix, quote, src) => `${prefix}${quote}${media(String(src).replace(/&amp;/gi, '&'))}${quote}`));
  const prepared = items.map(item => {
    const data: InformationData = JSON.parse(JSON.stringify(item.data));
    // Domain/template are explicit language settings. Only statistics stay environment-specific.
    delete data.site.statistical;
    if (data.site.domain) {
      let url: URL;
      try { url = new URL(/^https?:\/\//i.test(data.site.domain) ? data.site.domain : `https://${data.site.domain}`); }
      catch { throw new BadRequestException(`${item.language} 的站点域名格式无效`); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
          !['', '/'].includes(url.pathname) || url.search || url.hash ||
          !onlineDomains.includes(url.hostname.toLowerCase())) {
        throw new BadRequestException(`${item.language} 的站点域名不在当前网站的线上域名列表中，请核对后再同步`);
      }
    }
    data.site.logo = media(data.site.logo); data.company.weixin = media(data.company.weixin);
    data.site.copyright = html(data.site.copyright); data.company.other = html(data.company.other);
    return { language: item.language, data };
  });
  return { items: prepared, assets: [...assets.values()] };
}
