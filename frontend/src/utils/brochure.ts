import type { ProductItem } from '@/api/products';
import { getUploadUrl } from '@/api/uploads';
import { renderBrochureDetail, detailImages, mapDetailImages } from './brochure-detail';
import { paginatedBrochureHtml } from './brochure-pagination';
import { brochureLabels, isBrochureLanguage, type BrochureLanguage } from './brochure-language';
import { brochureLayout, brochureLayoutCss, isBrochureLayout, type BrochureLayout } from './brochure-layout';

export type BrochureSpec = { name: string; value: string; unit: string };
export type BrochureImage = { src: string; caption: string };
export type BrochureTypography = {
  bodyFontSize: number; headingFontSize: number; lineHeight: number; paragraphSpacing: number;
  tableFontSize: number; tableDensity: 'compact' | 'standard' | 'relaxed'; tableStyle: 'web' | 'minimal' | 'grid';
};
export const brochureTypographyDefaults: BrochureTypography = {
  bodyFontSize: 11, headingFontSize: 16, lineHeight: 1.6, paragraphSpacing: 6,
  tableFontSize: 10.5, tableDensity: 'standard', tableStyle: 'web',
};
export const brochureTypographyRanges = {
  bodyFontSize: [9, 16], headingFontSize: [12, 24], lineHeight: [1.2, 2.2], paragraphSpacing: [0, 16], tableFontSize: [8, 14],
} as const;
export function brochureTypography(draft: Partial<BrochureTypography>): BrochureTypography {
  const result = { ...brochureTypographyDefaults };
  for (const key of Object.keys(brochureTypographyRanges) as (keyof typeof brochureTypographyRanges)[]) {
    const value = draft[key], [min, max] = brochureTypographyRanges[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) result[key] = value;
  }
  if (['compact', 'standard', 'relaxed'].includes(draft.tableDensity || '')) result.tableDensity = draft.tableDensity!;
  if (['web', 'minimal', 'grid'].includes(draft.tableStyle || '')) result.tableStyle = draft.tableStyle!;
  return result;
}
export type BrochureProduct = {
  id: string; productId: number; title: string; subtitle: string; category: string;
  description: string; highlights: string; specs: BrochureSpec[]; images: BrochureImage[];
  detailsHtml?: string; detailsEnabled?: boolean;
};
export type BrochureDraft = Partial<BrochureTypography & BrochureLayout> & {
  version: 1; language: BrochureLanguage; title: string; subtitle: string;
  imageSize?: 'large' | 'medium'; newProductPage?: boolean;
  companyName: string; logoUrl: string; website: string; contactName: string; phone: string; email: string;
  notes: string; items: BrochureProduct[];
};

export const newBrochure = (language: BrochureLanguage = 'zh-CN'): BrochureDraft => ({ version: 1, language, title: brochureLabels(language).title, imageSize: 'large', newProductPage: true, subtitle: '', companyName: '', logoUrl: '', website: '', contactName: '', phone: '', email: '', notes: '', items: [] });
export const newBrochureProduct = (): BrochureProduct => ({ id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, productId: 0, title: '', subtitle: '', category: '', description: '', highlights: '', specs: [], images: [], detailsHtml: '', detailsEnabled: true });
export const cloneBrochure = (draft: BrochureDraft): BrochureDraft => JSON.parse(JSON.stringify(draft));

export function isBrochureDraft(value: unknown): value is BrochureDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as BrochureDraft;
  const strings = (object: object, keys: string[]) => keys.every((key) => typeof (object as Record<string, unknown>)[key] === 'string');
  return draft.version === 1 && isBrochureLanguage(draft.language) && isBrochureLayout(draft)
    && (draft.imageSize === undefined || ['large', 'medium'].includes(draft.imageSize))
    && (draft.newProductPage === undefined || typeof draft.newProductPage === 'boolean')
    && Object.entries(brochureTypographyRanges).every(([key, [min, max]]) => {
      const value = draft[key as keyof typeof brochureTypographyRanges];
      return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
    })
    && (draft.tableStyle === undefined || ['web', 'minimal', 'grid'].includes(draft.tableStyle))
    && (draft.tableDensity === undefined || ['compact', 'standard', 'relaxed'].includes(draft.tableDensity))
    && strings(draft, ['title', 'subtitle', 'companyName', 'logoUrl', 'website', 'contactName', 'phone', 'email', 'notes'])
    && Array.isArray(draft.items) && draft.items.length <= 20
    && draft.items.every((item) => item && strings(item, ['id', 'title', 'subtitle', 'category', 'description', 'highlights'])
      && (item.detailsHtml === undefined || typeof item.detailsHtml === 'string')
      && (item.detailsEnabled === undefined || typeof item.detailsEnabled === 'boolean')
      && Number.isSafeInteger(item.productId) && item.productId >= 0
      && Array.isArray(item.specs) && item.specs.length <= 100 && item.specs.every((row) => row && strings(row, ['name', 'value', 'unit']))
      && Array.isArray(item.images) && item.images.length <= 12 && item.images.every((img) => img && strings(img, ['src', 'caption'])));
}

function plainText(value = '') {
  const doc = new DOMParser().parseFromString(value, 'text/html');
  doc.querySelectorAll('script,style,iframe').forEach((node) => node.remove());
  return (doc.body.textContent || '').trim();
}

export function productToBrochure(product: ProductItem, category = ''): BrochureProduct {
  const images = [...new Set([product.largeImage, ...(product.carouselImages || [])].filter(Boolean))].slice(0, 12).map((src) => {
    const index = product.carouselImages?.indexOf(src) ?? -1;
    return { src, caption: index >= 0 ? (product.carouselTitles?.[index] || '').slice(0, 300) : '' };
  });
  return { ...newBrochureProduct(), productId: product.id, title: product.title.slice(0, 200), subtitle: plainText(product.subtitle).slice(0, 300), category: category.slice(0, 200), description: plainText(product.summary || product.description).slice(0, 12000), images, detailsHtml: product.content || '' };
}

const escape = (value: string) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const rasterData = /^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,[a-z0-9+/=\s]+$/i;
function httpUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function uploadPreviewUrl(value: string) {
  // Production uses /api paths; srcdoc preview and exported HTML need absolute URLs.
  try { return httpUrl(new URL(getUploadUrl(value), window.location.href).href); }
  catch { return ''; }
}

export function brochureImageUrl(value: string, siteBase = '') {
  const src = value.trim();
  if (!src) return '';
  if (rasterData.test(src)) return src;
  if (/^[a-z][\w+.-]*:/i.test(src) && !/^https?:/i.test(src)) return '';
  if (/^https?:\/\/|^\/\//i.test(src)) {
    const absolute = httpUrl(src.startsWith('//') ? `${location.protocol}${src}` : src);
    if (!absolute) return '';
    try {
      const url = new URL(absolute);
      if (siteBase && url.origin === new URL(siteBase).origin && /^\/(static|uploads?)\//i.test(url.pathname)) return uploadPreviewUrl(url.pathname);
    } catch { /* Keep a valid external URL when no site base is configured. */ }
    return absolute;
  }
  return uploadPreviewUrl(src);
}

export function previewBrochure(draft: BrochureDraft, siteBase: string) {
  const result = cloneBrochure(draft);
  result.logoUrl = brochureImageUrl(result.logoUrl, siteBase);
  result.items.forEach((item) => item.images.forEach((img) => { img.src = brochureImageUrl(img.src, siteBase); }));
  result.items.forEach(item => { item.detailsHtml = item.detailsEnabled === false ? '' : mapDetailImages(item.detailsHtml || '', src => brochureImageUrl(src, siteBase)); });
  return result;
}

export function validateBrochure(draft: BrochureDraft) {
  if (!isBrochureDraft(draft)) throw new Error('资料格式或语言无效，请重新打开资料');
  if (!draft.title.trim()) throw new Error('请填写资料标题');
  if (!draft.items.length) throw new Error('请先添加产品');
  if (draft.items.length > 20) throw new Error('每份介绍最多包含 20 个产品');
  for (const [index, item] of draft.items.entries()) {
    if (!item.title.trim()) throw new Error(`请填写第 ${index + 1} 个产品的型号 / 名称`);
    if (item.images.length > 12 || item.specs.length > 100) throw new Error(`${item.title} 最多支持 12 张图片和 100 项参数`);
    if ((item.detailsHtml || '').length > 300000) throw new Error(`${item.title} 的详情正文超过 30 万字符，请精简后保存`);
  }
}

export function brochureWarnings(draft: BrochureDraft) {
  const result: string[] = [];
  for (const [index, item] of draft.items.entries()) {
    const label = item.title || `产品 ${index + 1}`;
    const detail = item.detailsEnabled === false ? '' : item.detailsHtml || '';
    if (!item.images.some(image => image.src) && !detailImages(detail).length) result.push(`${label}：未添加图片`);
    if (!item.description.trim() && !plainText(detail)) result.push(`${label}：产品正文为空`);
    if (!item.category.trim()) result.push(`${label}：栏目名称为空`);
    if (draft.language !== 'zh-CN' && /[\u3400-\u9fff]/.test([item.title, item.subtitle, item.category, item.description, item.highlights, plainText(detail), ...item.specs.map(s => s.name + s.value), ...item.images.map(i => i.caption)].join(' '))) result.push(`${label}：存在中文内容，请核对翻译`);
  }
  if (draft.language !== 'zh-CN' && /[\u3400-\u9fff]/.test([draft.title, draft.subtitle, draft.companyName, draft.contactName, draft.notes].join(' '))) result.push('资料标题或公司信息含中文，请核对');
  return result;
}

export async function portableBrochure(draft: BrochureDraft, siteBase: string, progress: (done: number, total: number) => void, skipped: (count: number) => void = () => {}) {
  const result = previewBrochure(draft, siteBase);
  const allImages = (value: BrochureDraft) => [value.logoUrl, ...value.items.flatMap(item => [...item.images.map(img => img.src), ...(item.detailsEnabled === false ? [] : detailImages(item.detailsHtml))])].filter(Boolean);
  const sources = [...new Set(allImages(result))];
  const embedded = new Map<string, string>();
  let cursor = 0;
  let bytes = 0;
  let done = 0;
  let missing = new Set(allImages(draft).filter(src => !brochureImageUrl(src, siteBase))).size;
  const deadline = Date.now() + 90000;
    await Promise.all(Array.from({ length: Math.min(3, sources.length) }, async () => {
      while (cursor < sources.length) {
        const src = sources[cursor++];
        for (let attempt = 0; attempt < 2 && Date.now() < deadline; attempt++) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), Math.min(12000, deadline - Date.now()));
        try {
          const response = await fetch(src, { signal: controller.signal, credentials: 'omit' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          if (!/^image\/(png|jpeg|webp|gif|avif|bmp)$/i.test(blob.type)) throw new Error('请使用 JPG、PNG、WebP 等常规图片');
          if (blob.size > 10 * 1024 * 1024) break;
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('图片读取失败'));
            reader.readAsDataURL(blob);
          });
          const test = new Image();
          test.src = data;
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => { test.src = ''; reject(new Error('decode timeout')); }, 5000);
            test.decode().then(() => { clearTimeout(timer); resolve(); }, error => { clearTimeout(timer); reject(error); });
          });
          if (bytes + blob.size > 40 * 1024 * 1024) break;
          bytes += blob.size;
          embedded.set(src, data);
          break;
        } catch { /* Retry once, then omit this image only from the generated document. */ }
        finally { clearTimeout(timeout); controller.abort(); }
        }
        if (!embedded.has(src)) missing++;
        progress(++done, sources.length);
      }
    }));
  result.logoUrl = embedded.get(result.logoUrl) || '';
  result.items.forEach((item) => item.images.forEach((img) => { img.src = embedded.get(img.src) || ''; }));
  result.items.forEach(item => { item.images = item.images.filter(img => img.src); });
  result.items.forEach(item => { item.detailsHtml = mapDetailImages(item.detailsHtml || '', src => embedded.get(src) || ''); });
  skipped(missing);
  return result;
}

export function brochureHtml(draft: BrochureDraft, actions = true, reportToken = '', previewId = 0) {
  const labels = brochureLabels(draft.language);
  const typography = brochureTypography(draft);
  const layout = brochureLayout(draft);
  const typographyStyle = `--body-font:${typography.bodyFontSize}pt;--heading-font:${typography.headingFontSize}pt;--body-leading:${typography.lineHeight};--paragraph-space:${typography.paragraphSpacing}pt;--table-font:${typography.tableFontSize}pt;--cell-padding:${({ compact: 4, standard: 7, relaxed: 10 })[typography.tableDensity]}px`;
  const image = (src: string, alt: string, cls = '') => {
    const safe = rasterData.test(src) ? src : httpUrl(src);
    return safe ? `<img class="${cls}" src="${escape(safe)}" alt="${escape(alt)}">` : '';
  };
  const products = draft.items.map((item, index) => {
    const photos = item.images.filter((img) => img.src);
    const gallery = photos.slice(1);
    const galleryRows = Array.from({ length: Math.ceil(gallery.length / 2) }, (_, row) => {
      const pair = gallery.slice(row * 2, row * 2 + 2);
      return `<div class="gallery-row${pair.length === 1 ? ' gallery-row-single' : ''}">${pair.map(photo => `<figure>${image(photo.src, photo.caption || item.title)}${photo.caption ? `<figcaption>${escape(photo.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`;
    }).join('');
    const specs = item.specs.filter((row) => row.name.trim() && row.value.trim());
    return `<article class="product" id="product-${index}"><header class="product-heading"><div><p class="category">${escape(item.category)}</p><h2 dir="auto">${escape(item.title || labels.product)}</h2><p class="subtitle">${escape(item.subtitle)}</p></div><span class="product-number" dir="ltr">${String(index + 1).padStart(2, '0')} / ${String(draft.items.length).padStart(2, '0')}</span></header>
      ${photos.length ? `<figure class="main-photo">${image(photos[0].src, photos[0].caption || item.title)}${photos[0].caption ? `<figcaption>${escape(photos[0].caption)}</figcaption>` : ''}</figure>` : ''}
      ${item.description.trim() ? `<section class="text-section"><h3>${labels.overview}</h3><p class="multiline">${escape(item.description)}</p></section>` : ''}
      ${item.highlights.trim() ? `<section class="text-section"><h3>${labels.highlights}</h3><ul>${item.highlights.split('\n').filter((line) => line.trim()).map((line) => `<li>${escape(line)}</li>`).join('')}</ul></section>` : ''}
      ${specs.length ? `<section class="spec-section"><h3>${labels.specs}</h3><table><colgroup><col style="width:42%"><col></colgroup><thead><tr><th>${labels.name}</th><th>${labels.value}</th></tr></thead><tbody>${specs.map((row) => `<tr${row.name.length + row.value.length + row.unit.length > 600 ? ' class="long-value"' : ''}><th scope="row">${escape(row.name)}${row.unit ? ` (${escape(row.unit)})` : ''}</th><td>${escape(row.value)}</td></tr>`).join('')}</tbody></table></section>` : ''}
      ${item.detailsEnabled !== false && item.detailsHtml?.trim() ? `<section class="product-detail">${renderBrochureDetail(item.detailsHtml, draft.language === 'ar')}</section>` : ''}
      ${galleryRows ? `<div class="gallery">${galleryRows}</div>` : ''}</article>`;
  }).join('');
  const website = httpUrl(/^https?:/i.test(draft.website) ? draft.website : `https://${draft.website}`);
  const contact = [draft.contactName, draft.phone, draft.email].filter(Boolean).map(escape).join(' · ');
  const siteLink = draft.website && website ? `<a href="${escape(website)}" target="_blank" rel="noopener noreferrer">${escape(draft.website)}</a>` : '';
  const brand = `<header class="brand">${image(draft.logoUrl, draft.companyName)}<div><strong>${escape(draft.companyName)}</strong><div class="print-contact">${contact}${contact && siteLink ? '<br>' : ''}${siteLink}</div></div></header>`;
  const footer = `<footer class="contact${draft.notes ? ' with-notes' : ''}"><div class="web-contact"><h3>${labels.contact}</h3>${contact ? `<p>${contact}</p>` : ''}${siteLink}</div>${draft.notes ? `<div class="notes"><small>${labels.notes}</small><p>${escape(draft.notes)}</p></div>` : ''}</footer>`;
  const navigation = actions ? `<nav class="actions">${draft.items.map((item, index) => `<a href="#product-${index}">${escape(item.title)}</a>`).join('')}</nav>` : '';
  const content = `<div class="brochure-content table-${typography.tableStyle} ${draft.imageSize === 'medium' ? 'medium-images' : 'large-images'} ${draft.newProductPage === false ? 'continuous-products' : ''}" style="${typographyStyle}" lang="${draft.language}" dir="${draft.language === 'ar' ? 'rtl' : 'ltr'}">${brand}<div class="doc-heading"><h1>${escape(draft.title)}</h1>${draft.subtitle ? `<p>${escape(draft.subtitle)}</p>` : ''}</div>${products}${footer}</div>`;
  return paginatedBrochureHtml(content, escape(draft.title), draft.language, navigation, reportToken, previewId, {
    css: brochureLayoutCss(layout), pageWidthMm: layout.pageWidthMm, pageHeightMm: layout.pageHeightMm, marginMm: layout.pageMarginMm,
  });
}

export const brochureFileName = (draft: BrochureDraft) => `${draft.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 80) || 'product-brochure'}-${draft.language}.html`;
