import { ProductService } from './product.service';

describe('ProductService Chinese SEO optimization', () => {
  const createService = () => new ProductService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('保留人工产品标题并根据详情接收轮播标题', async () => {
    const service = createService();
    jest.spyOn(service, 'findTranslationModels').mockReturnValue([
      { value: 'deepseek-chat', provider: 'deepseek', available: true },
    ] as never);
    const requestSeoOptimization = jest.fn().mockResolvedValue(JSON.stringify({
      title: 'AI 不应覆盖的标题',
      subtitle: '适用于深孔勘探的一体式设备',
      keywords: '岩芯钻机,深孔勘探,履带钻机',
      summary: '用于矿产勘探和地质取样的一体式履带岩芯钻机。',
      urlName: 'crawler-core-drilling-rig',
      content: '<h2>深孔勘探</h2><p>适用于矿产勘探与地质取样。</p>',
      imageAlts: [],
      carouselTitles: ['深孔勘探履带岩芯钻机整机展示', '一体式钻进系统配置展示'],
    }));
    (service as any).requestSeoOptimization = requestSeoOptimization;

    const result = await service.optimizeSeoDraft({
      model: 'deepseek-chat',
      contentType: 'product',
      title: 'CR1200I 1200米一体式履带岩芯钻机',
      subtitle: '',
      keywords: '',
      summary: '',
      urlName: '',
      content: '<h2>深孔勘探</h2><p>适用于矿产勘探与地质取样。</p>',
      carouselTitles: ['', ''],
    });

    expect(result.title).toBe('CR1200I 1200米一体式履带岩芯钻机');
    expect(result.carouselTitles).toEqual([
      '深孔勘探履带岩芯钻机整机展示',
      '一体式钻进系统配置展示',
    ]);
    expect(requestSeoOptimization.mock.calls[0][2]).toContain('结合产品详情 content');
    expect(requestSeoOptimization.mock.calls[0][2]).toContain('不要返回 title');
  });

  it('轮播标题返回不完整时保持数量并保留原值', async () => {
    const service = createService();
    jest.spyOn(service, 'findTranslationModels').mockReturnValue([
      { value: 'deepseek-chat', provider: 'deepseek', available: true },
    ] as never);
    (service as any).requestSeoOptimization = jest.fn().mockResolvedValue(JSON.stringify({
      subtitle: '产品副标题',
      keywords: '工程机械,产品设备',
      summary: '产品描述',
      urlName: 'product-model',
      content: '<p>产品详情</p>',
      imageAlts: [],
      carouselTitles: ['优化后的第一张'],
    }));

    const result = await service.optimizeSeoDraft({
      model: 'deepseek-chat',
      contentType: 'product',
      title: 'MODEL-100 产品设备',
      content: '<p>产品详情</p>',
      carouselTitles: ['原第一张', '原第二张'],
    });

    expect(result.carouselTitles).toEqual(['优化后的第一张', '原第二张']);
  });

  it('批量翻译时把中文或错误语言 URL 改为目标语言前缀', () => {
    const service = createService();
    const pickUrl = (service as any).pickMenuTranslationUrl.bind(service);

    expect(pickUrl('cn-cr1200i-core-drill', 'cn-cr1200i-core-drill', 'en', 193, 'CR1200I Core Drilling Rig'))
      .toBe('en-cr1200i-core-drilling-rig');
    expect(pickUrl('es-cr1200i', 'cn-cr1200i', 'fr', 193, 'Foreuse carottiere CR1200I'))
      .toBe('fr-foreuse-carottiere-cr1200i');
    expect(pickUrl('fr-url-personnalisee', 'cn-cr1200i', 'fr', 193, 'Foreuse CR1200I'))
      .toBe('fr-url-personnalisee');
  });
});
