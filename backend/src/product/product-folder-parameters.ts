import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { TextDecoder } from 'util';
import { normalizeSharedParameters } from './product-shared-parameters';
import { ProductFieldDefinition, protectedProductField } from './product-fields';

export type FolderParameterType = 'auto' | 'core' | 'water-well';
type ParameterKey = 'depthM' | 'coreCapacity' | 'diameterMm' | 'liftingForce' | 'rotaryTorque';
export type FolderParameter = { key: ParameterKey; label: string; unit: string; value: string };
export type FolderParameters = { type: 'core' | 'water-well' | 'unknown'; files: string[]; items: FolderParameter[]; warnings: string[]; errors: string[] };
export type FolderParameterMapping = FolderParameter & { fieldName: string; fieldLabel: string; create: boolean };

const definitions: Record<ParameterKey, { label: string; unit: string; aliases: string[] }> = {
  depthM: { label: '钻探深度', unit: 'm', aliases: ['钻探深度', '钻孔深度', '钻进深度', '最大钻深', 'Drilling Depth', 'Depth'] },
  coreCapacity: { label: '取芯能力', unit: 'm', aliases: ['取芯能力', '取心能力', 'Core Capacity'] },
  diameterMm: { label: '钻孔直径', unit: 'mm', aliases: ['钻孔直径', '钻探直径', 'Drilling Diameter'] },
  liftingForce: { label: '提拔力', unit: 'kN', aliases: ['提拔力', '提升力', '回拉力', '回拖力', 'Pullback', 'Pullback Force', 'Lifting Force'] },
  rotaryTorque: { label: '回转扭矩', unit: 'N·m', aliases: ['回转扭矩', '旋转扭矩', 'Rotary Torque', 'Rotation Torque'] },
};
const normalizeLabel = (value: string) => value.normalize('NFKC').replace(/\([^)]*\)/g, '').replace(/[\s*_`]/g, '').toLowerCase();
const normalizeUnit = (value: string) => value.normalize('NFKC').replace(/[\s·⋅.*]/g, '').toLowerCase();
export const matchesProductModel = (filename: string, modelName: string) => {
  const value = filename.normalize('NFKC').toLowerCase();
  const model = modelName.normalize('NFKC').toLowerCase();
  return value.startsWith(model) && !/[a-z0-9]/i.test(value.slice(model.length, model.length + 1));
};
const keysFor = (type: FolderParameters['type']): ParameterKey[] => type === 'core'
  ? ['depthM', 'coreCapacity', 'liftingForce'] : type === 'water-well' ? ['depthM', 'diameterMm', 'rotaryTorque'] : ['depthM'];

function readText(file: string) {
  if (fs.statSync(file).size > 256 * 1024) throw new Error('参数 TXT 超过 256KB');
  const bytes = fs.readFileSync(file);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
}

function parseValue(key: ParameterKey, raw: string, labelUnit: string) {
  const unit = definitions[key].unit;
  if (labelUnit && normalizeUnit(labelUnit) !== normalizeUnit(unit)) throw new Error(`单位应为 ${unit}，不能自动换算 ${labelUnit}`);
  let value = raw.replace(/[*`]/g, '').replace(/\\\s*$/, '').trim().normalize('NFKC');
  const suffix = key === 'rotaryTorque' ? /\s*N\s*[·⋅.*]?\s*m\s*$/i : key === 'liftingForce' ? /\s*kN\s*$/i : key === 'diameterMm' ? /\s*mm\s*$/i : /\s*m\s*$/i;
  value = value.replace(suffix, '').trim();
  if (key === 'coreCapacity') {
    if (!value || value.length > 200) throw new Error('取芯能力必须为 1 至 200 字符的完整文本');
    return value;
  }
  value = value.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '').replace(/[–—~～]/g, '-').replace(/\s+/g, '');
  if (key === 'diameterMm') {
    if (!value) throw new Error('缺少数值');
    return normalizeSharedParameters({ diameterMm: value }).diameterMm;
  }
  if (!/^\d+(?:\.\d{1,6})?$/.test(value) || Number(value) > 1e12) throw new Error(`请填写非负数值，单位为 ${unit}`);
  return value;
}

export function parseFolderParameterTexts(texts: { filename: string; text: string }[], modelName: string, mode: FolderParameterType = 'auto'): FolderParameters {
  const values = new Map<ParameterKey, string>();
  const errors: string[] = [];
  const files = new Set<string>();
  for (const source of texts) {
    for (const original of source.text.split(/\r?\n/)) {
      const line = original.replace(/^\uFEFF/, '').replace(/^\s*(?:[-*#]+|\d+[.)、])\s*/, '').replace(/\*\*|__/g, '').trim();
      const match = line.match(/^([^:：]+)[:：]\s*(.*?)\s*$/);
      if (!match) continue;
      const name = normalizeLabel(match[1]);
      if (['产品型号', '型号', 'model', 'productmodel'].includes(name) && !matchesProductModel(match[2].trim(), modelName)) {
        errors.push(`${source.filename}：产品型号与文件夹 ${modelName} 不一致`);
      }
      const key = (Object.keys(definitions) as ParameterKey[]).find((item) => definitions[item].aliases.some((alias) => normalizeLabel(alias) === name));
      if (!key) continue;
      files.add(source.filename);
      const labelUnit = match[1].normalize('NFKC').match(/\(([^)]+)\)/)?.[1] || '';
      try {
        const value = parseValue(key, match[2], labelUnit);
        if (values.has(key) && values.get(key) !== value) errors.push(`${source.filename}：${definitions[key].label}存在不同数值，请先统一资料`);
        else values.set(key, value);
      } catch (error) { errors.push(`${source.filename}：${definitions[key].label}${(error as Error).message}`); }
    }
  }
  let type: FolderParameters['type'] = mode === 'auto' ? 'unknown' : mode;
  if (mode === 'auto') {
    if (values.has('coreCapacity') && values.has('rotaryTorque')) errors.push('同时包含岩芯和水井参数，请选择参数类型');
    else if (values.has('coreCapacity') || (values.has('liftingForce') && !values.has('rotaryTorque') && !values.has('diameterMm'))) type = 'core';
    else if (values.has('diameterMm') || values.has('rotaryTorque')) type = 'water-well';
  }
  const expected = keysFor(type);
  const warnings: string[] = [];
  if (!values.size) warnings.push('TXT 中没有识别到产品参数，参数留空');
  else if (type === 'unknown') warnings.push('无法确认参数类型，请选择岩芯钻机或水井钻机');
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
    const matches = keyed.length ? keyed : fields.filter((field) => definitions[item.key].aliases.some((alias) => normalizeLabel(alias) === normalizeLabel(field.label)));
    if (matches.length > 1) { errors.push(`${item.label}对应多个产品字段，请在产品字段管理中区分名称`); continue; }
    const field = matches[0];
    if (field && (!field.enabled || protectedProductField(field))) { errors.push(`${item.label}对应的「${field.label}」未启用或不是文本字段`); continue; }
    if (field?.unit && normalizeUnit(field.unit) !== normalizeUnit(item.unit)) { errors.push(`${item.label}的资料单位 ${item.unit} 与产品字段单位 ${field.unit} 不一致`); continue; }
    mappings.push({ ...item, fieldName: field?.name || `ext_param_${createHash('sha256').update(item.key).digest('hex').slice(0, 16)}`, fieldLabel: field?.label || item.label, create: !field });
  }
  return { mappings, errors };
}

export function folderSharedParameters(parameters: FolderParameters, mappings: FolderParameterMapping[]) {
  const value: Record<string, unknown> = { template: parameters.type === 'unknown' ? 'general' : parameters.type, coreCapacity: '', fieldValues: {} };
  for (const item of mappings) {
    if (['depthM', 'coreCapacity', 'diameterMm'].includes(item.key)) value[item.key] = item.value;
    else (value.fieldValues as Record<string, string>)[item.fieldName] = item.value;
  }
  return normalizeSharedParameters(value);
}
