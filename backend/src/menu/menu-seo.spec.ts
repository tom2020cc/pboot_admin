import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { Menu } from './entities/menu.entity';
import { MenuService } from './menu.service';
import { validate } from 'class-validator';
import { OptimizeMenuSeoDto } from './dto/optimize-menu-seo.dto';

const initSqlJs = require('sql.js');

describe('Chinese category SEO and PB metadata', () => {
  let root: string;
  let dbPath: string;
  let source: DataSource;
  let repo: Repository<Menu>;
  let service: MenuService;
  let SQL: any;
  let sites: any;

  const draft = (code = 'pboot:cn:1') => ({
    name: code.includes(':cn:') ? '岩芯钻机' : 'Core Drilling Rigs',
    code, siteId: 2, parentId: 0, publisher: 'admin', href: code.includes(':en:') ? '/en-Core-Rigs' : '/Core-Rigs',
    urlName: code.includes(':en:') ? 'en-Core-Rigs' : 'Core-Rigs', model: '3', listTemplate: '', detailTemplate: '',
    icon: ['/static/thumb.jpg'], show: true, orderNum: 1,
  });
  const metadata = {
    thumbnail: '/static/thumb.jpg', largeImage: '/static/banner.jpg',
    seoTitle: '岩芯钻机产品', seoKeywords: '岩芯钻机,取芯设备', seoDescription: '查看岩芯钻机型号和产品信息。',
  };
  const readRows = () => {
    const db = new SQL.Database(fs.readFileSync(dbPath));
    try {
      const result = db.exec('select * from ay_content_sort order by id')[0];
      return result.values.map((row: any[]) => Object.fromEntries(result.columns.map((key: string, i: number) => [key, row[i]])));
    } finally { db.close(); }
  };
  const execPb = (sql: string) => {
    const db = new SQL.Database(fs.readFileSync(dbPath));
    try { db.run(sql); fs.writeFileSync(dbPath, Buffer.from(db.export())); }
    finally { db.close(); }
  };

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-seo-'));
    dbPath = path.join(root, 'pboot.db');
    SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("create table ay_model (mcode text, name text, listtpl text, contenttpl text)");
    db.run("insert into ay_model values ('3','产品','productlist.html','product.html')");
    db.run(`create table ay_content_sort (
      id integer primary key, acode text, scode text, pcode text, name text, mcode text,
      status text, outlink text, ico text, pic text, title text, keywords text, description text,
      filename text, sorting integer, create_user text, update_user text, create_time text, update_time text,
      listtpl text, contenttpl text, subname text, gtype text, gid text, gnote text, def1 text, def2 text, def3 text
    )`);
    for (const [acode, scode] of [['cn', '1'], ['en', '101']]) {
      db.run(`insert into ay_content_sort (acode,scode,pcode,name,mcode,status,outlink,ico,pic,title,keywords,description,filename,sorting,create_user,listtpl,contenttpl,def1)
        values (?,?, '0', ?, '3','1','', '/static/thumb.jpg','/static/banner.jpg',?,?,?, ?,1,'admin','original-list.html','original-detail.html','do not change')`,
      [acode, scode, acode === 'cn' ? '岩芯钻机' : 'Core Drilling Rigs', metadata.seoTitle, metadata.seoKeywords, metadata.seoDescription, `${acode}-core-rigs`]);
    }
    fs.writeFileSync(dbPath, Buffer.from(db.export())); db.close();
    source = await new DataSource({ type: 'sqljs', entities: [Menu], synchronize: true }).initialize();
    repo = source.getRepository(Menu);
    sites = {
      getCurrentSiteId: () => 2, isDefaultSite: () => false,
      getPbootDbPath: () => dbPath, getPbootSiteRoot: () => root,
      getCurrentSiteStorageDir: () => path.join(root, 'managed'),
      getCurrentSiteLanguages: async () => [{ acode: 'cn' }, { acode: 'en' }],
    };
    service = new MenuService(repo, { get: (_key: string, fallback: any) => fallback } as ConfigService,
      { protectBeforeDangerousSync: jest.fn(async () => ({ backupPath: 'test-backup' })) } as any, sites);
    jest.spyOn(service as any, 'backupLocalSqljsDatabase').mockReturnValue('');
    jest.spyOn(service as any, 'getAiProviderKey').mockImplementation((provider) => provider === 'deepseek' ? 'test-key' : '');
  });

  afterEach(async () => {
    await source.destroy();
    fs.rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('loads legacy metadata without changing PB or clearing local SEO edits', async () => {
    const menu = await repo.save(repo.create(draft()));
    const before = fs.readFileSync(dbPath);
    expect(await service.findOneById(String(menu.id))).toMatchObject(metadata);
    expect(fs.readFileSync(dbPath)).toEqual(before);
    expect((await repo.findOneByOrFail({ id: menu.id })).seoTitle).toBeNull();
    await repo.update(menu.id, { seoTitle: '本地未同步标题', largeImage: '' });
    expect(await service.findOneById(String(menu.id))).toMatchObject({ seoTitle: '本地未同步标题', largeImage: '', seoKeywords: metadata.seoKeywords });
  });

  it('does not turn a PB large image into the thumbnail on legacy records', async () => {
    execPb("update ay_content_sort set ico='' where acode='cn'");
    const menu = await repo.save(repo.create({ ...draft(), icon: ['/static/banner.jpg'] }));
    expect(await service.findOneById(String(menu.id))).toMatchObject({ thumbnail: '', icon: [], largeImage: '/static/banner.jpg' });
  });

  it('imports each PB image and SEO field separately while preserving local IDs', async () => {
    const menu = await repo.save(repo.create({ ...draft(), ...metadata, seoTitle: 'old' }));
    const result = await service.syncFromPboot();
    expect(result.updated).toBe(1);
    expect(await repo.findOneByOrFail({ id: menu.id })).toMatchObject(metadata);
    expect(await repo.count()).toBe(2);
  });

  it('pushes Chinese metadata without touching English, category models or templates', async () => {
    const menu = await repo.save(repo.create({ ...draft(), ...metadata, seoTitle: '新的中文标题', largeImage: '/static/new-banner.jpg' }));
    const english = readRows()[1];
    await service.syncOneToPboot(String(menu.id));
    expect(readRows()[0]).toMatchObject({ ico: '/static/thumb.jpg', pic: '/static/new-banner.jpg', title: '新的中文标题', keywords: metadata.seoKeywords, description: metadata.seoDescription, mcode: '3', listtpl: 'original-list.html', contenttpl: 'original-detail.html', def1: 'do not change' });
    expect(readRows()[1]).toEqual(english);
  });

  it('supports explicit clearing without replacing the other image', async () => {
    const menu = await repo.save(repo.create({ ...draft(), ...metadata }));
    await service.update(String(menu.id), { thumbnail: '', seoDescription: '' });
    await service.syncOneToPboot(String(menu.id));
    expect(readRows()[0]).toMatchObject({ ico: '', pic: '/static/banner.jpg', description: '' });
  });

  it('copies uploaded images to PB and keeps existing static paths unchanged', async () => {
    const dir = path.join(root, 'managed', 'uploads'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'uploaded.jpg'), Buffer.from('test image bytes'));
    const menu = await repo.save(repo.create({ ...draft(), ...metadata, thumbnail: 'uploaded.jpg' }));
    await service.syncOneToPboot(String(menu.id));
    const row = readRows()[0];
    expect(row.ico).toMatch(/^\/static\/codex\/menus\/\d{8}\/uploaded.jpg$/);
    expect(fs.readFileSync(path.join(root, row.ico))).toEqual(Buffer.from('test image bytes'));
    expect(row.pic).toBe('/static/banner.jpg');
  });

  it('leaves PB untouched when an upload cannot be resolved', async () => {
    const menu = await repo.save(repo.create({ ...draft(), ...metadata, thumbnail: 'missing.jpg' }));
    const before = fs.readFileSync(dbPath);
    await expect(service.syncOneToPboot(String(menu.id))).rejects.toThrow('不存在');
    expect(fs.readFileSync(dbPath)).toEqual(before);
  });

  it('rejects foreign-site IDs, rebinding, and direct edits of translated SEO/images', async () => {
    const english = await repo.save(repo.create({ ...draft('pboot:en:101'), ...metadata }));
    await expect(service.update(String(english.id), { seoTitle: 'manual' })).rejects.toThrow('中文栏目');
    await expect(service.update(String(english.id), { largeImage: '/static/change.jpg' })).rejects.toThrow('中文栏目');
    await expect(service.update(String(english.id), { icon: ['/static/change.jpg'] })).rejects.toThrow('中文栏目');
    await expect(service.update(String(english.id), { code: 'pboot:cn:1' })).rejects.toThrow('绑定编码');
    const other = await repo.save(repo.create({ ...draft(), ...metadata, siteId: 3 }));
    await expect(service.findOneById(String(other.id))).rejects.toThrow('没有找到');
  });

  it('translates SEO from Chinese, shares media and retains existing target URLs', async () => {
    const chinese = await repo.save(repo.create({ ...draft(), ...metadata }));
    const target = await repo.save(repo.create({ ...draft('pboot:en:101'), ...metadata, sourceMenuId: Number(chinese.id), href: '/en-custom', urlName: 'en-custom' }));
    jest.spyOn(service as any, 'translateMenuNameListWithFallback').mockImplementation(async (values: string[]) => ({ names: values.map(value => `translated:${value}`), model: 'deepseek-chat' }));
    await service.translateAllFromChinese({ model: 'deepseek-chat' });
    const english = await repo.findOneByOrFail({ id: target.id });
    expect(english).toMatchObject({ thumbnail: metadata.thumbnail, largeImage: metadata.largeImage, seoTitle: `translated:${metadata.seoTitle}`, seoKeywords: `translated:${metadata.seoKeywords}`, seoDescription: `translated:${metadata.seoDescription}`, href: '/en-custom', urlName: 'en-custom' });
    await service.syncAllToPboot();
    expect(readRows()[1]).toMatchObject({ title: english.seoTitle, keywords: english.seoKeywords, description: english.seoDescription, ico: metadata.thumbnail, pic: metadata.largeImage });
  });

  it('writes metadata on insertion of a newly translated PB category', async () => {
    execPb("delete from ay_content_sort where acode='en'");
    await repo.save(repo.create({ ...draft(), ...metadata }));
    await repo.save(repo.create({ ...draft('pboot:en:101'), ...metadata, seoTitle: 'English SEO' }));
    await service.syncAllToPboot();
    expect(readRows()[1]).toMatchObject({ acode: 'en', title: 'English SEO', ico: metadata.thumbnail, pic: metadata.largeImage, listtpl: 'original-list.html' });
  });

  it('does not save a language when SEO translation returns incomplete data', async () => {
    await repo.save(repo.create({ ...draft(), ...metadata }));
    jest.spyOn(service as any, 'translateMenuNameListWithFallback')
      .mockResolvedValueOnce({ names: ['Core Rigs'], model: 'deepseek-chat' })
      .mockResolvedValueOnce({ names: ['only one field'], model: 'deepseek-chat' });
    const result = await service.translateAllFromChinese({ model: 'deepseek-chat' });
    expect(result.results).toEqual([]);
    expect(result.failures).toEqual([{ acode: 'en', message: expect.stringContaining('不完整') }]);
    expect(await repo.count()).toBe(1);
    expect(() => (service as any).parseStringArray('not json', ['中文'])).toThrow();
  });

  it('AI optimization only returns the three SEO draft fields and performs no persistence', async () => {
    const menu = await repo.save(repo.create({ ...draft(), ...metadata }));
    const request = jest.spyOn(service as any, 'requestMenuSeo').mockResolvedValue(JSON.stringify({ seoTitle: '岩芯钻机栏目', seoKeywords: '岩芯钻机,取芯设备,钻探设备', seoDescription: '浏览岩芯钻机相关型号与产品资料。', href: '/wrong', thumbnail: 'wrong.jpg' }));
    const before = fs.readFileSync(dbPath);
    const result = await service.optimizeSeoDraft({ lang: 'cn', model: 'deepseek-chat', menuId: String(menu.id), name: menu.name });
    expect(result).toMatchObject({ lang: 'cn', seoTitle: '岩芯钻机栏目' });
    expect(result).not.toHaveProperty('href');
    expect(result).not.toHaveProperty('thumbnail');
    expect((await repo.findOneByOrFail({ id: menu.id })).seoTitle).toBe(metadata.seoTitle);
    expect(fs.readFileSync(dbPath)).toEqual(before);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('validates the AI language, bound menu and response completeness', async () => {
    const target = await repo.save(repo.create({ ...draft('pboot:en:101'), ...metadata }));
    const request = jest.spyOn(service as any, 'requestMenuSeo').mockResolvedValue('{"seoTitle":"only title"}');
    await expect(service.optimizeSeoDraft({ lang: 'en' as any, model: 'deepseek-chat', name: 'test' })).rejects.toThrow('中文');
    await expect(service.optimizeSeoDraft({ lang: 'cn', menuId: String(target.id), model: 'deepseek-chat', name: 'test' })).rejects.toThrow('中文');
    const child = await repo.save(repo.create({ ...draft(''), ...metadata, name: 'Unbound child', parentId: Number(target.id) }));
    await expect(service.optimizeSeoDraft({ lang: 'cn', menuId: String(child.id), model: 'deepseek-chat', name: 'test' })).rejects.toThrow('中文');
    expect(request).not.toHaveBeenCalled();
    await expect(service.optimizeSeoDraft({ lang: 'cn', model: 'deepseek-chat', name: '岩芯钻机' })).rejects.toThrow('不完整');
    const dto = Object.assign(new OptimizeMenuSeoDto(), { lang: 'en', model: 'deepseek-chat', name: '岩芯钻机' });
    expect((await validate(dto)).some(error => error.property === 'lang')).toBe(true);
  });

  it('keeps legacy icon uploads as thumbnails when creating a menu', async () => {
    const created = await service.create({ ...draft(''), name: 'New category', icon: ['/static/legacy.jpg'] });
    expect(created).toMatchObject({ thumbnail: '/static/legacy.jpg', largeImage: '' });
  });
});
