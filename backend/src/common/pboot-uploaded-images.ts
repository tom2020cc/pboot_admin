import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { SitesService } from '../sites/sites.service';

type UploadSite = Pick<SitesService, 'getCurrentSiteId' | 'getCurrentSiteStorageDir' | 'isDefaultSite'>;
const imageExtension = /\.(?:jpe?g|png|gif|webp|avif|bmp|ico|svg|tiff?|jfif|heic|heif)$/i;

export function parseUploadedImage(value: string): { filename: string; siteId?: number } | undefined {
  const source = String(value || '').trim();
  if (!source || /^(?:data|blob):/i.test(source) || /^\/?static\//i.test(source)) return;
  let filename = source;
  let siteId: number | undefined;
  if (/^(?:https?:)?\/\//i.test(source) || /[/?#]/.test(source)) {
    let url: URL;
    try { url = new URL(source, 'http://upload.invalid'); } catch { return; }
    const managed = url.pathname.match(/^\/img-upload\/file\/([^/]+)$/i);
    const legacy = url.pathname.match(/^\/uploads?\/([^/]+)$/i);
    if (!managed && !legacy) return;
    const remote = /^(?:https?:)?\/\//i.test(source) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (remote && (!managed || !url.searchParams.has('siteId'))) return;
    filename = (managed || legacy)![1];
    if (url.searchParams.has('siteId')) {
      siteId = Number(url.searchParams.get('siteId'));
      if (!Number.isInteger(siteId) || siteId < 1) throw new BadRequestException('图片所属网站无效，请重新上传图片');
    }
  }
  try { filename = decodeURIComponent(filename); } catch { throw new BadRequestException('图片文件名编码无效'); }
  if (/[\\/:\x00-\x1f]/.test(filename) || !imageExtension.test(filename)) return;
  return { filename, siteId };
}

export function copyUploadedImageToPboot(value: string, sites: UploadSite, siteRoot: string, now: string, kind: 'news' | 'products' | 'pages' | 'menus') {
  const upload = parseUploadedImage(value);
  if (!upload) return value || '';
  const siteId = sites.getCurrentSiteId();
  if (upload.siteId !== undefined && upload.siteId !== siteId) {
    throw new BadRequestException('正文图片属于其他网站，请在当前网站重新上传后同步');
  }
  const siteSource = path.join(sites.getCurrentSiteStorageDir('api'), 'uploads', upload.filename);
  const legacySource = path.join(process.cwd(), 'uploads', upload.filename);
  const source = fs.existsSync(siteSource) ? siteSource : sites.isDefaultSite(siteId) ? legacySource : siteSource;
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new BadRequestException(`上传图片 ${upload.filename} 不存在，请重新上传后同步`);
  }
  const relativeDir = `/static/codex/${kind}/${now.slice(0, 10).replace(/-/g, '')}`;
  const targetDir = path.join(siteRoot, relativeDir);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(source, path.join(targetDir, upload.filename));
  return `${relativeDir}/${encodeURIComponent(upload.filename)}`;
}

export function rewriteUploadedHtmlImages(html: string, copy: (src: string) => string) {
  return String(html || '').replace(/<img\b[^>]*>/gi, tag => tag.replace(
    /(\s+src\s*=\s*)(["'])(.*?)\2/i,
    (_match, prefix, quote, src) => `${prefix}${quote}${copy(String(src).replace(/&amp;/gi, '&'))}${quote}`,
  ));
}
