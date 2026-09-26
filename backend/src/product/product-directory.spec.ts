import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { browseProductDirectory } from './product-directory';

describe('current site product directory browsing', () => {
  let root: string, site: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-directory-'));
    site = path.join(root, 'site');
    fs.mkdirSync(path.join(site, 'static', 'Rigs 中文', 'CR1000I'), { recursive: true });
    fs.mkdirSync(path.join(site, '.git'));
    fs.writeFileSync(path.join(site, 'config.php'), 'private fixture');
  });
  afterEach(() => {
    if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'product-directory-'))) throw new Error('Unsafe test cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('lists only non-hidden child directories without touching source files', async () => {
    const result = await browseProductDirectory(site);
    expect(result).toMatchObject({ rootPath: await fs.promises.realpath(site), currentPath: await fs.promises.realpath(site), parentPath: null, relativePath: '' });
    expect(result.directories.map(d => d.name)).toEqual(['static']);
    const child = await browseProductDirectory(site, path.join(site, 'static', 'Rigs 中文'));
    expect(child.parentPath).toBe(path.join(await fs.promises.realpath(site), 'static'));
    expect(child.directories[0].name).toBe('CR1000I');
    const leaf = await browseProductDirectory(site, child.directories[0].path);
    expect(leaf.directories).toEqual([]);
    expect(fs.readFileSync(path.join(site, 'config.php'), 'utf8')).toBe('private fixture');
  });
  it('rejects sibling sites, traversal, files, missing paths and relative input', async () => {
    fs.mkdirSync(path.join(root, 'site-other'));
    for (const target of [root, path.join(root, 'site-other'), path.join(site, '..'), 'static', path.join(site, 'config.php'), path.join(site, 'missing')]) {
      await expect(browseProductDirectory(site, target)).rejects.toThrow();
    }
    await expect(browseProductDirectory('')).rejects.toThrow('未配置');
    await expect(browseProductDirectory(path.join(root, 'missing'))).rejects.toThrow('不存在');
  });
  it('does not list symlinks and blocks their external targets', async () => {
    const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(site, 'escape'), 'junction');
    expect((await browseProductDirectory(site)).directories.map(d => d.name)).toEqual(['static']);
    await expect(browseProductDirectory(site, path.join(site, 'escape'))).rejects.toThrow('超出');
  });
  it('handles a configured root alias without allowing access outside its real root', async () => {
    const alias = path.join(root, 'alias'); fs.symlinkSync(site, alias, 'junction');
    expect((await browseProductDirectory(alias, path.join(alias, 'static'))).currentPath).toBe(path.join(await fs.promises.realpath(site), 'static'));
  });
  it('reports directory read failure without leaking filesystem internals', async () => {
    const read = jest.spyOn(fs.promises, 'readdir').mockRejectedValueOnce(new Error('EACCES private detail'));
    try { await expect(browseProductDirectory(site)).rejects.toThrow('读取权限'); }
    finally { read.mockRestore(); }
  });
});
