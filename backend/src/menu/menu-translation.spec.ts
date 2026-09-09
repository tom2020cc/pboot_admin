import { DataSource, Repository } from 'typeorm';
import { validate } from 'class-validator';
import { Menu } from './entities/menu.entity';
import { MenuService } from './menu.service';
import { TranslateMenuDto } from './dto/translate-menu.dto';
import { assertMenuTranslationQuality } from './menu-translation-quality';

describe('menu translation quality', () => {
  it.each(['id', 'vi', 'tr', 'fr'])('rejects copied or mixed Chinese for %s', acode => {
    expect(() => assertMenuTranslationQuality(['水井钻机'], ['水井钻机'], acode)).toThrow('仍含中文');
    expect(() => assertMenuTranslationQuality(['钻机'], ['Drilling 钻机'], acode)).toThrow('quality check failed');
  });

  it('rejects a long English batch for Vietnamese but not short shared words or models', () => {
    expect(() => assertMenuTranslationQuality(['水井钻机', '岩芯钻机', '履带式水井钻机'], [
      'Water well drilling equipment and drilling machines',
      'Core drilling rigs and drilling equipment',
      'Crawler mounted water well drilling equipment',
    ], 'vi')).toThrow('疑似返回了英文');
    expect(() => assertMenuTranslationQuality(['视频', 'CR1200I'], ['Video', 'CR1200I'], 'vi')).not.toThrow();
    expect(() => assertMenuTranslationQuality(['水井钻机', '岩芯钻机', '履带式水井钻机'], [
      'Máy khoan giếng nước và thiết bị khoan', 'Máy khoan lõi và thiết bị lấy mẫu', 'Máy khoan giếng nước bánh xích',
    ], 'vi')).not.toThrow();
  });

  it.each([
    ['id', ['Rig pengeboran', 'Mesin bor sumur air']],
    ['tr', ['Sondaj makineleri', 'Su kuyusu sondaj makinesi']],
  ])('allows valid %s without requiring accents', (acode: string, values: string[]) => {
    expect(() => assertMenuTranslationQuality(['钻机', '水井钻机'], values, acode)).not.toThrow();
  });

  it('rejects missing values and unsupported language codes', () => {
    expect(() => assertMenuTranslationQuality(['钻机'], [], 'id')).toThrow('不完整');
    expect(() => assertMenuTranslationQuality(['钻机'], [''], 'tr')).toThrow('空值');
    expect(() => assertMenuTranslationQuality(['钻机'], ['Rigs'], 'invalid')).toThrow('不支持');
  });
});

describe('targeted category translation', () => {
  let db: DataSource;
  let repo: Repository<Menu>;
  let service: MenuService;
  let activeSite = 2;
  const names: Record<string, string[]> = {
    id: ['Rig pengeboran', 'Mesin bor sumur air'],
    vi: ['Máy khoan', 'Máy khoan giếng nước'],
    tr: ['Sondaj makineleri', 'Su kuyusu sondaj makinesi'],
  };

  beforeEach(async () => {
    db = await new DataSource({ type: 'sqljs', entities: [Menu], synchronize: true }).initialize();
    repo = db.getRepository(Menu);
    activeSite = 2;
    service = new MenuService(repo, { get: (_key: string, fallback: unknown) => fallback } as any, {} as any, {
      getCurrentSiteId: () => activeSite, isDefaultSite: () => false,
      getCurrentSiteLanguages: async () => ['cn', 'en', 'id', 'vi', 'tr'].map(acode => ({ acode })),
    } as any);
    jest.spyOn(service as any, 'backupLocalSqljsDatabase').mockReturnValue('fixture-backup');
    jest.spyOn(service as any, 'nextPbootCode').mockResolvedValue(1000);
    jest.spyOn(service, 'findTranslationModels').mockReturnValue([
      { value: 'deepseek-chat', provider: 'deepseek', available: true },
      { value: 'google-free', provider: 'google', available: true },
    ] as any);
    // Any accidental unmocked provider call must fail instead of spending real API quota.
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network disabled in test'));
    for (const [index, acode] of ['cn', 'en', 'id', 'vi', 'tr'].entries()) {
      let parentId = 0;
      for (let child = 0; child < 2; child++) {
        const saved = await repo.save(repo.create({
          siteId: 2, name: acode === 'en' ? ['Drilling Rigs', 'Water Well Rigs'][child] : ['钻机', '水井钻机'][child],
          parentId, publisher: 'admin', href: `/${acode}-custom-${child}`, urlName: `${acode}-custom-${child}`,
          code: `pboot:${acode}:${index * 100 + 1 + child}`, model: '3',
          listTemplate: 'unchanged-list.html', detailTemplate: 'unchanged-product.html',
          icon: ['/static/existing.jpg'], thumbnail: '/static/existing.jpg', largeImage: '',
          seoTitle: '', seoKeywords: '', seoDescription: '', show: true, orderNum: child,
        }));
        parentId = Number(saved.id);
      }
    }
    const other = { ...(await repo.find())[0], id: undefined, siteId: 3 };
    await repo.save(repo.create(other));
  });

  afterEach(async () => { await db.destroy(); jest.restoreAllMocks(); });

  it('repairs only the three requested languages, retaining IDs, structure and URLs', async () => {
    const before = await repo.find();
    const translate = jest.spyOn(service as any, 'translateMenuNameList').mockImplementation(
      async (_source, acode: string) => names[acode],
    );
    const result = await service.translateAllFromChinese({ model: 'deepseek-chat', targetAcodes: ['id', 'vi', 'tr'] });
    expect(result.failures).toEqual([]);
    expect(result.results.map(row => row.acode)).toEqual(['id', 'vi', 'tr']);
    expect(translate.mock.calls.map(call => call[1])).toEqual(['id', 'vi', 'tr']);
    const after = await repo.find();
    expect(after).toHaveLength(before.length);
    for (const row of before) {
      const next = after.find(item => item.id === row.id)!;
      const acode = row.code.split(':')[1];
      if (!names[acode] || row.siteId !== 2) expect(next).toEqual(row);
      else {
        expect(next.name).toBe(names[acode][row.parentId === 0 ? 0 : 1]);
        expect(next).toMatchObject({ id: row.id, parentId: row.parentId, code: row.code, href: row.href, urlName: row.urlName, model: row.model, listTemplate: row.listTemplate, detailTemplate: row.detailTemplate });
      }
    }
  });

  it('continues after one language fails and leaves that language untouched', async () => {
    const before = await repo.find();
    jest.spyOn(service as any, 'translateMenuNameList').mockImplementation(async (_source, acode: string) => {
      if (acode === 'id') return ['钻机', '水井钻机'];
      return names[acode];
    });
    const result = await service.translateAllFromChinese({ model: 'deepseek-chat', targetAcodes: ['id', 'vi', 'tr'] });
    expect(result.failures).toEqual([{ acode: 'id', message: expect.stringContaining('仍含中文') }]);
    expect(result.results.map(row => row.acode)).toEqual(['vi', 'tr']);
    expect((await repo.find()).filter(row => row.code.startsWith('pboot:id:'))).toEqual(before.filter(row => row.code.startsWith('pboot:id:')));
  });

  it('retries a bad response through the configured provider fallback', async () => {
    const translate = jest.spyOn(service as any, 'translateMenuNameList').mockImplementation(async (_source, acode: string, model: string) =>
      model === 'deepseek-chat' ? ['钻机', '水井钻机'] : names[acode],
    );
    const result = await service.translateAllFromChinese({ model: 'deepseek-chat', targetAcodes: ['id'] });
    expect(result.failures).toEqual([]);
    expect(result.results[0].model).toBe('google-free');
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('rolls back an entire language if a row cannot be saved', async () => {
    const before = await repo.find();
    jest.spyOn(service as any, 'translateMenuNameList').mockImplementation(async (_source, acode: string) => names[acode]);
    const save = Repository.prototype.save;
    jest.spyOn(Repository.prototype, 'save').mockImplementation(function (this: Repository<Menu>, entity: any, options: any) {
      if (entity.code === 'pboot:id:202') return Promise.reject(new Error('fixture write failed'));
      return save.call(this, entity, options);
    } as any);
    const result = await service.translateAllFromChinese({ model: 'deepseek-chat', targetAcodes: ['id', 'tr'] });
    expect(result.failures[0].message).toContain('fixture write failed');
    expect(result.results[0].acode).toBe('tr');
    expect((await repo.find()).filter(row => row.code.startsWith('pboot:id:'))).toEqual(before.filter(row => row.code.startsWith('pboot:id:')));
  });

  it.each([[], ['cn'], ['xx'], ['id', 'id']])('rejects invalid targets %j without provider calls', async (...args) => {
    const targetAcodes = args.flat() as string[];
    const translate = jest.spyOn(service as any, 'translateMenuNameList');
    await expect(service.translateAllFromChinese({ model: 'deepseek-chat', targetAcodes })).rejects.toThrow();
    expect(translate).not.toHaveBeenCalled();
  });

  it('validates the HTTP DTO target list', async () => {
    for (const targetAcodes of [[], ['cn'], ['xx'], ['id', 'id'], 'id']) {
      expect(await validate(Object.assign(new TranslateMenuDto(), { targetAcodes }))).not.toHaveLength(0);
    }
    expect(await validate(Object.assign(new TranslateMenuDto(), { targetAcodes: ['id', 'vi', 'tr'] }))).toHaveLength(0);
  });

  it.each([['id', 'Indonesian'], ['vi', 'Vietnamese'], ['tr', 'Turkish']])('sends an explicit %s language instruction', (acode, label) => {
    expect((service as any).buildMenuTranslationPrompt(['钻机'], acode)).toContain(`${label} ONLY (language code: ${acode})`);
  });
});
