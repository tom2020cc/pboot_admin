import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { NewsService } from './news.service';
import { NewsController } from './news.controller';

const sharp: typeof import('sharp').default = require('sharp');

describe('news thumbnails share the product image pipeline', () => {
  let root: string;
  let site: string;
  let service: NewsService;
  let repo: any;
  let menus: any;
  let guard: jest.Mock;
  let create: jest.SpyInstance;
  let image: Buffer;
  const file = (buffer: Buffer) => ({ buffer } as Express.Multer.File);
  const title = '客户来访';
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'news-thumbnail-workflow-'));
    site = path.join(root, 'site');
    fs.mkdirSync(path.join(site, 'static'), { recursive: true });
    image = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#167e92' } }).jpeg().toBuffer();
    repo = { find: jest.fn(async () => []), findOneBy: jest.fn(async () => null) };
    menus = { findOne: jest.fn(async ({ where }) => where.siteId === 2 && where.id === '5'
      ? { id: '5', siteId: 2, code: 'pboot:cn:5', model: '2', name: '新闻中心' } : null) };
    guard = jest.fn(async () => ({ backupPath: 'fixture-only' }));
    service = new NewsService(repo, {} as any, menus, {} as any, { protectBeforeDangerousSync: guard } as any, {
      getPbootSiteRoot: () => site,
      getPbootPublicBaseUrl: () => 'https://site.invalid',
    } as any);
    (service as any).currentSiteId = async () => 2;
    create = jest.spyOn(service, 'create').mockImplementation(async (data: any) => ({ ...data, id: 77 }));
  });
  afterEach(() => {
    if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'news-thumbnail-workflow-'))) throw new Error('Unexpected test root');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const setupNews = (parent: string, name = title) => {
    const directory = path.join(parent, name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, '1.jpg'), image);
    fs.writeFileSync(path.join(directory, '01.jpg'), image);
    fs.writeFileSync(path.join(directory, `${name}_index.html`), '<h2>Visit</h2><p>Article content</p>');
    return directory;
  };

  it.each(['inside', 'outside'])('generates at import and keeps body images untouched: %s site', async location => {
    const source = location === 'inside' ? path.join(site, 'static', 'News Assets') : path.join(root, 'materials');
    const directory = setupNews(source);
    const scan = await service.scanNewsFolderImport({ sourceDirectory: source, menuId: 5 });
    expect(scan.items[0]).toMatchObject({ thumbnailImage: '0.jpg', thumbnailWillGenerate: true });
    expect(fs.existsSync(path.join(directory, '0.jpg'))).toBe(false);
    expect(guard).not.toHaveBeenCalled();
    expect(await service.importNewsFolders({ sourceDirectory: source, menuId: 5 })).toMatchObject({ createdCount: 1, failedCount: 0 });
    const saved = create.mock.calls[0][0];
    const prefix = location === 'inside' ? '/static/News%20Assets' : '/static/codex/news-folder-import/5';
    expect(saved.thumbnail).toBe(`${prefix}/${encodeURIComponent(title)}/0.jpg`);
    expect(saved.content).toContain(`${prefix}/${encodeURIComponent(title)}/01.jpg`);
    expect(saved.content).not.toContain('/0.jpg');
    expect(fs.readFileSync(path.join(directory, '1.jpg'))).toEqual(image);
    expect(fs.readFileSync(path.join(directory, '01.jpg'))).toEqual(image);
    expect(await sharp(path.join(directory, '0.jpg')).metadata()).toMatchObject({ width: 500, height: 400 });
    expect(fs.readFileSync(path.join(site, decodeURIComponent(saved.thumbnail)))).toEqual(fs.readFileSync(path.join(directory, '0.jpg')));
    if (location === 'inside') expect(fs.existsSync(path.join(site, 'static', 'codex'))).toBe(false);
  });

  it('preserves existing 0.JPG bytes and dimensions even if 1.jpg is broken', async () => {
    const source = path.join(site, 'static');
    const directory = setupNews(source);
    fs.writeFileSync(path.join(directory, '0.JPG'), image);
    fs.writeFileSync(path.join(directory, '1.jpg'), 'broken');
    expect((await service.scanNewsFolderImport({ sourceDirectory: source, menuId: 5 })).items[0].thumbnailWillGenerate).toBe(false);
    expect(await service.importNewsFolders({ sourceDirectory: source, menuId: 5 })).toMatchObject({ createdCount: 1, failedCount: 0 });
    expect(create.mock.calls[0][0].thumbnail.endsWith('/0.JPG')).toBe(true);
    expect(fs.readFileSync(path.join(directory, '0.JPG'))).toEqual(image);
  });

  it('skips duplicate news before creating a thumbnail', async () => {
    const source = path.join(site, 'static');
    const directory = setupNews(source);
    repo.find.mockResolvedValue([{ title }]);
    expect(await service.importNewsFolders({ sourceDirectory: source, menuId: 5 })).toMatchObject({ skippedCount: 1, createdCount: 0 });
    expect(fs.existsSync(path.join(directory, '0.jpg'))).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('reports a corrupt article image and still imports the next article', async () => {
    const source = path.join(site, 'static');
    const directory = setupNews(source);
    fs.writeFileSync(path.join(directory, '1.jpg'), 'broken');
    setupNews(source, '另一篇新闻');
    const result = await service.importNewsFolders({ sourceDirectory: source, menuId: 5 });
    expect(result).toMatchObject({ failedCount: 1, createdCount: 1 });
    expect(result.failed[0].title).toBe(title);
    expect(fs.existsSync(path.join(directory, '0.jpg'))).toBe(false);
  });

  it('creates news-specific folders for new articles and requires Chinese news category/title', async () => {
    await expect(service.uploadThumbnail({ title }, file(image))).rejects.toThrow('栏目');
    await expect(service.uploadThumbnail({ title, menuId: 999 }, file(image))).rejects.toThrow('当前网站');
    await expect(service.uploadThumbnail({ menuId: 5 }, file(image))).rejects.toThrow('新闻标题');
    const result = await service.uploadThumbnail({ title, menuId: 5 }, file(image));
    expect(result.url.startsWith(`/static/codex/news-images/5/${encodeURIComponent(title)}/thumbnail-`)).toBe(true);
    expect(result).toMatchObject({ width: 500, height: 400 });
    expect(create).not.toHaveBeenCalled();
    menus.findOne.mockResolvedValue({ id: '5', siteId: 2, code: 'pboot:en:5', model: '2' });
    await expect(service.uploadThumbnail({ title, menuId: 5 }, file(image))).rejects.toThrow('中文新闻栏目');
    menus.findOne.mockResolvedValue({ id: '5', siteId: 2, code: 'pboot:cn:5', model: '3' });
    await expect(service.uploadThumbnail({ title, menuId: 5 }, file(image))).rejects.toThrow('中文新闻栏目');
  });

  it('uses the saved news identity and folder and never replaces original files', async () => {
    const directory = setupNews(path.join(site, 'static', 'News Assets'));
    fs.writeFileSync(path.join(directory, '0.jpg'), image);
    repo.findOneBy.mockResolvedValue({ id: 22, siteId: 2, menuId: 5, title, thumbnail: `/static/News%20Assets/${encodeURIComponent(title)}/0.jpg` });
    const result = await service.uploadThumbnail({ newsId: 22, menuId: 999, title: 'WRONG' }, file(image));
    expect(repo.findOneBy).toHaveBeenCalledWith({ id: 22, siteId: 2 });
    expect(result.url.startsWith(`/static/News%20Assets/${encodeURIComponent(title)}/thumbnail-`)).toBe(true);
    expect(fs.readFileSync(path.join(directory, '0.jpg'))).toEqual(image);
    expect(fs.readFileSync(path.join(directory, '1.jpg'))).toEqual(image);
    expect(await sharp(path.join(site, decodeURIComponent(result.url))).metadata()).toMatchObject({ width: 500, height: 400 });
    expect((await service.uploadThumbnail({ newsId: 22 }, file(image))).url).not.toBe(result.url);
  });

  it('requires an unambiguous same-site folder and rejects traversal/symlink escapes', async () => {
    setupNews(path.join(site, 'static', 'First'));
    setupNews(path.join(site, 'static', 'Second'));
    await expect(service.uploadThumbnail({ title, menuId: 5 }, file(image))).rejects.toThrow('多个同名新闻目录');
    await expect(service.uploadThumbnail({ title, menuId: 5, referenceImage: `https://other.invalid/static/First/${encodeURIComponent(title)}/1.jpg` }, file(image))).rejects.toThrow('多个同名');
    const result = await service.uploadThumbnail({ title, menuId: 5, referenceImage: `/static/First/${encodeURIComponent(title)}/1.jpg` }, file(image));
    expect(result.url.startsWith(`/static/First/${encodeURIComponent(title)}/thumbnail-`)).toBe(true);
    await expect(service.uploadThumbnail({ title: '..', menuId: 5 }, file(image))).rejects.toThrow();
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(site, 'static', 'codex'), 'junction');
    await expect(service.uploadThumbnail({ title: '新标题', menuId: 5 }, file(image))).rejects.toThrow('超出当前网站');
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('rejects absent/cross-site news and missing/oversized uploads', async () => {
    await expect(service.uploadThumbnail({ newsId: 99 }, file(image))).rejects.toThrow('没有找到');
    await expect(service.uploadThumbnail({ menuId: 5, title })).rejects.toThrow('请选择');
    await expect(service.uploadThumbnail({ menuId: 5, title }, file(Buffer.alloc(5 * 1024 * 1024 + 1)))).rejects.toThrow('5MB');
    expect(fs.readdirSync(path.join(site, 'static'))).toEqual([]);
  });

  it('accepts the news multipart contract through the controller', async () => {
    const module = await Test.createTestingModule({ controllers: [NewsController], providers: [{ provide: NewsService, useValue: service }] }).compile();
    const app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    try {
      const result = await request(app.getHttpServer()).post('/news/thumbnail').field('menuId', '5').field('title', title).attach('image', image, 'photo.jpg').expect(201);
      expect(result.body).toMatchObject({ width: 500, height: 400 });
      await request(app.getHttpServer()).post('/news/thumbnail').field('newsId', '-1').attach('image', image, 'photo.jpg').expect(400);
      await request(app.getHttpServer()).post('/news/thumbnail').field('directory', root).attach('image', image, 'photo.jpg').expect(400);
      await request(app.getHttpServer()).post('/news/thumbnail').attach('imgArr', image, 'wrong-field.jpg').expect(400);
      await request(app.getHttpServer()).post('/news/thumbnail').attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'too-large.jpg').expect(413);
    } finally { await app.close(); }
  });
});
