import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { existingSiteAssetUrl } from './folder-import-assets';

// Sharp's CommonJS export is callable; the legacy TS resolver selects its ESM declarations.
const sharp: typeof import('sharp').default = require('sharp');

const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

function writeNewFile(filename: string, bytes: Buffer) {
  const fd = fs.openSync(filename, 'wx');
  try { fs.writeFileSync(fd, bytes); }
  catch (error) {
    fs.closeSync(fd);
    fs.unlinkSync(filename);
    throw error;
  }
  fs.closeSync(fd);
}

export async function createContentThumbnail(buffer: Buffer) {
  if (!buffer?.length || buffer.length > MAX_SOURCE_BYTES) throw new BadRequestException('缩略图源文件为空或超过 30MB');
  // Only raster formats; never pass SVG or other documents to an image renderer.
  const raster = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    || buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    || /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6));
  if (!raster) throw new BadRequestException('缩略图支持 JPG、PNG、WebP 和 GIF，请选择有效图片');
  try {
    return await sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error', pages: 1 })
      .rotate().flatten({ background: '#ffffff' })
      .resize(500, 400, { fit: 'contain', background: '#ffffff' })
      .jpeg({ quality: 90 }).toBuffer();
  } catch {
    throw new BadRequestException('图片损坏、尺寸过大或无法解码，缩略图未生成');
  }
}

function zeroJpeg(directory: string) {
  const name = fs.readdirSync(directory).find(name => name.toLowerCase() === '0.jpg');
  if (!name) return '';
  const stat = fs.lstatSync(path.join(directory, name));
  if (!stat.isFile() || stat.isSymbolicLink()) throw new BadRequestException('0.jpg 不是普通图片文件，请检查资料目录');
  return name;
}

export async function ensureFolderThumbnail(directory: string, sourceFile: string) {
  const existing = zeroJpeg(directory);
  if (existing) return existing;
  if (!sourceFile) return '';
  if (path.basename(sourceFile) !== sourceFile || /[\\/:\x00-\x1f]/.test(sourceFile)) throw new BadRequestException('缩略图源文件名无效');
  const source = path.join(directory, sourceFile);
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SOURCE_BYTES) throw new BadRequestException('缩略图源文件无效或超过 30MB');
  const bytes = await createContentThumbnail(fs.readFileSync(source));
  // Another import may have produced 0.jpg while the image was being decoded.
  const concurrent = zeroJpeg(directory);
  if (concurrent) return concurrent;
  try { writeNewFile(path.join(directory, '0.jpg'), bytes); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return zeroJpeg(directory);
    throw error;
  }
  return '0.jpg';
}

export function resolveContentThumbnailDirectory(siteRoot: string, modelName: string, references: string[], baseUrl: string, menuId: number, kind: 'product' | 'news' = 'product') {
  const entity = kind === 'news' ? '新闻' : '产品';
  const subject = kind === 'news' ? '新闻' : '型号';
  const titleLabel = kind === 'news' ? '中文新闻标题' : '中文产品型号 / 标题';
  const root = fs.realpathSync(siteRoot);
  const staticRoot = path.join(root, 'static');
  if (!modelName.trim()) throw new BadRequestException(`请先填写${titleLabel}，再上传缩略图`);
  const segment = modelName.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || kind;
  if (/^\.+$/.test(segment) || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment)) {
    throw new BadRequestException(`${entity}标题不能作为图片文件夹名称，请修改${titleLabel}`);
  }
  if (!Number.isSafeInteger(menuId) || menuId <= 0) throw new BadRequestException(`${entity}栏目无效`);
  if (!fs.existsSync(staticRoot)) fs.mkdirSync(staticRoot);
  if (fs.lstatSync(staticRoot).isSymbolicLink() || !inside(root, fs.realpathSync(staticRoot))) throw new BadRequestException('网站 static 目录无效');
  const names = new Set([modelName.trim().normalize('NFKC').toLowerCase(), segment.toLowerCase()]);
  const matches = (directory: string) => names.has(path.basename(directory).normalize('NFKC').toLowerCase());
  for (const reference of references.filter(Boolean)) {
    try {
      const url = new URL(reference, baseUrl);
      if (url.origin !== new URL(baseUrl).origin) continue;
      const filename = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!existingSiteAssetUrl(root, filename)) continue;
      const directory = path.dirname(filename);
      if (matches(directory)) return fs.realpathSync(directory);
    } catch { /* Unrelated or legacy image references are not model folders. */ }
  }
  const found: string[] = [];
  const pending = [staticRoot];
  let scanned = 0;
  while (pending.length) {
    if (++scanned > 5000) throw new BadRequestException(`图片目录较多，无法确定${subject}目录，请先设置正确目录中的${kind === 'news' ? '缩略图' : '产品大图'}地址`);
    const directory = pending.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(directory, entry.name);
      if (matches(child)) found.push(child);
      else pending.push(child);
    }
  }
  if (found.length > 1) throw new BadRequestException(`网站存在多个同名${subject}目录，请先设置正确目录中的${kind === 'news' ? '缩略图' : '产品大图'}地址，再上传缩略图`);
  if (found.length === 1) return fs.realpathSync(found[0]);
  const destination = path.join(staticRoot, 'codex', `${kind}-images`, String(menuId), segment);
  // Check existing ancestors before creating folders, including Windows junctions.
  let ancestor = destination;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (ancestor !== staticRoot && !inside(staticRoot, fs.realpathSync(ancestor))) throw new BadRequestException(`${subject}图片目录超出当前网站`);
  fs.mkdirSync(destination, { recursive: true });
  return fs.realpathSync(destination);
}

export async function saveUploadedContentThumbnail(siteRoot: string, directory: string, buffer: Buffer) {
  const bytes = await createContentThumbnail(buffer);
  const root = fs.realpathSync(siteRoot);
  const realDirectory = fs.realpathSync(directory);
  if (!inside(path.join(root, 'static'), realDirectory)) throw new BadRequestException('缩略图目录不属于当前网站');
  const filename = path.join(realDirectory, `thumbnail-${randomBytes(10).toString('hex')}.jpg`);
  writeNewFile(filename, bytes);
  return { url: existingSiteAssetUrl(root, filename)!, width: 500, height: 400 };
}
