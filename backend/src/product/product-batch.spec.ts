import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource } from 'typeorm';
import initSqlJs from 'sql.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Product } from './entities/product.entity';
import { ProductTranslation } from './entities/product-translation.entity';
import { Menu } from '../menu/entities/menu.entity';
import { ProductService } from './product.service';
import { BatchProductDto } from './dto/batch-product.dto';
import { replaceBatchDatabase } from './product-batch-file';

describe('site-scoped product batch operations', () => {
  let source: DataSource,
    directory: string,
    file: string,
    SQL: any,
    service: any;
  const product = (id: number) =>
    source.getRepository(Product).findOneByOrFail({ id });
  const pbRows = () => {
    const db = new SQL.Database(fs.readFileSync(file));
    try {
      return (
        db.exec(
          'select id,acode,scode,filename,title from ay_content order by id',
        )[0]?.values || []
      );
    } finally {
      db.close();
    }
  };
  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-batch-'));
    fs.mkdirSync(path.join(directory, 'data'));
    file = path.join(directory, 'data', 'site.db');
    SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(
      'create table ay_content(id integer primary key,acode text,scode text,filename text,title text)',
    );
    db.run('create table ay_content_sort(acode text,scode text,mcode text)');
    db.run('create table ay_content_ext(contentid integer,value text)');
    db.run(
      "insert into ay_content_sort values('cn','1','3'),('en','2','3'),('cn','3','3'),('en','4','3')",
    );
    db.run(
      "insert into ay_content values(11,'cn','1','cn-rig1','Rig 1'),(12,'en','2','en-rig1','Rig 1 EN'),(21,'cn','1','cn-rig2','Rig 2'),(22,'en','2','en-rig2','Rig 2 EN')",
    );
    db.run(
      "insert into ay_content_ext values(11,'Keep only when not selected'),(21,'Keep')",
    );
    fs.writeFileSync(file, Buffer.from(db.export()));
    db.close();
    source = await new DataSource({
      type: 'sqljs',
      entities: [Product, ProductTranslation, Menu],
      synchronize: true,
    }).initialize();
    for (const [id, code, sourceMenuId, siteId] of [
      [1, 'pboot:cn:1', 1, 1],
      [2, 'pboot:en:2', 1, 1],
      [3, 'pboot:cn:3', 3, 1],
      [4, 'pboot:en:4', 3, 1],
      [5, 'pboot:cn:5', 5, 2],
    ] as const) {
      await source
        .getRepository(Menu)
        .save({
          id: String(id),
          siteId,
          code,
          sourceMenuId,
          model: '3',
          name: 'Rigs',
          parentId: 0,
          publisher: 'admin',
          href: `/rigs-${sourceMenuId}`,
          urlName: `rigs-${sourceMenuId}`,
          show: true,
          orderNum: 1,
        });
    }
    for (const id of [1, 2, 3]) {
      await source
        .getRepository(Product)
        .save({
          id,
          siteId: id === 3 ? 2 : 1,
          menuId: 1,
          title: `Rig ${id}`,
          urlName: `cn-rig${id}`,
          content: '<p>Original content</p>',
          thumbnail: '/shared/0.jpg',
          carouselImages: ['/shared/1.jpg'],
          sharedParameters: { fieldValues: { ext_power: '110' } } as any,
          show: true,
          orderNum: id,
        });
      for (const lang of ['zh-CN', 'en'])
        await source
          .getRepository(ProductTranslation)
          .save({
            productId: id,
            lang,
            title: `Rig ${id}${lang === 'en' ? ' EN' : ''}`,
            urlName: `${lang === 'en' ? 'en' : 'cn'}-rig${id}`,
            content: '<p>Translated content</p>',
          });
    }
    service = new ProductService(
      source.getRepository(Product),
      source.getRepository(ProductTranslation),
      source.getRepository(Menu),
      {} as any,
      {} as any,
      {
        getCurrentSiteLanguages: async () => [
          { code: 'zh-CN' },
          { code: 'en' },
        ],
        getCurrentSite: () => ({ id: 1, name: 'Test' }),
        getPbootPublicBaseUrl: () => 'https://example.invalid',
      } as any,
    );
    service.currentSiteId = async () => 1;
    service.getPbootDbPath = () => file;
    service.getPbootSiteRoot = () => directory;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (source?.isInitialized) await source.destroy();
    if (
      directory &&
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('pboot-batch-')
    )
      fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    { action: 'unknown', ids: [1] },
    { action: 'show', ids: [] },
    { action: 'show', ids: [1, 1] },
    { action: 'show', ids: [1.2] },
    { action: 'show', ids: [1], value: 'true' },
    { action: 'sort', ids: [1], orders: [{ id: 1, orderNum: -1 }] },
  ])('validates malformed API payload %j', async (payload) => {
    expect(
      (await validate(plainToInstance(BatchProductDto, payload))).length,
    ).toBeGreaterThan(0);
  });
  it('rejects mixed-site and missing selections before changing any products', async () => {
    await expect(
      service.batchManage({ action: 'show', ids: [1, 3], value: false }),
    ).rejects.toThrow('不属于当前网站');
    expect((await product(1)).show).toBe(true);
    await expect(
      service.batchManage({ action: 'show', ids: [1, 99], value: false }),
    ).rejects.toThrow();
  });
  it('changes only selected shared attributes, retaining all translated content and PB bytes', async () => {
    const translations = await source.getRepository(ProductTranslation).find();
    const before = fs.readFileSync(file);
    for (const action of ['show', 'top', 'recommend'])
      expect(
        (await service.batchManage({ action, ids: [1], value: false }))
          .succeeded,
      ).toBe(1);
    expect(await product(1)).toMatchObject({
      show: false,
      isTop: false,
      isRecommend: false,
    });
    expect(await product(2)).toMatchObject({
      show: true,
      isTop: null,
      isRecommend: null,
    });
    expect(await source.getRepository(ProductTranslation).find()).toEqual(
      translations,
    );
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it('validates exact sort IDs and ranges', async () => {
    await expect(
      service.batchManage({
        action: 'sort',
        ids: [1],
        orders: [{ id: 2, orderNum: 10 }],
      }),
    ).rejects.toThrow('一一对应');
    await expect(
      service.batchManage({
        action: 'sort',
        ids: [1],
        orders: [
          { id: 1, orderNum: 1 },
          { id: 1, orderNum: 2 },
        ],
      }),
    ).rejects.toThrow();
    expect(
      (
        await service.batchManage({
          action: 'sort',
          ids: [1, 2],
          orders: [
            { id: 1, orderNum: 90 },
            { id: 2, orderNum: 0 },
          ],
        })
      ).succeeded,
    ).toBe(2);
    expect((await product(1)).orderNum).toBe(90);
    expect((await product(2)).orderNum).toBe(0);
  });
  it('requires explicit confirmation and a Chinese product menu in the same site', async () => {
    for (const action of ['copy', 'move', 'delete'])
      await expect(service.batchManage({ action, ids: [1] })).rejects.toThrow(
        '先确认',
      );
    for (const menuId of [2, 5, 999])
      await expect(
        service.batchManage({
          action: 'move',
          ids: [1],
          menuId,
          confirmed: true,
        }),
      ).rejects.toThrow();
    expect(
      (
        await service.batchManage({
          action: 'move',
          ids: [1],
          menuId: 3,
          confirmed: true,
        })
      ).succeeded,
    ).toBe(1);
    expect((await product(1)).menuId).toBe(3);
    expect((await product(2)).menuId).toBe(1);
  });
  it('blocks a move with missing language URLs instead of creating PB duplicates', async () => {
    await source
      .getRepository(ProductTranslation)
      .update({ productId: 1, lang: 'en' }, { urlName: '' });
    expect(
      (
        await service.batchManage({
          action: 'move',
          ids: [1],
          menuId: 3,
          confirmed: true,
        })
      ).failed,
    ).toBe(1);
    expect((await product(1)).menuId).toBe(1);
  });
  it('copies all languages into a hidden independent product without changing originals or image files', async () => {
    const original = await product(1),
      before = fs.readFileSync(file);
    const result = await service.batchManage({
      action: 'copy',
      ids: [1],
      menuId: 3,
      confirmed: true,
    });
    expect(result.succeeded).toBe(1);
    const copied = await product(result.results[0].newId);
    expect(copied).toMatchObject({
      siteId: 1,
      menuId: 3,
      show: false,
      thumbnail: original.thumbnail,
      sharedParameters: original.sharedParameters,
    });
    const versions = await source
      .getRepository(ProductTranslation)
      .findBy({ productId: copied.id });
    expect(versions).toHaveLength(2);
    expect(versions.find((item) => item.lang === 'zh-CN').urlName).toBe(
      copied.urlName,
    );
    expect(versions.every((item) => item.urlName.includes('-copy-'))).toBe(
      true,
    );
    expect(copied.urlName).not.toBe(original.urlName);
    const second = await service.batchManage({
      action: 'copy',
      ids: [1],
      menuId: 3,
      confirmed: true,
    });
    expect((await product(second.results[0].newId)).urlName).not.toBe(
      copied.urlName,
    );
    expect(await product(1)).toEqual(original);
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it('deletes local products and translations only by default, preserving PB and unselected products', async () => {
    const before = fs.readFileSync(file);
    expect(
      (
        await service.batchManage({
          action: 'delete',
          ids: [1],
          confirmed: true,
        })
      ).succeeded,
    ).toBe(1);
    expect(await source.getRepository(Product).findOneBy({ id: 1 })).toBeNull();
    expect(
      await source.getRepository(ProductTranslation).countBy({ productId: 1 }),
    ).toBe(0);
    expect(await product(2)).toBeDefined();
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it('optionally deletes only uniquely matched selected PB records and retains file mode', async () => {
    const before = fs.statSync(file);
    const result = await service.batchManage({
      action: 'delete',
      ids: [1],
      deletePboot: true,
      confirmed: true,
    });
    expect(result.results).toEqual([
      expect.objectContaining({ status: 'success' }),
    ]);
    expect(pbRows().map((row: any[]) => row[0])).toEqual([21, 22]);
    expect(fs.statSync(file).mode).toBe(before.mode);
    expect(await product(2)).toBeDefined();
  });
  it('refuses ambiguous PB matches without deleting anything', async () => {
    const db = new SQL.Database(fs.readFileSync(file));
    db.run("insert into ay_content values(13,'cn','1','cn-rig1','Duplicate')");
    fs.writeFileSync(file, db.export());
    db.close();
    const before = fs.readFileSync(file);
    const result = await service.batchManage({
      action: 'delete',
      ids: [1],
      deletePboot: true,
      confirmed: true,
    });
    expect(result.failed).toBe(1);
    expect(result.results[0].message).toContain('多个 PB');
    expect(await product(1)).toBeDefined();
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it('refuses PB deletion when the source Chinese product menu is missing', async () => {
    await source.getRepository(Menu).delete({ id: '1' });
    const before = fs.readFileSync(file);
    const result = await service.batchManage({
      action: 'delete',
      ids: [1],
      deletePboot: true,
      confirmed: true,
    });
    expect(result.failed).toBe(1);
    expect(await product(1)).toBeDefined();
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it('refuses a PB record referenced by another unselected local product', async () => {
    await source
      .getRepository(ProductTranslation)
      .update({ productId: 2, lang: 'en' }, { urlName: 'en-rig1' });
    const before = fs.readFileSync(file);
    const result = await service.batchManage({
      action: 'delete',
      ids: [1],
      deletePboot: true,
      confirmed: true,
    });
    expect(result.failed).toBe(1);
    expect(result.results[0].message).toContain('共用');
    expect(await product(1)).toBeDefined();
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it('preserves unknown PB flags but applies explicit true and false on later sync', async () => {
    const original = await product(1);
    jest.spyOn(service, 'preparePbootImage').mockReturnValue('');
    jest.spyOn(service, 'preparePbootContent').mockReturnValue('');
    jest.spyOn(service, 'getPbootExistingRow').mockReturnValue({ id: 11 });
    jest.spyOn(service, 'upsertPbootProductExt').mockImplementation(() => {});
    const writes = jest.spyOn(service, 'runSql').mockImplementation(() => {});
    const content = {
      lang: 'zh-CN',
      title: original.title,
      urlName: original.urlName,
      subtitle: '',
      keywords: '',
      summary: '',
      content: '',
      carouselTitles: [],
    };
    service.upsertPbootProduct(
      {},
      original,
      content,
      'zh-CN',
      { acode: 'cn', scode: '1' },
      directory,
    );
    expect(writes.mock.calls[0][1]).not.toMatch(/istop|isrecommend/);
    writes.mockClear();
    service.upsertPbootProduct(
      {},
      { ...original, isTop: true, isRecommend: false },
      content,
      'zh-CN',
      { acode: 'cn', scode: '1' },
      directory,
    );
    expect(writes.mock.calls[0][1]).toContain('istop=?,isrecommend=?');
    expect((writes.mock.calls[0][2] as unknown[]).slice(-3)).toEqual([
      '1',
      '0',
      11,
    ]);
  });
  it('rolls back local deletion when preserving PB permissions fails', async () => {
    const before = fs.readFileSync(file);
    jest.spyOn(fs, 'fchmodSync').mockImplementation(() => {
      throw Error('EPERM');
    });
    expect(
      (
        await service.batchManage({
          action: 'delete',
          ids: [1],
          deletePboot: true,
          confirmed: true,
        })
      ).failed,
    ).toBe(1);
    expect(await product(1)).toBeDefined();
    expect(
      await source.getRepository(ProductTranslation).countBy({ productId: 1 }),
    ).toBe(2);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['site.db']);
  });
  it('passes the chosen language scope and reports failures without hiding partial results', async () => {
    const sync = jest
      .spyOn(service, 'syncToPboot')
      .mockResolvedValueOnce({ synced: [{ lang: 'en' }], skipped: [] })
      .mockRejectedValueOnce(Error('Missing PB menu'));
    const result = await service.batchManage({
      action: 'sync',
      ids: [1, 2],
      lang: 'en',
      allLanguages: false,
    });
    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    expect(sync).toHaveBeenNthCalledWith(1, 1, { all: false, lang: 'en' });
    await expect(
      service.batchManage({ action: 'sync', ids: [1], lang: 'xx' }),
    ).rejects.toThrow('未在当前网站启用');
  });
  (process.platform === 'win32' ? it.skip : it)(
    'preserves a different PHP owner and rejects concurrent file changes',
    () => {
      if (process.getuid?.() === 0) fs.chownSync(file, 65534, 65534);
      fs.chmodSync(file, 0o660);
      const before = fs.statSync(file),
        original = fs.readFileSync(file);
      replaceBatchDatabase(file, original, original);
      expect(fs.statSync(file)).toMatchObject({
        uid: before.uid,
        gid: before.gid,
        mode: before.mode,
      });
      const changed = Buffer.from('changed');
      fs.writeFileSync(file, changed);
      expect(() => replaceBatchDatabase(file, original, original)).toThrow(
        '已变化',
      );
      expect(fs.readFileSync(file)).toEqual(changed);
    },
  );
});
