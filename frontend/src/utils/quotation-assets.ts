import { getUploadUrl } from '@/api/uploads';

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

export function quotationImageUrl(value: string, siteBase = '') {
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

export async function embedQuotationImages(raw: string[], siteBase: string, progress: (done: number, total: number) => void) {
  const sources = [...new Set(raw.filter(Boolean).map(src => quotationImageUrl(src, siteBase)))];
  if (sources.some(src => !src)) throw new Error('图片地址无效，请使用已上传的图片或 HTTP(S) 图片地址');
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
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('图片解码超时')), 10000);
            test.decode().then(() => { clearTimeout(timer); resolve(); }, error => { clearTimeout(timer); reject(error); });
          });
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
  return new Map(raw.map(src => [src, embedded.get(quotationImageUrl(src, siteBase)) || '']));
}
