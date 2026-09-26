import { QuotationPdfService, MAX_QUOTATION_HTML_BYTES, prepareQuotationPdfHtml } from './quotation-pdf.service';
import { chromium } from 'playwright';
import * as fs from 'fs';

jest.mock('playwright', () => ({ chromium: { launch: jest.fn(), executablePath: () => '/test/chromium' } }));

const documentHtml = '<!doctype html><html><head><title>Not body text</title><style>@page{size:A4;margin:0}.pagedjs_page{width:210mm;height:297mm}</style></head><body><div class="pagedjs_page" data-page-number="1"><p>Product data</p></div></body></html>';

describe('quotation PDF document boundary', () => {
  it('accepts exactly one continuous sheet and rejects mixed documents', () => {
    const sheet='<div class="q-continuous-sheet"><p>Complete quote</p></div>';
    expect(prepareQuotationPdfHtml(sheet)).toMatchObject({continuous:true,pageCount:1});
    expect(() => prepareQuotationPdfHtml(sheet+sheet)).toThrow();
    expect(() => prepareQuotationPdfHtml(documentHtml+sheet)).toThrow();
  });
  it('preserves print styles and page attributes without leaking the title into the body', () => {
    const prepared = prepareQuotationPdfHtml(documentHtml);
    expect(prepared.pageCount).toBe(1);
    expect(prepared.html).toContain('@page{size:A4');
    expect(prepared.html).toContain('data-page-number="1"');
    expect(prepared.html).toContain('Product data');
    expect(prepared.html).not.toContain('Not body text');
    expect(prepared.html).toContain("script-src 'none'");
    expect(prepared.html).toContain("connect-src 'none'");
  });
  it('strips script execution, iframe, base, forms and handler attributes', () => {
    const prepared = prepareQuotationPdfHtml(documentHtml.replace('Product data', '<script>alert(1)</script><iframe src="http://localhost/"></iframe><base href="file:///"><form action="https://example.invalid"><span onclick="alert(1)">Safe text</span></form><a href="javascript:alert(1)">Link</a>'));
    expect(prepared.html).toContain('Safe text');
    expect(prepared.html).not.toMatch(/<script|<iframe|<base|<form|onclick=|javascript:/i);
  });
  it.each(['https://example.invalid/a.jpg', 'http://127.0.0.1/image', 'file:///etc/passwd', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,WA=='])('rejects non-embedded or active image source %s', src => {
    expect(() => prepareQuotationPdfHtml(documentHtml.replace('Product data', `<img src="${src}">`))).toThrow('PDF 仅接受');
  });
  it('accepts raster images', () => {
    expect(prepareQuotationPdfHtml(documentHtml.replace('Product data', '<img src="data:image/png;base64,AAAA" alt="photo">')).html).toContain('data:image/png;base64,AAAA');
  });
  it('preserves language direction and semantic detail content', () => {
    const html = prepareQuotationPdfHtml(documentHtml.replace('Product data', '<section lang="ar" dir="rtl"><h5>تفاصيل المنتج</h5><p>m<sup>2</sup></p><blockquote>Details</blockquote><table><caption>Specs</caption><tr><td colspan="2">1000</td></tr></table></section>')).html;
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain('<sup>2</sup>');
    expect(html).toContain('<caption>Specs</caption>');
    expect(html).toContain('colspan="2"');
  });
  it('preserves bounded typography styles and repeated semantic table headers', () => {
    const html = prepareQuotationPdfHtml(documentHtml.replace('Product data', '<section class="quotation-content table-web" style="--body-font:12pt;--body-leading:1.8;--table-font:11pt"><table><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody><tr class="table-group"><th colspan="2">Power head</th></tr><tr><td>Depth</td><td>1200 m</td></tr></tbody></table></section>')).html;
    expect(html).toContain('--body-font:12pt'); expect(html).toContain('--body-leading:1.8');
    expect(html).toContain('--table-font:11pt'); expect(html).toContain('<thead>');
    expect(html).toContain('class="table-group"');
  });
  it('rejects empty, unpaginated, oversized and too many page inputs', () => {
    for (const value of ['', '<p>not paginated</p>', 'a'.repeat(MAX_QUOTATION_HTML_BYTES + 1), '<div class="pagedjs_page"></div>'.repeat(151)]) {
      expect(() => prepareQuotationPdfHtml(value)).toThrow();
    }
  });
});

describe('quotation PDF renderer isolation', () => {
  let page: any, context: any, browser: any;
  beforeEach(() => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    page = { setDefaultTimeout: jest.fn(), setContent: jest.fn(), emulateMedia: jest.fn(), evaluate: jest.fn(),
      locator: jest.fn(() => ({ evaluateAll: jest.fn().mockResolvedValue([{ width: 794, height: 1123 }]) })),
      pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')) };
    context = { route: jest.fn(), newPage: jest.fn().mockResolvedValue(page) };
    browser = { newContext: jest.fn().mockResolvedValue(context), close: jest.fn().mockResolvedValue(undefined) };
    (chromium.launch as jest.Mock).mockResolvedValue(browser);
  });
  afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });
  it('measures continuous PDF height on the server instead of using fixed paper height', async () => {
    page.locator.mockReturnValue({evaluateAll:jest.fn().mockResolvedValue([{width:794,height:4200}])});
    await new QuotationPdfService().render('<div class="q-continuous-sheet">Long quote</div>',210,0);
    expect(page.pdf).toHaveBeenCalledWith(expect.objectContaining({width:'210mm',height:'1112.3mm'}));
    await expect(new QuotationPdfService().render(documentHtml,210,0)).rejects.toThrow('页面模式不符');
  });
  it('rejects continuous sheets past the supported PDF limit without clipping', async () => {
    page.locator.mockReturnValue({evaluateAll:jest.fn().mockResolvedValue([{width:794,height:20000}])});
    await expect(new QuotationPdfService().render('<div class="q-continuous-sheet">Long quote</div>',210,0)).rejects.toThrow('5080mm');
    expect(page.pdf).not.toHaveBeenCalled();expect(browser.close).toHaveBeenCalled();
  });
  it('uses sandbox, disables scripts and network, and returns PDF without print UI', async () => {
    expect((await new QuotationPdfService().render(documentHtml)).toString()).toBe('%PDF-test');
    expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ chromiumSandbox: true, headless: true }));
    expect(browser.newContext).toHaveBeenCalledWith({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
    const abort = jest.fn(); context.route.mock.calls[0][1]({ abort });
    expect(abort).toHaveBeenCalled();
    expect(page.pdf).toHaveBeenCalledWith(expect.objectContaining({ width: '210mm', height: '297mm', preferCSSPageSize: false, printBackground: true }));
    expect(browser.close).toHaveBeenCalled();
  });
  it('reports a missing browser with installation instructions', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    await expect(new QuotationPdfService().render(documentHtml)).rejects.toThrow('playwright install chromium');
    expect(chromium.launch).not.toHaveBeenCalled();
  });
  it('accepts independently specified landscape and custom paper sizes', async () => {
    page.locator.mockReturnValue({ evaluateAll: jest.fn().mockResolvedValue([{ width: 1123, height: 794 }]) });
    await new QuotationPdfService().render(documentHtml,297,210);
    expect(page.pdf).toHaveBeenCalledWith(expect.objectContaining({ width: '297mm', height: '210mm' }));
    page.locator.mockReturnValue({ evaluateAll: jest.fn().mockResolvedValue([{ width: 794, height: 1123 }]) });
    await new QuotationPdfService().render(documentHtml);
    expect(page.pdf).toHaveBeenLastCalledWith(expect.objectContaining({ width: '210mm', height: '297mm' }));
    page.locator.mockReturnValue({ evaluateAll: jest.fn().mockResolvedValue([{ width: 794, height: 1512 }]) });
    await new QuotationPdfService().render(documentHtml,210,400);
    expect(page.pdf).toHaveBeenLastCalledWith(expect.objectContaining({ width: '210mm', height: '400mm' }));
  });
  it('rejects mixed page orientations', async () => {
    page.locator.mockReturnValue({ evaluateAll: jest.fn().mockResolvedValue([{ width: 1123, height: 794 }, { width: 794, height: 1123 }]) });
    await expect(new QuotationPdfService().render(documentHtml.replace('</body>', '<div class="pagedjs_page"></div></body>'))).rejects.toThrow('纸张设置不符');
    expect(page.pdf).not.toHaveBeenCalled();
  });
  it('validates fixed page geometry and closes the renderer on failure', async () => {
    page.locator.mockReturnValue({ evaluateAll: jest.fn().mockResolvedValue([{ width: 1000, height: 2000 }]) });
    await expect(new QuotationPdfService().render(documentHtml)).rejects.toThrow('纸张设置不符');
    expect(page.pdf).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });
  it('rejects a second concurrent quotation export and releases capacity after completion', async () => {
    const service = new QuotationPdfService();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    page.setContent.mockReturnValue(pending);
    const first = service.render(documentHtml);
    await expect(service.render(documentHtml)).rejects.toThrow('繁忙');
    finish();
    await first;
    await expect(service.render(documentHtml)).resolves.toBeInstanceOf(Buffer);
  });
});

 describe('quotation paper bounds', () => {
  it.each([[0,297],[179,297],[421,297],[210,601],[210,179],[NaN,297],[210,Infinity]])('rejects unsafe paper sizes %s x %s', async (width,height) => {
    await expect(new QuotationPdfService().render(documentHtml,width,height)).rejects.toThrow('纸张宽度');
    expect(chromium.launch).not.toHaveBeenCalled();
  });
});
