import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildImportedNewsContent, scanNewsFolders } from './news-folder-import';

describe('news folder import', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-news-import-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const writeFile = (directory: string, filename: string, content = filename) => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, filename), content);
  };

  it('识别新闻文件夹并优先使用 0.jpg 作为缩略图', () => {
    const newsDirectory = path.join(root, '公司新闻', '新型钻机正式下线');
    ['0.jpg', '1.jpg', '01.jpg', '02.jpg'].forEach((file) => writeFile(newsDirectory, file));
    writeFile(newsDirectory, '新型钻机正式下线_index.html', '<h2>新闻内容</h2><p>正文</p>');

    const candidates = scanNewsFolders(root);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      title: '新型钻机正式下线',
      relativePath: path.join('公司新闻', '新型钻机正式下线'),
      thumbnailImageFile: '0.jpg',
      detailHtmlFile: '新型钻机正式下线_index.html',
      detailImageFiles: ['01.jpg', '02.jpg'],
      warnings: [],
    });
  });

  it('缺少 0.jpg 时计划生成，扫描不修改文件', () => {
    const newsDirectory = path.join(root, '客户来访');
    writeFile(newsDirectory, '1.jpg');
    writeFile(newsDirectory, '客户来访_index.html', '<p>新闻正文</p>');

    const [candidate] = scanNewsFolders(root);

    expect(candidate.thumbnailImageFile).toBe('0.jpg');
    expect(candidate.thumbnailSourceFile).toBe('1.jpg');
    expect(fs.existsSync(path.join(newsDirectory, '0.jpg'))).toBe(false);
  });

  it('recognizes existing uppercase 0.JPG and numbered PNG sources', () => {
    writeFile(path.join(root, '旧新闻'), '0.JPG');
    writeFile(path.join(root, '旧新闻'), '1.jpg');
    writeFile(path.join(root, '新新闻'), '1.PNG');
    const candidates = scanNewsFolders(root);
    expect(candidates.find(item => item.title === '旧新闻')).toMatchObject({ thumbnailImageFile: '0.JPG', thumbnailSourceFile: '' });
    expect(candidates.find(item => item.title === '新新闻')).toMatchObject({ thumbnailImageFile: '0.jpg', thumbnailSourceFile: '1.PNG' });
  });

  it('清理正文 HTML 并把正文图片插入标题前', () => {
    const content = buildImportedNewsContent(
      '<!doctype html><html><body><script>alert(1)</script><p>开头</p><h2>正文</h2></body></html>',
      '新型钻机正式下线',
      ['/static/import/01.jpg'],
    );

    expect(content).not.toContain('<script');
    expect(content).not.toContain('<body');
    expect(content).toContain('src="/static/import/01.jpg"');
    expect(content).toContain('class="news-detail-image"');
    expect(content.indexOf('class="news-detail-image"')).toBeLessThan(content.indexOf('<h'));
  });
});
