import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SiteInformationService } from './site-information.service';
import { SiteInformationDraft } from './site-information.entity';
import { INFORMATION_FIELDS, normalizeInformation, translationFields } from './site-information.fields';
import { SiteInformationTranslator } from './site-information-translator.service';
import { prepareInformationOnline } from './site-information-online';
import { AreaService } from '../area/area.service';

describe('site and company information', () => {
  const originalEnvironment = process.env.APP_ENVIRONMENT;
  let folder: string;
  let source: DataSource;
  let service: SiteInformationService;
  let selected: number;
  let requested: number | undefined;
  let SQL: any;
  let sites: any;
  let translator: any;
  const profile = (result: any, language = 'cn') => result.profiles.find(item => item.language === language);
  const sample = (language: string) => {
    const data = { site: {}, company: {} } as any;
    for (const field of INFORMATION_FIELDS) data[field.section][field.key] = '';
    Object.assign(data.site, { title: '山博', subtitle: '钻机制造', theme: language, domain: `${language}.example.com`, logo: '/static/logo.jpg', statistical: '<script>stats()</script>' });
    Object.assign(data.company, { name: '山博机械', address: '中国山东济宁', phone: '+86 123', email: 'info@example.com' });
    return data;
  };
  const editPb = (work: (db: any) => void, id = selected) => {
    const file = sites.getSite(id).dbPath;
    const db = new SQL.Database(fs.readFileSync(file));
    try { work(db); fs.writeFileSync(file, db.export()); } finally { db.close(); }
  };
  const readPb = (sql: string, id = selected) => {
    const db = new SQL.Database(fs.readFileSync(sites.getSite(id).dbPath));
    try { return db.exec(sql); } finally { db.close(); }
  };

  beforeEach(async () => {
    process.env.APP_ENVIRONMENT = 'local';
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'site-information-test-'));
    SQL = await initSqlJs(); selected = 1; requested = 1;
    source = new DataSource({ type: 'sqljs', entities: [SiteInformationDraft], synchronize: true });
    await source.initialize();
    const fixtures = [1, 2].map(id => {
      const rootPath = path.join(folder, String(id));
      fs.mkdirSync(path.join(rootPath, 'data'), { recursive: true });
      for (const language of ['cn', 'en', 'fr']) {
        fs.mkdirSync(path.join(rootPath, 'template', language, 'html'), { recursive: true });
        fs.writeFileSync(path.join(rootPath, 'template', language, 'html/index.html'), '<h1>Fixture</h1>');
      }
      const db = new SQL.Database();
      db.run('CREATE TABLE ay_area (id INTEGER PRIMARY KEY, acode TEXT, pcode TEXT, name TEXT, domain TEXT)');
      for (const section of ['site', 'company']) {
        db.run(`CREATE TABLE ay_${section} (id INTEGER PRIMARY KEY, acode TEXT, ${INFORMATION_FIELDS.filter(field => field.section === section).map(field => `${field.key} TEXT NOT NULL`).join(',')}, untouched TEXT DEFAULT 'keep')`);
      }
      db.run('CREATE TABLE ay_content (id INTEGER PRIMARY KEY,title TEXT)'); db.run("INSERT INTO ay_content VALUES (1,'Unchanged product')");
      for (const [index, language] of ['cn', 'en', 'fr'].entries()) {
        db.run('INSERT INTO ay_area VALUES (?,?,?,?,?)', [index + 1, language, '0', language, `${language}.example.com`]);
        if (language === 'fr') continue;
        const values = sample(language);
        for (const section of ['site', 'company']) {
          const fields = INFORMATION_FIELDS.filter(field => field.section === section).map(field => field.key);
          db.run(`INSERT INTO ay_${section} (acode,${fields.join(',')}) VALUES (${['?', ...fields.map(() => '?')].join(',')})`, [language, ...fields.map(field => values[section][field])]);
        }
      }
      const dbPath = path.join(rootPath, 'data', 'pb.db'); fs.writeFileSync(dbPath, db.export()); db.close();
      return { id, name: `Site ${id}`, rootPath, dbPath, enabled: true, environment: 'phpstudy', publicBaseUrl: 'http://fixture.c' };
    });
    sites = { getSite: (id: number) => fixtures[id - 1], getCurrentSite: () => fixtures[selected - 1],
      getPbootDbPath: () => fixtures[selected - 1].dbPath,
      getCurrentSiteId: () => selected, isDefaultSite: (id: number) => id === 1,
      getCurrentSiteStorageDir: () => path.join(folder, `uploads-${selected}`) };
    translator = { models: () => [], translate: jest.fn(async (fields: any, language: string) => ({
      fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ? `${language}: ${value}` : ''])), model: 'mock', fallbackUsed: false })) };
    service = new SiteInformationService(source.getRepository(SiteInformationDraft), sites, { getSiteId: () => requested } as any, translator);
  });
  afterEach(async () => {
    if (originalEnvironment === undefined) delete process.env.APP_ENVIRONMENT; else process.env.APP_ENVIRONMENT = originalEnvironment;
    await source.destroy();
    // Only this test's unique temporary directory is removed.
    if (path.dirname(folder) === os.tmpdir() && path.basename(folder).startsWith('site-information-test-')) fs.rmSync(folder, { recursive: true, force: true });
  });

  const setupOnline = () => {
    const storage = sites.getCurrentSiteStorageDir(); fs.mkdirSync(storage, { recursive: true });
    fs.writeFileSync(path.join(storage, 'ftp.config.json'), JSON.stringify({ host: 'example.com', user: 'fixture', password: 'fixture', secure: true }));
    fs.writeFileSync(path.join(storage, 'system-license.json'), JSON.stringify({ siteId: selected, profiles: { baota: { domains: ['example.com', 'cn.example.com', 'en.example.com', 'fr.example.com'] } } }));
    const root = sites.getCurrentSite().rootPath;
    fs.mkdirSync(path.join(root, 'static')); fs.writeFileSync(path.join(root, 'static/logo.jpg'), 'fixture-image');
  };
  it('links domains in both directions, retains aliases and other languages, and rejects duplicates atomically', async () => {
    editPb(db => {
      db.run("ALTER TABLE ay_area ADD COLUMN update_user TEXT; ALTER TABLE ay_area ADD COLUMN update_time TEXT");
      db.run("UPDATE ay_area SET domain='en.example.com,www.example.com' WHERE acode='en'");
    });
    const areas = new AreaService(sites);
    await areas.update(2, { domain: 'https://new.example.com/,www.example.com' });
    expect(profile(await service.read(), 'en').data.site.domain).toBe('new.example.com');
    expect(profile(await service.read()).data.site.domain).toBe('cn.example.com');
    const target = profile(await service.read(), 'en');
    target.data.site.domain = 'https://next.example.com/';
    target.data.site.title = 'Unpublished title';
    let state = await service.save(target);
    expect(readPb("SELECT domain FROM ay_area WHERE acode='en'")[0].values[0][0]).toBe('new.example.com,www.example.com');
    state = await service.sync({ items: [profile(state, 'en')] });
    expect(readPb("SELECT domain FROM ay_area WHERE acode='en'")[0].values[0][0]).toBe('next.example.com,www.example.com');
    await areas.update(2, { domain: 'www.example.com,next.example.com' });
    expect(readPb("SELECT domain,title FROM ay_site WHERE acode='en'")[0].values[0]).toEqual(['https://www.example.com', 'Unpublished title']);
    // An older editor cannot restore the old domain over a new region change.
    await expect(service.sync({ items: [profile(state, 'en')] })).rejects.toThrow('其它窗口');
    const before = fs.readFileSync(sites.getCurrentSite().dbPath);
    await expect(areas.update(2, { domain: 'cn.example.com' })).rejects.toThrow('已绑定');
    expect(fs.readFileSync(sites.getCurrentSite().dbPath)).toEqual(before);
    await areas.update(2, { domain: '' });
    expect(readPb("SELECT domain FROM ay_site WHERE acode='en'")[0].values[0][0]).toBe('');
    expect(readPb("SELECT domain FROM ay_area WHERE acode='en'")[0].values[0][0]).toBe('');
    expect(profile(await service.read()).data.site.domain).toBe('cn.example.com');
    expect(readPb("SELECT domain FROM ay_area WHERE acode='en'", 2)[0].values[0][0]).toBe('en.example.com');
  });
  it('rejects a conflicting site domain without publishing other fields', async () => {
    const target = profile(await service.read(), 'en');
    target.data.site.domain = 'cn.example.com';
    target.data.site.title = 'Must not publish';
    const state = await service.save(target);
    const before = fs.readFileSync(sites.getCurrentSite().dbPath);
    await expect(service.sync({ items: [profile(state, 'en')] })).rejects.toThrow('已绑定');
    expect(fs.readFileSync(sites.getCurrentSite().dbPath)).toEqual(before);
  });
  it('sends only requested site/company language and images without changing local PB or draft revisions', async () => {
    setupOnline();
    const first = profile(await service.read()); const saved = await service.save(first);
    const before = fs.readFileSync(sites.getCurrentSite().dbPath);
    const transmit = jest.spyOn(service as any, 'sendOnline').mockResolvedValue({ warnings: [] });
    const result = await service.syncOnline({ siteId: 1, targetRevision: saved.onlineTargetRevision, items: [profile(saved)] });
    expect(result.languages).toEqual(['cn']); expect(result.imageCount).toBe(1);
    const [, payload, assets] = transmit.mock.calls[0] as any[];
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].data.site.domain).toBe('cn.example.com');
    expect(payload.items[0].data.site.theme).toBe('cn');
    expect(payload.items[0].data.site.statistical).toBeUndefined();
    expect(payload.items[0].data.site.logo).toBe('/' + assets[0].path);
    expect(fs.readFileSync(sites.getCurrentSite().dbPath)).toEqual(before);
    expect(profile(await service.read()).revision).toBe(profile(saved).revision);
  });
  it('supports all selected languages, deduplicates shared logos and rejects stale target or cross-site requests', async () => {
    setupOnline();
    for (const lang of ['cn', 'en']) await service.save(profile(await service.read(), lang));
    const result = await service.read();
    const transmit = jest.spyOn(service as any, 'sendOnline').mockResolvedValue({ warnings: [] });
    const dto = { siteId: 1, targetRevision: result.onlineTargetRevision, items: result.profiles.filter(p => p.language !== 'fr') };
    const synced = await service.syncOnline(dto);
    expect(synced.languages).toEqual(['cn', 'en']); expect(synced.imageCount).toBe(1);
    await expect(service.syncOnline({ ...dto, targetRevision: 'stale' })).rejects.toThrow('连接已变化');
    await expect(service.syncOnline({ ...dto, siteId: 2 })).rejects.toThrow('网站已变化');
    await expect(service.syncOnline({ ...dto, items: [dto.items[0], dto.items[0]] })).rejects.toThrow('重复');
    expect(transmit).toHaveBeenCalledTimes(1);
  });
  it('hides and rejects remote sync on Baota even if a site is incorrectly marked local', async () => {
    process.env.APP_ENVIRONMENT = 'baota';
    expect((await service.read()).canSyncOnline).toBe(false);
    await expect(service.syncOnline({ siteId: 1, targetRevision: '', items: [] })).rejects.toThrow('线上环境无需');
  });
  it('rejects cross-site uploads and traversal paths before any network access', () => {
    const data = sample('cn'); data.site.logo = '/static/../../outside.jpg';
    expect(() => prepareInformationOnline(sites, [{ language: 'cn', data }], ['cn.example.com'])).toThrow('越过');
    data.site.logo = 'http://localhost:5108/img-upload/file/logo.jpg?siteId=2';
    expect(() => prepareInformationOnline(sites, [{ language: 'cn', data }], ['cn.example.com'])).toThrow('其他站点');
  });
  it('copies explicit domain URLs and blank bindings, but rejects local or unrelated domains', () => {
    const data = sample('cn'); data.site.logo = '';
    const prepare = () => prepareInformationOnline(sites, [{ language: 'cn', data }], ['example.com']);
    for (const domain of ['fixture.c', 'localhost', 'other.com', 'https://example.com/path', 'https://user@example.com']) {
      data.site.domain = domain;
      expect(prepare).toThrow('线上域名列表');
    }
    data.site.domain = 'https://example.com/';
    expect(prepare().items[0].data.site.domain).toBe(data.site.domain);
    data.site.domain = ''; data.site.theme = '';
    expect(prepare().items[0].data.site).toMatchObject({ domain: '', theme: '' });
  });

  it('reads all fields and languages without writing management drafts or PB', async () => {
    const original = fs.readFileSync(sites.getSite(1).dbPath);
    const result = await service.read();
    expect(result.languages.map(item => item.code)).toEqual(['cn', 'en', 'fr']);
    expect(profile(result).data).toEqual(sample('cn'));
    expect(profile(result, 'fr').data.site.theme).toBe('fr');
    expect(await source.getRepository(SiteInformationDraft).count()).toBe(0);
    expect(fs.readFileSync(sites.getSite(1).dbPath)).toEqual(original);
  });
  it('saves drafts persistently and detects concurrent editing without touching PB', async () => {
    const first = profile(await service.read()); first.data.company.name = '新公司';
    const saved = profile(await service.save(first));
    expect(saved.pending).toBe(true);
    expect(profile(await service.read()).data.company.name).toBe('新公司');
    expect(readPb("select name from ay_company where acode='cn'")[0].values[0][0]).toBe('山博机械');
    await expect(service.save(first)).rejects.toThrow('其它窗口');
  });
  it('isolates drafts and rejects mismatched or unconfigured site/language requests', async () => {
    const first = profile(await service.read()); first.data.site.title = 'Only site one'; await service.save(first);
    selected = 2; requested = 2;
    expect(profile(await service.read()).data.site.title).toBe('山博');
    await expect(service.save({ ...profile(await service.read()), language: 'de' })).rejects.toThrow('不属于');
    requested = 999; await expect(service.read()).rejects.toThrow('有效');
  });
  it('translates only approved fields from CN and preserves target configuration', async () => {
    const result = await service.read(); const target = profile(result, 'en');
    const translated = await service.translate({ language: 'en', revision: target.revision, sourceRevision: profile(result).revision, model: 'mock' });
    const english = profile(translated, 'en');
    expect(english.data.site.title).toBe('en: 山博');
    expect(english.data.site.domain).toBe('en.example.com');
    expect(english.data.site.theme).toBe('en');
    expect(english.data.site.statistical).toBe('<script>stats()</script>');
    expect(english.data.company.phone).toBe('+86 123');
    expect(Object.keys(translator.translate.mock.calls[0][0])).not.toContain('site.statistical');
    expect(english.pending).toBe(true);
    const cn = profile(translated); cn.data.site.title = '基础修改';
    expect(profile(await service.save(cn), 'en').sourceChanged).toBe(true);
  });
  it('keeps prior translations when the provider fails and rejects stale source revisions', async () => {
    const result = await service.read();
    translator.translate.mockRejectedValueOnce(new Error('offline'));
    await expect(service.translate({ language: 'en', revision: profile(result, 'en').revision, sourceRevision: profile(result).revision, model: 'mock' })).rejects.toThrow('offline');
    expect(profile(await service.read(), 'en').data).toEqual(sample('en'));
    const changed = profile(result); changed.data.site.title = 'changed'; await service.save(changed);
    await expect(service.translate({ language: 'en', revision: profile(result, 'en').revision, sourceRevision: profile(result).revision, model: 'mock' })).rejects.toThrow('其它窗口');
  });
  it('publishes selected languages, creates missing records and preserves unrelated data', async () => {
    let state = await service.read();
    const cn = profile(state); cn.data.company.phone = '999'; state = await service.save(cn);
    const fr = profile(state, 'fr'); fr.data.company.name = 'French company'; state = await service.save(fr);
    const result = await service.sync({ items: ['cn', 'fr'].map(lang => ({ language: lang, revision: profile(state, lang).revision })) });
    expect(profile(result).pending).toBe(false);
    expect(profile(result, 'fr').exists).toEqual({ site: true, company: true });
    expect(readPb("select phone from ay_company where acode='en'")[0].values[0][0]).toBe('+86 123');
    expect(readPb('select title from ay_content')[0].values[0][0]).toBe('Unchanged product');
    expect(readPb("select untouched from ay_site where acode='cn'")[0].values[0][0]).toBe('keep');
  });
  it('refuses PB conflicts atomically, allows unrelated content changes and supports reimport', async () => {
    let state = await service.read();
    const cn = profile(state); cn.data.site.title = 'draft'; state = await service.save(cn);
    editPb(db => db.run("UPDATE ay_content SET title='another product'"));
    state = await service.sync({ items: [{ language: 'cn', revision: profile(state).revision }] });
    const edited = profile(state); edited.data.site.title = 'draft two'; state = await service.save(edited);
    editPb(db => db.run("UPDATE ay_site SET title='PB external' WHERE acode='cn'"));
    expect(profile(await service.read()).pbChanged).toBe(true);
    await expect(service.sync({ items: [{ language: 'cn', revision: profile(state).revision }] })).rejects.toThrow('PB 资料已被修改');
    expect(readPb("select title from ay_site where acode='cn'")[0].values[0][0]).toBe('PB external');
    state = await service.import({ language: 'cn', revision: profile(state).revision });
    expect(profile(state).data.site.title).toBe('PB external');
    expect(profile(state).hasDraft).toBe(false);
  });
  it('copies a site-owned logo and clears only generated cache files', async () => {
    const uploads = path.join(sites.getCurrentSiteStorageDir(), 'uploads'); fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, 'test.png'), 'image fixture');
    const root = sites.getSite(1).rootPath;
    for (const relative of ['runtime/config', 'runtime/cache', 'runtime/complile']) { fs.mkdirSync(path.join(root, relative), { recursive: true }); fs.writeFileSync(path.join(root, relative, 'generated.php'), 'cached'); }
    let state = await service.read(); const cn = profile(state); cn.data.site.logo = 'test.png'; state = await service.save(cn);
    state = await service.sync({ items: [{ language: 'cn', revision: profile(state).revision }] });
    expect(profile(state).data.site.logo).toMatch(/^\/static\/codex\/site-information\/\d{8}\/test.png$/);
    expect(fs.existsSync(path.join(root, profile(state).data.site.logo))).toBe(true);
    expect(fs.existsSync(path.join(root, 'runtime/config/generated.php'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'template/cn'))).toBe(true);
  });
  it('rejects malformed fields, paths and active PB journals', async () => {
    expect(() => normalizeInformation({ ...sample('cn'), site: { ...sample('cn').site, title: 1 } })).toThrow('格式');
    const data = sample('cn'); data.site.theme = '../other'; expect(() => normalizeInformation(data)).toThrow('模板');
    const dto = profile(await service.read()); dto.data.site.logo = 'javascript:alert(1)'; await expect(service.save(dto)).rejects.toThrow('图片');
    fs.writeFileSync(sites.getSite(1).dbPath + '-wal', 'active'); await expect(service.read()).rejects.toThrow('正在写入');
  });

  it('previews setup without writes, fills absent records, preserves translated data and is idempotent', async () => {
    editPb(db => { db.run("UPDATE ay_site SET subtitle='Existing English', logo='' WHERE acode='en'"); db.run("CREATE TABLE ay_config (name TEXT,value TEXT)"); db.run("INSERT INTO ay_config VALUES ('sn','private-license-fixture')"); });
    const before = fs.readFileSync(sites.getSite(1).dbPath);
    const plan = await service.previewSetup();
    expect(fs.readFileSync(sites.getSite(1).dbPath)).toEqual(before);
    expect(plan.items.find(item => item.language === 'fr')?.createSite).toBe(true);
    expect(JSON.stringify(plan)).not.toContain('private-license');
    expect(JSON.stringify(plan)).not.toContain('stats()');
    const result = await service.setup({ token: plan.token, languages: ['fr', 'en'] });
    expect(profile(result, 'fr').exists).toEqual({ site: true, company: true });
    expect(profile(result, 'fr').data.site).toMatchObject({ theme: 'fr', title: '山博', domain: 'fr.example.com', statistical: '' });
    expect(profile(result, 'fr').data.company.phone).toBe('+86 123');
    expect(profile(result, 'en').data.site.subtitle).toBe('Existing English');
    expect(readPb('select title from ay_content')[0].values[0][0]).toBe('Unchanged product');
    expect(readPb('select value from ay_config')[0].values[0][0]).toBe('private-license-fixture');
    const again = await service.previewSetup();
    const after = fs.readFileSync(sites.getSite(1).dbPath);
    await service.setup({ token: again.token, languages: ['fr'] });
    expect(fs.readFileSync(sites.getSite(1).dbPath)).toEqual(after);
    expect(again.items.every(item => !item.needsChange)).toBe(true);
  });
  it('repairs invalid themes but preserves valid custom themes and never copies CN domains or scripts', async () => {
    editPb(db => db.run("UPDATE ay_site SET theme='default',domain='' WHERE acode='en'"));
    const plan = await service.previewSetup();
    expect(plan.items.find(item => item.language === 'en')?.changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'site.theme', after: 'en' })]));
    await service.setup({ token: plan.token, languages: ['en'] });
    editPb(db => db.run("UPDATE ay_site SET theme='cn' WHERE acode='en'"));
    expect((await service.previewSetup()).items.find(item => item.language === 'en')?.changes.some(item => item.field === 'site.theme')).toBe(false);
  });
  it('blocks stale previews, missing templates, pending drafts and different sites before any PB writes', async () => {
    const first = await service.previewSetup();
    editPb(db => db.run("UPDATE ay_site SET title='Updated source' WHERE acode='cn'"));
    await expect(service.setup({ token: first.token, languages: ['fr'] })).rejects.toThrow('预览已变化');
    const plan = await service.previewSetup(); selected = 2; requested = 2;
    await expect(service.setup({ token: plan.token, languages: ['fr'] })).rejects.toThrow('预览已变化');
    selected = 1; requested = 1;
    fs.unlinkSync(path.join(sites.getSite(1).rootPath, 'template/fr/html/index.html'));
    const missing = await service.previewSetup();
    const before = fs.readFileSync(sites.getSite(1).dbPath);
    await expect(service.setup({ token: missing.token, languages: ['en', 'fr'] })).rejects.toThrow('缺少');
    expect(fs.readFileSync(sites.getSite(1).dbPath)).toEqual(before);
    const en = profile(await service.read(), 'en'); en.data.company.name = 'Pending translation'; await service.save(en);
    const draft = await service.previewSetup();
    await expect(service.setup({ token: draft.token, languages: ['en'] })).rejects.toThrow('草稿');
    await expect(service.setup({ token: draft.token, languages: ['fr','fr'] })).rejects.toThrow('不重复');
    await expect(service.setup({ token: draft.token, languages: ['unknown'] })).rejects.toThrow('不属于');
  });
});

describe('site information translation adapter', () => {
  let service: SiteInformationTranslator;
  const originalFetch = global.fetch;
  beforeEach(() => {
    service = new SiteInformationTranslator(new ConfigService({ DEEPSEEK_API_KEY: 'fixture-not-a-real-key' }));
    jest.spyOn(service, 'models').mockReturnValue([{ value: 'deepseek-chat', provider: 'deepseek', available: true, operational: true }] as any);
  });
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
  it('preserves HTML and unescaped plain text, excludes protected fields and validates JSON', async () => {
    global.fetch = jest.fn(async (_url, request) => {
      const messages = JSON.parse(String(request.body)).messages;
      const input = JSON.parse(messages[1].content);
      expect(JSON.stringify(input)).not.toContain('<a');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(Object.fromEntries(Object.keys(input).map(key => [key, 'R&D equipment']))) } }] }), { status: 200 });
    }) as any;
    const result = await service.translate({ 'company.name': '山博', 'site.copyright': '<a href="/about"> 中文 </a>', 'site.subtitle': '' }, 'en', 'deepseek-chat');
    expect(result.fields['company.name']).toBe('R&D equipment');
    expect(result.fields['site.copyright']).toBe('<a href="/about"> R&amp;D equipment </a>');
    expect(result.fields['site.subtitle']).toBe('');
  });
  it.each(['{}', '{"site.title:0":""}', '{"site.title:0":"<script>bad()</script>"}'])('rejects incomplete or injected translation: %s', async text => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 })) as any;
    await expect(service.translate({ 'site.title': '中文标题' }, 'en', 'deepseek-chat')).rejects.toThrow('原资料未改变');
  });
  it('rejects CN targets, unsupported models and empty base records', async () => {
    await expect(service.translate({ title: '中文' }, 'cn', 'deepseek-chat')).rejects.toThrow('不支持');
    await expect(service.translate({ title: '中文' }, 'en', 'invalid')).rejects.toThrow('已配置');
    await expect(service.translate({ title: '' }, 'en', 'deepseek-chat')).rejects.toThrow('CN');
  });
});
