import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { ProductService } from './product.service';
import { ProductFieldsService } from './product-fields.service';
import { normalizeSharedParameters } from './product-shared-parameters';
import { readPbootContentGroups } from '../common/pboot-content-import';

const languages = ['zh-CN', 'en', 'es', 'fr', 'ru', 'ar', 'pt', 'id', 'tr', 'vi'];
const acode = (lang: string) => lang === 'zh-CN' ? 'cn' : lang;

describe('native PB parameter synchronization', () => {
  let directory: string;
  let dbPath: string;
  let SQL: any;
  let service: any;
  let product: any;
  let translations: any[];

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-parameter-sync-test-'));
    dbPath = path.join(directory, 'site.db');
    SQL = await initSqlJs();
    const db = new SQL.Database();
    const fields = ['acode', 'scode', 'subscode', 'title', 'titlecolor', 'subtitle', 'filename', 'author', 'source', 'outlink', 'date', 'ico', 'pics', 'content', 'tags', 'enclosure', 'keywords', 'description', 'sorting', 'status', 'istop', 'isrecommend', 'isheadline', 'visits', 'likes', 'oppose', 'create_user', 'update_user', 'create_time', 'update_time', 'gtype', 'gid', 'gnote', 'picstitle'];
    db.run(`create table ay_content (id integer primary key autoincrement,${fields.map((name) => `${name} text`).join(',')})`);
    db.run('create table ay_content_sort (acode text,scode text,mcode text,filename text,name text)');
    db.run('create table ay_content_ext (extid integer primary key autoincrement,contentid integer,ext_cp_BigPic text,ext_video text,ext_weight text)');
    db.run('create table ay_extfield (id integer primary key autoincrement,mcode text,name text,type integer,value text,description text,sorting integer)');
    for (const lang of languages) db.run('insert into ay_content_sort values (?,?,?,?,?)', [acode(lang), acode(lang), '3', `${acode(lang)}-rigs`, 'Core drilling rigs']);
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();
    product = {
      id: 99, siteId: 2, menuId: 30, title: 'TEST800', urlName: 'cn-test800', content: '<p>Chinese</p>', show: true,
      thumbnail: '/static/1.jpg', largeImage: '/static/00.jpg', carouselImages: [], carouselTitles: [],
      sharedParameters: normalizeSharedParameters({ template: 'core', depthM: '800', coreBqM: '1000', coreNqM: '800', coreHqM: '500', pullback: '152', referencePrice: '98765', custom: [{ name: '功率', nameEn: 'Power', value: '100', unit: 'kW' }] }),
    };
    translations = languages.map((lang) => ({ lang, title: `TEST800 ${lang}`, urlName: `${acode(lang)}-test800`, subtitle: '', keywords: '', summary: 'Summary', content: `<p>${lang} content</p>`, carouselTitles: [] }));
    service = new ProductService({} as any, { find: async () => translations } as any, {} as any, {} as any,
      { protectBeforeDangerousSync: jest.fn() } as any,
      { getCurrentSiteLanguages: async () => languages.map((code) => ({ code })), getCurrentSite: () => ({ name: 'Test Site' }) } as any);
    service.findProductEntity = async () => product;
    service.ensureTranslations = async () => undefined;
    service.getPbootDbPath = () => dbPath;
    service.getPbootSiteRoot = () => directory;
    service.getPbootPublicBaseUrl = () => 'https://example.invalid';
    service.resolvePbootConfigFromMenu = async (config: any) => ({ ...config, scode: config.acode });
  });

  afterEach(() => {
    if (directory?.startsWith(path.join(os.tmpdir(), 'pboot-parameter-sync-test-'))) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('defaults to all ten configured languages and repeated sync updates rather than duplicates', async () => {
    const first = await service.syncToPboot(product.id);
    expect(first.synced.map((item: any) => item.lang)).toEqual(languages);
    expect(first.skipped).toEqual([]);
    expect(fs.existsSync(first.backupPath)).toBe(true);
    const second = await service.syncToPboot(product.id, { lang: 'zh-CN' });
    expect(second.synced).toHaveLength(10);
    expect(second.synced.every((item: any) => item.action === 'updated')).toBe(true);
    const db = new SQL.Database(fs.readFileSync(dbPath));
    try {
      expect(db.exec('select count(*) from ay_content')[0].values[0][0]).toBe(10);
      const field = product.sharedParameters.custom[0].fieldName;
      const rows = db.exec(`select e.ext_drill_depth,e.ext_core_capacity,e.ext_engine,e.${field},e.ext_cp_BigPic from ay_content c join ay_content_ext e on e.contentid=c.id order by c.id`)[0].values;
      expect(rows).toEqual(languages.map(() => ['800', 'BQ 1000 / NQ 800 / HQ 500', '', '100 kW', '/static/00.jpg']));
      expect(db.exec('pragma table_info(ay_content_ext)')[0].values.map((row: any[]) => row[1])).not.toEqual(expect.arrayContaining(['ext_bigpic']));
      expect(db.exec("select count(*) from ay_extfield where name in ('ext_spec_type','ext_shared_specs','ext_shared_data')")[0].values[0][0]).toBe(0);
      const imported = readPbootContentGroups(db, '3', 'product');
      expect(imported.sourceRows).toBe(10);
      expect(imported.groups[0].rows[0].ext_custom_parameters[0]).toMatchObject({ name: '功率', value: '100 kW' });
    } finally { db.close(); }
  });

  it('reports missing translations and menus without stopping later languages or copying Chinese', async () => {
    translations.find((item) => item.lang === 'es').content = '';
    const db = new SQL.Database(fs.readFileSync(dbPath));
    db.run("delete from ay_content_sort where acode='fr'");
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();
    const result = await service.syncToPboot(product.id, { all: true });
    expect(result.synced).toHaveLength(8);
    expect(result.skipped.map((item: any) => item.lang)).toEqual(['es', 'fr']);
    expect(result.skipped.map((item: any) => item.reasonCode)).toEqual(['translation-missing', 'pboot-menu-missing']);
    expect(result.synced.at(-1).lang).toBe('vi');
  });

  it('supports an explicit single language request', async () => {
    const result = await service.syncToPboot(product.id, { all: false, lang: 'en' });
    expect(result.synced.map((item: any) => item.lang)).toEqual(['en']);
  });

  it('does not treat an existing wrong-model column as a missing column', async () => {
    const db = new SQL.Database(fs.readFileSync(dbPath));
    db.run("update ay_content_sort set mcode='2' where acode='en'");
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();
    const result = await service.syncToPboot(product.id);
    expect(result.skipped).toEqual([expect.objectContaining({ lang: 'en', reasonCode: 'pboot-menu-model-mismatch' })]);
    expect(result.synced).toHaveLength(9);
  });

  it('preserves unrelated native fields and retired custom values', async () => {
    await service.syncToPboot(product.id);
    const field = product.sharedParameters.custom[0].fieldName;
    const db = new SQL.Database(fs.readFileSync(dbPath));
    db.run("update ay_content_ext set ext_weight='999'");
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();
    product.sharedParameters.custom = [];
    await service.syncToPboot(product.id);
    const updated = new SQL.Database(fs.readFileSync(dbPath));
    try {
      expect(updated.exec(`select ext_weight,${field} from ay_content_ext`)[0].values).toEqual(languages.map(() => ['999', '100 kW']));
    } finally { updated.close(); }
  });

  it('writes the four fixed fields for all ten languages without changing existing schema', async () => {
    product.sharedParameters = normalizeSharedParameters({
      depthM: '600', coreCapacity: 'BQ 1000 / NQ 800 / HQ 500', diameterMm: '140-400', engine: '36 kW',
    });
    await service.syncToPboot(product.id);
    const before = new SQL.Database(fs.readFileSync(dbPath));
    const schema = before.exec("select name,sql from sqlite_master where type='table' order by name");
    expect(before.exec('select count(*) from ay_extfield')[0].values[0][0]).toBe(4);
    before.close();
    product.sharedParameters = normalizeSharedParameters({ ...product.sharedParameters, engine: '110 kW' });
    const result = await service.syncToPboot(product.id);
    expect(result.synced).toHaveLength(10);
    const db = new SQL.Database(fs.readFileSync(dbPath));
    try {
      expect(db.exec("select name,sql from sqlite_master where type='table' order by name")).toEqual(schema);
      expect(db.exec('select ext_drill_depth,ext_core_capacity,ext_drill_diameter,ext_engine from ay_content_ext')[0].values)
        .toEqual(languages.map(() => ['600', 'BQ 1000 / NQ 800 / HQ 500', '140-400', '110 kW']));
    } finally { db.close(); }
  });

  it('uses managed engine fields across ten languages and preserves retired PB values', async () => {
    const engine = 'ext_param_existingengine';
    const before = new SQL.Database(fs.readFileSync(dbPath));
    for (const [name, label] of [[engine, '发动机'], ['ext_pullback', '回拖力'], ['ext_pullback_unit', '回拖力单位']]) {
      before.run(`alter table ay_content_ext add column ${name} text`);
      before.run('insert into ay_extfield(mcode,name,type,description,sorting) values (?,?,?,?,?)', ['3', name, 1, label, 900]);
    }
    fs.writeFileSync(dbPath, Buffer.from(before.export()));
    before.close();
    const fields = new ProductFieldsService({
      getCurrentSiteId: () => 2,
      getCurrentSiteStorageDir: () => directory,
    } as any, {} as any);
    service.productFields = fields;
    product.sharedParameters = normalizeSharedParameters({
      depthM: '600', coreCapacity: 'BQ 1000 / NQ 800 / HQ 500', diameterMm: '140-400',
      custom: [{ fieldName: engine, name: '发动机', value: '36', unit: 'kW' }],
    });
    expect((await service.syncToPboot(product.id)).synced).toHaveLength(10);
    const existing = new SQL.Database(fs.readFileSync(dbPath));
    expect(existing.exec(`select ${engine} from ay_content_ext`)[0].values).toEqual(languages.map(() => ['36 kW']));
    existing.run("update ay_content_ext set ext_pullback='152',ext_pullback_unit='kN'");
    fs.writeFileSync(dbPath, Buffer.from(existing.export()));
    existing.close();
    product.sharedParameters.engine = '玉柴 110 kW';
    expect((await service.syncToPboot(product.id)).synced).toHaveLength(10);
    const updated = new SQL.Database(fs.readFileSync(dbPath));
    try {
      expect(updated.exec(`select ${engine},ext_pullback,ext_pullback_unit from ay_content_ext`)[0].values)
        .toEqual(languages.map(() => ['玉柴 110 kW', '152', 'kN']));
      expect(updated.exec("select count(*) from ay_extfield where name='ext_engine'")[0].values[0][0]).toBe(0);
      const imported = readPbootContentGroups(updated, '3', 'product');
      for (const group of imported.groups) for (const row of group.rows) {
        expect(row.ext_engine).toBe('玉柴 110 kW');
        expect(row.ext_parameter_values[engine]).toBe('玉柴 110 kW');
      }
    } finally { updated.close(); }
  });
});
