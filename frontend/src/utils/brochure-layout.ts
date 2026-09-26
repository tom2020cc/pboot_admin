import pageCss from './brochure-page.css?raw';

export const brochureFonts = {
  sans: { label: '无衬线 / Arial', css: 'Arial,"Noto Sans","Noto Sans Arabic","Microsoft YaHei","Noto Sans CJK SC",sans-serif' },
  serif: { label: '衬线 / 宋体', css: '"Times New Roman","Noto Serif","DejaVu Serif","SimSun","Noto Serif CJK SC","Noto Sans Arabic",serif' },
  mono: { label: '等宽 / Courier', css: '"Courier New","Noto Sans Mono","DejaVu Sans Mono","Microsoft YaHei","Noto Sans CJK SC","Noto Sans Arabic",monospace' },
} as const;
export type BrochureLayout = {
  pageWidthMm: number; pageHeightMm: number; pageMarginMm: number; fontFamily: keyof typeof brochureFonts;
};
export const brochureLayoutDefaults: BrochureLayout = { pageWidthMm: 210, pageHeightMm: 297, pageMarginMm: 13, fontFamily: 'sans' };
export const brochureLayoutRanges = { pageWidthMm: [100, 420], pageHeightMm: [100, 600], pageMarginMm: [8, 30] } as const;
export function isBrochureLayout(value: Partial<BrochureLayout>) {
  return Object.entries(brochureLayoutRanges).every(([key, [min, max]]) => {
    const number = value[key as keyof typeof brochureLayoutRanges];
    return number === undefined || (typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max);
  }) && (value.fontFamily === undefined || Object.prototype.hasOwnProperty.call(brochureFonts, value.fontFamily));
}
export function brochureLayout(value: Partial<BrochureLayout>): BrochureLayout {
  const result = { ...brochureLayoutDefaults };
  for (const key of Object.keys(brochureLayoutRanges) as (keyof typeof brochureLayoutRanges)[]) {
    const n = value[key], [min, max] = brochureLayoutRanges[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max) result[key] = n;
  }
  if (value.fontFamily && Object.prototype.hasOwnProperty.call(brochureFonts, value.fontFamily)) result.fontFamily = value.fontFamily;
  return result;
}
export function brochureLayoutCss(layout: BrochureLayout) {
  const available = layout.pageHeightMm - layout.pageMarginMm * 2 - 2;
  return pageCss.replace('size: A4 portrait;', `size: ${layout.pageWidthMm}mm ${layout.pageHeightMm}mm;`)
    .replace('margin: 13mm 13mm 15mm;', `margin: ${layout.pageMarginMm}mm ${layout.pageMarginMm}mm ${layout.pageMarginMm + 2}mm;`)
    + `\n.pagedjs_page{font-family:${brochureFonts[layout.fontFamily].css}}\n`
    + `.main-photo img,.gallery img{max-height:${Math.max(12, available - 25)}mm}.product-detail img{max-height:${Math.max(12, available - 12)}mm}.table-group + tr{break-before:avoid}`;
}
