import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Brochure } from './brochure.entity';
import { SaveBrochureDto } from './brochure.dto';
import { BrochureService } from './brochure.service';

const payload = (): SaveBrochureDto => ({ data: {
  version: 1, language: 'zh-CN', title: '岩芯钻机产品介绍', subtitle: '', companyName: '测试公司',
  logoUrl: '/static/logo.png', website: '', contactName: '', phone: '', email: '', notes: '',
  items: [{ id: 'draft-item', productId: 223, title: 'CR600P', subtitle: '', category: '岩芯钻机',
    description: '产品说明', highlights: '', specs: [{ name: '取芯能力', value: 'BQ 760 / NQ 600 / HQ 280', unit: 'm' }],
    images: [{ src: '/static/CR600P/1.jpg', caption: '正面' }] }],
} });

describe('site-scoped product brochures', () => {
  let db: DataSource;
  let service: BrochureService;
  let siteId: number;
  beforeEach(async () => {
    db = await new DataSource({ type: 'sqljs', entities: [Brochure], synchronize: true }).initialize();
    siteId = 2;
    service = new BrochureService(db.getRepository(Brochure), { getCurrentSiteId: () => siteId } as any);
  });
  afterEach(async () => { await db.destroy(); });

  it('round-trips product data, text capacities and image ordering in an independent table', async () => {
    const body = payload();
    const saved = await service.create(body);
    body.data.items[0].title = 'original source changed';
    const loaded = await service.findOne(saved.id);
    expect(loaded.siteId).toBe(2);
    expect(loaded.data.items[0].title).toBe('CR600P');
    expect(loaded.data.items[0].specs[0].value).toBe('BQ 760 / NQ 600 / HQ 280');
    expect(loaded.data.items[0].images[0].src).toBe('/static/CR600P/1.jpg');
  });
  it('derives title/count, strips untrusted outer properties and permits independent copies', async () => {
    const saved = await service.create({ ...payload(), siteId: 99, id: 999, title: 'spoof' } as any);
    expect(saved).toMatchObject({ siteId: 2, title: payload().data.title, itemCount: 1 });
    expect(saved.id).not.toBe(999);
    const copy = await service.create(payload());
    expect(copy.id).not.toBe(saved.id);
  });
  it('updates only the selected brochure and returns compact searchable summaries', async () => {
    const first = await service.create(payload());
    const other = await service.create(payload());
    const change = payload(); change.data.title = '水井钻机介绍';
    change.data.items[0].specs[0] = { name: '回转扭矩', value: '12,000', unit: 'N.m' };
    await service.update(first.id, change);
    expect((await service.findOne(other.id)).title).toBe(payload().data.title);
    const results = await service.findAll('水井');
    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty('data');
    expect(await service.findAll("' OR 1=1 --")).toEqual([]);
  });
  it('rejects cross-site read, update, deletion and list leakage', async () => {
    const saved = await service.create(payload());
    siteId = 3;
    expect(await service.findAll()).toEqual([]);
    await expect(service.findOne(saved.id)).rejects.toThrow('不属于当前站点');
    await expect(service.update(saved.id, payload())).rejects.toThrow();
    await expect(service.remove(saved.id)).rejects.toThrow();
    siteId = 2;
    expect((await service.findOne(saved.id)).id).toBe(saved.id);
  });
  it('deletes only the requested saved document', async () => {
    const first = await service.create(payload());
    const second = await service.create(payload());
    await service.remove(first.id);
    await expect(service.findOne(first.id)).rejects.toThrow();
    expect((await service.findOne(second.id)).id).toBe(second.id);
  });
  it('keeps independent language copies and complete editable HTML without changing the original', async () => {
    const original = await service.create(payload());
    const english = payload(); english.data.language = 'en'; english.data.imageSize = 'large'; english.data.newProductPage = false;
    english.data.items[0].detailsHtml = '<h2>Core rig</h2><p>Details</p><table><tr><td>1000 m</td></tr></table><img src="/static/01.jpg">';
    english.data.items[0].detailsEnabled = false;
    const saved = await service.create(english);
    expect((await service.findOne(saved.id)).data).toEqual(english.data);
    expect((await service.findAll('', 'en')).map(row => row.id)).toEqual([saved.id]);
    expect((await service.findOne(original.id)).data.language).toBe('zh-CN');
    siteId = 9;
    expect(await service.findAll('', 'en')).toEqual([]);
  });
  it('round-trips document typography without modifying another document', async () => {
    const original = await service.create(payload());
    const body = payload();
    Object.assign(body.data, { bodyFontSize: 12.5, headingFontSize: 18, lineHeight: 1.8, paragraphSpacing: 10, tableFontSize: 11.5, tableDensity: 'relaxed', tableStyle: 'minimal', pageWidthMm: 250, pageHeightMm: 400, pageMarginMm: 15, fontFamily: 'serif' });
    const pipe = new ValidationPipe({ whitelist: true });
    const clean = await pipe.transform(body, { type: 'body', metatype: SaveBrochureDto });
    const saved = await service.create(clean);
    expect((await service.findOne(saved.id)).data).toEqual(body.data);
    expect((await service.findOne(original.id)).data.bodyFontSize).toBeUndefined();
  });
});

describe('brochure request validation', () => {
  const pipe = new ValidationPipe({ whitelist: true });
  const check = (value: unknown) => pipe.transform(value, { type: 'body', metatype: SaveBrochureDto });
  it('accepts ordinary strings and strips unknown properties at every level', async () => {
    const body: any = payload(); body.siteId = 999; body.data.unknown = 'secret'; body.data.items[0].price = 123;
    const clean = await check(body);
    expect(clean.siteId).toBeUndefined(); expect(clean.data.unknown).toBeUndefined(); expect(clean.data.items[0].price).toBeUndefined();
    expect(clean.data.items[0].specs).toEqual(payload().data.items[0].specs);
  });
  it.each(['zh-CN', 'en', 'es', 'fr', 'ru', 'ar', 'pt', 'id', 'tr', 'vi'])('accepts %s and editable content fields', async language => {
    const body = payload(); body.data.language = language; body.data.imageSize = 'medium'; body.data.newProductPage = true;
    body.data.items[0].detailsHtml = '<p>正文</p>'; body.data.items[0].detailsEnabled = true;
    expect((await check(body)).data).toEqual(body.data);
  });
  it.each(['language', 'details', 'toggle', 'size'])('rejects invalid %s', async kind => {
    const body: any = payload();
    if (kind === 'language') body.data.language = 'xx';
    if (kind === 'details') body.data.items[0].detailsHtml = 'a'.repeat(300001);
    if (kind === 'toggle') body.data.items[0].detailsEnabled = 'false';
    if (kind === 'size') body.data.imageSize = 'giant';
    await expect(check(body)).rejects.toThrow();
  });
  it.each([
    ['bodyFontSize', 8], ['bodyFontSize', 17], ['bodyFontSize', '12'], ['bodyFontSize', NaN],
    ['headingFontSize', 25], ['headingFontSize', 11], ['lineHeight', 1], ['lineHeight', 3],
    ['paragraphSpacing', -1], ['paragraphSpacing', 17], ['tableFontSize', 7], ['tableFontSize', Infinity],
    ['tableStyle', 'injected'], ['tableDensity', 'giant'],
  ])('rejects unsafe typography %s=%s', async (key, value) => {
    const body = payload(); body.data[key] = value;
    await expect(check(body)).rejects.toThrow();
  });
  it.each(['missing', 'blank-title', 'blank-product', 'null-item', 'invalid-spec', 'too-many-images', 'huge-value', 'too-many-products'])('rejects %s', async (kind) => {
    const body: any = payload();
    if (kind === 'missing') delete body.data;
    if (kind === 'blank-title') body.data.title = '  ';
    if (kind === 'blank-product') body.data.items[0].title = '\n';
    if (kind === 'null-item') body.data.items = [null];
    if (kind === 'invalid-spec') body.data.items[0].specs[0].value = {};
    if (kind === 'too-many-images') body.data.items[0].images = Array(13).fill({ src: 'a.jpg', caption: '' });
    if (kind === 'huge-value') body.data.items[0].specs[0].value = 'a'.repeat(3001);
    if (kind === 'too-many-products') body.data.items = Array(21).fill(body.data.items[0]);
    await expect(check(body)).rejects.toThrow();
  });
});
