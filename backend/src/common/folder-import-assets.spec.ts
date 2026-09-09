import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFolderAssetResolver, existingSiteAssetUrl } from './folder-import-assets';
import { ProductService } from '../product/product.service';
import { NewsService } from '../news/news.service';

describe('folder imports reference current-site static images', () => {
  let root: string;
  let siteRoot: string;
  const destination = 'static/codex/folder-import/12/CR600P';
  const write = (directory: string, filename: string, value = 'original image') => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, filename), value);
  };
  const url = (file: string) => '/' + path.relative(siteRoot, file).split(path.sep).map(encodeURIComponent).join('/');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-folder-asset-'));
    siteRoot = path.join(root, 'selected-site');
    fs.mkdirSync(path.join(siteRoot, 'static'), { recursive: true });
  });

  afterEach(() => {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('pboot-folder-asset-')) {
      throw new Error('Unexpected test cleanup directory');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('uses original URLs, preserves case, and never creates a copied-assets directory', () => {
    const source = path.join(siteRoot, 'static', 'Drilling Rigs', '岩芯 #100%', 'CR600P');
    write(source, '01.JPG');
    const image = path.join(source, '01.JPG');
    const before = fs.statSync(image);
    const resolve = createFolderAssetResolver(siteRoot, source, destination);
    expect(resolve('01.JPG')).toBe(url(image));
    expect(resolve('01.JPG')).toBe(url(image));
    expect(resolve('')).toBe('');
    expect(fs.statSync(image).mtimeMs).toBe(before.mtimeMs);
    expect(fs.existsSync(path.join(siteRoot, 'static/codex'))).toBe(false);
    expect(decodeURIComponent(resolve('01.JPG'))).toContain('/岩芯 #100%/CR600P/01.JPG');
  });

  it.each(['../outside', '../selected-site-other/static', 'static-other', 'data'])('copies instead of referencing sources outside this static root: %s', relative => {
    const source = path.resolve(siteRoot, relative, 'CR600P');
    write(source, '01.JPG');
    const resolve = createFolderAssetResolver(siteRoot, source, destination);
    expect(existingSiteAssetUrl(siteRoot, path.join(source, '01.JPG'))).toBeUndefined();
    expect(resolve('01.JPG')).toBe('/static/codex/folder-import/12/CR600P/01.jpg');
    expect(fs.readFileSync(path.join(siteRoot, destination, '01.jpg'), 'utf8')).toBe('original image');
    expect(fs.readFileSync(path.join(source, '01.JPG'), 'utf8')).toBe('original image');
  });

  it('copies junction targets belonging to another site instead of treating them as current-site assets', () => {
    const source = path.join(root, 'other-site', 'images');
    write(source, '1.jpg');
    const junction = path.join(siteRoot, 'static', 'linked');
    fs.symlinkSync(source, junction, process.platform === 'win32' ? 'junction' : 'dir');
    const resolve = createFolderAssetResolver(siteRoot, junction, destination);
    expect(resolve('1.jpg')).toBe('/static/codex/folder-import/12/CR600P/1.jpg');
  });

  it('does not recopy a source already in the import destination', () => {
    const source = path.join(siteRoot, destination);
    write(source, '1.jpg');
    const resolve = createFolderAssetResolver(siteRoot, source, destination);
    expect(resolve('1.jpg')).toBe('/static/codex/folder-import/12/CR600P/1.jpg');
    expect(fs.readFileSync(path.join(source, '1.jpg'), 'utf8')).toBe('original image');
  });

  it('does not create directories for an empty import and rejects unsafe filenames', () => {
    const resolve = createFolderAssetResolver(siteRoot, root, destination);
    expect(resolve('')).toBe('');
    expect(() => resolve('../outside.jpg')).toThrow('文件名');
    expect(() => resolve('image.jpg:secret')).toThrow('文件名');
    expect(() => createFolderAssetResolver(siteRoot, root, '../outside')).toThrow('目标目录');
    expect(fs.existsSync(path.join(siteRoot, 'static/codex'))).toBe(false);
  });

  it.each(['product', 'news'])('integrates with %s importing for all media and duplicate skipping', async kind => {
    const source = path.join(siteRoot, 'static', 'Drilling Rigs', 'CR600P');
    for (const name of ['0.jpg', '00.jpg', '1.jpg', '2.jpg', '3.jpg', '4.jpg', '01.jpg', '02.jpg']) write(source, name);
    write(source, 'CR600P_index.html', '<h2>Detail</h2><p>Original text</p>');
    const service: any = Object.create(kind === 'product' ? ProductService.prototype : NewsService.prototype);
    service.sitesService = { getPbootSiteRoot: () => siteRoot };
    service.currentSiteId = async () => 2;
    service.syncGuard = { protectBeforeDangerousSync: async () => ({ backupPath: 'test-only' }) };
    const duplicateNames = new Set<string>();
    service.productFields = { prepareFolderParameters: async () => ({}) };
    service[`${kind}Repo`] = { find: async () => [] };
    service[kind === 'product' ? 'requireChineseProductImportMenu' : 'requireChineseNewsImportMenu'] = async () => ({ id: 12, name: 'Selected category' });
    service[kind === 'product' ? 'findDuplicateProductNames' : 'findDuplicateNewsTitles'] = async () => duplicateNames;
    service.create = jest.fn(async values => ({ id: 1, ...values }));
    const method = kind === 'product' ? 'importProductFolders' : 'importNewsFolders';
    const result = await service[method]({ sourceDirectory: path.dirname(source), menuId: 12 });
    expect(result).toMatchObject({ createdCount: 1, failedCount: 0 });
    const values = service.create.mock.calls[0][0];
    expect(values.thumbnail).toBe(url(path.join(source, '0.jpg')));
    expect(values.content).toContain(url(path.join(source, '01.jpg')));
    expect(values.content).toContain(url(path.join(source, '02.jpg')));
    expect(values.content).toContain('Original text');
    expect(values.translations[0].content).toBe(values.content);
    expect(service.preparePbootContent(values.content, siteRoot, '2026-09-05 12:00:00')).toBe(values.content);
    expect(service.preparePbootImage(values.thumbnail, siteRoot, '2026-09-05 12:00:00')).toBe(values.thumbnail);
    if (kind === 'product') {
      expect(values.largeImage).toBe(url(path.join(source, '00.jpg')));
      expect(values.carouselImages).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg'].map(name => url(path.join(source, name))));
    }
    expect(fs.existsSync(path.join(siteRoot, 'static/codex'))).toBe(false);
    const again = await service[method]({ sourceDirectory: path.dirname(source), menuId: 12 });
    expect(again).toMatchObject({ createdCount: 0, skippedCount: 1 });
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(siteRoot, 'static/codex'))).toBe(false);
  });
});
