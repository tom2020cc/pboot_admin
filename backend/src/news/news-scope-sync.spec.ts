import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { NewsService } from './news.service';

const languages = ['zh-CN', 'en', 'es', 'fr', 'ru', 'ar', 'pt', 'id', 'tr', 'vi'];
const acode = (lang: string) => lang === 'zh-CN' ? 'cn' : lang;

describe('Chinese article scope, all-language non-destructive PB sync', () => {
  let directory: string;
  let dbPath: string;
  let SQL: any;
  let service: any;
  let articles: any[];
  let translations: any[];
  let menus: any[];
  let guard: jest.Mock;
  const editDb = (callback: (db: any) => void) => {
    const db = new SQL.Database(fs.readFileSync(dbPath));
    try { callback(db); fs.writeFileSync(dbPath, Buffer.from(db.export())); } finally { db.close(); }
  };
  const readRows = () => {
    const db = new SQL.Database(fs.readFileSync(dbPath));
    try { return db.exec('select acode,scode,filename,title,content from ay_content order by id')[0]?.values || []; }
    finally { db.close(); }
  };

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'news-scope-sync-'));
    dbPath = path.join(directory, 'site.db');
    SQL = await initSqlJs();
    const db = new SQL.Database();
    const fields = ['acode', 'scode', 'subscode', 'title', 'titlecolor', 'subtitle', 'filename', 'author', 'source', 'outlink', 'date', 'ico', 'pics', 'content', 'tags', 'enclosure', 'keywords', 'description', 'sorting', 'status', 'istop', 'isrecommend', 'isheadline', 'visits', 'likes', 'oppose', 'create_user', 'update_user', 'create_time', 'update_time', 'gtype', 'gid', 'gnote', 'picstitle'];
    db.run(`create table ay_content (id integer primary key autoincrement,${fields.map(name => `${name} text`).join(',')})`);
    db.run('create table ay_content_sort (acode text,scode text,mcode text)');
    menus = languages.flatMap((lang, index) => [0, 1].map(child => {
      const id = index * 10 + child + 1;
      db.run('insert into ay_content_sort values (?,?,?)', [acode(lang), String(id), '2']);
      return { id: String(id), siteId: 2, parentId: child ? id - 1 : 0, code: `pboot:${acode(lang)}:${id}`, model: '2', name: child ? 'Child rigs' : 'Rigs', href: `/${acode(lang)}-${child ? 'child' : 'rigs'}`, urlName: `${acode(lang)}-${child ? 'child' : 'rigs'}` };
    }));
    db.run("insert into ay_content(acode,scode,filename,title,content) values ('cn','999','unrelated','Unrelated','Keep')");
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();
    articles = [
      { id: 1, siteId: 2, menuId: 1 }, { id: 2, siteId: 2, menuId: 2 },
      { id: 3, siteId: 2, menuId: 999 }, { id: 4, siteId: 3, menuId: 1 },
    ].map(item => ({ ...item, title: `CR${item.id}`, urlName: `cn-cr${item.id}`, content: '<p>Chinese</p>', show: true, thumbnail: '' }));
    translations = articles.flatMap(article => languages.map(lang => ({ newsId: article.id, lang,
      title: article.title, content: `<p>${lang} description</p>`, urlName: `${acode(lang)}-cr${article.id}`,
    })));
    guard = jest.fn();
    service = new NewsService({
      find: jest.fn(async ({ where }: any) => articles.filter(item => item.siteId === where.siteId && where.menuId.value.includes(item.menuId))),
    } as any, { find: async () => translations } as any, {
      find: async () => menus.filter(item => item.siteId === 2),
      findOne: async ({ where }: any) => menus.find(item => item.id === where.id && item.siteId === where.siteId),
    } as any, {} as any, { protectBeforeDangerousSync: guard } as any, {
      getCurrentSiteLanguages: async () => languages.map(code => ({ code })), getCurrentSite: () => ({ name: 'Test Site' }),
    } as any);
    service.currentSiteId = async () => 2;
    service.getPbootDbPath = () => dbPath;
    service.getPbootSiteRoot = () => directory;
    service.getPbootPublicBaseUrl = () => 'https://example.invalid';
  });

  afterEach(() => {
    const resolved = path.resolve(directory);
    if (resolved.startsWith(path.join(os.tmpdir(), 'news-scope-sync-'))) fs.rmSync(resolved, { recursive: true, force: true });
  });

  it('previews descendants and all ten languages without writing or backing up', async () => {
    const before = fs.readFileSync(dbPath);
    expect(await service.syncChineseNewsScope(1)).toMatchObject({ totalNews: 2, totalLanguages: 10, readyCount: 20, blocked: [], skipped: [], syncedCount: 0 });
    expect(fs.readFileSync(dbPath)).toEqual(before);
    expect(guard).not.toHaveBeenCalled();
    expect((await service.syncChineseNewsScope(2)).totalNews).toBe(1);
  });

  it('upserts all ten languages, never duplicates or deletes unrelated articles', async () => {
    const first = await service.syncChineseNewsScope(1, true);
    expect(first).toMatchObject({ syncedCount: 20, created: 20, updated: 0, deleted: 0 });
    expect(fs.existsSync(first.backupPath)).toBe(true);
    expect(await service.syncChineseNewsScope(1, true)).toMatchObject({ syncedCount: 20, created: 0, updated: 20, deleted: 0 });
    const rows = readRows();
    expect(rows).toHaveLength(21);
    expect(rows[0]).toEqual(['cn', '999', 'unrelated', 'Unrelated', 'Keep']);
    expect(rows.filter((row: any[]) => ['id', 'tr', 'vi'].includes(row[0]))).toHaveLength(6);
    expect(rows.filter((row: any[]) => row[2].includes('cr3') || row[2].includes('cr4'))).toHaveLength(0);
  });

  it('skips empty and unfinished versions without falling back to Chinese', async () => {
    translations = translations.filter(item => !(item.newsId === 1 && item.lang === 'id'));
    translations.find(item => item.newsId === 1 && item.lang === 'tr').content = '<p><br></p>';
    translations.find(item => item.newsId === 1 && item.lang === 'zh-CN').subtitle = 'CN subtitle';
    for (const translation of translations.filter(item => item.newsId === 1 && item.lang !== 'vi')) translation.subtitle = 'Subtitle';
    const result = await service.syncChineseNewsScope(1, true);
    expect(result.skipped.map((item: any) => item.lang)).toEqual(['id', 'tr', 'vi']);
    expect(result.syncedCount).toBe(17);
    expect(readRows().some((row: any[]) => row[2] === 'id-cr1')).toBe(false);
  });

  it.each(['missing', 'wrong-model'])('blocks every write when a PB category is %s', async mode => {
    editDb(db => db.run(mode === 'missing' ? "delete from ay_content_sort where acode='vi'" : "update ay_content_sort set mcode='3' where acode='vi'"));
    const before = fs.readFileSync(dbPath);
    expect((await service.syncChineseNewsScope(1)).blocked).toHaveLength(2);
    await expect(service.syncChineseNewsScope(1, true)).rejects.toThrow('未写入任何新闻');
    expect(fs.readFileSync(dbPath)).toEqual(before);
    expect(guard).not.toHaveBeenCalled();
  });

  it('rejects non-Chinese, cross-site and non-news scope selections', async () => {
    await expect(service.syncChineseNewsScope(11, true)).rejects.toThrow('中文新闻栏目');
    await expect(service.syncChineseNewsScope(999, true)).rejects.toThrow('中文新闻栏目');
    menus.find(item => item.id === '1').siteId = 3;
    await expect(service.syncChineseNewsScope(1, true)).rejects.toThrow('中文新闻栏目');
    menus.find(item => item.id === '1').siteId = 2;
    menus.find(item => item.id === '1').model = '3';
    await expect(service.syncChineseNewsScope(1, true)).rejects.toThrow('中文新闻栏目');
  });

  it('never falls back to a historical hard-coded PB category when a local language menu is missing', async () => {
    menus = menus.filter(item => !item.code.startsWith('pboot:en:'));
    editDb(db => db.run("insert into ay_content_sort values ('en','130','2')"));
    const before = fs.readFileSync(dbPath);
    const preview = await service.syncChineseNewsScope(1);
    expect(preview.blocked).toHaveLength(2);
    expect(preview.blocked.every(item => item.lang === 'en' && item.reason.includes('缺少对应语言'))).toBe(true);
    await expect(service.syncChineseNewsScope(1, true)).rejects.toThrow('未写入任何新闻');
    expect(fs.readFileSync(dbPath)).toEqual(before);
    expect(guard).not.toHaveBeenCalled();
  });

  it('blocks ambiguous language menu mappings rather than choosing the first match', async () => {
    menus.push({ ...menus.find(item => item.id === '91'), id: '9991', code: 'pboot:vi:9991' });
    expect((await service.syncChineseNewsScope(1)).blocked.some(item => item.reason.includes('不唯一'))).toBe(true);
    await expect(service.syncChineseNewsScope(1, true)).rejects.toThrow('未写入任何新闻');
  });

  it('refuses URL conflicts outside the destination category and within the batch', async () => {
    editDb(db => db.run("insert into ay_content(acode,scode,filename,title) values ('en','999','en-cr1','Other')"));
    expect((await service.syncChineseNewsScope(1)).blocked[0].reason).toContain('其他栏目');
    await expect(service.syncChineseNewsScope(1, true)).rejects.toThrow('未写入任何新闻');
    translations.find(item => item.newsId === 2 && item.lang === 'fr').urlName = 'fr-cr1';
    expect((await service.syncChineseNewsScope(1)).blocked.some((item: any) => item.reason.includes('重复 URL'))).toBe(true);
  });

  it('rechecks the database and refuses to overwrite concurrent changes', async () => {
    guard.mockImplementation(async () => editDb(db => db.run("update ay_content set content='New PB edit' where filename='unrelated'")));
    await expect(service.syncChineseNewsScope(1, true)).rejects.toThrow('刚刚发生变化');
    expect(readRows()).toEqual([['cn', '999', 'unrelated', 'Unrelated', 'New PB edit']]);
  });

  it('does not claim success when no version is ready', async () => {
    translations.forEach(item => { item.content = ''; });
    expect((await service.syncChineseNewsScope(1)).readyCount).toBe(0);
    await expect(service.syncChineseNewsScope(1, true)).rejects.toThrow('没有内容完整');
  });
});
