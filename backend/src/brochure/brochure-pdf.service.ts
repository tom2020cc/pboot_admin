import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { chromium } from 'playwright';
import * as fs from 'fs';

const sanitizeHtml = require('sanitize-html');
export const MAX_BROCHURE_HTML_BYTES = 60 * 1024 * 1024;

export function prepareBrochurePdfHtml(input: string) {
  if (!input || Buffer.byteLength(input, 'utf8') > MAX_BROCHURE_HTML_BYTES) {
    throw new BadRequestException('导出内容为空或超过 60MB，请减少图片数量或压缩图片');
  }
  let pageCount = 0;
  const clean = sanitizeHtml(input, {
    nonTextTags: ['script', 'style', 'textarea', 'option', 'title', 'noscript', 'iframe', 'template'],
    allowedTags: ['style', 'main', 'nav', 'article', 'section', 'header', 'footer', 'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'strong', 'small', 'b', 'em', 'i', 'br', 'hr', 'ul', 'ol', 'li', 'table', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'figure', 'figcaption', 'img', 'a'],
    allowedAttributes: {
      '*': ['class', 'id', 'style', 'data-*', 'aria-*', 'role'], img: ['src', 'alt', 'width', 'height'],
      a: ['href'], th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'], col: ['span'],
    },
    allowedSchemes: ['http', 'https', 'mailto'], allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false, allowVulnerableTags: true,
    // Paged.js emits print CSS. Scripts are stripped, and the renderer additionally
    // disables JavaScript and all network/file access before loading this document.
    transformTags: {
      div: (tagName: string, attribs: Record<string, string>) => {
        if ((attribs.class || '').split(/\s+/).includes('pagedjs_page')) pageCount++;
        return { tagName, attribs };
      },
      img: (tagName: string, attribs: Record<string, string>) => {
        if (!/^data:image\/(?:png|jpeg|webp|gif|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(attribs.src || '')) {
          throw new BadRequestException('PDF 仅接受已内嵌的常规图片，请重新上传图片后导出');
        }
        return { tagName, attribs };
      },
    },
  });
  if (pageCount < 1 || pageCount > 150) throw new BadRequestException('分页数据无效或超过 150 页，请分批导出');
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return { pageCount, html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${clean}</body></html>` };
}

@Injectable()
export class BrochurePdfService {
  private active = 0;

  async render(input: string) {
    const prepared = prepareBrochurePdfHtml(input);
    if (this.active >= 2) throw new ServiceUnavailableException('PDF 导出任务繁忙，请稍后重试');
    const executablePath = process.env.BROCHURE_PDF_EXECUTABLE_PATH?.trim() || chromium.executablePath();
    if (!fs.existsSync(executablePath)) {
      throw new ServiceUnavailableException('服务端 PDF 引擎未安装，请在 backend 目录执行 pnpm exec playwright install chromium');
    }
    this.active++;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      browser = await chromium.launch({ headless: true, executablePath, chromiumSandbox: true, timeout: 30000 });
      const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
      await context.route('**/*', route => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      const work = async () => {
        await page.setContent(prepared.html, { waitUntil: 'load', timeout: 20000 });
        await page.emulateMedia({ media: 'print' });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(Array.from(document.images).map(image => image.decode()));
        });
        const pageBoxes = await page.locator('.pagedjs_page').evaluateAll(pages => pages.map(page => ({
          width: (page as HTMLElement).offsetWidth, height: (page as HTMLElement).offsetHeight,
        })));
        if (pageBoxes.length !== prepared.pageCount || pageBoxes.some(box => Math.abs(box.width - 794) > 2 || Math.abs(box.height - 1123) > 2)) {
          throw new BadRequestException('页面尺寸不是 A4，请刷新产品介绍后重新导出');
        }
        const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true });
        if (pdf.length > 80 * 1024 * 1024) throw new BadRequestException('PDF 超过 80MB，请压缩图片后重试');
        return pdf;
      };
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ServiceUnavailableException('PDF 生成超时，请减少本次导出的产品或图片')), 60000);
      })]);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('PDF 引擎运行失败，请检查服务器 Chromium、中文字体和运行权限；产品资料未改动');
    } finally {
      clearTimeout(timer);
      await browser?.close().catch(() => undefined);
      this.active--;
    }
  }
}
