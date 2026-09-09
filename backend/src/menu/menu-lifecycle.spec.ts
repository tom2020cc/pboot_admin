import { DataSource, EntitySchema, Repository } from 'typeorm';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Menu } from './entities/menu.entity';
import { MenuService } from './menu.service';
import { resolveMenuSources } from './menu-relations';
import { resolveChineseMenuScope } from '../common/menu-translation-scope';

const initSqlJs = require('sql.js');
const Content = new EntitySchema({ name: 'FixtureContent', columns: {
  id: { type: Number, primary: true, generated: true }, siteId: { type: Number }, menuId: { type: Number },
} });

describe('CN-driven menu lifecycle (isolated databases)', () => {
  let root: string, pb: string, SQL: any, db: DataSource, repo: Repository<Menu>, service: MenuService;
  const draft = (name = '钻机', parentId = 0) => ({ name, parentId, publisher: 'admin', href: '/rigs',
    urlName: 'rigs', model: '3', code: '', icon: [], show: true, orderNum: 1,
    thumbnail: '', largeImage: '', seoTitle: '', seoKeywords: '', seoDescription: '', listTemplate: '', detailTemplate: '' });
  const query = (sql: string, args: any[] = []) => {
    const native = new SQL.Database(fs.readFileSync(pb));
    try {
      const statement = native.prepare(sql); statement.bind(args);
      const result: any[] = []; while (statement.step()) result.push(statement.getAsObject()); statement.free();
      return result;
    } finally { native.close(); }
  };
  const write = (sql: string, args: any[] = []) => {
    const native = new SQL.Database(fs.readFileSync(pb));
    try { native.run(sql, args); fs.writeFileSync(pb, Buffer.from(native.export())); } finally { native.close(); }
  };
  const translate = () => service.translateAllFromChinese({ model: 'google-free', targetAcodes: ['en'] });
  const createChild = async (parent: Menu, slug: string) => service.create({ ...draft(slug, Number(parent.id)), href: `/${slug}`, urlName: slug });

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-lifecycle-')); pb = path.join(root, 'pboot.db');
    SQL = await initSqlJs(); const native = new SQL.Database();
    native.run(`create table ay_model (mcode text, name text, listtpl text, contenttpl text);
      insert into ay_model values ('3','产品','productlist.html','product.html');
      insert into ay_model values ('2','新闻','newslist.html','news.html');
      create table ay_content (acode text, scode text, subscode text);
      create table ay_content_sort (id integer primary key, acode text, mcode text, pcode text, scode text, name text,
        listtpl text, contenttpl text, status text, outlink text, subname text, ico text, pic text, title text, keywords text,
        description text, filename text, sorting integer, create_user text, update_user text, create_time text,
        update_time text, gtype text, gid text, gnote text, def1 text, def2 text, def3 text);`);
    fs.writeFileSync(pb, Buffer.from(native.export())); native.close();
    db = await new DataSource({ type: 'sqljs', entities: [Menu, Content], synchronize: true }).initialize();
    repo = db.getRepository(Menu);
    service = new MenuService(repo, { get: (_key: string, fallback: any) => fallback } as any,
      { protectBeforeDangerousSync: async () => ({ backupPath: 'fixture' }) } as any,
      { getCurrentSiteId: () => 2, isDefaultSite: () => false, getPbootDbPath: () => pb, getPbootSiteRoot: () => root,
        getCurrentSiteLanguages: async () => [{ acode: 'cn' }, { acode: 'en' }] } as any);
    jest.spyOn(service as any, 'backupLocalSqljsDatabase').mockReturnValue('');
    jest.spyOn(service, 'findTranslationModels').mockReturnValue([{ value: 'google-free', provider: 'google', available: true }] as any);
    jest.spyOn(service as any, 'translateMenuNameListWithFallback').mockImplementation(async (names: string[]) => ({ names: names.map(name => `English ${name}`), model: 'google-free' }));
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network disabled'));
  });
  afterEach(async () => { await db.destroy(); fs.rmSync(root, { recursive: true, force: true }); jest.restoreAllMocks(); });

  it('allocates a visible CN identity, inherits native templates, and publishes only on explicit sync', async () => {
    const before = fs.readFileSync(pb);
    const parent = await service.create(draft());
    const child = await createChild(parent, 'core');
    expect(parent).toMatchObject({ code: 'pboot:cn:1', pbootSyncPending: true, listTemplate: 'productlist.html', detailTemplate: 'product.html' });
    expect((await service.findAll()).map(item => item.acode)).toEqual(['cn', 'cn']);
    expect(child.code).toBe('pboot:cn:2'); expect(fs.readFileSync(pb)).toEqual(before);
    expect((await translate()).results[0]).toMatchObject({ created: 2 });
    const translated = (await repo.find()).filter(item => item.sourceMenuId);
    expect(new Set(translated.map(item => item.code)).size).toBe(2);
    await expect(service.syncOneToPboot(String(child.id))).rejects.toThrow('父栏目');
    expect(fs.readFileSync(pb)).toEqual(before);
    const synced = await service.syncAllToPboot(); expect(synced.created).toBe(4);
    expect(query('select * from ay_content_sort')).toHaveLength(4);
    expect(query('select listtpl,contenttpl from ay_content_sort where acode=?', ['en'])[0]).toEqual({ listtpl: 'productlist.html', contenttpl: 'product.html' });
    expect(await repo.countBy({ pbootSyncPending: true })).toBe(0);
    expect((await service.syncAllToPboot()).created).toBe(0);
  });

  it('retains blank-code legacy rows until the user saves them; validates creation scope and URLs', async () => {
    const legacy = await repo.save(repo.create({ ...draft(), siteId: 2 }));
    expect((await service.findAll())[0]).toMatchObject({ acode: 'cn', code: '' });
    expect((await repo.findOneByOrFail({ id: legacy.id })).code).toBe('');
    await service.update(String(legacy.id), { name: '坑道钻机' });
    expect((await repo.findOneByOrFail({ id: legacy.id })).code).toMatch(/^pboot:cn:/);
    await expect(service.create(draft())).rejects.toThrow('URL');
    await expect(service.create({ ...draft(), code: 'pboot:cn:22' })).rejects.toThrow('分配');
    await expect(service.create({ ...draft(), parentId: 999 })).rejects.toThrow('父栏目');
    await expect(service.create({ ...draft('new'), href: '/new', urlName: 'new', model: '999' })).rejects.toThrow('内容类型');
    expect(query('select * from ay_content_sort')).toEqual([]);
  });

  it('keeps associations stable when inserting a sibling, renaming URLs, and translating again', async () => {
    const parent = await service.create(draft()); const child = await createChild(parent, 'core');
    await translate(); const old = (await repo.find()).find(item => item.sourceMenuId === Number(child.id))!;
    await createChild(parent, 'new-sibling');
    await service.update(String(child.id), { name: '新岩芯栏目', href: '/renamed', urlName: 'renamed', orderNum: 9, show: false, seoTitle: '新标题' });
    expect(await repo.findOneByOrFail({ id: old.id })).toMatchObject({ sourceMenuId: Number(child.id), href: old.href, orderNum: 9, show: false, translationNeedsUpdate: true });
    expect(resolveChineseMenuScope(await repo.find(), Number(old.id), 'en', '3').sourceMenu.id).toBe(child.id);
    expect((await translate()).results[0]).toMatchObject({ created: 1, updated: 2 });
    expect(await repo.findOneByOrFail({ id: old.id })).toMatchObject({ sourceMenuId: Number(child.id), href: old.href, translationNeedsUpdate: false });
    await expect(service.update(String(parent.id), { parentId: Number(child.id) })).rejects.toThrow('自身');
  });

  it('updates parent relationships across languages without moving unrelated siblings', async () => {
    const parent = await service.create(draft()); const child = await createChild(parent, 'child');
    const other = await service.create({ ...draft('other'), href: '/other', urlName: 'other' }); await translate();
    const targets = await repo.find(); const targetChild = targets.find(item => item.sourceMenuId === Number(child.id))!;
    const targetOther = targets.find(item => item.sourceMenuId === Number(other.id))!;
    await service.update(String(child.id), { parentId: Number(other.id) });
    expect((await repo.findOneByOrFail({ id: targetChild.id })).parentId).toBe(Number(targetOther.id));
    await expect(service.update(String(targetChild.id), { parentId: 0 })).rejects.toThrow('中文');
  });

  it('stages and restores a language family, then deletes only that family on explicit PB sync', async () => {
    const parent = await service.create(draft()); const child = await createChild(parent, 'child'); await translate(); await service.syncAllToPboot();
    const before = fs.readFileSync(pb);
    const preview = await service.previewDelete(String(child.id)); expect(preview.items).toHaveLength(2); expect(preview.canDelete).toBe(true);
    await service.remove(String(child.id)); expect(fs.readFileSync(pb)).toEqual(before);
    expect(await repo.countBy({ pendingDelete: true })).toBe(2);
    await service.syncFromPboot(); expect(await repo.countBy({ pendingDelete: true })).toBe(2);
    await service.restore(String(child.id)); expect(await repo.countBy({ pendingDelete: true })).toBe(0);
    await service.remove(String(child.id)); const result = await service.syncOneToPboot(String(child.id));
    expect(result.deleted).toBe(2); expect(await repo.count()).toBe(2);
    expect(query('select * from ay_content_sort')).toHaveLength(2);
    expect((await repo.find()).every(item => item.parentId === 0)).toBe(true);
  });

  it('blocks deletion with local children, local content, PB primary or secondary content', async () => {
    const parent = await service.create(draft()); const child = await createChild(parent, 'child'); await translate(); await service.syncAllToPboot();
    await expect(service.remove(String(parent.id))).rejects.toThrow('子栏目');
    const target = (await repo.find()).find(item => item.sourceMenuId === Number(child.id))!;
    await db.getRepository(Content).save({ siteId: 2, menuId: Number(target.id) });
    await expect(service.remove(String(child.id))).rejects.toThrow('内容'); await db.getRepository(Content).clear();
    const scode = target.code.split(':')[2];
    for (const [primary, secondary] of [[scode, ''], ['999', scode]]) {
      write('insert into ay_content values (?,?,?)', ['en', primary, secondary]);
      await expect(service.remove(String(child.id))).rejects.toThrow('内容'); write('delete from ay_content');
    }
    expect(await repo.countBy({ pendingDelete: true })).toBe(0);
  });

  it('rechecks deletion at sync time and preserves both databases if new content appears', async () => {
    const cn = await service.create(draft()); await translate(); await service.syncAllToPboot(); await service.remove(String(cn.id));
    write('insert into ay_content values (?,?,?)', ['cn', cn.code.split(':')[2], '']); const before = fs.readFileSync(pb);
    await expect(service.syncAllToPboot()).rejects.toThrow('内容'); expect(fs.readFileSync(pb)).toEqual(before); expect(await repo.count()).toBe(2);
  });

  it('refuses PB code collisions without overwriting a website category', async () => {
    const cn = await service.create(draft());
    write("insert into ay_content_sort (acode,scode,pcode,mcode,name,filename) values ('en','1','0','3','Existing','existing')");
    const before = fs.readFileSync(pb); await expect(service.syncAllToPboot()).rejects.toThrow('占用');
    expect(fs.readFileSync(pb)).toEqual(before); expect((await repo.findOneByOrFail({ id: cn.id })).pbootSyncPending).toBe(true);
  });

  it('never infers translated categories by numeric offsets or sibling positions', async () => {
    const cn = await service.create(draft()); const first = await createChild(cn, 'first'); const second = await createChild(cn, 'second');
    const en = await repo.save(repo.create({ ...draft('Rigs'), siteId: 2, code: 'pboot:en:101', sourceMenuId: Number(cn.id), href: '/en-rigs', urlName: 'en-rigs' }));
    const unbound = await repo.save(repo.create({ ...draft('Custom', Number(en.id)), siteId: 2, code: 'pboot:en:102', href: '/custom-url', urlName: 'custom-url' }));
    expect(resolveMenuSources(await repo.find()).get(Number(unbound.id))).toBe(0);
    expect(() => resolveChineseMenuScope([], Number(unbound.id), 'en', '3')).toThrow();
    await expect(service.remove(String(unbound.id))).rejects.toThrow('中文');
    const result = await translate(); expect(result.failures).toHaveLength(1);
    await service.update(String(unbound.id), { sourceMenuId: Number(second.id) });
    await repo.delete(first.id);
    expect(resolveChineseMenuScope(await repo.find(), Number(unbound.id), 'en', '3').sourceMenu.id).toBe(second.id);
    await expect(service.update(String(unbound.id), { sourceMenuId: Number(cn.id) })).rejects.toThrow('不能重新绑定');
  });

  it('freezes unique legacy links before editing a CN root URL', async () => {
    const cn = await service.create(draft());
    const en = await repo.save(repo.create({ ...draft('Rigs'), siteId: 2, code: 'pboot:en:101', href: '/en-rigs', urlName: 'en-rigs' }));
    expect((await service.findAll()).find(item => item.id === en.id)?.sourceMenuId).toBe(Number(cn.id));
    expect((await repo.findOneByOrFail({ id: en.id })).sourceMenuId).toBe(0);
    await service.update(String(cn.id), { href: '/new-root', urlName: 'new-root' });
    expect((await repo.findOneByOrFail({ id: en.id })).sourceMenuId).toBe(Number(cn.id));
  });

  it('translates only one new child using an existing translated parent, without touching siblings or descendants', async () => {
    const cn = await service.create(draft()); await createChild(cn, 'sibling'); await translate();
    const child = await createChild(cn, 'underground'); const grandchild = await createChild(child, 'nested');
    await repo.update(child.id, { seoTitle: '坑道钻机标题', thumbnail: '/static/shared.jpg', icon: ['/static/shared.jpg'] });
    const before = await repo.find(), pbBefore = fs.readFileSync(pb);
    const provider = jest.spyOn(service as any, 'translateMenuNameListWithFallback'); provider.mockClear();
    const result = await service.translateOneFromChinese(String(child.id), { model: 'google-free', targetAcodes: ['en'] });
    expect(result.sourceCount).toBe(1); expect(result.results[0]).toMatchObject({ created: 1, updated: 0, translated: 1 });
    const after = await repo.find(); expect(after.filter(item => before.some(old => old.id === item.id))).toEqual(before);
    const target = after.find(item => item.sourceMenuId === Number(child.id))!;
    const parent = after.find(item => item.sourceMenuId === Number(cn.id))!;
    expect(target).toMatchObject({ parentId: Number(parent.id), seoTitle: 'English 坑道钻机标题', thumbnail: '/static/shared.jpg', icon: ['/static/shared.jpg'], pbootSyncPending: true });
    expect(after.some(item => item.sourceMenuId === Number(grandchild.id))).toBe(false);
    expect(provider).toHaveBeenNthCalledWith(1, [child.name], 'en', 'google-free');
    expect(fs.readFileSync(pb)).toEqual(pbBefore);
  });

  it('updates only the selected root translation, retaining its ID, URL and child translations', async () => {
    const cn = await service.create(draft()); await createChild(cn, 'child'); await translate();
    const target = (await repo.find()).find(item => item.sourceMenuId === Number(cn.id))!;
    await repo.update(target.id, { href: '/en-custom', urlName: 'en-custom', translationNeedsUpdate: true });
    await repo.update(cn.id, { name: '更新的钻机栏目' }); const before = await repo.find();
    const result = await service.translateOneFromChinese(String(cn.id), { model: 'google-free' });
    expect(result.results[0]).toMatchObject({ created: 0, updated: 1 });
    expect(await repo.findOneByOrFail({ id: target.id })).toMatchObject({ name: 'English 更新的钻机栏目', href: '/en-custom', urlName: 'en-custom', translationNeedsUpdate: false });
    expect((await repo.find()).filter(item => item.id !== target.id)).toEqual(before.filter(item => item.id !== target.id));
  });

  it('rejects missing, other-site, non-Chinese, unbound and pending-delete single sources before provider calls', async () => {
    const cn = await service.create(draft()); await translate();
    const en = (await repo.find()).find(item => item.sourceMenuId)!;
    const unbound = await repo.save(repo.create({ ...draft(), siteId: 2 }));
    const other = await repo.save(repo.create({ ...draft(), siteId: 3, code: 'pboot:cn:100' }));
    const provider = jest.spyOn(service as any, 'translateMenuNameListWithFallback'); provider.mockClear();
    await expect(service.translateOneFromChinese('999999')).rejects.toThrow('没有找到');
    await expect(service.translateOneFromChinese(String(other.id))).rejects.toThrow('没有找到');
    await expect(service.translateOneFromChinese(String(en.id))).rejects.toThrow('中文主栏目');
    await expect(service.translateOneFromChinese(String(unbound.id))).rejects.toThrow('先保存');
    await repo.update(cn.id, { pendingDelete: true });
    await expect(service.translateOneFromChinese(String(cn.id))).rejects.toThrow('待删除');
    expect(provider).not.toHaveBeenCalled();
  });

  it('reports missing parent languages separately, while still saving a valid language', async () => {
    const cn = await service.create(draft()); await translate(); const child = await createChild(cn, 'new-child');
    (service as any).sitesService.getCurrentSiteLanguages = async () => ['cn', 'en', 'tr'].map(acode => ({ acode }));
    const provider = jest.spyOn(service as any, 'translateMenuNameListWithFallback'); provider.mockClear();
    const result = await service.translateOneFromChinese(String(child.id), { model: 'google-free', targetAcodes: ['tr', 'en'] });
    expect(result.failures).toEqual([{ acode: 'tr', message: expect.stringContaining('先翻译父栏目') }]);
    expect(result.results[0]).toMatchObject({ acode: 'en', created: 1 });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await repo.countBy({ code: 'pboot:tr:1' })).toBe(0);
  });

  it('does not let unrelated unbound branches block single-menu translation or create duplicate same-level entries', async () => {
    const cn = await service.create(draft()); await translate(); const child = await createChild(cn, 'new-child');
    const other = await repo.save(repo.create({ ...draft('Unknown', 999), code: 'pboot:en:50', siteId: 2, href: '/unknown', urlName: 'unknown' }));
    expect((await service.translateOneFromChinese(String(child.id))).results[0]).toMatchObject({ created: 1 });
    const parent = (await repo.find()).find(item => item.sourceMenuId === Number(cn.id))!;
    await repo.update(other.id, { parentId: Number(parent.id) });
    const before = await repo.find();
    expect((await service.translateOneFromChinese(String(child.id))).failures[0].message).toContain('中文来源');
    expect(await repo.find()).toEqual(before);
  });
});
