import { ProductSharedParameters, productCoreCapacity, productEngine } from './product-shared-parameters';

export type ProductFieldDefinition = {
  name: string;
  label: string;
  unit: string;
  sort: number;
  enabled: boolean;
  key?: 'depthM' | 'coreCapacity' | 'diameterMm' | 'engine';
  type: number;
};

export const validProductFieldName = (name: string) => /^ext_[a-zA-Z][a-zA-Z0-9_]{0,55}$/.test(name);
export const retiredProductFields = new Set(['ext_pullback', 'ext_pullback_unit', 'ext_spec_type', 'ext_shared_specs', 'ext_shared_data']);
export const protectedProductField = (field: ProductFieldDefinition) => retiredProductFields.has(field.name.toLowerCase())
  || field.type !== 1 || /(?:big_?pic|video)/i.test(field.name);

export function defaultProductFields(engineName = 'ext_engine'): ProductFieldDefinition[] {
  return [
    { name: 'ext_drill_depth', label: '钻孔深度', unit: 'm', key: 'depthM', sort: 10, enabled: true, type: 1 },
    { name: 'ext_core_capacity', label: '取芯能力', unit: 'm', key: 'coreCapacity', sort: 20, enabled: true, type: 1 },
    { name: 'ext_drill_diameter', label: '钻孔直径', unit: 'mm', key: 'diameterMm', sort: 30, enabled: true, type: 1 },
    { name: engineName, label: '发动机', unit: '', key: 'engine', sort: 40, enabled: true, type: 1 },
  ];
}

export function productFieldValue(value: ProductSharedParameters | null | undefined, field: ProductFieldDefinition): string {
  if (!value) return '';
  if (field.key === 'coreCapacity') return productCoreCapacity(value);
  if (field.key === 'engine') return value.engine ?? value.fieldValues?.[field.name] ?? productEngine(value);
  if (field.key) return value[field.key] || '';
  const custom = value.custom?.find((row) => row.fieldName === field.name);
  return value.fieldValues?.[field.name] ?? (custom?.value ? `${custom.value}${custom.unit ? ` ${custom.unit}` : ''}` : '');
}
