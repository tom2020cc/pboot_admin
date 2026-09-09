import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { ProductFieldsService } from './product-fields.service';
import { normalizeSharedParameters } from './product-shared-parameters';
import { parseFolderParameterTexts } from './product-folder-parameters';

describe('site-scoped product field management', () => {
  let root: string;
  let SQL: any;
  let current: number;
  let products: any[];
  let sites: any;
  let service: ProductFieldsService;
  const engine = 'ext_param_existingengine';
  const database = (id: number) => path.join(root, String(id), 'data', 'site.db');
  const open = (id = current) => new SQL.Database(fs.readFileSync(database(id)));

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-fields-test-'));
    SQL = await initSqlJs();
    current = 1;
    products = [];
    for (const id of [1, 2]) {
      fs.mkdirSync(path.dirname(database(id)), { recursive: true });
      const db = new SQL.Database();
      db.run(`create table ay_content_ext (contentid integer, ext_drill_depth text, ext_core_capacity text, ext_drill_diameter text, ${engine} text, ext_pullback text, ext_pullback_unit text, ext_weight text)`);
      db.run(`insert into ay_content_ext values (10,'800','BQ 1000 / NQ 800 / HQ 500','140-400','36 kW','152','kN','')`);
      db.run('create table ay_extfield (id integer primary key, mcode text, name text, description text, sorting integer, type integer, value text)');
      const fields = [['ext_drill_depth', '钻孔深度'], ['ext_core_capacity', '取芯能力'], ['ext_drill_diameter', '钻孔直径'], [engine, '发动机'], ['ext_pullback', '回拖力'], ['ext_pullback_unit', '回拖力单位'], ['ext_weight', '重量']];
      fields.forEach(([name, label]) => db.run('insert into ay_extfield(mcode,name,description,sorting,type) values (?,?,?,?,?)', ['3', name, label, 900, 1]));
      fs.writeFileSync(database(id), Buffer.from(db.export()));
      db.close();
    }
    sites = {
      getCurrentSiteId: () => current,
      getCurrentSite: () => ({ id: current, name: `Site ${current}` }),
      getPbootSiteRoot: () => path.join(root, String(current)),
      getPbootDbPath: () => database(current),
      getCurrentSiteStorageDir: (section: string) => {
        const directory = path.join(root, 'managed', String(current), section);
        fs.mkdirSync(directory, { recursive: true });
        return directory;
      },
    };
    service = new ProductFieldsService(sites, { find: async ({ where }: any) => products.filter((item) => item.siteId === where.siteId) } as any);
  });

  afterEach(() => {
    const relative = path.relative(os.tmpdir(), root);
    if (!relative.startsWith('..') && relative.startsWith('pboot-fields-test-')) fs.rmSync(root, { recursive: true, force: true });
  });

  it('reuses the existing engine and lists without changing PB or writing configuration', async () => {
    const before = fs.readFileSync(database(1));
    const list = await service.list();
    expect(list.fields.filter((field) => field.enabled).map((field) => field.name)).toEqual(['ext_drill_depth', 'ext_core_capacity', 'ext_drill_diameter', engine]);
    expect(list.fields.find((field) => field.name === engine)).toMatchObject({ key: 'engine', pbUsed: 1, pbootExists: true });
    expect(list.fields.map((field) => field.name)).not.toContain('ext_pullback');
    expect(list.fields.map((field) => field.name)).not.toContain('ext_pullback_unit');
    expect(fs.readFileSync(database(1))).toEqual(before);
    expect(fs.existsSync(path.join(sites.getCurrentSiteStorageDir('state'), 'product-fields.json'))).toBe(false);
  });

  it('keeps retired force fields hidden after reading PB or restoring old configuration', async () => {
    const before = fs.readFileSync(database(1));
    const config = {
      version: 1, siteId: 1, removed: [],
      fields: [
        { name: 'ext_PULLBACK', label: '回拖力', unit: '', sort: 900, type: 1, enabled: true },
        { name: 'ext_pullback_unit', label: '回拖力单位', unit: '', sort: 900, type: 1, enabled: false },
        { name: 'ext_weight', label: '重量', unit: 'kg', sort: 50, type: 1, enabled: true },
      ],
    };
    fs.writeFileSync(path.join(sites.getCurrentSiteStorageDir('state'), 'product-fields.json'), JSON.stringify(config));
    for (const result of [await service.list(), await service.importFromPboot(), await service.list()]) {
      expect(result.fields.map((field) => field.name.toLowerCase())).not.toEqual(expect.arrayContaining(['ext_pullback']));
      expect(result.fields.map((field) => field.name.toLowerCase())).not.toEqual(expect.arrayContaining(['ext_pullback_unit']));
      expect(result.fields.find((field) => field.name === 'ext_weight')).toMatchObject({ enabled: true, unit: 'kg', sort: 50 });
      expect(result.fields.find((field) => field.name === engine)).toMatchObject({ key: 'engine', enabled: true });
    }
    expect(fs.readFileSync(database(1))).toEqual(before);
    const db = open();
    try {
      const values = service.writeProductValues(db, normalizeSharedParameters({ engine: '110 kW', pullback: '999' }));
      expect(values).not.toHaveProperty('ext_pullback');
      expect(values).not.toHaveProperty('ext_pullback_unit');
      expect(db.exec('select ext_pullback,ext_pullback_unit from ay_content_ext')[0].values[0]).toEqual(['152', 'kN']);
    } finally { db.close(); }
  });

  it('creates, updates and removes only the selected site configuration', async () => {
    await service.create({ name: 'ext_power', label: '功率', unit: 'kW' });
    await service.update('ext_power', { label: '额定功率', sort: 5, enabled: false });
    expect((await service.list()).fields[0]).toMatchObject({ name: 'ext_power', label: '额定功率', enabled: false });
    current = 2;
    expect((await service.list()).fields.some((field) => field.name === 'ext_power')).toBe(false);
    await expect(service.update('ext_power', { label: 'other site' })).rejects.toThrow();
    current = 1;
    await service.remove('ext_power');
    await service.importFromPboot();
    expect((await service.list()).fields.some((field) => field.name === 'ext_power')).toBe(false);
    expect(fs.readdirSync(path.join(sites.getCurrentSiteStorageDir('backups'), 'product-fields')).length).toBeGreaterThan(0);
  });

  it('blocks deletion when a product holds data and preserves disabled values', async () => {
    await service.create({ name: 'ext_power', label: '功率' });
    products.push({ siteId: 1, sharedParameters: normalizeSharedParameters({ fieldValues: { ext_power: '110' } }) });
    await expect(service.remove('ext_power')).rejects.toThrow('已有产品数据');
    await service.update('ext_power', { label: '功率', enabled: false });
    const db = open();
    try {
      const values = service.writeProductValues(db, products[0].sharedParameters);
      expect(values).not.toHaveProperty('ext_power');
      expect(products[0].sharedParameters.fieldValues.ext_power).toBe('110');
    } finally { db.close(); }
  });

  it('removes an unused imported field from the project without dropping the PB column', async () => {
    await service.remove('ext_weight');
    expect((await service.importFromPboot()).fields.some((field) => field.name === 'ext_weight')).toBe(false);
    const db = open();
    expect(db.exec('pragma table_info(ay_content_ext)')[0].values.some((row: any[]) => row[1] === 'ext_weight')).toBe(true);
    db.close();
  });

  it('syncs field definitions with a backup and leaves data and the other site untouched', async () => {
    const before = fs.readFileSync(database(1));
    const other = fs.readFileSync(database(2));
    await service.update(engine, { label: '发动机型号', sort: 1 });
    const result = await service.syncToPboot();
    expect(result.synced).toBe(4);
    expect(fs.readFileSync(result.backupPath)).toEqual(before);
    expect(fs.readFileSync(database(2))).toEqual(other);
    const db = open();
    try {
      expect(db.exec(`select ${engine},ext_pullback,ext_pullback_unit from ay_content_ext`)[0].values[0]).toEqual(['36 kW', '152', 'kN']);
      expect(db.exec("select count(*) from ay_extfield where name='ext_engine'")[0].values[0][0]).toBe(0);
      expect(db.exec(`select description from ay_extfield where name='${engine}'`)[0].values[0][0]).toBe('发动机型号');
    } finally { db.close(); }
  });

  it('writes the engine and new fields but never writes old pullback or disabled fields', async () => {
    await service.create({ name: 'ext_power', label: '功率' });
    const parameters = normalizeSharedParameters({ engine: '玉柴 110 kW', depthM: '600', pullback: '999', fieldValues: { ext_power: '110', ext_weight: '300', ext_unknown: 'bad' } });
    const db = open();
    try {
      const values = service.writeProductValues(db, parameters);
      expect(values).toMatchObject({ [engine]: '玉柴 110 kW', ext_power: '110', ext_drill_depth: '600' });
      expect(values).not.toHaveProperty('ext_engine');
      expect(values).not.toHaveProperty('ext_pullback');
      expect(values).not.toHaveProperty('ext_weight');
      expect(values).not.toHaveProperty('ext_unknown');
      expect(db.exec('pragma table_info(ay_content_ext)')[0].values.some((row: any[]) => row[1] === 'ext_power')).toBe(true);
    } finally { db.close(); }
  });

  it('keeps legacy engine values and permits an explicit clear', async () => {
    const db = open();
    try {
      const parameters = normalizeSharedParameters({ custom: [{ fieldName: engine, name: '发动机', value: '36', unit: 'kW' }] });
      expect(service.writeProductValues(db, parameters)[engine]).toBe('36 kW');
      expect(service.writeProductValues(db, { ...parameters, engine: '' })[engine]).toBe('');
    } finally { db.close(); }
  });

  it('protects names, reserved fields and site boundaries', async () => {
    await expect(service.create({ name: "ext_x';drop table ay_content_ext;", label: 'bad' })).rejects.toThrow();
    await expect(service.create({ name: 'ext_DRILL_depth', label: 'duplicate' })).rejects.toThrow('已经存在');
    await expect(service.update(engine, { name: 'ext_renamed', label: 'renamed' })).rejects.toThrow('不能修改');
    await expect(service.update('ext_pullback', { label: 'force', enabled: true })).rejects.toThrow('不存在');
    await expect(service.create({ name: 'ext_pullback', label: 'force', enabled: true })).rejects.toThrow('原有功能');
    await expect(service.remove(engine)).rejects.toThrow('基础字段');
    sites.getPbootDbPath = () => database(2);
    await expect(service.list()).rejects.toThrow('不属于当前网站');
  });

  it('does not override a PB field belonging to another model', async () => {
    const db = open();
    db.run("update ay_extfield set mcode='2' where name='ext_drill_depth'");
    fs.writeFileSync(database(1), Buffer.from(db.export()));
    db.close();
    const before = fs.readFileSync(database(1));
    await expect(service.syncToPboot()).rejects.toThrow('不同类型');
    expect(fs.readFileSync(database(1))).toEqual(before);
  });

  it('prepares imported parameters using existing force fields without touching PB', async () => {
    await service.create({ name: 'ext_custom_force', label: '回拉力', unit: 'KN' });
    const before = fs.readFileSync(database(1));
    const parsed = parseFolderParameterTexts([{ filename: '参数.txt', text: '钻探深度(m)：600\n取芯能力(m)：BQ 760 / NQ 600 / HQ 280\n提拔力(kN)：100' }], 'CR600P');
    const params = await service.prepareFolderParameters(parsed);
    expect(params).toMatchObject({ depthM: '600', coreCapacity: 'BQ 760 / NQ 600 / HQ 280', fieldValues: { ext_custom_force: '100' } });
    expect(service.parameterRows(params, 'zh-CN').at(-1)).toEqual({ name: '回拉力', value: '100', unit: 'KN' });
    const db = open();
    try { expect(service.writeProductValues(db, params)).toMatchObject({ ext_custom_force: '100', ext_core_capacity: 'BQ 760 / NQ 600 / HQ 280' }); }
    finally { db.close(); }
    expect(fs.readFileSync(database(1))).toEqual(before);
  });

  it('creates one site-local torque field and exposes edited values in previews', async () => {
    const before = fs.readFileSync(database(1));
    const parsed = parseFolderParameterTexts([{ filename: '参数.txt', text: 'Drilling Depth: 600 m\nDrilling Diameter: 105–450 mm\nRotary Torque: 12,000 N·m' }], 'WR600');
    const params = await service.prepareFolderParameters(parsed);
    await service.prepareFolderParameters(parsed);
    const list = await service.list();
    const torqueFields = list.fields.filter((field) => field.label === '回转扭矩');
    expect(torqueFields).toHaveLength(1);
    const name = torqueFields[0].name;
    expect(params.fieldValues[name]).toBe('12000');
    params.fieldValues[name] = '15000';
    expect(service.parameterRows(params, 'zh-CN').at(-1)).toEqual({ name: '回转扭矩', value: '15000', unit: 'N·m' });
    expect(params.coreCapacity).toBe('');
    expect(fs.readFileSync(database(1))).toEqual(before);
    current = 2;
    expect((await service.list()).fields.some((field) => field.name === name)).toBe(false);
  });
});
