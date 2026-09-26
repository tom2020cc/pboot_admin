import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { TextDecoder } from 'util';
import { normalizeSharedParameters } from './product-shared-parameters';
import { ProductFieldDefinition, protectedProductField } from './product-fields';

export type FolderParameterType = 'auto' | 'core' | 'water-well';
type KnownParameterKey = 'depthM' | 'coreCapacity' | 'diameterMm' | 'liftingForce' | 'rotaryTorque';
type ParameterKey = KnownParameterKey | `custom:${string}`;
export type FolderParameter = { key: ParameterKey; label: string; unit: string; value: string; variantOf?: KnownParameterKey };
export type FolderParameters = { type: 'core' | 'water-well' | 'custom' | 'unknown'; files: string[]; items: FolderParameter[]; warnings: string[]; errors: string[]; allowUnitVariants?: boolean };
export type FolderParameterMapping = FolderParameter & { fieldName: string; fieldLabel: string; create: boolean; storageKey?: ProductFieldDefinition['key'] };

const definitions: Record<KnownParameterKey, { label: string; unit: string; aliases: string[] }> = {
  depthM: { label: '钻探深度', unit: 'm', aliases: ['钻探深度', '钻孔深度', '钻进深度', '最大钻深', 'Drilling Depth', 'Depth'] },
  coreCapacity: { label: '取芯能力', unit: 'm', aliases: ['取芯能力', '取心能力', 'Core Capacity'] },
  diameterMm: { label: '钻孔直径', unit: 'mm', aliases: ['钻孔直径', '钻探直径', 'Drilling Diameter'] },
  liftingForce: { label: '提拔力', unit: 'kN', aliases: ['提拔力', '提升力', '回拉力', '回拖力', 'Pullback', 'Pullback Force', 'Lifting Force'] },
  rotaryTorque: { label: '回转扭矩', unit: 'N·m', aliases: ['回转扭矩', '旋转扭矩', 'Rotary Torque', 'Rotation Torque'] },
};
const normalizeLabel = (value: string) => value.normalize('NFKC').replace(/\([^)]*\)/g, '').replace(/[\s*_`]/g, '').toLowerCase();
const normalizeUnit = (value: string) => {
  const unit = value.normalize('NFKC').replace(/[\s·⋅.*]/g, '');
  const aliases: Record<string, string> = { KN: 'kN', kn: 'kN', nm: 'Nm', NM: 'Nm', KG: 'kg', Kg: 'kg', KW: 'kW', kw: 'kW', t: 'T', 吨: 'T' };
  return aliases[unit] || unit;
};
export const matchesProductModel = (filename: string, modelName: string) => {
  const value = filename.normalize('NFKC').toLowerCase();
  const model = modelName.normalize('NFKC').toLowerCase();
  return value.startsWith(model) && !/[a-z0-9]/i.test(value.slice(model.length, model.length + 1));
};
const keysFor = (type: FolderParameters['type']): KnownParameterKey[] => type === 'core'
  ? ['depthM', 'coreCapacity', 'liftingForce'] : type === 'water-well' ? ['depthM', 'diameterMm', 'rotaryTorque'] : ['depthM'];

function readText(file: string) {
  if (fs.statSync(file).size > 256 * 1024) throw new Error('参数 TXT 超过 256KB');
  const bytes = fs.readFileSync(file);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
}

function parseValue(key: KnownParameterKey, raw: string, labelUnit: string, unit = definitions[key].unit) {
  if (labelUnit && normalizeUnit(labelUnit) !== normalizeUnit(unit)) throw new Error(`单位应为 ${unit}，不能自动换算 ${labelUnit}`);
  let value = raw.replace(/[*`]/g, '').replace(/\\\s*$/, '').trim().normalize('NFKC');
  const suffix = key === 'rotaryTorque' ? /\s*N\s*[·⋅.*]?\s*m\s*$/i : key === 'liftingForce' ? /\s*kN\s*$/i : key === 'diameterMm' ? /\s*mm\s*$/i : /\s*m\s*$/i;
  const alternateUnit = normalizeUnit(unit) !== normalizeUnit(definitions[key].unit);
  value = alternateUnit ? value.replace(new RegExp(`\\s*${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').trim() : value.replace(suffix, '').trim();
  if (key === 'coreCapacity') {
    if (!value || value.length > 200) throw new Error('取芯能力必须为 1 至 200 字符的完整文本');
    return value;
  }
  value = value.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '').replace(/[–—~～]/g, '-').replace(/\s+/g, '');
  if (key === 'diameterMm' && !alternateUnit) {
    if (!value) throw new Error('缺少数值');
    return normalizeSharedParameters({ diameterMm: value }).diameterMm;
  }
  if (!/^\d+(?:\.\d{1,6})?$/.test(value) || Number(value) > 1e12) throw new Error(`请填写非负数值，单位为 ${unit}`);
  return value;
}

export function parseFolderParameterTexts(texts: { filename: string; text: string }[], modelName: string, mode: FolderParameterType = 'auto'): FolderParameters {
  const values = new Map<KnownParameterKey, string>();
  const ordered = new Map<ParameterKey, FolderParameter>();
  const errors: string[] = [];
  const files = new Set<string>();
  for (const source of texts) {
    let parameterSection = false;
    for (const original of source.text.split(/\r?\n/)) {
      const line = original.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*#]+|\d+[.)、])\s*/, '').replace(/\*\*|__/g, '').trim();
      const match = line.match(/^([^:：]+)[:：]\s*(.*?)\s*$/);
      if (/^(?:产品参数|核心参数|主要参数|技术参数|参数|parameters?|specifications?)\s*[:：]?$/i.test(line)) { parameterSection = true; continue; }
      if (!match) continue;
      const name = normalizeLabel(match[1]);
      if (['产品型号', '型号', 'model', 'productmodel'].includes(name) && !matchesProductModel(match[2].trim(), modelName)) {
        errors.push(`${source.filename}：产品型号与文件夹 ${modelName} 不一致`);
      }
      const key = (Object.keys(definitions) as KnownParameterKey[]).find((item) => definitions[item].aliases.some((alias) => normalizeLabel(alias) === name));
      const labelUnit = match[1].normalize('NFKC').match(/\(([^)]+)\)/)?.[1] || '';
      if (!key) {
        if (/^(?:seo|产品型号|型号|model|productmodel|产品标题|标题|title|关键词|关键字|keywords?|描述|description|摘要|summary|简介|正文|content|网址|url|图片|image)/i.test(name)) { parameterSection = false; continue; }
        // Outside a parameter section, require an explicit unit to avoid importing SEO prose as a field.
        if (!labelUnit && !parameterSection) continue;
        const label = match[1].normalize('NFKC').replace(/\([^)]*\)/g, '').trim();
        const unit = labelUnit.trim();
        let value = match[2].replace(/[*`]/g, '').trim().normalize('NFKC');
        if (unit && value.toLowerCase().endsWith(unit.toLowerCase()) && /[\d\s]$/.test(value.slice(0, -unit.length))) value = value.slice(0, -unit.length).trim();
        if (!label || label.length > 60 || unit.length > 20 || value.length > 200 || /[<>\x00-\x1f]/.test(label + unit + value)) { errors.push(`${source.filename}：${label}参数格式或长度无效`); continue; }
        const customKey: ParameterKey = `custom:${normalizeLabel(label)}`;
        const previous = ordered.get(customKey);
        if (previous && (previous.value !== value || normalizeUnit(previous.unit) !== normalizeUnit(unit))) errors.push(`${source.filename}：${label}存在不同数值或单位，请先统一资料`);
        else ordered.set(customKey, { key: customKey, label, unit, value });
        files.add(source.filename);
        continue;
      }
      files.add(source.filename);
      try {
        const suffixUnit = match[2].normalize('NFKC').match(/\d\s*(kN|KN|T|吨|kg|kW|MW|mW|mm|cm|ft|N[·⋅.*]?m|kN[·⋅.*]?m|m)\s*$/)?.[1] || '';
        const actualUnit = labelUnit || suffixUnit || definitions[key].unit;
        if (mode === 'auto' && normalizeUnit(actualUnit) !== normalizeUnit(definitions[key].unit)) {
          const value = parseValue(key, match[2], actualUnit, actualUnit);
          const label = match[1].normalize('NFKC').replace(/\([^)]*\)/g, '').trim();
          if (label.length > 60 || actualUnit.length > 20 || /[<>\x00-\x1f]/.test(label + actualUnit)) throw new Error('参数格式或长度无效');
          const variantKey: ParameterKey = `custom:${key}`;
          const previous = ordered.get(variantKey) || ordered.get(key);
          if (previous && (previous.value !== value || normalizeUnit(previous.unit) !== normalizeUnit(actualUnit))) errors.push(`${source.filename}：${label}存在不同数值或单位，请先统一资料`);
          else ordered.set(variantKey, {key: variantKey, label, unit: actualUnit, value, variantOf: key});
          continue;
        }
        const value = parseValue(key, match[2], labelUnit);
        if (ordered.has(`custom:${key}`)) { errors.push(`${source.filename}：${definitions[key].label}存在不同数值或单位，请先统一资料`); continue; }
        if (values.has(key) && values.get(key) !== value) errors.push(`${source.filename}：${definitions[key].label}存在不同数值，请先统一资料`);
        else values.set(key, value);
        if (!ordered.has(key)) ordered.set(key, {key, label: definitions[key].label, unit: definitions[key].unit, value});
      } catch (error) { errors.push(`${source.filename}：${definitions[key].label}${(error as Error).message}`); }
    }
  }
  if (mode === 'auto') {
    const warnings: string[] = [];
    if (ordered.size > 3) warnings.push(`识别到 ${ordered.size} 个参数，固定只导入 TXT 顺序的前三项，请核对扫描结果`);
    if (!ordered.size) warnings.push('TXT 中没有识别到产品参数，参数留空');
    else if (ordered.size < 3) warnings.push(`只识别到 ${ordered.size} 个参数，三参数位置中缺失项留空`);
    const items = [...ordered.values()].slice(0, 3);
    const type = (['core', 'water-well'] as const).find(kind => items.length === 3 && keysFor(kind).every(key => items.some(item => item.key === key))) || (items.length ? 'custom' : 'unknown');
    return { type, files: [...files], items, warnings, errors: [...new Set(errors)], allowUnitVariants: true };
  }
  const type = mode;
  const expected = keysFor(type);
  const warnings: string[] = [];
  if (!values.size) warnings.push('TXT 中没有识别到产品参数，参数留空');
  for (const key of expected) if (!values.has(key)) warnings.push(`缺少${definitions[key].label}，导入时留空`);
  for (const key of values.keys()) if (!expected.includes(key)) warnings.push(`${definitions[key].label}不属于当前参数类型，不导入该项`);
  return { type, files: [...files], items: expected.map((key) => ({ key, label: definitions[key].label, unit: definitions[key].unit, value: values.get(key) ?? '' })), warnings, errors: [...new Set(errors)] };
}

export function readFolderParameters(directory: string, files: fs.Dirent[], modelName: string, mode: FolderParameterType = 'auto') {
  const textFiles = files.filter((file) => file.isFile() && /\.txt$/i.test(file.name));
  const matching = textFiles.filter((file) => matchesProductModel(file.name, modelName));
  const candidates = (matching.length ? matching : textFiles.filter((file) => /^(?:参数|产品参数|规格|标题|specs?|parameters?)(?:[\s_.(（-]|\.txt$)/i.test(file.name))).sort((a, b) => a.name.localeCompare(b.name));
  if (candidates.length > 32) return { type: 'unknown', files: [], items: [], warnings: [], errors: ['型号文件夹的 TXT 超过 32 个，请缩小资料范围'] } as FolderParameters;
  const texts: { filename: string; text: string }[] = [];
  const errors: string[] = [];
  for (const file of candidates) {
    try { texts.push({ filename: file.name, text: readText(path.join(directory, file.name)) }); }
    catch (error) { errors.push(`${file.name}：${(error as Error).message}`); }
  }
  const result = parseFolderParameterTexts(texts, modelName, mode);
  result.errors.push(...errors);
  return result;
}

export function mapFolderParameters(parameters: FolderParameters, fields: ProductFieldDefinition[]) {
  const errors = [...parameters.errors];
  const mappings: FolderParameterMapping[] = [];
  for (const item of parameters.items.filter((entry) => entry.value !== '')) {
    const keyed = fields.filter((field) => field.key === item.key);
    const knownKey = item.variantOf || (!item.key.startsWith('custom:') ? item.key as KnownParameterKey : undefined);
    const aliases = knownKey ? definitions[knownKey].aliases : [item.label];
    const candidates = keyed.length ? keyed : fields.filter((field) => aliases.some((alias) => normalizeLabel(alias) === normalizeLabel(field.label)));
    const unitFor = (field: ProductFieldDefinition) => field.unit || field.label.normalize('NFKC').match(/\(([^)]+)\)/)?.[1] || '';
    const matches = parameters.allowUnitVariants ? candidates.filter(field => normalizeUnit(unitFor(field)) === normalizeUnit(item.unit)) : candidates;
    if (matches.length > 1) { errors.push(`${item.label}对应多个产品字段，请在产品字段管理中区分名称`); continue; }
    const field = matches[0];
    if (field && (!field.enabled || protectedProductField(field))) { errors.push(`${item.label}对应的「${field.label}」未启用或不是文本字段`); continue; }
    const fieldUnit = field ? unitFor(field) : '';
    if (fieldUnit && normalizeUnit(fieldUnit) !== normalizeUnit(item.unit)) { errors.push(`${item.label}的资料单位 ${item.unit} 与产品字段单位 ${fieldUnit} 不一致`); continue; }
    const separate = !field && (candidates.length > 0 || !!item.variantOf);
    const fieldLabel = separate && item.unit ? `${item.label}（${item.unit}）` : item.label;
    if (!field && fieldLabel.length > 60) { errors.push(`${item.label}名称与单位合计超过 60 字符，请缩短名称`); continue; }
    const identity = parameters.allowUnitVariants ? `${knownKey || item.key}\0${normalizeUnit(item.unit)}` : item.key;
    mappings.push({ ...item, fieldName: field?.name || `ext_param_${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`, fieldLabel: field?.label || fieldLabel, create: !field, storageKey: field?.key });
  }
  return { mappings, errors };
}

export function folderSharedParameters(parameters: FolderParameters, mappings: FolderParameterMapping[]) {
  const value: Record<string, unknown> = { template: ['unknown','custom'].includes(parameters.type) ? 'general' : parameters.type, coreCapacity: '', fieldValues: {} };
  for (const item of mappings) {
    if (item.storageKey) value[item.storageKey] = item.storageKey === 'engine' && item.unit ? `${item.value} ${item.unit}` : item.value;
    else if (['depthM', 'coreCapacity', 'diameterMm'].includes(item.key)) value[item.key] = item.value;
    else (value.fieldValues as Record<string, string>)[item.fieldName] = item.value;
  }
  return normalizeSharedParameters(value);
}
