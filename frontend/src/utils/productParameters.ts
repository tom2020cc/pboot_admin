export type ProductParameterTemplate = 'core' | 'water-well' | 'general';
export type ProductSharedParameters = {
  template: ProductParameterTemplate;
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

export const emptyProductParameters = (template: ProductParameterTemplate = 'general'): ProductSharedParameters => ({
  template, depthM: '', coreBqM: '', coreNqM: '', coreHqM: '', diameterMm: '', pullback: '',
  pullbackUnit: template === 'water-well' ? 'T' : 'kN', custom: [], referencePrice: '', currency: 'USD',
});

export function productCoreCapacity(parameters: ProductSharedParameters): string {
  // Older products stored these values in three separate inputs.
  return parameters.coreCapacity ?? [['BQ', parameters.coreBqM], ['NQ', parameters.coreNqM], ['HQ', parameters.coreHqM]]
    .filter(([, value]) => value != null && value !== '').map(([size, value]) => `${size} ${value}`).join(' / ');
}

export function productEngine(parameters: ProductSharedParameters): string {
  const legacy = parameters.custom?.find((row) => /^(发动机|发动机参数|engine)$/i.test(row.name.trim()));
  return parameters.engine ?? (legacy?.value ? `${legacy.value}${legacy.unit ? ` ${legacy.unit}` : ''}` : '');
}

export function chineseParameterSpecs(parameters?: ProductSharedParameters | null) {
  if (!parameters) return [];
  const result: { group: string; name: string; value: string }[] = [];
  const add = (name: string, value: string, unit = '') => {
    if (value !== '') result.push({ group: '公共参数', name: unit ? `${name} (${unit})` : name, value });
  };
  add('钻孔深度', parameters.depthM, 'm');
  add('取芯能力', productCoreCapacity(parameters), 'm');
  add('钻孔直径', parameters.diameterMm, 'mm');
  add('发动机', productEngine(parameters));
  parameters.custom.filter((item) => item.name && !/^(发动机|发动机参数|engine)$/i.test(item.name.trim())).forEach((item) => add(item.name, item.value, item.unit));
  return result;
}

export function productReferencePrice(parameters: ProductSharedParameters | null | undefined, currency: string) {
  if (!parameters || parameters.currency !== currency || parameters.referencePrice === '') return 0;
  const price = Number(parameters.referencePrice);
  return Number.isFinite(price) && price >= 0 ? price : 0;
}
