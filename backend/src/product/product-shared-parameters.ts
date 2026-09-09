import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

export type ProductSharedParameters = {
  template: 'core' | 'water-well' | 'general';
  depthM: string;
  coreBqM: string;
  coreNqM: string;
  coreHqM: string;
  coreCapacity?: string;
  diameterMm: string;
  engine?: string;
  fieldValues?: Record<string, string>;
  pullback: string;
  pullbackUnit: 'kN' | 'T';
  pullbackText?: string;
  custom: { name: string; nameEn: string; value: string; unit: string; fieldName?: string }[];
  referencePrice: string;
  currency: string;
};

const text = (value: unknown, max = 160) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw new BadRequestException('参数值必须是文字或数字。');
  const result = String(value).trim();
  if (result.length > max) throw new BadRequestException(`参数长度不能超过 ${max} 个字符。`);
  return result;
};

const numeric = (value: unknown, label: string) => {
  const result = text(value, 30);
  if (result && (!/^\d+(?:\.\d{1,6})?$/.test(result) || Number(result) > 1e12)) {
    throw new BadRequestException(`${label}请填写非负数字，不要包含单位。`);
  }
  return result;
};

export function normalizeSharedParameters(input: unknown): ProductSharedParameters | null {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('公共参数格式无效。');
  const value = input as Record<string, unknown>;
  const template = text(value.template || 'general');
  if (!['core', 'water-well', 'general'].includes(template)) throw new BadRequestException('参数模板无效。');
  let pullbackUnit = text(value.pullbackUnit || (template === 'water-well' ? 'T' : 'kN'));
  let pullback = value.pullback;
  if (value.pullbackText !== undefined) {
    const combined = text(value.pullbackText, 40);
    const match = combined.match(/^(\d+(?:\.\d{1,6})?)\s*(kN|T|吨|千牛)$/i);
    if (combined && !match) throw new BadRequestException('回拖力请填写数值和单位，例如 152 kN 或 28 T。');
    pullback = match?.[1] || '';
    if (match) pullbackUnit = /^(t|吨)$/i.test(match[2]) ? 'T' : 'kN';
  }
  if (!['kN', 'T'].includes(pullbackUnit)) throw new BadRequestException('回拖力单位只能是 kN 或 T。');
  const diameterMm = text(value.diameterMm, 60).replace(/[\u2013\u2014~\uff5e]/g, '-').replace(/\s+/g, '');
  if (diameterMm) {
    const parts = diameterMm.split('-');
    if (parts.length > 2 || parts.some((part) => !part || numeric(part, '钻孔直径') === '') || (parts.length === 2 && Number(parts[0]) > Number(parts[1]))) {
      throw new BadRequestException('钻孔直径请填写数值或从小到大的范围，例如 140-400。');
    }
  }
  const currency = text(value.currency || 'USD').toUpperCase();
  if (!['USD', 'CNY', 'EUR', 'GBP', 'AUD', 'CAD'].includes(currency)) throw new BadRequestException('请选择支持的参考价格币种。');
  if (value.custom != null && !Array.isArray(value.custom)) throw new BadRequestException('自定义参数格式无效。');
  const custom = (value.custom || []) as Record<string, unknown>[];
  if (custom.length > 20) throw new BadRequestException('自定义参数最多 20 项。');
  const usedFields = new Set<string>();
  const fieldValues = value.fieldValues ?? {};
  if (typeof fieldValues !== 'object' || Array.isArray(fieldValues) || Object.keys(fieldValues).length > 100) throw new BadRequestException('产品字段值格式无效。');
  const entries = Object.entries(fieldValues).map(([name, entry]) => {
    if (!/^ext_[a-zA-Z][a-zA-Z0-9_]{0,55}$/.test(name)) throw new BadRequestException('产品字段名无效。');
    return [name, text(entry, 200)];
  });
  return {
    template: template as ProductSharedParameters['template'],
    depthM: numeric(value.depthM, '钻孔深度'),
    coreBqM: numeric(value.coreBqM, 'BQ 取芯能力'),
    coreNqM: numeric(value.coreNqM, 'NQ 取芯能力'),
    coreHqM: numeric(value.coreHqM, 'HQ 取芯能力'),
    coreCapacity: value.coreCapacity == null ? productCoreCapacity({
      coreBqM: numeric(value.coreBqM, 'BQ 取芯能力'),
      coreNqM: numeric(value.coreNqM, 'NQ 取芯能力'),
      coreHqM: numeric(value.coreHqM, 'HQ 取芯能力'),
    }) : text(value.coreCapacity, 200),
    diameterMm,
    engine: value.engine == null ? undefined : text(value.engine, 200),
    fieldValues: Object.fromEntries(entries),
    pullback: numeric(pullback, '回拖力'),
    pullbackUnit: pullbackUnit as ProductSharedParameters['pullbackUnit'],
    custom: custom.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('自定义参数格式无效。');
      const row = { name: text(item.name, 60), nameEn: text(item.nameEn, 80), value: text(item.value), unit: text(item.unit, 20) };
      if (row.value && !row.name) throw new BadRequestException('请填写自定义参数名称。');
      const fieldName = text(item.fieldName, 64) || (row.name ? `ext_param_${createHash('sha256').update(row.name).digest('hex').slice(0, 16)}` : '');
      if (fieldName && !/^ext_param_[a-z0-9_]{1,48}$/.test(fieldName)) throw new BadRequestException('自定义参数字段名无效。');
      if (fieldName && usedFields.has(fieldName)) throw new BadRequestException('同一产品的自定义参数名称或字段名不能重复。');
      if (fieldName) usedFields.add(fieldName);
      return { ...row, fieldName };
    }),
    referencePrice: numeric(value.referencePrice, '参考价格'),
    currency,
  };
}

const labels: Record<string, string[]> = {
  'zh-CN': ['钻孔深度', '取芯能力', '回拖力', '钻孔直径'],
  en: ['Depth', 'Core Capacity', 'Pullback', 'Drilling Diameter'],
  es: ['Profundidad de perforación', 'Capacidad de extracción de testigos', 'Fuerza de extracción', 'Diámetro de perforación'],
  fr: ['Profondeur de forage', 'Capacité de carottage', 'Force de traction', 'Diamètre de forage'],
  ru: ['Глубина бурения', 'Глубина колонкового бурения', 'Усилие подъёма', 'Диаметр бурения'],
  ar: ['عمق الحفر', 'قدرة حفر اللب', 'قوة السحب', 'قطر الحفر'],
  pt: ['Profundidade de perfuração', 'Capacidade de testemunhagem', 'Força de extração', 'Diâmetro de perfuração'],
  id: ['Kedalaman Pengeboran', 'Kapasitas Pengeboran Inti', 'Gaya Tarik', 'Diameter Pengeboran'],
  tr: ['Sondaj Derinliği', 'Karot Kapasitesi', 'Geri Çekme Kuvveti', 'Sondaj Çapı'],
  vi: ['Độ sâu khoan', 'Khả năng khoan lấy lõi', 'Lực kéo', 'Đường kính khoan'],
};

export function productCoreCapacity(value: Pick<ProductSharedParameters, 'coreCapacity' | 'coreBqM' | 'coreNqM' | 'coreHqM'>): string {
  // Explicitly clearing the combined input must not revive legacy values.
  return value.coreCapacity ?? [['BQ', value.coreBqM], ['NQ', value.coreNqM], ['HQ', value.coreHqM]]
    .filter(([, amount]) => amount != null && amount !== '').map(([size, amount]) => `${size} ${amount}`).join(' / ');
}

export function productEngine(value: Pick<ProductSharedParameters, 'engine' | 'custom'>): string {
  const legacy = value.custom?.find((row) => /^(发动机|发动机参数|engine)$/i.test(row.name.trim()));
  return value.engine ?? (legacy?.value ? `${legacy.value}${legacy.unit ? ` ${legacy.unit}` : ''}` : '');
}

export function sharedParameterRows(value: ProductSharedParameters | null, language = 'zh-CN') {
  if (!value) return [];
  const lang = language === 'cn' ? 'zh-CN' : language;
  const names = labels[lang] || labels.en;
  const rows: { name: string; value: string; unit: string }[] = [];
  const add = (name: string, entry: string, unit: string) => { if (entry !== '') rows.push({ name, value: entry, unit }); };
  add(lang === 'en' && value.template === 'water-well' ? 'Drilling Depth' : names[0], value.depthM, 'm');
  add(names[1], productCoreCapacity(value), 'm');
  add(names[3], value.diameterMm, 'mm');
  const engineLabels = { 'zh-CN': '发动机', en: 'Engine', es: 'Motor', fr: 'Moteur', ru: 'Двигатель', ar: 'المحرك', pt: 'Motor', id: 'Mesin', tr: 'Motor', vi: 'Động cơ' };
  add(engineLabels[lang] || engineLabels.en, productEngine(value), '');
  value.custom.filter((row) => row.name && row.value !== '' && !/^(发动机|发动机参数|engine)$/i.test(row.name.trim())).forEach((row) => add(lang === 'zh-CN' ? row.name : row.nameEn || row.name, row.value, row.unit));
  return rows;
}

export const PBOOT_PARAMETER_FIELDS = {
  ext_drill_depth: '钻孔深度 (m)',
  ext_core_capacity: '取芯能力 (m)',
  ext_drill_diameter: '钻孔直径 (mm)',
  ext_engine: '发动机',
};

export function publicParameterValues(value: ProductSharedParameters | null): Record<string, string> {
  // PB stores only native field values; templates, JSON and prices remain local.
  return {
    ext_drill_depth: value?.depthM || '',
    ext_core_capacity: value ? productCoreCapacity(value) : '',
    ext_drill_diameter: value?.diameterMm || '',
    ext_engine: value ? productEngine(value) : '',
    ...Object.fromEntries((value?.custom || []).filter((row) => row.fieldName && row.name).map((row) => [row.fieldName, row.value === '' ? '' : `${row.value}${row.unit ? ` ${row.unit}` : ''}`])),
  };
}

export type NativeParameterRow = {
  ext_drill_depth?: string;
  ext_core_capacity?: string;
  ext_drill_diameter?: string;
  ext_pullback?: string;
  ext_pullback_unit?: string;
  ext_engine?: string;
  ext_parameter_values?: Record<string, string>;
  ext_custom_parameters?: { fieldName: string; name: string; value: string }[];
};

export function readPbootParameters(row: NativeParameterRow): ProductSharedParameters | null {
  if (!Object.keys(PBOOT_PARAMETER_FIELDS).some((key) => row[key]) && !row.ext_custom_parameters?.some((item) => item.value) && !Object.values(row.ext_parameter_values || {}).some(Boolean)) return null;
  try {
    const capacity = String(row.ext_core_capacity || '');
    const amount = (size: string) => capacity.match(new RegExp(`\\b${size}\\s+(\\d+(?:\\.\\d+)?)`, 'i'))?.[1] || '';
    return normalizeSharedParameters({
      template: capacity ? 'core' : 'water-well', depthM: row.ext_drill_depth,
      coreBqM: amount('BQ'), coreNqM: amount('NQ'), coreHqM: amount('HQ'), coreCapacity: capacity, diameterMm: row.ext_drill_diameter,
      pullback: row.ext_pullback, pullbackUnit: row.ext_pullback_unit || 'kN',
      engine: row.ext_engine || undefined, fieldValues: row.ext_parameter_values,
      custom: (row.ext_custom_parameters || []).map((item) => ({ ...item, nameEn: '', unit: '' })),
    });
  } catch { return null; }
}

export function ensurePbootParameterFields(db: any, value: ProductSharedParameters) {
  ensurePbootFieldDefinitions(db, { ...PBOOT_PARAMETER_FIELDS, ...Object.fromEntries(value.custom.filter((row) => row.fieldName && row.name).map((row) => [row.fieldName, row.name])) });
}

export function ensurePbootFieldDefinitions(db: any, definitions: Record<string, string>) {
  const columns = new Set<string>((db.exec('pragma table_info(ay_content_ext)')[0]?.values || []).map((row: any[]) => String(row[1]).toLowerCase()));
  if (!columns.has('contentid')) throw new BadRequestException('PB 产品扩展表缺少 contentid，请先检查网站数据库。');
  const metadata = new Set<string>((db.exec('pragma table_info(ay_extfield)')[0]?.values || []).map((row: any[]) => String(row[1])));
  if (!metadata.has('name') || !metadata.has('mcode')) throw new BadRequestException('PB 模型字段表不完整，无法添加产品参数。');
  for (const [name, description] of Object.entries(definitions)) {
      if (!/^ext_[a-zA-Z][a-zA-Z0-9_]{0,55}$/.test(name)) throw new BadRequestException('参数字段名无效。');
      const existing = db.exec(`select mcode,type from ay_extfield where lower(name)=lower('${name}')`)[0]?.values || [];
      if (existing.some((row: any[]) => String(row[0]) !== '3' || Number(row[1]) !== 1)) throw new BadRequestException(`PB 已存在不同类型的字段 ${name}，请先检查模型字段。`);
      // Match PB's native ExtField/add: a nullable TEXT(200) column plus metadata.
      if (!columns.has(name.toLowerCase())) db.run(`alter table ay_content_ext add column "${name}" TEXT(200) NULL`);
      if (!existing.length) {
        const values: Record<string, unknown> = { mcode: '3', name, type: 1, value: '', description, sorting: 900, create_user: 'admin', update_user: 'admin' };
        const fields = Object.keys(values).filter((field) => metadata.has(field));
        db.run(`insert into ay_extfield (${fields.join(',')}) values (${fields.map(() => '?').join(',')})`, fields.map((field) => values[field]));
      }
  }
}
