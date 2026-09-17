import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { chromium } from 'playwright';
import * as fs from 'fs';

const sanitizeHtml = require('sanitize-html');
export const MAX_QUOTATION_HTML_BYTES = 60 * 1024 * 1024;

export function prepareQuotationPdfHtml(input: string) {
  if (!input || Buffer.byteLength(input, 'utf8') > MAX_QUOTATION_HTML_BYTES) {
    throw new BadRequestException('导出内容为空或超过 60MB，请减少图片数量或压缩图片');
  }
  let pageCount = 0, continuousSheets = 0;
  const clean = sanitizeHtml(input, {
    nonTextTags: ['script', 'style', 'textarea', 'option', 'title', 'noscript', 'iframe', 'template'],
    allowedTags: ['style', 'main', 'nav', 'article', 'section', 'header', 'footer', 'div', 'span', 'bdi', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'small', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'blockquote', 'pre', 'code', 'br', 'hr', 'ul', 'ol', 'li', 'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'figure', 'figcaption', 'img', 'a'],
    allowedAttributes: {
      '*': ['class', 'id', 'style', 'data-*', 'aria-*', 'role', 'lang', 'dir'], img: ['src', 'alt', 'width', 'height'],
      a: ['href'], ol: ['start'], th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'], col: ['span'],
    },
    allowedSchemes: ['http', 'https', 'mailto'], allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false, allowVulnerableTags: true,
    // Paged.js emits print CSS. Scripts are stripped, and the renderer additionally
    // disables JavaScript and all network/file access before loading this document.
    transformTags: {
      div: (tagName: string, attribs: Record<string, string>) => {
        if ((attribs.class || '').split(/\s+/).includes('pagedjs_page')) pageCount++;
        if ((attribs.class || '').split(/\s+/).includes('q-continuous-sheet')) continuousSheets++;
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
  const continuous = continuousSheets === 1 && pageCount === 0;
  if (!continuous && (continuousSheets > 0 || pageCount < 1 || pageCount > 150)) throw new BadRequestException('报价单页面数据无效或超过 150 页，请分批导出');
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return { pageCount: continuous ? 1 : pageCount, continuous, html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${clean}</body></html>` };
}

@Injectable()
export class QuotationPdfService {
  private active = 0;

  async render(input: string, widthMm = 210, heightMm = 297) {
    if (!Number.isFinite(widthMm) || widthMm < 180 || widthMm > 420 || !Number.isFinite(heightMm) || (heightMm !== 0 && (heightMm < 180 || heightMm > 600))) {
      throw new BadRequestException('报价单纸张宽度须为 180-420mm，高度须为 180-600mm');
    }
    const prepared = prepareQuotationPdfHtml(input);
    if (prepared.continuous !== (heightMm === 0)) throw new BadRequestException('页面模式不符，请重新生成报价单后导出');
    if (this.active >= 1) throw new ServiceUnavailableException('PDF 导出任务繁忙，请稍后重试');
    const executablePath = process.env.QUOTATION_PDF_EXECUTABLE_PATH?.trim() || chromium.executablePath();
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
        const pageBoxes = await page.locator(prepared.continuous ? '.q-continuous-sheet' : '.pagedjs_page').evaluateAll(pages => pages.map(page => ({
          width: (page as HTMLElement).offsetWidth, height: (page as HTMLElement).offsetHeight,
        })));
        if (prepared.continuous) {
          const box = pageBoxes[0];
          if (pageBoxes.length !== 1 || !box || Math.abs(box.width - widthMm * 96 / 25.4) > 2 || box.height <= 0) {
            throw new BadRequestException('长页宽度与报价单设置不符，请重新生成后导出');
          }
          // 200 inches is the widely supported PDF page boundary. Never silently clip a long quote.
          heightMm = Math.ceil((box.height * 25.4 / 96 + 1) * 10) / 10;
          if (heightMm > 5080) throw new BadRequestException('连续报价单超过 PDF 长页上限（5080mm），请减少产品数量或选择固定纸张分页');
        }
        const expected = { width: widthMm * 96 / 25.4, height: heightMm * 96 / 25.4 };
        if (!prepared.continuous && (pageBoxes.length !== prepared.pageCount || pageBoxes.some(box => Math.abs(box.width - expected.width) > 2 || Math.abs(box.height - expected.height) > 2))) {
          throw new BadRequestException('页面尺寸与报价单纸张设置不符，请重新排版后导出');
        }
        const pdf = await page.pdf({ width: `${widthMm}mm`, height: `${heightMm}mm`, preferCSSPageSize: false, printBackground: true, tagged: true });
        if (pdf.length > 80 * 1024 * 1024) throw new BadRequestException('PDF 超过 80MB，请压缩图片后重试');
        return pdf;
      };
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ServiceUnavailableException('PDF 生成超时，请减少本次导出的产品或图片')), 60000);
      })]);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('PDF 引擎运行失败，请检查服务器 Chromium、中文字体和运行权限；报价数据未改动');
    } finally {
      clearTimeout(timer);
      await browser?.close().catch(() => undefined);
      this.active--;
    }
  }
}
