export type QuotationLayout = {
  pageMode: 'continuous' | 'paged';
  pageWidth: number; pageHeight: number; margin: number;
  fontFamily: 'sans' | 'cjk' | 'serif'; bodyFontSize: number; titleFontSize: number;
  sectionFontSize: number; tableFontSize: number; priceFontSize: number;
  lineHeight: number; cellPadding: number; imageColumnWidth: number; priceColumnWidth: number;
};

export const quotationLayoutDefaults: QuotationLayout = {
  pageMode: 'continuous',
  pageWidth: 210, pageHeight: 297, margin: 12, fontFamily: 'sans', bodyFontSize: 9,
  titleFontSize: 20, sectionFontSize: 11, tableFontSize: 8.5, priceFontSize: 11,
  lineHeight: 1.45, cellPadding: 1.5, imageColumnWidth: 27, priceColumnWidth: 25,
};
export const quotationClassicLayout: QuotationLayout = {
  ...quotationLayoutDefaults, pageWidth: 297, pageHeight: 210, margin: 9,
  bodyFontSize: 8.5, lineHeight: 1.35, cellPadding: 1,
};
export const quotationLayoutRanges = {
  pageWidth: [180, 420], pageHeight: [180, 600], margin: [6, 20],
  bodyFontSize: [8, 16], titleFontSize: [14, 30], sectionFontSize: [10, 20],
  tableFontSize: [8, 16], priceFontSize: [9, 22], lineHeight: [1.15, 2.2],
  cellPadding: [1, 5], imageColumnWidth: [22, 38], priceColumnWidth: [22, 32],
} as const;

export function quotationLayout(value: Partial<QuotationLayout> = {}): QuotationLayout {
  const result = { ...quotationLayoutDefaults };
  for (const key of Object.keys(quotationLayoutRanges) as (keyof typeof quotationLayoutRanges)[]) {
    const n = value?.[key], [min, max] = quotationLayoutRanges[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max) result[key] = n;
  }
  if (['sans', 'cjk', 'serif'].includes(value?.fontFamily || '')) result.fontFamily = value.fontFamily!;
  if (value?.pageMode === 'paged') result.pageMode = 'paged';
  return result;
}

export function quotationPaperLabel(value?: Partial<QuotationLayout>) {
  const { pageWidth: w, pageHeight: h, pageMode } = quotationLayout(value);
  if (pageMode === 'continuous') return `连续长页 · 宽 ${w} mm · 高度自动`;
  const preset = w === 210 && h === 297 ? 'A4 竖向' : w === 297 && h === 210 ? 'A4 横向' : '自定义';
  return `${preset} · ${w} × ${h} mm`;
}

export function quotationLayoutCss(value?: Partial<QuotationLayout>) {
  const s = quotationLayout(value);
  const fonts = { sans: 'Arial,"Noto Sans","Noto Sans CJK SC","Noto Sans Arabic",sans-serif', cjk: '"Noto Sans CJK SC","Microsoft YaHei","Noto Sans Arabic",sans-serif', serif: '"Noto Serif CJK SC",Georgia,"Times New Roman",serif' };
  return `@page { size: ${s.pageWidth}mm ${s.pageHeight}mm; margin: ${s.margin}mm; }
    .quotation-document { --q-body-font: ${s.bodyFontSize}pt; --q-title-font: ${s.titleFontSize}pt; --q-section-font: ${s.sectionFontSize}pt; --q-table-font: ${s.tableFontSize}pt; --q-price-font: ${s.priceFontSize}pt; --q-leading: ${s.lineHeight}; --q-cell-padding: ${s.cellPadding}mm; --q-columns: ${s.imageColumnWidth}% ${100-s.imageColumnWidth-s.priceColumnWidth}% ${s.priceColumnWidth}%; --q-price-width: ${s.priceColumnWidth}%; font-family: ${fonts[s.fontFamily]}; }
    .q-product-compact { min-height: ${Math.min(55, (s.pageHeight - 2*s.margin)*0.3)}mm; }
    .q-photo-gallery img { max-height: ${Math.min(80, (s.pageHeight - 2*s.margin)*0.48)}mm; }`;
}
