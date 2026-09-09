import { folderSharedParameters, mapFolderParameters, parseFolderParameterTexts } from './product-folder-parameters';
import { defaultProductFields, ProductFieldDefinition } from './product-fields';

const parse = (text: string, mode: 'auto' | 'core' | 'water-well' = 'auto') => parseFolderParameterTexts([{ filename: 'CR600P_标题 (1).txt', text }], 'CR600P', mode);
const force: ProductFieldDefinition = { name: 'ext_param_7801907f4e874d29', label: '回拉力', unit: 'KN', sort: 100, enabled: true, type: 1 };

describe('product folder parameter recognition', () => {
  it('maps the supplied Chinese core parameters to the existing force field', () => {
    const source = parse('产品型号：CR600P\nSEO标题：不要作为产品字段读取\n钻探深度（m）：600\n取芯能力（m）：BQ 760 / NQ 600 / HQ 280\n提拔力（kN）：100');
    expect(source.type).toBe('core');
    expect(source.errors).toEqual([]);
    expect(source.warnings).toEqual([]);
    const mapped = mapFolderParameters(source, [...defaultProductFields(), force]);
    expect(mapped.errors).toEqual([]);
    expect(mapped.mappings.map((item) => item.fieldName)).toEqual(['ext_drill_depth', 'ext_core_capacity', force.name]);
    expect(mapped.mappings.every((item) => !item.create)).toBe(true);
    expect(folderSharedParameters(source, mapped.mappings)).toMatchObject({ depthM: '600', coreCapacity: 'BQ 760 / NQ 600 / HQ 280', coreBqM: '', engine: undefined, fieldValues: { [force.name]: '100' } });
  });

  it('recognizes numbered English water-well parameters and normalizes units', () => {
    const source = parse('1. **Drilling Depth:** 600 m\n2. **Drilling Diameter:** 105–450 mm\n3. **Rotary Torque:** 12,000 N·m');
    expect(source.type).toBe('water-well');
    expect(source.errors).toEqual([]);
    const mapped = mapFolderParameters(source, [...defaultProductFields(), force]);
    expect(mapped.errors).toEqual([]);
    expect(mapped.mappings[2]).toMatchObject({ label: '回转扭矩', value: '12000', unit: 'N·m', create: true });
    const parameters = folderSharedParameters(source, mapped.mappings);
    expect(parameters).toMatchObject({ template: 'water-well', depthM: '600', diameterMm: '105-450', coreCapacity: '', fieldValues: { [mapped.mappings[2].fieldName]: '12000' } });
    expect(parameters.fieldValues).not.toHaveProperty(force.name);
  });

  it('leaves absent values blank without filling example capacities', () => {
    const source = parse('钻探深度（m）：600', 'core');
    expect(source.items.map((item) => item.value)).toEqual(['600', '', '']);
    expect(source.warnings).toHaveLength(2);
    const mapped = mapFolderParameters(source, defaultProductFields());
    expect(folderSharedParameters(source, mapped.mappings).coreCapacity).toBe('');
  });

  it.each(['提拔力（T）：100', '提拔力（kN）：28 T', 'Drilling Depth: -600 m', 'Drilling Diameter: 450-105 mm', 'Rotary Torque: 12,00 N·m'])('rejects invalid values or unconverted units: %s', (text) => {
    expect(parse(text).errors.length).toBeGreaterThan(0);
  });

  it('preserves zero and additional core sizes as a single string', () => {
    const source = parse('Depth: 0 m\nCore Capacity (m): BQ 760 / NQ 600 / HQ 280 / PQ 100\nPullback Force: 0 kN');
    expect(source.items.map((item) => item.value)).toEqual(['0', 'BQ 760 / NQ 600 / HQ 280 / PQ 100', '0']);
  });

  it('blocks conflicting TXT files and mismatched model names', () => {
    const result = parseFolderParameterTexts([{ filename: 'one.txt', text: 'Depth: 600 m' }, { filename: 'two.txt', text: 'Depth: 800 m\n产品型号：CR800P' }], 'CR600P', 'core');
    expect(result.errors).toHaveLength(2);
    expect(parseFolderParameterTexts([{ filename: 'one.txt', text: 'Depth: 600 m' }, { filename: 'two.txt', text: 'Depth: 600 m' }], 'CR600P').errors).toEqual([]);
  });

  it('requires a choice for mixed parameter types', () => {
    const text = 'Core Capacity: NQ 600\nRotary Torque: 12,000 N·m';
    expect(parse(text).errors.join()).toContain('请选择参数类型');
    expect(parse(text, 'water-well').errors).toEqual([]);
    expect(parse(text, 'water-well').items.some((item) => item.key === 'coreCapacity')).toBe(false);
  });

  it('blocks disabled, ambiguous or mismatched destination fields', () => {
    const source = parse('Core Capacity: NQ 600\nPullback: 100 kN');
    expect(mapFolderParameters(source, [...defaultProductFields(), { ...force, enabled: false }]).errors.join()).toContain('未启用');
    expect(mapFolderParameters(source, [...defaultProductFields(), force, { ...force, name: 'ext_force2' }]).errors.join()).toContain('多个产品字段');
    expect(mapFolderParameters(source, [...defaultProductFields(), { ...force, unit: 'T' }]).errors.join()).toContain('不一致');
  });
});
