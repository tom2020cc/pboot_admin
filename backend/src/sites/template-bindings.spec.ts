import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { parseTemplateReferences, readBoundTemplates, replaceTemplateReferences, templateHash, templatePath } from './template-bindings';
import { TemplateBindingsService } from './template-bindings.service';

describe('native template category references', () => {
  it('only reads numeric native category attributes, including lists and numbered tags', () => {
    const text = `<!-- {pboot:nav parent=99} -->
<img width="19" src="/19.jpg">{pboot:content id=19 scode=2}{/pboot:content}
{pboot:2nav parent='19, 20'}{/pboot:2nav}
{pboot:list scode="5" num=19 order=sorting}{/pboot:list}
{pboot:nav parent=0}{/pboot:nav}
{pboot:nav parent={sort:tcode}}{/pboot:nav}
{pboot:list scode="{sort:scode}"}{/pboot:list}`;
    expect(parseTemplateReferences(text, 'cn/html/a.html', 'cn').map(r => [r.tag, r.attribute, r.scode, r.line]))
      .toEqual([['content', 'scode', '2', 2], ['2nav', 'parent', '19', 3], ['2nav', 'parent', '20', 3], ['list', 'scode', '5', 4]]);
  });
  it('does not change partially written tags', () => {
    expect(parseTemplateReferences('{pboot:list scode=19 num="2', 'cn/a.html', 'cn')).toEqual([]);
    expect(parseTemplateReferences('{pboot:nav parent=19 broken', 'cn/a.html', 'cn')).toEqual([]);
  });
  it('preserves BOM, line endings, spacing, and non-category values while swapping', () => {
    const text = '\ufeff<p>19</p>\r\n{pboot:nav parent="19, 20" num=19}';
    const file = { file: 'cn/a.html', text, hash: templateHash(text), references: parseTemplateReferences(text, 'cn/a.html', 'cn') };
    const result = replaceTemplateReferences(file, new Map([['cn:19', '20'], ['cn:20', '19']]));
    expect(result.text).toBe('\ufeff<p>19</p>\r\n{pboot:nav parent="20, 19" num=19}');
    expect(result.changes).toHaveLength(2);
  });
});

describe('template binding preview and update', () => {
  let parent: string, root: string, dbPath: string, service: TemplateBindingsService, sites: any, menus: any[], pb: any[], siteId: number;
  const file = (name = 'cn/html/index.html') => path.join(root, 'template', name);
  const text = '\ufeff{pboot:nav parent="19" num=10}[nav:name]{/pboot:nav}\r\n{pboot:list scode=20}ok{/pboot:list}\r\n';
  const writePb = async () => {
    const SQL = await initSqlJs(); const db = new SQL.Database();
    db.run('create table ay_content_sort (acode text, scode text, name text, mcode text)');
    for (const m of pb) db.run('insert into ay_content_sort values (?, ?, ?, ?)', [m.lang, m.scode, m.name, m.model]);
    fs.writeFileSync(dbPath, db.export()); db.close();
  };
  const dto = (view: Awaited<ReturnType<TemplateBindingsService['list']>>) => ({
    revision: view.revision, templateVersion: view.templateVersion,
    bindings: view.groups.map(g => ({ id: g.id, cnMenuId: g.cn?.menuId || null, enMenuId: g.en?.menuId || null })),
  });
  const changed = async () => {
    const request = dto(await service.list());
    request.bindings.find(r => r.id === 'cn:19')!.cnMenuId = 4;
    return request;
  };
  beforeEach(async () => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'template-binding-test-')); root = path.join(parent, 'site');
    for (const dir of ['template/cn/html', 'template/en/html', 'template/comm', 'data']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(file(), text); fs.writeFileSync(file('en/html/index.html'), '{pboot:nav parent=66}EN{/pboot:nav}');
    fs.writeFileSync(file('comm/shared.html'), '{pboot:nav parent=19}shared{/pboot:nav}');
    dbPath = path.join(root, 'data/pb.db'); siteId = 2;
    menus = [
      { id: '1', siteId: 2, code: 'pboot:cn:19', name: '岩芯钻机', model: '3', urlName: 'Core-Rigs', parentId: 0 },
      { id: '2', siteId: 2, code: 'pboot:en:66', name: 'Core Rigs', model: '3', urlName: 'en-Core-Rigs', parentId: 0 },
      { id: '3', siteId: 2, code: 'pboot:cn:20', name: '其他钻机', model: '3', urlName: 'Other-Rigs', parentId: 0 },
      { id: '4', siteId: 2, code: 'pboot:cn:25', name: '新岩芯栏目', model: '3', urlName: 'New-Core', parentId: 0 },
      { id: '99', siteId: 3, code: 'pboot:cn:199', name: '另一网站', model: '3', urlName: 'Other-Site', parentId: 0 },
    ];
    pb = menus.filter(m => m.siteId === 2).map(m => ({ lang: m.code.split(':')[1], scode: m.code.split(':')[2], name: m.name, model: m.model }));
    await writePb();
    sites = {
      getCurrentSite: () => ({ id: siteId, name: 'Fixture', enabled: true, rootPath: root, dbPath }),
      getCurrentSiteStorageDir: (kind: string) => { const p = path.join(parent, 'storage', String(siteId), kind); fs.mkdirSync(p, { recursive: true }); return p; },
    };
    service = new TemplateBindingsService(sites, { getRepository: () => ({ find: async ({ where }: any) => menus.filter(m => m.siteId === where.siteId) }) } as any);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (path.dirname(parent) !== path.resolve(os.tmpdir()) || !path.basename(parent).startsWith('template-binding-test-')) throw new Error('Unexpected test directory');
    fs.rmSync(parent, { recursive: true, force: true });
  });
  it('auto-pairs unique language slugs without writing templates or PB data', async () => {
    const originalDb = fs.readFileSync(dbPath);
    const view = await service.list();
    expect(view.fileCount).toBe(2); expect(view.groups).toHaveLength(2);
    expect(view.groups[0]).toMatchObject({ cn: { menuId: 1 }, en: { menuId: 2 } });
    expect(fs.readFileSync(file(), 'utf8')).toBe(text);
    expect(fs.readFileSync(dbPath)).toEqual(originalDb);
    expect(fs.existsSync(path.join(sites.getCurrentSiteStorageDir('state'), 'template-bindings.json'))).toBe(false);
  });
  it('does not guess counterpart based on numeric offsets or translated names', async () => {
    menus[1].urlName = 'unrelated';
    const view = await service.list(); expect(view.groups).toHaveLength(3);
    expect(view.groups.find(g => g.id === 'cn:19')!.en).toBeNull();
  });
  it('saves bindings without changing template files', async () => {
    const saved = await service.save(await changed());
    expect(saved.groups.find(g => g.id === 'cn:19')!.cn).toMatchObject({ menuId: 4, sourceScode: '19', targetScode: '25' });
    expect(fs.readFileSync(file(), 'utf8')).toBe(text);
  });
  it('previews and applies only changed references, with backup and preserved shared template/DB', async () => {
    const originalDb = fs.readFileSync(dbPath);
    const preview = await service.preview(await changed());
    expect(preview).toMatchObject({ changedFiles: 1, changedReferences: 1 });
    expect(fs.readFileSync(file(), 'utf8')).toBe(text);
    const result = await service.apply(preview.previewId);
    expect(result.changedFiles).toBe(1);
    expect(fs.readFileSync(path.join(result.backupPath, 'cn/html/index.html'), 'utf8')).toBe(text);
    expect(fs.readFileSync(file(), 'utf8')).toBe(text.replace('parent="19"', 'parent="25"'));
    expect(fs.readFileSync(file('comm/shared.html'), 'utf8')).toContain('parent=19');
    expect(fs.readFileSync(dbPath)).toEqual(originalDb);
    expect((await service.list()).groups.find(g => g.id === 'cn:19')!.cn?.sourceScode).toBe('25');
    const next = await service.preview(dto(await service.list()));
    expect((await service.apply(next.previewId)).changedFiles).toBe(0);
    await expect(service.apply(preview.previewId)).rejects.toThrow('过期');
  });
  it('allows exact scode swaps but rejects merging separate template positions', async () => {
    const request = dto(await service.list());
    request.bindings.find(r => r.id === 'cn:19')!.cnMenuId = 3;
    await expect(service.preview(request)).rejects.toThrow('合并');
    request.bindings.find(r => r.id === 'cn:20')!.cnMenuId = 1;
    const preview = await service.preview(request); await service.apply(preview.previewId);
    expect(fs.readFileSync(file(), 'utf8')).toBe(text.replace('parent="19"', 'parent="20"').replace('scode=20', 'scode=19'));
  });
  it.each([2, 99, 123])('rejects wrong language, wrong site and nonexistent menu %s', async id => {
    const request = await changed(); request.bindings[0].cnMenuId = id;
    await expect(service.preview(request)).rejects.toThrow('当前网站');
  });
  it('requires a unique PB target with the same model, but permits saving pending bindings', async () => {
    const request = await changed(); pb = pb.filter(m => m.scode !== '25'); await writePb();
    await expect(service.preview(request)).rejects.toThrow('PB 栏目');
    const saved = await service.save(request); expect(saved.groups[0].cn!.issue).toContain('PB');
    pb.push({ lang: 'cn', scode: '25', name: 'wrong model', model: '2' }); await writePb();
    await expect(service.preview(dto(saved))).rejects.toThrow('模型不一致');
  });
  it('rejects incomplete and duplicate submitted rows', async () => {
    const request = await changed(); request.bindings.pop();
    await expect(service.save(request)).rejects.toThrow('不完整');
    request.bindings.push(request.bindings[0]);
    await expect(service.preview(request)).rejects.toThrow('重复');
  });
  it('rejects a stale template without overwriting the user edit', async () => {
    const preview = await service.preview(await changed()); fs.appendFileSync(file(), '<p>User edit</p>');
    await expect(service.apply(preview.previewId)).rejects.toThrow('变化');
    expect(fs.readFileSync(file(), 'utf8')).toContain('User edit');
  });
  it('rejects changed bindings and PB state after preview', async () => {
    const request = await changed(); const preview = await service.preview(request);
    await service.save(request); await expect(service.apply(preview.previewId)).rejects.toThrow('变化');
    const second = await service.preview(dto(await service.list())); pb = pb.filter(m => m.scode !== '25'); await writePb();
    await expect(service.apply(second.previewId)).rejects.toThrow('PB 栏目');
  });
  it('rejects cross-site and expired preview tokens', async () => {
    const preview = await service.preview(await changed()); siteId = 3;
    await expect(service.apply(preview.previewId)).rejects.toThrow('切换'); siteId = 2;
    const now = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(now + 600001);
    await expect(service.apply(preview.previewId)).rejects.toThrow('过期');
  });
  it('preserves bindings if project row IDs change but PB code stays stable', async () => {
    await service.save(dto(await service.list())); menus[0].id = '101';
    expect((await service.list()).groups[0].cn?.menuId).toBe(101);
  });
  it('rolls back written templates when a later write fails', async () => {
    const preview = await service.preview(await changed());
    const original = (service as any).writeAtomic.bind(service);
    jest.spyOn(service as any, 'writeAtomic').mockImplementation((target: string, content: string) => {
      if (target.endsWith('template-bindings.json')) throw new Error('simulated disk error');
      original(target, content);
    });
    await expect(service.apply(preview.previewId)).rejects.toThrow('回退');
    expect(fs.readFileSync(file(), 'utf8')).toBe(text);
  });
  it('does not overwrite outside changes while recovering a failed apply', async () => {
    const preview = await service.preview(await changed());
    const original = (service as any).writeAtomic.bind(service);
    jest.spyOn(service as any, 'writeAtomic').mockImplementation((target: string, content: string) => {
      if (target.endsWith('template-bindings.json')) { fs.writeFileSync(file(), 'external edit'); throw new Error('interrupted'); }
      original(target, content);
    });
    await expect(service.apply(preview.previewId)).rejects.toThrow('人工恢复');
    expect(fs.readFileSync(file(), 'utf8')).toBe('external edit');
  });
  it('rejects traversal, junctions and a live PB transaction journal', async () => {
    expect(() => templatePath(root, 'cn/../../data/pb.db')).toThrow('路径');
    const outside = path.join(parent, 'outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, 'template/cn/linked'), 'junction');
    expect(() => readBoundTemplates(root)).toThrow('链接'); fs.rmdirSync(path.join(root, 'template/cn/linked'));
    fs.writeFileSync(dbPath + '-wal', 'transaction');
    await expect(service.list()).rejects.toThrow('活动日志');
  });
});
