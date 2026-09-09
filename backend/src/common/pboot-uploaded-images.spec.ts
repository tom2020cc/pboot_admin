import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { copyUploadedImageToPboot, parseUploadedImage, rewriteUploadedHtmlImages } from './pboot-uploaded-images';
import { ProductService } from '../product/product.service';
import { NewsService } from '../news/news.service';
import { PageService } from '../page/page.service';
import { decodeEscapedHtml, repairTranslatedHtml } from './translation-html-utils';

describe('portable uploaded images and PB publishing', () => {
  let directory: string;
  let sites: any;
  let siteRoot: string;
  const now = '2026-09-05 12:00:00';
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-upload-image-'));
    siteRoot = path.join(directory, 'website');
    fs.mkdirSync(path.join(directory, 'api/uploads'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'api/uploads/image.jpg'), 'image-content');
    sites = { getCurrentSiteId: () => 2, getCurrentSiteStorageDir: () => path.join(directory, 'api'), isDefaultSite: () => false };
  });
  afterEach(() => {
    if (path.resolve(directory).startsWith(path.join(os.tmpdir(), 'pboot-upload-image-'))) fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each(['image.jpg', '/uploads/image.jpg', 'uploads/image.jpg', 'http://localhost:5108/uploads/image.jpg',
    'http://localhost:5108/img-upload/file/image.jpg?siteId=2', '/img-upload/file/image.jpg?siteId=2',
    'https://admin.example.invalid/img-upload/file/image.jpg?siteId=2'])('copies saved upload references: %s', source => {
    const copied = copyUploadedImageToPboot(source, sites, siteRoot, now, 'products');
    expect(copied).toBe('/static/codex/products/20260905/image.jpg');
    expect(fs.readFileSync(path.join(siteRoot, copied), 'utf8')).toBe('image-content');
  });

  it.each(['/static/my image.jpg', 'https://cdn.example.invalid/uploads/image.jpg', 'https://cdn.example.invalid/image.jpg', 'data:image/png;base64,AAAA'])('preserves website/static and external images: %s', source => {
    expect(copyUploadedImageToPboot(source, sites, siteRoot, now, 'news')).toBe(source);
  });

  it('rejects missing or cross-site uploads rather than publishing a broken or unrelated image', () => {
    expect(() => copyUploadedImageToPboot('/uploads/missing.jpg', sites, siteRoot, now, 'news')).toThrow('不存在');
    expect(() => copyUploadedImageToPboot('http://localhost:5108/img-upload/file/image.jpg?siteId=3', sites, siteRoot, now, 'news')).toThrow('其他网站');
    expect(parseUploadedImage('/uploads/..%2Fprivate.jpg')).toBeUndefined();
    expect(parseUploadedImage('/uploads/image.jpg%3Asecret')).toBeUndefined();
  });

  it('keeps captions, attributes and HTML intact while replacing old backend image URLs', () => {
    const html = '<h2>Heading</h2><p><img data-src="keep.jpg" src="http://localhost:5108/img-upload/file/image.jpg?siteId=2&amp;reload=1" alt="Caption" width="800" /></p>';
    const output = rewriteUploadedHtmlImages(html, src => copyUploadedImageToPboot(src, sites, siteRoot, now, 'news'));
    expect(output).toBe('<h2>Heading</h2><p><img data-src="keep.jpg" src="/static/codex/news/20260905/image.jpg" alt="Caption" width="800" /></p>');
  });

  it.each([[ProductService, 'products'], [NewsService, 'news']] as const)('uses the same working image path for %s media and body content', (Service, kind) => {
    const service: any = Object.create(Service.prototype);
    service.sitesService = sites;
    expect(service.preparePbootImage('image.jpg', siteRoot, now)).toBe(`/static/codex/${kind}/20260905/image.jpg`);
    const body = service.preparePbootContent('<p><img src="/uploads/image.jpg" alt="Local" /></p>', siteRoot, now);
    expect(body).toContain(`src="/static/codex/${kind}/20260905/image.jpg"`);
    expect(body).not.toContain('localhost');
  });

  it.each([ProductService, NewsService, PageService])('preserves escaped image attributes when saving through %s', Service => {
    const service: any = Object.create(Service.prototype);
    const html = '<p><img src="/uploads/image.jpg" alt="detail &quot;caption&quot;.jpg"></p>';
    expect(service.compactHtmlForStorage(html)).toBe(html);
    expect(repairTranslatedHtml(html)).toBe(html);
    const escaped = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    expect(decodeEscapedHtml(escaped)).toBe(html);
    expect(service.compactHtmlForStorage(escaped)).toBe(html);
  });
});
