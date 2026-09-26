import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export async function browseProductDirectory(siteRoot: string, input = '') {
  if (!siteRoot || !path.isAbsolute(siteRoot)) throw new BadRequestException('当前网站未配置有效的服务器根目录，请检查站点管理');
  let root: string;
  try {
    root = await fs.promises.realpath(siteRoot);
    if (!(await fs.promises.stat(root)).isDirectory()) throw new Error('Not a directory');
  } catch {
    throw new BadRequestException('当前网站根目录不存在或无法读取，请检查站点管理中的服务器路径');
  }
  const selected = String(input || '').trim();
  if (selected && (!path.isAbsolute(selected) || /[\x00-\x1f]/.test(selected))) {
    throw new BadRequestException('请选择服务器上的绝对目录路径');
  }
  // Validate the real target as well as the requested path to contain directory links.
  const requested = selected ? path.resolve(selected) : root;
  if (!within(root, requested) && !within(path.resolve(siteRoot), requested)) throw new BadRequestException('只能浏览当前网站根目录及其子目录');
  let directory: string;
  try { directory = await fs.promises.realpath(requested); }
  catch { throw new BadRequestException('目录不存在或无法读取'); }
  if (!within(root, directory)) throw new BadRequestException('目录链接超出当前网站根目录');
  try {
    if (!(await fs.promises.stat(directory)).isDirectory()) throw new Error('Not a directory');
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    const folders = entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'));
    if (folders.length > 1000) throw new BadRequestException('当前目录子目录超过 1000 个，请直接填写更具体的资料目录');
    return {
      rootPath: root, currentPath: directory, relativePath: path.relative(root, directory),
      parentPath: directory === root ? null : path.dirname(directory),
      directories: folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })).map(entry => ({
        name: entry.name, path: path.join(directory, entry.name),
      })),
    };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('目录无法读取，请在宝塔检查目录是否存在及后台进程的读取权限');
  }
}
