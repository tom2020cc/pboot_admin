import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const sharp: typeof import('sharp').default = require('sharp');
import { createProductThumbnail, ensureFolderThumbnail, resolveProductThumbnailDirectory, saveUploadedProductThumbnail } from './product-thumbnail';

describe('product thumbnails', () => {
  let root: string;
  let site: string;
  let model: string;
  const raster = (width = 1000, height = 400) => sharp({ create: { width, height, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
  const resolve = (name = 'CR600P', refs: string[] = []) => resolveProductThumbnailDirectory(site, name, refs, 'https://site.invalid', 5);
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-thumbnail-'));
    site = path.join(root, 'site');
    model = path.join(site, 'static', 'Core Rigs', 'CR600P');
    fs.mkdirSync(model, { recursive: true });
  });
  afterEach(() => {
    if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'product-thumbnail-'))) throw new Error('Unexpected test root');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([[1000, 400], [400, 1000], [600, 600], [50, 40]])('outputs an undistorted 500x400 JPEG from %sx%s', async (width, height) => {
    const source = await raster(width, height);
    const result = await createProductThumbnail(source);
    expect(await sharp(result).metadata()).toMatchObject({ width: 500, height: 400, format: 'jpeg', channels: 3 });
    const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
    expect(pixel(250, 200)[0]).toBeGreaterThan(245);
    expect(pixel(250, 200)[1]).toBeLessThan(10);
    if (width / height !== 1.25) expect(pixel(0, 0).every(value => value > 245)).toBe(true);
    expect(await sharp(source).metadata()).toMatchObject({ width, height });
  });

  it('applies EXIF orientation and removes metadata', async () => {
    const source = await sharp(await raster()).withMetadata({ orientation: 6 }).toBuffer();
    const result = await createProductThumbnail(source);
    expect((await sharp(result).metadata()).orientation).toBeUndefined();
    const { data } = await sharp(result).extract({ left: 0, top: 200, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect([...data].every(value => value > 245)).toBe(true);
  });

  it('flattens transparency on white', async () => {
    const source = await sharp({ create: { width: 500, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const stats = await sharp(await createProductThumbnail(source)).stats();
    expect(stats.channels.every(channel => channel.mean > 254)).toBe(true);
  });

  it('generates 0.jpg in the source model folder and never changes 1.jpg', async () => {
    const source = await raster();
    fs.writeFileSync(path.join(model, '1.jpg'), source);
    expect(await ensureFolderThumbnail(model, '1.jpg')).toBe('0.jpg');
    expect(await sharp(path.join(model, '0.jpg')).metadata()).toMatchObject({ width: 500, height: 400 });
    expect(fs.readFileSync(path.join(model, '1.jpg'))).toEqual(source);
    const original = fs.readFileSync(path.join(model, '0.jpg'));
    fs.writeFileSync(path.join(model, '1.jpg'), 'invalid');
    expect(await ensureFolderThumbnail(model, '1.jpg')).toBe('0.jpg');
    expect(fs.readFileSync(path.join(model, '0.jpg'))).toEqual(original);
  });

  it('keeps an existing uppercase 0.JPG without resizing or validating its replacement', async () => {
    const source = await raster(75, 60);
    fs.writeFileSync(path.join(model, '0.JPG'), source);
    const before = fs.statSync(path.join(model, '0.JPG')).mtimeMs;
    expect(await ensureFolderThumbnail(model, 'not-present.jpg')).toBe('0.JPG');
    expect(fs.readFileSync(path.join(model, '0.JPG'))).toEqual(source);
    expect(fs.statSync(path.join(model, '0.JPG')).mtimeMs).toBe(before);
  });

  it('handles simultaneous imports without overwriting 0.jpg', async () => {
    fs.writeFileSync(path.join(model, '1.jpg'), await raster());
    expect(await Promise.all([ensureFolderThumbnail(model, '1.jpg'), ensureFolderThumbnail(model, '1.jpg')])).toEqual(['0.jpg', '0.jpg']);
    expect(fs.readdirSync(model).sort()).toEqual(['0.jpg', '1.jpg']);
  });

  it('supports numbered PNG input and leaves missing source alone', async () => {
    expect(await ensureFolderThumbnail(model, '')).toBe('');
    fs.writeFileSync(path.join(model, '1.PNG'), await sharp(await raster()).png().toBuffer());
    expect(await ensureFolderThumbnail(model, '1.PNG')).toBe('0.jpg');
  });

  it.each(['<svg xmlns="http://www.w3.org/2000/svg"/>', 'not an image', '\xff\xd8\xffbroken'])('rejects invalid images without writing output', async (value) => {
    fs.writeFileSync(path.join(model, '1.jpg'), Buffer.from(value, 'latin1'));
    await expect(ensureFolderThumbnail(model, '1.jpg')).rejects.toThrow();
    expect(fs.readdirSync(model)).toEqual(['1.jpg']);
  });

  it('rejects empty and oversized input', async () => {
    await expect(createProductThumbnail(Buffer.alloc(0))).rejects.toThrow();
    await expect(createProductThumbnail(Buffer.alloc(30 * 1024 * 1024 + 1))).rejects.toThrow();
    await expect(ensureFolderThumbnail(model, '../1.jpg')).rejects.toThrow();
  });

  it('reuses a model folder under the current static root', () => {
    expect(resolve()).toBe(fs.realpathSync(model));
    expect(fs.existsSync(path.join(site, 'static', 'codex'))).toBe(false);
  });

  it('rejects ambiguous models, resolving them only with same-site media references', () => {
    fs.mkdirSync(path.join(site, 'static', 'Other', 'CR600P'), { recursive: true });
    fs.writeFileSync(path.join(model, '1.jpg'), 'image');
    expect(() => resolve()).toThrow('多个同名');
    expect(() => resolve('CR600P', ['https://other.invalid/static/Core%20Rigs/CR600P/1.jpg'])).toThrow('多个同名');
    expect(resolve('CR600P', ['/static/Core%20Rigs/CR600P/1.jpg'])).toBe(fs.realpathSync(model));
  });

  it('creates a portable model folder only when no matching folder exists', () => {
    expect(resolve('WRT 600')).toBe(path.join(fs.realpathSync(site), 'static', 'codex', 'product-images', '5', 'WRT-600'));
  });

  it.each(['', ' ', '.', '..', '...', 'CON', 'NUL.jpg', 'LPT1', 'CR600.'])('rejects invalid model names: %s', name => {
    expect(() => resolve(name)).toThrow();
  });

  it('rejects Windows junction escapes before creating a model folder', () => {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(site, 'static', 'codex'), 'junction');
    expect(() => resolve('WRT600')).toThrow('超出当前网站');
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('saves unique uploaded thumbnails in the model directory without overwriting 0.jpg', async () => {
    const original = await raster(75, 60);
    fs.writeFileSync(path.join(model, '0.jpg'), original);
    const first = await saveUploadedProductThumbnail(site, resolve(), await raster());
    const second = await saveUploadedProductThumbnail(site, resolve(), await raster(400, 1000));
    expect(first).toMatchObject({ width: 500, height: 400, url: expect.stringMatching(/^\/static\/Core%20Rigs\/CR600P\/thumbnail-[a-f0-9]+\.jpg$/) });
    expect(first.url).not.toBe(second.url);
    expect(fs.readFileSync(path.join(model, '0.jpg'))).toEqual(original);
    expect(await sharp(path.join(site, decodeURIComponent(first.url))).metadata()).toMatchObject({ width: 500, height: 400 });
    await expect(saveUploadedProductThumbnail(site, root, await raster())).rejects.toThrow('当前网站');
  });
});
