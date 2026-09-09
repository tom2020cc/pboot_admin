import { ConfigService } from '@nestjs/config';
import { MenuService } from './menu.service';

describe('MenuService', () => {
  it('creates a complete target-language tree when the target menus do not exist', async () => {
    const stored: any[] = [
      { id: '1', siteId: 2, name: '钻机', parentId: 0, publisher: 'admin', href: '/Drilling-Rigs', code: 'pboot:cn:1', urlName: 'Drilling-Rigs', model: '1', listTemplate: 'list.html', detailTemplate: 'content.html', icon: [], show: true, orderNum: 1 },
      { id: '5', siteId: 2, name: '水井钻机', parentId: 1, publisher: 'admin', href: '/Water-well-drilling-rig', code: 'pboot:cn:5', urlName: 'Water-well-drilling-rig', model: '1', listTemplate: 'list.html', detailTemplate: 'content.html', icon: [], show: true, orderNum: 1 },
      { id: '15', siteId: 2, name: '履带式水井钻机', parentId: 5, publisher: 'admin', href: '/Crawler-Water-Well-Drilling-Rig', code: 'pboot:cn:15', urlName: 'Crawler-Water-Well-Drilling-Rig', model: '1', listTemplate: 'list.html', detailTemplate: 'content.html', icon: [], show: true, orderNum: 1 },
    ];
    let nextId = 100;
    stored.forEach((menu) => Object.assign(menu, { thumbnail: '', largeImage: '', seoTitle: '', seoKeywords: '', seoDescription: '' }));
    const menusRepo: any = {
      find: jest.fn(async ({ where }: any) => stored.filter((menu) => menu.siteId === where.siteId)),
      countBy: jest.fn(async ({ siteId }: any) => stored.filter((menu) => menu.siteId === siteId).length),
      update: jest.fn(),
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => {
        if (!value.id) value.id = String(nextId++);
        const index = stored.findIndex((item) => String(item.id) === String(value.id));
        if (index >= 0) stored[index] = value;
        else stored.push(value);
        return value;
      }),
    };
    menusRepo.manager = { transaction: (work: any) => work({ getRepository: () => menusRepo }) };
    const config = {
      get: jest.fn((key: string, fallback?: string) => key === 'DEEPSEEK_API_KEY' ? 'test-key' : fallback),
    } as unknown as ConfigService;
    const sitesService: any = {
      getCurrentSiteId: () => 2,
      isDefaultSite: () => false,
      getCurrentSiteLanguages: async () => [
        { acode: 'cn', code: 'zh-CN', name: '中文' },
        { acode: 'en', code: 'en', name: 'English' },
      ],
    };
    const service = new MenuService(menusRepo, config, {} as any, sitesService);
    jest.spyOn(service as any, 'nextPbootCode').mockResolvedValue(16);
    jest.spyOn(service as any, 'backupLocalSqljsDatabase').mockReturnValue('');
    jest.spyOn(service as any, 'translateMenuNameListWithFallback').mockResolvedValue({
      names: ['Drilling Rigs', 'Water Well Drilling Rigs', 'Crawler Water Well Drilling Rigs'],
      model: 'deepseek-chat',
    });

    const result = await service.translateAllFromChinese({ model: 'deepseek-chat' });
    const english = stored.filter((menu) => String(menu.code).startsWith('pboot:en:'));

    expect(result.results).toEqual([
      expect.objectContaining({ acode: 'en', created: 3, updated: 0, skipped: 0, translated: 3 }),
    ]);
    expect(english).toHaveLength(3);
    expect(english.map((menu) => menu.code)).toEqual(['pboot:en:16', 'pboot:en:17', 'pboot:en:18']);
    expect(english.map((menu) => menu.sourceMenuId)).toEqual([1, 5, 15]);
    expect(english[0].parentId).toBe(0);
    expect(english[1].parentId).toBe(Number(english[0].id));
    expect(english[2].parentId).toBe(Number(english[1].id));
    expect(english[2]).toMatchObject({
      href: '/en-crawler-water-well-drilling-rig',
      listTemplate: 'list.html',
      detailTemplate: 'content.html',
    });
  });
});
