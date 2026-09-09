import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

const isInside = (root: string, filename: string) => {
  const relative = path.relative(root, filename);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const publicUrl = (siteRoot: string, filename: string) =>
  `/${path.relative(siteRoot, filename).split(path.sep).map(encodeURIComponent).join('/')}`;

export function existingSiteAssetUrl(siteRoot: string, filename: string): string | undefined {
  const root = path.resolve(siteRoot);
  const staticRoot = path.join(root, 'static');
  const source = path.resolve(filename);
  if (!isInside(staticRoot, source) || !fs.existsSync(source) || !fs.statSync(source).isFile()) return;
  // A junction below static must not make another site's files count as local.
  const realRoot = fs.realpathSync(root);
  const realStatic = fs.realpathSync(staticRoot);
  const realSource = fs.realpathSync(source);
  if (!isInside(realRoot, realStatic) || !isInside(realStatic, realSource)) return;
  return publicUrl(root, source);
}

export function createFolderAssetResolver(siteRoot: string, sourceDirectory: string, destination: string) {
  const root = path.resolve(siteRoot);
  const targetDirectory = path.resolve(root, destination);
  if (!isInside(path.join(root, 'static'), targetDirectory)) throw new BadRequestException('导入图片目标目录无效');
  const assets = new Map<string, string>();

  return (filename: string) => {
    if (!filename) return '';
    if (assets.has(filename)) return assets.get(filename)!;
    if (path.basename(filename) !== filename || /[\\/:\x00-\x1f]/.test(filename) || filename === '.' || filename === '..') {
      throw new BadRequestException('导入图片文件名无效');
    }
    const source = path.join(sourceDirectory, filename);
    let url = existingSiteAssetUrl(root, source);
    if (!url) {
      const target = path.join(targetDirectory, filename.toLowerCase());
      fs.mkdirSync(targetDirectory, { recursive: true });
      fs.copyFileSync(source, target);
      url = publicUrl(root, target);
    }
    assets.set(filename, url);
    return url;
  };
}
