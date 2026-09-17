import { folderSharedParameters, mapFolderParameters, parseFolderParameterTexts } from './product-folder-parameters';
import { defaultProductFields, ProductFieldDefinition } from './product-fields';

const parse = (text: string, mode: 'auto' | 'core' | 'water-well' = 'auto') => parseFolderParameterTexts([{ filename: 'CR600P_标题 (1).txt', text }], 'CR600P', mode);
const force: ProductFieldDefinition = { name: 'ext_param_7801907f4e874d29', label: '回拉力', unit: 'KN', sort: 100, enabled: true, type: 1 };

describe('product folder parameter recognition', () => {
  it('imports three arbitrary parameters in TXT order without treating SEO text as fields', () => {
    const source = parse('产品型号：CR600P\nSEO标题：大型设备\n产品参数：\n发动机功率（kW）：85 kW\n整机重量（kg）：10000\n铲斗容量（m³）：0.4 m³\n运输长度（mm）：6000\nSEO描述：测试\n产品特点：不作为参数');
    expect(source.type).toBe('custom');
    expect(source.errors).toEqual([]);
    expect(source.items.map(({label, value}) => [label, value])).toEqual([['发动机功率','85'], ['整机重量','10000'], ['铲斗容量','0.4']]);
    expect(source.warnings.join()).toContain('前三项');
    const first = mapFolderParameters(source, defaultProductFields());
    const again = mapFolderParameters(source, defaultProductFields());
    expect(first.mappings).toEqual(again.mappings);
    expect(first.mappings.every(item => item.create && /^ext_param_[a-f0-9]{16}$/.test(item.fieldName))).toBe(true);
    expect(Object.values(folderSharedParameters(source, first.mappings).fieldValues)).toEqual(['85', '10000', '0.4']);
  });

  it('mixes existing and new fields, and preserves the existing engine storage', () => {
    const source = parse('参数：\n钻探深度（m）：600\n发动机：Cummins\n额定功率（kW）：110');
    const power: ProductFieldDefinition = {name: 'ext_power', label: '额定功率', unit: 'kW', sort: 100, enabled: true, type: 1};
    const mapped = mapFolderParameters(source, [...defaultProductFields(), power]);
    expect(mapped.errors).toEqual([]);
    expect(mapped.mappings.map(item => item.create)).toEqual([false, false, false]);
    expect(folderSharedParameters(source, mapped.mappings)).toMatchObject({depthM: '600', engine: 'Cummins', fieldValues: {ext_power: '110'}});
  });

  it('keeps all three parameters in a nonstandard combination of known fields', () => {
    const source = parse('钻探深度（m）：600\n回拉力（kN）：100\n回转扭矩（N·m）：12000');
    expect(source.errors).toEqual([]);
    expect(source.type).toBe('custom');
    expect(source.items.map(item => item.key)).toEqual(['depthM','liftingForce','rotaryTorque']);
  });

  it('does not create fields for ordinary prose or invalid or conflicting generic values', () => {
    expect(parse('标题：设备\n特点：节能\n售后：一年').items.some(item => item.key.startsWith('custom:'))).toBe(false);
    expect(parse('参数：\n额定功率（kW）：85\n额定功率（W）：85000').errors.join()).toContain('不同数值或单位');
    expect(parse('参数：\n额定功率（kW）：<script>bad</script>').errors.join()).toContain('无效');
    const mapped = mapFolderParameters(parse('整机重量（kg）：1000'), [{name: 'ext_weight', label:'整机重量（T）', unit:'', type:1, enabled:true, sort:1}]);
    expect(mapped.errors).toEqual([]);
    expect(mapped.mappings[0]).toMatchObject({create: true, unit: 'kg', value: '1000', fieldLabel: '整机重量（kg）'});
  });

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

  it.each(['提拔力（kN）：28 T', 'Drilling Depth: -600 m', 'Drilling Diameter: 450-105 mm', 'Rotary Torque: 12,00 N·m', '提升力（T）：-40', '提升力（T）：40 kN'])('rejects invalid values or conflicting source units: %s', (text) => {
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

  it('uses the actual ordered parameters in auto mode, while explicit templates remain strict', () => {
    const text = 'Core Capacity: NQ 600\nRotary Torque: 12,000 N·m';
    expect(parse(text).errors).toEqual([]);
    expect(parse(text).items.map(item => item.key)).toEqual(['coreCapacity', 'rotaryTorque']);
    expect(parse(text, 'water-well').errors).toEqual([]);
    expect(parse(text, 'water-well').items.some((item) => item.key === 'coreCapacity')).toBe(false);
    expect(parse('提拔力（T）：100', 'core').errors.join()).toContain('单位应为 kN');
  });

  it('blocks disabled, ambiguous or mismatched destination fields', () => {
    const source = parse('Core Capacity: NQ 600\nPullback: 100 kN');
    expect(mapFolderParameters(source, [...defaultProductFields(), { ...force, enabled: false }]).errors.join()).toContain('未启用');
    expect(mapFolderParameters(source, [...defaultProductFields(), force, { ...force, name: 'ext_force2' }]).errors.join()).toContain('多个产品字段');
    const variant = mapFolderParameters(source, [...defaultProductFields(), { ...force, unit: 'T' }]);
    expect(variant.errors).toEqual([]);
    expect(variant.mappings.at(-1)).toMatchObject({ create: true, unit: 'kN', fieldLabel: '提拔力（kN）' });
  });

  it('recognizes the WR400RC combination without substituting torque for lifting force in T', () => {
    const source = parse('产品参数：\n钻孔深度（m）：400\n钻孔直径（mm）：105-305\n提升力（T）：40');
    expect(source.errors).toEqual([]);
    expect(source.items.map(item=>[item.label,item.unit,item.value])).toEqual([['钻探深度','m','400'],['钻孔直径','mm','105-305'],['提升力','T','40']]);
    const mapped = mapFolderParameters(source, [...defaultProductFields(), force]);
    expect(mapped.errors).toEqual([]);
    const lift = mapped.mappings[2];
    expect(lift).toMatchObject({create:true,fieldLabel:'提升力（T）',unit:'T',value:'40'});
    expect(lift.fieldName).not.toBe(force.name);
    expect(folderSharedParameters(source, mapped.mappings)).toMatchObject({depthM:'400',diameterMm:'105-305',fieldValues:{[lift.fieldName]:'40'}});
    const fields = [...defaultProductFields(), force, {name:lift.fieldName,label:lift.fieldLabel,unit:'T',sort:110,enabled:true,type:1}];
    const again = mapFolderParameters(parse('回拉力：45 T'), fields);
    expect(again.mappings[0]).toMatchObject({create:false,fieldName:lift.fieldName,value:'45'});
    expect(mapFolderParameters(parse('回拉力（kN）：400'), fields).mappings[0].fieldName).toBe(force.name);
  });

  it('keeps TXT order even for standard triples and blocks conflicting sources within the same model', () => {
    expect(parse('提拔力（kN）：100\n取芯能力（m）：NQ 500\n钻孔深度（m）：600').items.map(item=>item.key)).toEqual(['liftingForce','coreCapacity','depthM']);
    for (const text of ['提升力（T）：40\n回拉力（kN）：400','提升力（kN）：400\n回拉力（T）：40','提升力（T）：40\n提拔力（T）：45']) expect(parse(text).errors.join()).toContain('不同数值或单位');
  });

  it('stores nonstandard depth units separately and distinguishes case-sensitive SI prefixes', () => {
    const source = parse('钻孔深度（ft）：1200');
    const mapped = mapFolderParameters(source, defaultProductFields());
    expect(mapped.errors).toEqual([]);
    const params = folderSharedParameters(source, mapped.mappings);
    expect(params.depthM).toBe('');
    expect(params.fieldValues[mapped.mappings[0].fieldName]).toBe('1200');
    const fields: ProductFieldDefinition[] = [{name:'ext_mw',label:'输出功率',unit:'mW',sort:100,enabled:true,type:1}];
    expect(mapFolderParameters(parse('输出功率（MW）：5'), fields).mappings[0]).toMatchObject({create:true,unit:'MW'});
  });
});
