import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildImportedProductContent, scanProductFolders } from './product-folder-import';

describe('product folder import', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-product-import-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const writeFile = (directory: string, filename: string, content = filename) => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, filename), content);
  };

  it('识别型号文件夹并优先使用 0.jpg 作为缩略图', () => {
    const productDirectory = path.join(root, '岩芯钻机', 'CR1200I');
    ['0.jpg', '00.jpg', '1.jpg', '2.jpg', '3.jpg', '4.jpg', '01.jpg', '02.jpg'].forEach((file) => {
      writeFile(productDirectory, file);
    });
    writeFile(productDirectory, 'CR1200I_index.html', '<h2>参数</h2><p>详情</p>');

    const candidates = scanProductFolders(root);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      modelName: 'CR1200I',
      relativePath: path.join('岩芯钻机', 'CR1200I'),
      thumbnailImageFile: '0.jpg',
      largeImageFile: '00.jpg',
      carouselImageFiles: ['1.jpg', '2.jpg', '3.jpg', '4.jpg'],
      detailHtmlFile: 'CR1200I_index.html',
      detailImageFiles: ['01.jpg', '02.jpg'],
      warnings: expect.arrayContaining(['TXT 中没有识别到产品参数，参数留空']),
    });
  });

  it('reads UTF-16 parameter sidecars including downloaded filenames', () => {
    const directory = path.join(root, 'CR600P');
    writeFile(directory, '1.jpg');
    fs.writeFileSync(path.join(directory, 'CR600P_标题 (1).txt'), Buffer.from('\uFEFF钻探深度（m）：600\n取芯能力（m）：BQ 760 / NQ 600 / HQ 280\n提拔力（kN）：100', 'utf16le'));
    const [candidate] = scanProductFolders(root);
    expect(candidate.parameters.files).toEqual(['CR600P_标题 (1).txt']);
    expect(candidate.parameters.items.map((item) => item.value)).toEqual(['600', 'BQ 760 / NQ 600 / HQ 280', '100']);
    expect(candidate.parameters.errors).toEqual([]);
  });

  it('缺少 0.jpg 时预告生成缩略图，扫描不写入文件', () => {
    const productDirectory = path.join(root, 'SD10');
    writeFile(productDirectory, '1.jpg');
    writeFile(productDirectory, 'SD10_index.html', '<p>产品详情</p>');

    const [candidate] = scanProductFolders(root);

    expect(candidate.thumbnailImageFile).toBe('0.jpg');
    expect(candidate.thumbnailSourceFile).toBe('1.jpg');
    expect(fs.existsSync(path.join(productDirectory, '0.jpg'))).toBe(false);
    expect(candidate.carouselImageFiles).toEqual(['1.jpg']);
  });

  it.each(['CR600P详情.html', 'cr600p_index (1).html', 'CR600P.html'])('accepts model-based filenames and a single model folder: %s', (filename) => {
    const directory = path.join(root, 'CR600P');
    writeFile(directory, '1.jpg');
    writeFile(directory, filename, '<h2>Detail</h2>');
    writeFile(directory, 'CR600P参数.txt', 'Depth: 600 m\nCore Capacity: NQ 600\nPullback: 100 kN');
    writeFile(directory, 'CR800P参数.txt', 'Depth: 800 m');
    const [candidate] = scanProductFolders(directory);
    expect(candidate.detailHtmlFile).toBe(filename);
    expect(candidate.parameters.errors).toEqual([]);
    expect(candidate.parameters.items[0].value).toBe('600');
  });

  it('清理详情 HTML 并把详情图片插入标题前', () => {
    const content = buildImportedProductContent(
      '<!doctype html><html><body><script>alert(1)</script><p>开头</p><h2>性能</h2><p>内容</p><h3>参数</h3></body></html>',
      'CR1200I',
      ['/static/import/01.jpg', '/static/import/02.jpg'],
    );

    expect(content).not.toContain('<script');
    expect(content).not.toContain('<body');
    expect(content).toContain('src="/static/import/01.jpg"');
    expect(content).toContain('src="/static/import/02.jpg"');
    expect((content.match(/class="product-detail-image"/g) || [])).toHaveLength(2);
    expect(content.indexOf('class="product-detail-image"')).toBeLessThan(content.indexOf('<h'));
  });

  const imageSources = (html: string) => [...html.matchAll(/<img\b[^>]*src="([^"]*)"/g)].map(match => match[1]);
  const headings = (count: number) => Array.from({ length: count }, (_, index) =>
    `<h2>Section ${index + 1}</h2><p>Body ${index + 1}</p>`).join('');
  const images = ['/static/01.jpg', '/static/02.jpg', '/static/03.jpg'];

  it.each([0, 0.2, 0.5, 0.99])('preserves image order at random, distinct heading positions (%s)', (random) => {
    jest.spyOn(Math, 'random').mockReturnValue(random);
    const source = headings(8);
    const content = buildImportedProductContent(source, 'CR1200I', images);
    expect(imageSources(content)).toEqual(images);
    expect(content.match(/<p class="product-detail-image">[^\n]*<\/p>\n<h2>/g)).toHaveLength(3);
    expect(content.replace(/<p class="product-detail-image">[^\n]*<\/p>\n/g, '')).toBe(source);
  });

  it('randomizes insertion positions rather than fixing the first headings', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const first = buildImportedProductContent(headings(8), 'CR1200I', images);
    random.mockReturnValue(0.99);
    const second = buildImportedProductContent(headings(8), 'CR1200I', images);
    expect(first).not.toBe(second);
    expect(imageSources(first)).toEqual(images);
    expect(imageSources(second)).toEqual(images);
  });

  it('keeps overflow images ordered and balanced across available headings', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const urls = [...images, '/static/04.jpg', '/static/05.jpg'];
    const content = buildImportedProductContent(headings(2), 'CR1200I', urls);
    expect(imageSources(content)).toEqual(urls);
    const groups = content.split(/<h2>/).map(part => imageSources(part).length).filter(Boolean);
    expect(groups.sort()).toEqual([2, 3]);
  });

  it.each(['', '<p>Only body text</p>', '<h2>One section</h2><p>Body</p>'])('keeps every image in order when insertion positions are limited: %s', source => {
    expect(imageSources(buildImportedProductContent(source, 'CR1200I', images))).toEqual(images);
  });

  it('leaves body content unchanged without detail images', () => {
    const source = headings(3);
    expect(buildImportedProductContent(source, 'CR1200I', [])).toBe(source);
  });

  it('uses numeric filename order through scanning and content generation', () => {
    const directory = path.join(root, 'CR1200I');
    ['010.jpg', '03.webp', '01.jpg', '02.png', '00.jpg', '0.jpg', '1.jpg'].forEach(file => writeFile(directory, file));
    writeFile(directory, 'CR1200I.html', headings(6));
    const [candidate] = scanProductFolders(root);
    expect(candidate.detailImageFiles).toEqual(['01.jpg', '02.png', '03.webp', '010.jpg']);
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const urls = candidate.detailImageFiles.map(file => `/static/${file}`);
    expect(imageSources(buildImportedProductContent(headings(6), candidate.modelName, urls))).toEqual(urls);
  });
});
