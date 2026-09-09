import initSqlJs from 'sql.js';
import { ensurePbootParameterFields, normalizeSharedParameters, publicParameterValues, readPbootParameters, sharedParameterRows } from './product-shared-parameters';
import { ProductService } from './product.service';

const core = () => normalizeSharedParameters({ template: 'core', depthM: '800', coreBqM: '1000', coreNqM: '800', coreHqM: '500', engine: '110 kW', pullback: '152', referencePrice: '54321.50', currency: 'USD' });

describe('shared product parameters', () => {
  it('keeps examples out of defaults and preserves explicit zero', () => {
    expect(normalizeSharedParameters(null)).toBeNull();
    expect(normalizeSharedParameters({ template: 'core' })).toMatchObject({ depthM: '', coreBqM: '', pullback: '', referencePrice: '' });
    expect(normalizeSharedParameters({ depthM: 0, pullback: 0, referencePrice: 0 })).toMatchObject({ depthM: '0', pullback: '0', referencePrice: '0' });
  });

  it('formats BQ/NQ/HQ and shares unchanged values across all languages', () => {
    const parameters = core();
    for (const lang of ['zh-CN', 'en', 'es', 'fr', 'ru', 'ar', 'pt', 'id', 'tr', 'vi']) {
      expect(sharedParameterRows(parameters, lang).map(({ value, unit }) => [value, unit])).toEqual([
        ['800', 'm'], ['BQ 1000 / NQ 800 / HQ 500', 'm'], ['110 kW', ''],
      ]);
    }
    expect(sharedParameterRows(parameters, 'en')[1].name).toBe('Core Capacity');
  });

  it('separates drilling diameter from core capacity without converting force units', () => {
    const parameters = normalizeSharedParameters({ template: 'water-well', depthM: '600', diameterMm: '140–400', pullback: '28' });
    expect(sharedParameterRows(parameters, 'en')).toEqual([
      { name: 'Drilling Depth', value: '600', unit: 'm' },
      { name: 'Drilling Diameter', value: '140-400', unit: 'mm' },
    ]);
    expect(normalizeSharedParameters({ ...parameters, pullback: '152', pullbackUnit: 'kN' }).pullbackUnit).toBe('kN');
  });

  it.each([
    { depthM: '-1' }, { depthM: '800m' }, { depthM: 'NaN' }, { diameterMm: '400-140' },
    { diameterMm: '140-' }, { pullbackUnit: 'kg' }, { template: 'invalid' }, { referencePrice: '-1' },
    { custom: [{ name: '', value: '123' }] }, { currency: 'WRONG' }, { depthM: {} },
    { custom: [{ name: 'test', value: '1', fieldName: 'ext_price' }] },
    { custom: [{ name: 'same', value: '1' }, { name: 'same', value: '2' }] },
  ])('rejects invalid parameter data: %j', (input) => {
    expect(() => normalizeSharedParameters(input)).toThrow();
  });

  it('publishes only native field values and never exposes internal metadata or price', () => {
    const parameters = normalizeSharedParameters({ ...core(), custom: [{ name: '发动机功率', nameEn: 'Engine Power', value: '110', unit: 'kW' }] });
    const fields = publicParameterValues(parameters);
    expect(JSON.stringify(fields)).not.toContain('54321.50');
    expect(fields).not.toHaveProperty('ext_spec_type');
    expect(fields).not.toHaveProperty('ext_shared_specs');
    expect(fields).not.toHaveProperty('ext_shared_data');
    expect(Object.entries(fields).find(([name]) => name.startsWith('ext_param_'))?.[1]).toBe('110 kW');
    expect(readPbootParameters(fields)).toMatchObject({ template: 'core', depthM: '800', coreBqM: '1000', engine: '110 kW', referencePrice: '' });
    expect(fields).not.toHaveProperty('ext_pullback');
    expect(fields).not.toHaveProperty('ext_pullback_unit');
    expect(sharedParameterRows(normalizeSharedParameters({ template: 'core', coreNqM: '800' }), 'en')).toEqual([{ name: 'Core Capacity', value: 'NQ 800', unit: 'm' }]);
  });

  it('adds PB fields idempotently while preserving existing extension data', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    try {
      db.run('create table ay_content_ext (extid integer primary key, contentid integer, ext_existing text)');
      db.run("insert into ay_content_ext (contentid, ext_existing) values (10,'keep-me')");
      db.run('create table ay_extfield (id integer primary key, mcode text, name text, type integer, value text, description text, sorting integer)');
      const parameters = normalizeSharedParameters({ ...core(), custom: [{ name: '发动机功率', value: '110', unit: 'kW' }] });
      ensurePbootParameterFields(db, parameters);
      ensurePbootParameterFields(db, parameters);
      expect(db.exec('select count(*) from ay_extfield')[0].values[0][0]).toBe(5);
      expect(db.exec("select count(*) from ay_extfield where name in ('ext_spec_type','ext_shared_specs','ext_shared_data')")[0].values[0][0]).toBe(0);
      const fields = publicParameterValues(parameters);
      const names = Object.keys(fields);
      db.run(`update ay_content_ext set ${names.map((name) => `${name}=?`).join(',')} where contentid=10`, Object.values(fields));
      expect(db.exec('select ext_existing, ext_drill_depth, ext_engine from ay_content_ext')[0].values[0]).toEqual(['keep-me', '800', '110 kW']);
      expect(db.exec("select type from ay_extfield where name='ext_drill_depth'")[0].values[0][0]).toBe(1);
    } finally { db.close(); }
  });

  it('keeps a saved custom field key stable when its display name changes', () => {
    const before = normalizeSharedParameters({ custom: [{ name: '功率', value: '100', unit: 'kW' }] });
    const after = normalizeSharedParameters({ custom: [{ ...before.custom[0], name: '额定功率' }] });
    expect(after.custom[0].fieldName).toBe(before.custom[0].fieldName);
  });

  it.each(['general', 'core', 'water-well'])('publishes every fixed field regardless of the old %s template', (template) => {
    const parameters = normalizeSharedParameters({ template, depthM: '800', coreCapacity: 'BQ 1000 / NQ 800 / HQ 500', diameterMm: '140-400', engine: '玉柴 110 kW', pullbackText: '28 T' });
    expect(publicParameterValues(parameters)).toEqual({
      ext_drill_depth: '800', ext_core_capacity: 'BQ 1000 / NQ 800 / HQ 500',
      ext_drill_diameter: '140-400', ext_engine: '玉柴 110 kW',
    });
    expect(sharedParameterRows(parameters)).toHaveLength(4);
  });

  it('preserves the combined capacity text when reading back from PB', () => {
    const parameters = normalizeSharedParameters({ coreCapacity: 'BQ 1000 / NQ 800 / HQ 500 / PQ 300', pullbackText: '152 kN' });
    const imported = readPbootParameters(publicParameterValues(parameters));
    expect(imported.coreCapacity).toBe('BQ 1000 / NQ 800 / HQ 500 / PQ 300');
    expect(publicParameterValues(imported)).toEqual(publicParameterValues(parameters));
  });

  it('clears combined fields without falling back to old values or losing private data', () => {
    const parameters = normalizeSharedParameters({ ...core(), coreCapacity: '', pullbackText: '' });
    expect(publicParameterValues(parameters)).toMatchObject({ ext_core_capacity: '' });
    expect(parameters.pullback).toBe('');
    expect(parameters.referencePrice).toBe('54321.50');
    expect(parameters.coreBqM).toBe('1000');
  });

  it.each([
    ['152 kN', '152', 'kN'], ['28T', '28', 'T'], ['28.5 吨', '28.5', 'T'],
    ['152KN', '152', 'kN'], ['0 kN', '0', 'kN'],
  ])('splits %s into existing PB value and unit fields', (pullbackText, pullback, pullbackUnit) => {
    expect(normalizeSharedParameters({ pullbackText })).toMatchObject({ pullback, pullbackUnit });
  });

  it.each(['28', '-1 T', '10 kg', 'T', '1e3 kN', 'NaN kN'])('rejects ambiguous or invalid force %s', (pullbackText) => {
    expect(() => normalizeSharedParameters({ pullbackText })).toThrow('回拖力');
  });

  it('limits combined capacity length to the native field size', () => {
    expect(() => normalizeSharedParameters({ coreCapacity: '1'.repeat(201) })).toThrow();
  });
});

describe('ProductService shared parameter persistence', () => {
  const setup = () => {
    const product = { id: 10, siteId: 2, menuId: 1, title: 'CR800', content: '', carouselImages: [], carouselTitles: [], sharedParameters: core() };
    const save = jest.fn(async (value) => value);
    const service: any = new ProductService({ save } as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    service.findProductEntity = jest.fn(async () => product);
    service.ensureTranslations = jest.fn();
    service.findOneById = jest.fn();
    return { service, save, product };
  };

  it('preserves parameters when a translation update omits them', async () => {
    const { service, save, product } = setup();
    await service.update(10, { translations: [{ lang: 'en', title: 'CR800' }] });
    expect(save.mock.calls[0][0].sharedParameters).toEqual(product.sharedParameters);
    expect(save.mock.calls[0][0].siteId).toBe(2);
  });

  it('supports explicit clearing and validates updates before saving', async () => {
    const { service, save } = setup();
    await service.update(10, { sharedParameters: null });
    expect(save.mock.calls[0][0].sharedParameters).toBeNull();
    save.mockClear();
    await expect(service.update(10, { sharedParameters: { depthM: '-5' } })).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  it('does not let a language record replace the shared values', () => {
    const { service, product } = setup();
    const merged = service.mergeTranslation(product, { title: 'Titre', content: '', sharedParameters: { depthM: '999' } }, 'fr');
    expect(merged.sharedParameters.depthM).toBe('800');
    expect(merged.parameterRows[0]).toEqual({ name: 'Profondeur de forage', value: '800', unit: 'm' });
  });
});
