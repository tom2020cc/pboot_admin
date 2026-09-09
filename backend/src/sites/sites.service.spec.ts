import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { SitesService } from './sites.service';
import { ManagedSite } from './entities/managed-site.entity';

const makeSite = (rootPath: string, dbPath: string): ManagedSite => ({
  id: 1,
  name: 'Example site',
  code: 'example-site',
  environment: 'phpstudy',
  rootPath,
  dbPath,
  publicBaseUrl: 'https://example.com',
  youtubeChannelId: 'UC1234567890123456789012',
  enabled: true,
  isDefault: true,
  notes: '',
  createTime: new Date(),
  updateTime: new Date(),
});

describe('SitesService multi-site storage', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-sites-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('discovers only PbootCMS directories with a data database', async () => {
    const siteRoot = path.join(tempRoot, 'example.com');
    fs.mkdirSync(path.join(siteRoot, 'apps'), { recursive: true });
    fs.mkdirSync(path.join(siteRoot, 'core'), { recursive: true });
    fs.mkdirSync(path.join(siteRoot, 'data'), { recursive: true });
    fs.writeFileSync(path.join(siteRoot, 'index.php'), '<?php');
    fs.writeFileSync(path.join(siteRoot, 'data', 'example.db'), Buffer.alloc(256, 1));
    fs.mkdirSync(path.join(tempRoot, 'ordinary-folder'));

    const repository = { find: jest.fn().mockResolvedValue([]) };
    const config = { get: jest.fn() };
    const context = { getSiteId: jest.fn() };
    const service = new SitesService(repository as any, config as any, context as any);

    const result = await service.discover({ parentPath: tempRoot, environment: 'phpstudy' });

    expect(result.scannedDirectories).toBe(2);
    expect(result.foundSites).toBe(1);
    expect(result.newSites).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      name: 'example.com',
      code: 'example-com',
      rootPath: siteRoot,
      publicBaseUrl: 'http://example.com',
      existingSiteId: 0,
    });
  });

  it('creates an independent configuration directory for every managed site', async () => {
    const siteRoot = path.join(tempRoot, 'site-root');
    const dbPath = path.join(siteRoot, 'data', 'site.db');
    const storageRoot = path.join(tempRoot, 'managed-sites');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, Buffer.alloc(128, 1));
    const site = makeSite(siteRoot, dbPath);

    const repository = {
      count: jest.fn().mockResolvedValue(1),
      countBy: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([site]),
    };
    const config = {
      get: jest.fn((key: string) => key === 'MANAGED_SITES_DIR' ? storageRoot : ''),
    };
    const context = { getSiteId: jest.fn() };
    const service = new SitesService(repository as any, config as any, context as any);

    await service.onModuleInit();

    const directory = path.join(storageRoot, site.code);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'site.json'), 'utf8'));
    expect(saved.site).toMatchObject({ code: site.code, youtubeChannelId: site.youtubeChannelId });
    for (const section of ['api', 'api/uploads', 'seo', 'ftp', 'google', 'state', 'backups']) {
      expect(fs.statSync(path.join(directory, section)).isDirectory()).toBe(true);
    }
    expect(saved.sharedConfiguration.modelApiKeys).toBe('global');
    expect(saved.storage.uploads).toBe('api/uploads');
  });

  it('does not reuse the default YouTube channel for another site', async () => {
    const defaultSite = makeSite(tempRoot, path.join(tempRoot, 'default.db'));
    const secondSite = { ...defaultSite, id: 2, code: 'second-site', isDefault: false, youtubeChannelId: '' };
    const repository = { find: jest.fn().mockResolvedValue([defaultSite, secondSite]) };
    const config = { get: jest.fn((key: string) => key === 'YOUTUBE_CHANNEL_ID' ? defaultSite.youtubeChannelId : '') };
    const context = { getSiteId: jest.fn().mockReturnValue(2) };
    const service = new SitesService(repository as any, config as any, context as any);

    await (service as any).refreshCache();

    expect(service.getYoutubeChannelId()).toBe('');
  });

  it('reports a shared YouTube API Key without exposing the secret', () => {
    const repository = {};
    const config = { get: jest.fn((key: string) => key === 'YOUTUBE_API_KEY' ? 'AIzaSyExampleSecret1234' : '') };
    const context = { getSiteId: jest.fn() };
    const service = new SitesService(repository as any, config as any, context as any);

    expect(service.getSharedSettings()).toEqual({
      youtubeApiKeyConfigured: true,
      youtubeApiKeyMasked: 'AIzaS...1234',
    });
  });

  it('returns every language area configured by the selected PbootCMS site', async () => {
    const siteRoot = path.join(tempRoot, 'multilingual-site');
    const dbPath = path.join(siteRoot, 'data', 'multilingual.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('create table ay_area (id integer primary key, acode text, pcode text, is_default integer)');
    ['ar', 'cn', 'en', 'es', 'fr', 'id', 'pt', 'ru', 'tr', 'vi'].forEach((acode, index) => {
      db.run('insert into ay_area (id, acode, pcode, is_default) values (?, ?, ?, ?)', [index + 1, acode, '0', acode === 'cn' ? 1 : 0]);
    });
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();

    const selectedSite = { ...makeSite(siteRoot, dbPath), id: 2 };
    const repository = { find: jest.fn().mockResolvedValue([selectedSite]) };
    const config = { get: jest.fn() };
    const context = { getSiteId: jest.fn().mockReturnValue(2) };
    const service = new SitesService(repository as any, config as any, context as any);
    await (service as any).refreshCache();

    const languages = await service.getCurrentSiteLanguages();
    expect(languages.map((item) => item.acode)).toEqual(['cn', 'ar', 'en', 'es', 'fr', 'id', 'pt', 'ru', 'tr', 'vi']);
    expect(languages).toEqual(expect.arrayContaining([
      { acode: 'id', code: 'id', name: 'Bahasa Indonesia' },
      { acode: 'tr', code: 'tr', name: 'Türkçe' },
      { acode: 'vi', code: 'vi', name: 'Tiếng Việt' },
    ]));
  });

  it('reads quotation header details from the currently selected PbootCMS site', async () => {
    const siteRoot = path.join(tempRoot, 'selected-site');
    const dbPath = path.join(siteRoot, 'data', 'selected.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('create table ay_site (id integer primary key, acode text, title text, subtitle text, logo text, description text)');
    db.run('create table ay_company (id integer primary key, acode text, name text, contact text, mobile text, phone text, email text, weixin text)');
    db.run("insert into ay_site values (1, 'cn', 'Selected Site', 'Selected subtitle', '/static/logo.png', '')");
    db.run("insert into ay_company values (1, 'cn', 'Selected Company', 'Sales', '123456', '', 'sales@example.com', 'wechat-id')");
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();

    const selectedSite = { ...makeSite(siteRoot, dbPath), id: 2, name: 'Managed fallback' };
    const repository = { find: jest.fn().mockResolvedValue([selectedSite]) };
    const config = { get: jest.fn() };
    const context = { getSiteId: jest.fn().mockReturnValue(2) };
    const service = new SitesService(repository as any, config as any, context as any);
    await (service as any).refreshCache();

    await expect(service.getCurrentSiteProfile()).resolves.toMatchObject({
      siteId: 2,
      companyName: 'Selected Company',
      companySubtitle: 'Selected subtitle',
      logoUrl: 'https://example.com/static/logo.png',
      website: 'https://example.com',
      assetBaseUrl: 'https://example.com',
      contactName: 'Sales',
      phone: '123456',
      whatsapp: '123456',
      wechat: 'wechat-id',
      email: 'sales@example.com',
    });
  });
});
