import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeResourcePath, scanSiteResources } from './site-resource-scan';

describe('conservative website resource scan', () => {
  let root: string;
  const file = (relative: string, text = 'image fixture') => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    return target;
  };
  const scan = (references = []) => scanSiteResources(root, references, Date.now() + 8 * 86400000);
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-scan-'));
    fs.mkdirSync(path.join(root, 'static'));
    fs.mkdirSync(path.join(root, 'template'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('offers only old unreferenced images and truly empty directories, never program files', () => {
    file('static/unused.jpg'); file('static/code.php', '<?php echo 1;'); file('static/manual.pdf');
    fs.mkdirSync(path.join(root, 'static/empty'));
    const result = scan();
    expect(result.entries.filter(e => e.status === 'candidate').map(e => e.path).sort()).toEqual(['static/empty', 'static/unused.jpg']);
    expect(result.entries.find(e => e.path.endsWith('code.php')).status).toBe('protected');
    expect(fs.existsSync(path.join(root, 'static/unused.jpg'))).toBe(true);
  });
  it('protects recent files even with backdated mtime, including unsaved browser uploads', () => {
    const image = file('static/new.jpg'); fs.utimesSync(image, 1, 1);
    expect(scanSiteResources(root, []).entries[0].status).toBe('protected');
  });
  it('recognizes encoded URLs, JSON escaped paths, filenames, CSS and all-language DB references', () => {
    ['中文 图.jpg', 'db.jpg', 'draft.png', 'relative.webp', 'file.svg'].forEach(name => file(`static/images/${name}`));
    file('template/cn/product.html', '<img src="/static/images/%E4%B8%AD%E6%96%87%20%E5%9B%BE.jpg">');
    file('static/css/main.css', 'body{background:url(../images/relative.webp)}');
    file('static/js/index.js', 'const logo="file.svg";');
    const result = scanSiteResources(root, [{ source: 'PB en', text: '{"img":"\\/static\\/images\\/db.jpg"}' },
      { source: '项目未同步新闻', text: 'draft.png' }], Date.now() + 8 * 86400000);
    expect(result.entries.filter(e => e.kind === 'image').every(e => e.status === 'referenced')).toBe(true);
  });
  it.each(["const p='/static/dynamic/' + model + '.png';", '<img src="/static/dynamic/${model}">', "const p='../dynamic/'+model;"])
    ('protects a dynamically addressed directory: %s', source => {
      file('static/dynamic/unused.jpg'); file('static/js/app.js', source);
      expect(scan().entries.find(e => e.kind === 'image').status).toBe('review');
    });
  it('treats an unknown image extension concatenation as uncertain across static', () => {
    file('static/somewhere/a.jpg'); file('static/app.js', "image.src = base + name + '.jpg';");
    expect(scan().entries.find(e => e.kind === 'image').status).toBe('review');
  });
  it('does not traverse junctions, even if the target is inside the website', () => {
    fs.mkdirSync(path.join(root, 'real'));
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'static/link'), 'junction');
    expect(() => scan()).toThrow('链接');
    expect(() => safeResourcePath(root, 'static/link/a.jpg', true)).toThrow('链接');
  });
  it.each(['../a.jpg', 'static/../a.jpg', '/static/a.jpg', 'static\\a.jpg', 'static/a.jpg:stream', 'static/a./x', 'template/a.jpg'])
    ('rejects unsafe or non-static paths: %s', relative => expect(() => safeResourcePath(root, relative, true)).toThrow());
  it('fails closed on incomplete or unsupported reference coverage', () => {
    file('static/a.jpg');
    fs.writeFileSync(file('template/bad.html'), Buffer.from([0xff, 0xfe, 0x01, 0x00]));
    expect(() => scan()).toThrow('UTF-8');
  });
});
