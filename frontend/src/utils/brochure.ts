import type { ProductItem } from '@/api/products';
import { getUploadUrl } from '@/api/uploads';
import { chineseParameterSpecs } from '@/utils/productParameters';
import { extractProductSpecifications } from '@/utils/quotation';
import { paginatedBrochureHtml } from './brochure-pagination';

export type BrochureSpec = { name: string; value: string; unit: string };
export type BrochureImage = { src: string; caption: string };
export type BrochureProduct = {
  id: string; productId: number; title: string; subtitle: string; category: string;
  description: string; highlights: string; specs: BrochureSpec[]; images: BrochureImage[];
};
export type BrochureDraft = {
  version: 1; language: 'zh-CN' | 'en'; title: string; subtitle: string;
  companyName: string; logoUrl: string; website: string; contactName: string; phone: string; email: string;
  notes: string; items: BrochureProduct[];
};

export const newBrochure = (): BrochureDraft => ({ version: 1, language: 'zh-CN', title: '产品介绍', subtitle: '', companyName: '', logoUrl: '', website: '', contactName: '', phone: '', email: '', notes: '', items: [] });
export const newBrochureProduct = (): BrochureProduct => ({ id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, productId: 0, title: '', subtitle: '', category: '', description: '', highlights: '', specs: [], images: [] });
export const cloneBrochure = (draft: BrochureDraft): BrochureDraft => JSON.parse(JSON.stringify(draft));

export function isBrochureDraft(value: unknown): value is BrochureDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as BrochureDraft;
  const strings = (object: object, keys: string[]) => keys.every((key) => typeof (object as Record<string, unknown>)[key] === 'string');
  return draft.version === 1 && ['zh-CN', 'en'].includes(draft.language)
    && strings(draft, ['title', 'subtitle', 'companyName', 'logoUrl', 'website', 'contactName', 'phone', 'email', 'notes'])
    && Array.isArray(draft.items) && draft.items.length <= 20
    && draft.items.every((item) => item && strings(item, ['id', 'title', 'subtitle', 'category', 'description', 'highlights'])
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
  const primary = product.parameterRows?.map((row) => ({ ...row }))
    ?? chineseParameterSpecs(product.sharedParameters).map((row) => ({ name: row.name, value: row.value, unit: '' }));
  const rows = [...primary, ...extractProductSpecifications(product.content).map((row) => ({ name: row.name, value: row.value, unit: '' }))];
  const seen = new Set<string>();
  const specs = rows.filter((row) => {
    // Reference prices are internal; do not include them in customer brochures by default.
    if (!row.name.trim() || !row.value.trim() || /价格|报价|成本|price|cost/i.test(row.name)) return false;
    const key = row.name.replace(/\s|\([^)]*\)|（[^）]*）/g, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 100).map((row) => ({ name: row.name.slice(0, 160), value: row.value.slice(0, 3000), unit: row.unit.slice(0, 40) }));
  const images = [...new Set([product.largeImage, product.thumbnail, ...(product.carouselImages || [])].filter(Boolean))].slice(0, 12).map((src) => {
    const index = product.carouselImages?.indexOf(src) ?? -1;
    return { src, caption: index >= 0 ? (product.carouselTitles?.[index] || '').slice(0, 300) : '' };
  });
  return { ...newBrochureProduct(), productId: product.id, title: product.title.slice(0, 200), subtitle: plainText(product.subtitle).slice(0, 300), category: category.slice(0, 200), description: plainText(product.summary || product.description).slice(0, 12000), specs, images };
}

const escape = (value: string) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const rasterData = /^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,[a-z0-9+/=\s]+$/i;
function httpUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
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
      if (siteBase && url.origin === new URL(siteBase).origin && /^\/(static|uploads?)\//i.test(url.pathname)) return getUploadUrl(url.pathname);
    } catch { /* Keep a valid external URL when no site base is configured. */ }
    return absolute;
  }
  return getUploadUrl(src);
}

export function previewBrochure(draft: BrochureDraft, siteBase: string) {
  const result = cloneBrochure(draft);
  result.logoUrl = brochureImageUrl(result.logoUrl, siteBase);
  result.items.forEach((item) => item.images.forEach((img) => { img.src = brochureImageUrl(img.src, siteBase); }));
  return result;
}

export function validateBrochure(draft: BrochureDraft) {
  if (!draft.title.trim()) throw new Error('请填写资料标题');
  if (!draft.items.length) throw new Error('请先添加产品');
  if (draft.items.length > 20) throw new Error('每份介绍最多包含 20 个产品');
  for (const [index, item] of draft.items.entries()) {
    if (!item.title.trim()) throw new Error(`请填写第 ${index + 1} 个产品的型号 / 名称`);
    if (item.images.length > 12 || item.specs.length > 100) throw new Error(`${item.title} 最多支持 12 张图片和 100 项参数`);
  }
}

export async function portableBrochure(draft: BrochureDraft, siteBase: string, progress: (done: number, total: number) => void) {
  const result = previewBrochure(draft, siteBase);
  const sources = [...new Set([result.logoUrl, ...result.items.flatMap((item) => item.images.map((img) => img.src))].filter(Boolean))];
  // Reject invalid nonempty sources, rather than silently exporting a missing image.
  const raw = [draft.logoUrl, ...draft.items.flatMap((item) => item.images.map((img) => img.src))].filter(Boolean);
  if (raw.some((src) => !brochureImageUrl(src, siteBase))) throw new Error('图片地址无效，请使用已上传的图片或 HTTP(S) 图片地址');
  const embedded = new Map<string, string>();
  let cursor = 0;
  let bytes = 0;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120000);
  try {
    await Promise.all(Array.from({ length: Math.min(3, sources.length) }, async () => {
      while (cursor < sources.length) {
        const src = sources[cursor++];
        try {
          const response = await fetch(src, { signal: controller.signal, credentials: 'omit' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          if (!/^image\/(png|jpeg|webp|gif|avif|bmp)$/i.test(blob.type)) throw new Error('请使用 JPG、PNG、WebP 等常规图片');
          bytes += blob.size;
          if (blob.size > 10 * 1024 * 1024 || bytes > 40 * 1024 * 1024) throw new Error('图片过大，单张须小于 10MB，整份须小于 40MB');
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('图片读取失败'));
            reader.readAsDataURL(blob);
          });
          const test = new Image();
          test.src = data;
          await test.decode();
          embedded.set(src, data);
          progress(embedded.size, sources.length);
        } catch (error) {
          controller.abort();
          const name = src.startsWith('data:') ? '内嵌图片' : src.slice(0, 140);
          throw new Error(`图片未能导出：${name}。${error instanceof Error ? error.message : ''}。请重新上传该图片后再导出。`);
        }
      }
    }));
  } finally { clearTimeout(timeout); }
  result.logoUrl = embedded.get(result.logoUrl) || '';
  result.items.forEach((item) => item.images.forEach((img) => { img.src = embedded.get(img.src) || ''; }));
  return result;
}

export function brochureHtml(draft: BrochureDraft, actions = true, reportToken = '') {
  const en = draft.language === 'en';
  const labels = en ? { specs: 'Technical specifications', overview: 'Overview', highlights: 'Key features', contact: 'Contact', notes: 'Notes', print: 'Print / Save PDF', name: 'Parameter', value: 'Specification' }
    : { specs: '技术参数', overview: '产品简介', highlights: '产品特点', contact: '联系我们', notes: '备注', print: '打印 / 保存 PDF', name: '参数', value: '规格' };
  const image = (src: string, alt: string, cls = '') => {
    const safe = rasterData.test(src) ? src : httpUrl(src);
    return safe ? `<img class="${cls}" src="${escape(safe)}" alt="${escape(alt)}">` : '';
  };
  const products = draft.items.map((item, index) => {
    const photos = item.images.filter((img) => img.src);
    const specs = item.specs.filter((row) => row.name.trim() && row.value.trim());
    return `<article class="product" id="product-${index}"><header class="product-heading"><div><p class="category">${escape(item.category)}</p><h2>${escape(item.title || (en ? 'Product' : '产品型号'))}</h2><p class="subtitle">${escape(item.subtitle)}</p></div><span class="product-number">${String(index + 1).padStart(2, '0')} / ${String(draft.items.length).padStart(2, '0')}</span></header>
      ${photos.length ? `<figure class="main-photo">${image(photos[0].src, photos[0].caption || item.title)}${photos[0].caption ? `<figcaption>${escape(photos[0].caption)}</figcaption>` : ''}</figure>` : ''}
      ${item.description.trim() ? `<section class="text-section"><h3>${labels.overview}</h3><p class="multiline">${escape(item.description)}</p></section>` : ''}
      ${item.highlights.trim() ? `<section class="text-section"><h3>${labels.highlights}</h3><ul>${item.highlights.split('\n').filter((line) => line.trim()).map((line) => `<li>${escape(line)}</li>`).join('')}</ul></section>` : ''}
      ${specs.length ? `<section class="spec-section"><h3>${labels.specs}</h3><table><colgroup><col style="width:42%"><col></colgroup><thead><tr><th>${labels.name}</th><th>${labels.value}</th></tr></thead><tbody>${specs.map((row) => `<tr${row.name.length + row.value.length + row.unit.length > 600 ? ' class="long-value"' : ''}><th scope="row">${escape(row.name)}${row.unit ? ` (${escape(row.unit)})` : ''}</th><td>${escape(row.value)}</td></tr>`).join('')}</tbody></table></section>` : ''}
      ${photos.length > 1 ? `<div class="gallery">${photos.slice(1).map((photo) => `<figure>${image(photo.src, photo.caption || item.title)}${photo.caption ? `<figcaption>${escape(photo.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}</article>`;
  }).join('');
  const website = httpUrl(/^https?:/i.test(draft.website) ? draft.website : `https://${draft.website}`);
  const contact = [draft.contactName, draft.phone, draft.email].filter(Boolean).map(escape).join(' · ');
  const siteLink = draft.website && website ? `<a href="${escape(website)}" target="_blank" rel="noopener noreferrer">${escape(draft.website)}</a>` : '';
  const brand = `<header class="brand">${image(draft.logoUrl, draft.companyName)}<div><strong>${escape(draft.companyName)}</strong><div class="print-contact">${contact}${contact && siteLink ? '<br>' : ''}${siteLink}</div></div></header>`;
  const footer = `<footer class="contact${draft.notes ? ' with-notes' : ''}"><div class="web-contact"><h3>${labels.contact}</h3>${contact ? `<p>${contact}</p>` : ''}${siteLink}</div>${draft.notes ? `<div class="notes"><small>${labels.notes}</small><p>${escape(draft.notes)}</p></div>` : ''}</footer>`;
  const navigation = actions ? `<nav class="actions">${draft.items.map((item, index) => `<a href="#product-${index}">${escape(item.title)}</a>`).join('')}</nav>` : '';
  return paginatedBrochureHtml(`${brand}<div class="doc-heading"><h1>${escape(draft.title)}</h1>${draft.subtitle ? `<p>${escape(draft.subtitle)}</p>` : ''}</div>${products}${footer}`, escape(draft.title), en ? 'en' : 'zh-CN', navigation, reportToken);
}

export const brochureFileName = (draft: BrochureDraft) => `${draft.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 80) || 'product-brochure'}.html`;
