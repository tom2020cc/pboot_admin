import { BrochurePdfService, MAX_BROCHURE_HTML_BYTES, prepareBrochurePdfHtml } from './brochure-pdf.service';
import { chromium } from 'playwright';
import * as fs from 'fs';

jest.mock('playwright', () => ({ chromium: { launch: jest.fn(), executablePath: () => '/test/chromium' } }));

const documentHtml = '<!doctype html><html><head><title>Not body text</title><style>@page{size:A4;margin:0}.pagedjs_page{width:210mm;height:297mm}</style></head><body><div class="pagedjs_page" data-page-number="1"><p>Product data</p></div></body></html>';

describe('brochure PDF document boundary', () => {
  it('preserves print styles and page attributes without leaking the title into the body', () => {
    const prepared = prepareBrochurePdfHtml(documentHtml);
    expect(prepared.pageCount).toBe(1);
    expect(prepared.html).toContain('@page{size:A4');
    expect(prepared.html).toContain('data-page-number="1"');
    expect(prepared.html).toContain('Product data');
    expect(prepared.html).not.toContain('Not body text');
    expect(prepared.html).toContain("script-src 'none'");
    expect(prepared.html).toContain("connect-src 'none'");
  });
  it('strips script execution, iframe, base, forms and handler attributes', () => {
    const prepared = prepareBrochurePdfHtml(documentHtml.replace('Product data', '<script>alert(1)</script><iframe src="http://localhost/"></iframe><base href="file:///"><form action="https://example.invalid"><span onclick="alert(1)">Safe text</span></form><a href="javascript:alert(1)">Link</a>'));
    expect(prepared.html).toContain('Safe text');
    expect(prepared.html).not.toMatch(/<script|<iframe|<base|<form|onclick=|javascript:/i);
  });
  it.each(['https://example.invalid/a.jpg', 'http://127.0.0.1/image', 'file:///etc/passwd', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,WA=='])('rejects non-embedded or active image source %s', src => {
    expect(() => prepareBrochurePdfHtml(documentHtml.replace('Product data', `<img src="${src}">`))).toThrow('PDF 仅接受');
  });
  it('accepts raster images', () => {
    expect(prepareBrochurePdfHtml(documentHtml.replace('Product data', '<img src="data:image/png;base64,AAAA" alt="photo">')).html).toContain('data:image/png;base64,AAAA');
  });
  it('rejects empty, unpaginated, oversized and too many page inputs', () => {
    for (const value of ['', '<p>not paginated</p>', 'a'.repeat(MAX_BROCHURE_HTML_BYTES + 1), '<div class="pagedjs_page"></div>'.repeat(151)]) {
      expect(() => prepareBrochurePdfHtml(value)).toThrow();
    }
  });
});

describe('brochure PDF renderer isolation', () => {
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
  it('uses sandbox, disables scripts and network, and returns PDF without print UI', async () => {
    expect((await new BrochurePdfService().render(documentHtml)).toString()).toBe('%PDF-test');
    expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ chromiumSandbox: true, headless: true }));
    expect(browser.newContext).toHaveBeenCalledWith({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
    const abort = jest.fn(); context.route.mock.calls[0][1]({ abort });
    expect(abort).toHaveBeenCalled();
    expect(page.pdf).toHaveBeenCalledWith(expect.objectContaining({ format: 'A4', preferCSSPageSize: true, printBackground: true }));
    expect(browser.close).toHaveBeenCalled();
  });
  it('reports a missing browser with installation instructions', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    await expect(new BrochurePdfService().render(documentHtml)).rejects.toThrow('playwright install chromium');
    expect(chromium.launch).not.toHaveBeenCalled();
  });
  it('validates fixed page geometry and closes the renderer on failure', async () => {
    page.locator.mockReturnValue({ evaluateAll: jest.fn().mockResolvedValue([{ width: 1000, height: 2000 }]) });
    await expect(new BrochurePdfService().render(documentHtml)).rejects.toThrow('不是 A4');
    expect(page.pdf).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });
  it('rejects a third concurrent export and releases capacity after completion', async () => {
    const service = new BrochurePdfService();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    page.setContent.mockReturnValue(pending);
    const first = service.render(documentHtml), second = service.render(documentHtml);
    await expect(service.render(documentHtml)).rejects.toThrow('繁忙');
    finish();
    await Promise.all([first, second]);
    await expect(service.render(documentHtml)).resolves.toBeInstanceOf(Buffer);
  });
});
