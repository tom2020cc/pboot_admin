import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const sharp: typeof import('sharp').default = require('sharp');
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request = require('supertest');

describe('product thumbnail import and upload workflows', () => {
  let root: string;
  let site: string;
  let service: ProductService;
  let repo: any;
  let guard: jest.Mock;
  let create: jest.SpyInstance;
  let image: Buffer;
  const file = (buffer: Buffer) => ({ buffer } as Express.Multer.File);
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-thumbnail-workflow-'));
    site = path.join(root, 'site');
    fs.mkdirSync(path.join(site, 'static'), { recursive: true });
    image = await sharp({ create: { width: 800, height: 1200, channels: 3, background: 'red' } }).jpeg().toBuffer();
    repo = { find: jest.fn(async () => []), findOneBy: jest.fn(async () => null) };
    guard = jest.fn(async () => ({ backupPath: 'fixture-only' }));
    service = new ProductService(repo, {} as any, {
      findOne: jest.fn(async ({ where }) => where.siteId === 2 && where.id === '5'
        ? { id: '5', siteId: 2, code: 'pboot:cn:5', model: '3', name: 'Core Rigs' } : null),
    } as any, {} as any, { protectBeforeDangerousSync: guard } as any, {
      getPbootSiteRoot: () => site,
      getPbootPublicBaseUrl: () => 'https://site.invalid',
    } as any, { getImportDefinitions: async () => [], prepareFolderParameters: async () => ({}) } as any);
    (service as any).currentSiteId = async () => 2;
    create = jest.spyOn(service, 'create').mockImplementation(async (data: any) => ({ ...data, id: 77 }));
  });
  afterEach(() => {
    if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'product-thumbnail-workflow-'))) throw new Error('Unexpected test root');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const setupModel = (parent: string) => {
    const directory = path.join(parent, 'CR600P');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, '1.jpg'), image);
    return directory;
  };

  it.each(['inside', 'outside'])('generates at import and uses the correct portable URL: %s source', async location => {
    const source = location === 'inside' ? path.join(site, 'static', 'Core Rigs') : path.join(root, 'materials');
    const directory = setupModel(source);
    const scan = await service.scanProductFolderImport({ sourceDirectory: source, menuId: 5 });
    expect(scan.items[0]).toMatchObject({ thumbnailImage: '0.jpg', thumbnailWillGenerate: true });
    expect(fs.existsSync(path.join(directory, '0.jpg'))).toBe(false);
    expect(guard).not.toHaveBeenCalled();
    const imported = await service.importProductFolders({ sourceDirectory: source, menuId: 5 });
    expect(imported).toMatchObject({ createdCount: 1, failedCount: 0 });
    const url = create.mock.calls[0][0].thumbnail;
    expect(url).toBe(location === 'inside' ? '/static/Core%20Rigs/CR600P/0.jpg' : '/static/codex/folder-import/5/CR600P/0.jpg');
    expect(fs.readFileSync(path.join(directory, '1.jpg'))).toEqual(image);
    expect(await sharp(path.join(directory, '0.jpg')).metadata()).toMatchObject({ width: 500, height: 400 });
    expect(fs.readFileSync(path.join(site, decodeURIComponent(url)))).toEqual(fs.readFileSync(path.join(directory, '0.jpg')));
    if (location === 'inside') expect(fs.existsSync(path.join(site, 'static', 'codex'))).toBe(false);
  });

  it('skips duplicate products before any image is generated', async () => {
    const source = path.join(site, 'static');
    const directory = setupModel(source);
    repo.find.mockResolvedValue([{ title: 'CR600P' }]);
    expect(await service.importProductFolders({ sourceDirectory: source, menuId: 5 })).toMatchObject({ skippedCount: 1, createdCount: 0 });
    expect(fs.existsSync(path.join(directory, '0.jpg'))).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('reports a corrupt source instead of saving a broken thumbnail/product', async () => {
    const source = path.join(site, 'static');
    const directory = setupModel(source);
    fs.writeFileSync(path.join(directory, '1.jpg'), 'broken');
    expect(await service.importProductFolders({ sourceDirectory: source, menuId: 5 })).toMatchObject({ failedCount: 1, createdCount: 0 });
    expect(fs.existsSync(path.join(directory, '0.jpg'))).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('uploads for a new model only with a current-site Chinese product category and model', async () => {
    await expect(service.uploadThumbnail({ modelName: 'WRT600' }, file(image))).rejects.toThrow('栏目');
    await expect(service.uploadThumbnail({ modelName: 'WRT600', menuId: 999 }, file(image))).rejects.toThrow('当前网站');
    await expect(service.uploadThumbnail({ menuId: 5 }, file(image))).rejects.toThrow('型号');
    const result = await service.uploadThumbnail({ modelName: 'WRT600', menuId: 5 }, file(image));
    expect(result.url).toMatch(/^\/static\/codex\/product-images\/5\/WRT600\/thumbnail-/);
    expect(create).not.toHaveBeenCalled();
  });

  it('uses the saved product model and existing folder, ignoring a spoofed model/menu', async () => {
    const directory = setupModel(path.join(site, 'static', 'Core Rigs'));
    repo.findOneBy.mockResolvedValue({ id: 22, siteId: 2, menuId: 5, title: 'CR600P', largeImage: '/static/Core%20Rigs/CR600P/1.jpg', carouselImages: [] });
    const result = await service.uploadThumbnail({ productId: 22, menuId: 999, modelName: 'WRONG' }, file(image));
    expect(repo.findOneBy).toHaveBeenCalledWith({ id: 22, siteId: 2 });
    expect(result.url).toMatch(/^\/static\/Core%20Rigs\/CR600P\/thumbnail-/);
    expect(await sharp(path.join(directory, path.basename(result.url))).metadata()).toMatchObject({ width: 500, height: 400 });
    expect(fs.readFileSync(path.join(directory, '1.jpg'))).toEqual(image);
  });

  it('rejects absent/cross-site products and missing/oversized uploads', async () => {
    await expect(service.uploadThumbnail({ productId: 99 }, file(image))).rejects.toThrow('没有找到');
    await expect(service.uploadThumbnail({ menuId: 5, modelName: 'CR600P' })).rejects.toThrow('请选择');
    await expect(service.uploadThumbnail({ menuId: 5, modelName: 'CR600P' }, file(Buffer.alloc(5 * 1024 * 1024 + 1)))).rejects.toThrow('5MB');
    expect(fs.readdirSync(path.join(site, 'static'))).toEqual([]);
  });

  it('accepts multipart uploads through the real controller and validates form fields', async () => {
    const module = await Test.createTestingModule({ controllers: [ProductController], providers: [{ provide: ProductService, useValue: service }] }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    try {
      const uploaded = await request(app.getHttpServer()).post('/products/thumbnail')
        .field('menuId', '5').field('modelName', 'HTTP600')
        .attach('image', image, 'portrait.jpg').expect(201);
      expect(uploaded.body).toMatchObject({ width: 500, height: 400 });
      expect(await sharp(path.join(site, decodeURIComponent(uploaded.body.url))).metadata()).toMatchObject({ width: 500, height: 400 });
      await request(app.getHttpServer()).post('/products/thumbnail').field('menuId', '-1').attach('image', image, 'bad-id.jpg').expect(400);
      await request(app.getHttpServer()).post('/products/thumbnail').field('directory', '/arbitrary').attach('image', image, 'bad-field.jpg').expect(400);
      await request(app.getHttpServer()).post('/products/thumbnail').attach('imgArr', image, 'wrong-field.jpg').expect(400);
      await request(app.getHttpServer()).post('/products/thumbnail').field('menuId', '5').field('modelName', 'INVALID').attach('image', Buffer.from('<svg/>'), 'bad.jpg').expect(400);
      await request(app.getHttpServer()).post('/products/thumbnail').attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'too-big.jpg').expect(413);
    } finally { await app.close(); }
  });
});
