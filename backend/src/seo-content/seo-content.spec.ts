import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Menu } from '../menu/entities/menu.entity';
import { News } from '../news/entities/news.entity';
import { NewsTranslation } from '../news/entities/news-translation.entity';
import { SiteRequestContextService } from '../sites/site-request-context.service';
import {
  ArticleDraft,
  defaultPlan,
  SeoControl,
  SeoJob,
  SeoPlan,
  SeoSource,
} from './seo-content.entity';
import {
  checkDraft,
  cleanDraft,
  SeoContentService,
  validateSourceUrl,
} from './seo-content.service';
import { SeoWorkerGuard } from './seo-worker.controller';
import { SavePlanDto } from './seo-content.dto';
import { Product } from '../product/entities/product.entity';
import { ProductTranslation } from '../product/entities/product-translation.entity';

describe('SEO content: isolated durable workflow', () => {
  let db: DataSource,
    service: SeoContentService,
    context: SiteRequestContextService,
    config: ConfigService;
  const sites = { findAll: jest.fn(), getCurrentSite: jest.fn() };
  const news = { findTranslationModels: jest.fn(), syncToPboot: jest.fn() };
  const draft: ArticleDraft = {
    title: '岩芯钻机选型资料',
    subtitle: '依据已核实资料',
    keywords: '岩芯钻机,选型',
    summary: '根据资料整理选型注意事项。',
    content: '<h2>型号选择</h2><p>请结合实际需求确认配置。</p>',
  };
  function at<T>(site: number | undefined, work: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) =>
      context.run(site, () => {
        work().then(resolve, reject);
      }),
    );
  }
  async function enable(siteId = 1) {
    await at(siteId, async () => {
      const plan = (await service.state()).plan;
      await service.savePlan({
        revision: plan.revision,
        config: {
          ...defaultPlan(),
          industry: siteId === 1 ? '钻机' : '挖掘机',
          keywords: ['钻机'],
          model: 'writer',
          menuId: siteId * 10,
          dailyLimit: 10,
          feeds: ['https://example.com/feed.xml'],
        },
      });
      await service.switchSite(true);
      await service.switchGlobal(true);
    });
  }
  async function queueDraft(site = 1) {
    return at(site, async () => {
      const source = await service.saveSource({
        title: `已核实选题${Math.random()}`,
        url: '',
        notes: '真实型号参数，不编造事实',
        verified: true,
      });
      return service.queue({ kind: 'generate', sourceId: source.id });
    });
  }
  async function finishDraft(site = 1) {
    const queued = await queueDraft(site);
    const leased = await service.claim();
    expect(leased!.id).toBe(queued.id);
    await service.complete(leased!.id, {
      leaseToken: leased!.leaseToken,
      draft,
      tokens: 123,
    });
    return (await db.getRepository(SeoJob).findOneBy({ id: queued.id }))!;
  }
  async function scheduleJob(job: SeoJob) {
    await at(job.siteId, () =>
      service.schedule(job.id, {
        revision: job.revision,
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
      }),
    );
    await db.getRepository(SeoJob).update(job.id, {
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
    });
    return (await service.claim())!;
  }
  beforeEach(async () => {
    db = new DataSource({
      type: 'sqljs',
      entities: [
        SeoPlan,
        SeoControl,
        SeoSource,
        SeoJob,
        Menu,
        News,
        NewsTranslation,
        Product,
        ProductTranslation,
      ],
      synchronize: true,
    });
    await db.initialize();
    context = new SiteRequestContextService();
    sites.findAll.mockResolvedValue([
      { id: 1, enabled: true },
      { id: 2, enabled: true },
    ]);
    sites.getCurrentSite.mockImplementation(() => ({
      id: context.getSiteId() === 2 ? 2 : 1,
      enabled: true,
    }));
    news.findTranslationModels.mockReturnValue([
      {
        value: 'writer',
        label: 'Writer',
        provider: 'deepseek',
        available: true,
      },
      { value: 'google-free', provider: 'google', available: true },
      { value: 'qwen-mt-lite', provider: 'qwen', available: true },
    ]);
    news.syncToPboot.mockReset();
    news.syncToPboot.mockImplementation(async (_id, _options, beforeWrite) => {
      await beforeWrite();
      return { synced: [{ lang: 'zh-CN' }] };
    });
    config = new ConfigService({
      SEO_WORKER_TOKEN: 'x'.repeat(40),
      BRAVE_SEARCH_API_KEY: '',
    });
    config.set('BRAVE_SEARCH_API_KEY', '');
    service = new SeoContentService(
      db,
      sites as any,
      context,
      news as any,
      config,
    );
    for (const siteId of [1, 2])
      await db.getRepository(Menu).save(
        db.getRepository(Menu).create({
          id: String(siteId * 10),
          siteId,
          name: '中文新闻',
          parentId: 0,
          publisher: 'test',
          href: '/news',
          code: `pboot:cn:${siteId * 10}`,
          model: '2',
          show: true,
          orderNum: 0,
        }),
      );
  });
  afterEach(async () => db.destroy());
  it('defaults off and rejects missing/invalid site instead of fallback', async () => {
    await expect(at(undefined, () => service.state())).rejects.toThrow(
      '明确选择',
    );
    await expect(at(99, () => service.state())).rejects.toThrow('明确选择');
    const state = await at(1, () => service.state());
    expect(state.plan.enabled).toBe(false);
    expect(state.control.paused).toBe(true);
    await expect(
      at(1, () => service.queue({ kind: 'collect' })),
    ).rejects.toThrow('关闭');
    expect(service.models().map((m) => m.value)).toEqual([
      'writer',
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ]);
    expect(await service.claim()).toBeNull();
  });
  it('validates nested configuration and rejects stale revisions and foreign menus', async () => {
    expect(
      (await validate(plainToInstance(SavePlanDto, { revision: 0 }))).length,
    ).toBeGreaterThan(0);
    await expect(
      at(1, () =>
        service.savePlan({
          revision: 0,
          config: { ...defaultPlan(), menuId: 20 },
        }),
      ),
    ).rejects.toThrow('当前网站');
    await enable();
    await expect(
      at(1, () => service.savePlan({ revision: 0, config: defaultPlan() })),
    ).rejects.toThrow('已更新');
  });
  it('isolates source identity, queries, edits and job access', async () => {
    await enable();
    await enable(2);
    const input = {
      title: '选型标题',
      url: 'https://example.com/article',
      notes: '已核实',
      verified: true,
    };
    const source = await at(1, () => service.saveSource(input));
    await expect(at(1, () => service.saveSource(input))).rejects.toThrow(
      '已收录',
    );
    await at(2, () => service.saveSource(input));
    await expect(
      at(2, () => service.saveSource(input, source.id)),
    ).rejects.toThrow('没有此素材');
    await expect(
      at(2, () => service.queue({ kind: 'generate', sourceId: source.id })),
    ).rejects.toThrow('没有可用');
    const job = await at(1, () =>
      service.queue({ kind: 'generate', sourceId: source.id }),
    );
    expect((await at(2, () => service.state())).jobs).toEqual([]);
    await expect(at(2, () => service.cancel(job.id))).rejects.toThrow(
      '没有此任务',
    );
  });
  it('requires verified notes, rejects repeated topics and caps daily requests', async () => {
    await enable();
    const source = await at(1, () =>
      service.saveSource({
        title: '钻机',
        url: '',
        notes: '',
        verified: false,
      }),
    );
    await expect(
      at(1, () => service.queue({ kind: 'generate', sourceId: source.id })),
    ).rejects.toThrow('没有可用');
    await expect(
      at(1, () => service.saveSource({ ...source, verified: true })),
    ).rejects.toThrow('事实资料');
    const job = await finishDraft();
    await expect(
      at(1, () =>
        service.queue({ kind: 'generate', sourceId: job.snapshot.source!.id }),
      ),
    ).rejects.toThrow('已有写作任务');
    const plan = (await at(1, () => service.state())).plan;
    await at(1, () =>
      service.savePlan({
        revision: plan.revision,
        config: { ...plan.config, dailyLimit: 1 },
      }),
    );
    await expect(queueDraft()).rejects.toThrow('今日');
  });
  it('single claims survive service restarts, reject duplicate completion, and strip scripts/images', async () => {
    await enable();
    await queueDraft();
    const claims = await Promise.all([service.claim(), service.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const job = claims.find(Boolean)!;
    service = new SeoContentService(
      db,
      sites as any,
      context,
      news as any,
      config,
    );
    const data = {
      leaseToken: job.leaseToken,
      draft: {
        ...draft,
        content:
          '<script>bad()</script><img src="http://localhost"><p onclick="bad()">中文正文</p>',
      },
    };
    await service.complete(job.id, data);
    await expect(service.complete(job.id, data)).rejects.toThrow('租约');
    const state = await at(1, () => service.state());
    expect(state.jobs[0].draft!.content).toBe('<p>中文正文</p>');
    expect(state.jobs[0]).not.toHaveProperty('leaseToken');
    expect(news.syncToPboot).not.toHaveBeenCalled();
  });
  it('closing one site pauses its queue and retracts schedules without affecting other sites', async () => {
    await enable();
    await enable(2);
    const job = await finishDraft();
    await at(1, () =>
      service.schedule(job.id, {
        revision: job.revision,
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
      }),
    );
    const queued = await at(1, () => service.queue({ kind: 'collect' }));
    await at(1, () => service.switchSite(false));
    expect(
      (await db.getRepository(SeoJob).findOneBy({ id: job.id }))!.status,
    ).toBe('draft');
    expect(
      (await db.getRepository(SeoJob).findOneBy({ id: queued.id }))!.status,
    ).toBe('paused');
    expect((await at(2, () => service.state())).plan.enabled).toBe(true);
    await at(1, () => service.switchSite(true));
    expect(await service.claim()).toBeNull();
  });
  it('expired generation leases fail rather than silently charge again', async () => {
    await enable();
    await queueDraft();
    const job = (await service.claim())!;
    await db
      .getRepository(SeoJob)
      .update(job.id, { leaseUntil: new Date(0).toISOString() });
    expect(await service.claim()).toBeNull();
    expect(
      (await db.getRepository(SeoJob).findOneBy({ id: job.id }))!.status,
    ).toBe('failed');
    await expect(
      service.complete(job.id, { leaseToken: job.leaseToken, draft }),
    ).rejects.toThrow('租约');
  });
  it('stores collected titles as unverified, filtered and deduplicated per site', async () => {
    await enable();
    await at(1, () => service.queue({ kind: 'collect' }));
    const job = (await service.claim())!;
    const item = {
      title: '钻机选型',
      url: 'https://example.com/rig',
      publishedAt: '',
    };
    await service.complete(job.id, {
      leaseToken: job.leaseToken,
      sources: [
        item,
        item,
        { ...item, title: '无关标题', url: 'https://example.com/other' },
      ],
    });
    const sources = (await at(1, () => service.state())).sources;
    expect(sources).toHaveLength(1);
    expect(sources[0].verified).toBe(false);
    expect(sources[0].notes).toBe('');
  });
  it('publishes only approved CN to the original site with a stable local news record', async () => {
    await enable();
    const job = await finishDraft();
    const lease = await scheduleJob(job);
    await at(2, () => service.publish(lease.id, lease.leaseToken));
    const saved = (await db.getRepository(SeoJob).findOneBy({ id: job.id }))!;
    expect(saved.status).toBe('published');
    expect(saved.newsId).toBeGreaterThan(0);
    expect(news.syncToPboot.mock.calls[0][1]).toEqual({
      lang: 'zh-CN',
      all: false,
    });
    expect(
      (await db.getRepository(News).findOneBy({ id: saved.newsId }))!.siteId,
    ).toBe(1);
    expect(
      (await db.getRepository(NewsTranslation).find()).map((t) => t.lang),
    ).toEqual(['zh-CN']);
    await expect(service.publish(lease.id, lease.leaseToken)).rejects.toThrow(
      '租约',
    );
  });
  it('rechecks switch immediately before PB commit, even when toggled back on', async () => {
    await enable();
    const lease = await scheduleJob(await finishDraft());
    let committed = false;
    news.syncToPboot.mockImplementation(async (_id, _options, beforeWrite) => {
      await at(1, () => service.switchSite(false));
      await at(1, () => service.switchSite(true));
      await beforeWrite();
      committed = true;
    });
    await expect(service.publish(lease.id, lease.leaseToken)).rejects.toThrow();
    expect(committed).toBe(false);
    expect(
      (await db.getRepository(SeoJob).findOneBy({ id: lease.id }))!.status,
    ).toBe('uncertain');
  });
  it('fails closed on removed sites and never backfills overdue publications', async () => {
    await enable();
    const job = await finishDraft();
    await at(1, () =>
      service.schedule(job.id, {
        revision: job.revision,
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
      }),
    );
    await db.getRepository(SeoJob).update(job.id, {
      scheduledAt: new Date(Date.now() - 7200000).toISOString(),
    });
    expect(await service.claim()).toBeNull();
    expect(
      (await db.getRepository(SeoJob).findOneBy({ id: job.id }))!.status,
    ).toBe('draft');
    await queueDraft();
    sites.findAll.mockResolvedValue([{ id: 1, enabled: false }]);
    expect(await service.claim()).toBeNull();
  });
  it('validates source protocols and minimal Chinese draft checks', () => {
    for (const url of [
      'http://example.com',
      'file:///tmp/x',
      'https://user:pass@example.com',
      'https://example.com:8443',
    ])
      expect(() => validateSourceUrl(url)).toThrow();
    expect(checkDraft(draft)).toEqual([]);
    expect(checkDraft(null)).not.toHaveLength(0);
    expect(
      cleanDraft({ ...draft, title: '<script>bad</script>中文' }).title,
    ).toBe('中文');
  });
  it('worker credentials are mandatory, scoped to separate routes and constant time compared', () => {
    const ctx = (token: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ headers: { 'x-seo-worker-token': token } }),
        }),
      }) as any;
    expect(() =>
      new SeoWorkerGuard(new ConfigService()).canActivate(ctx('')),
    ).toThrow();
    const guard = new SeoWorkerGuard(
      new ConfigService({ SEO_WORKER_TOKEN: 'x'.repeat(40) }),
    );
    expect(() => guard.canActivate(ctx('y'.repeat(40)))).toThrow();
    expect(guard.canActivate(ctx('x'.repeat(40)))).toBe(true);
  });
  it('search defaults off, requires credentials and rotates bounded site-specific queries', async () => {
    await enable();
    let plan = (await at(1, () => service.state())).plan;
    expect(plan.config.searchEnabled).toBe(false);
    const search = {
      ...plan.config,
      searchEnabled: true,
      keywords: ['钻机', '岩芯', '水井', '设备'],
      feeds: [],
      dailyCollectLimit: 2,
      searchProvider: 'brave' as const,
      dailySearchLimit: 6,
    };
    await expect(
      at(1, () =>
        service.savePlan({ revision: plan.revision, config: search }),
      ),
    ).rejects.toThrow('BRAVE_SEARCH_API_KEY');
    config.set('BRAVE_SEARCH_API_KEY', 'fixture-not-a-real-key');
    await at(1, () =>
      service.savePlan({ revision: plan.revision, config: search }),
    );
    const first = await at(1, () => service.queue({ kind: 'collect' }));
    expect(first.snapshot.searchKeywords).toEqual(['钻机', '岩芯', '水井']);
    expect(JSON.stringify(first)).not.toContain('fixture-not-a-real-key');
    const lease = (await service.claim())!;
    await service.complete(lease.id, {
      leaseToken: lease.leaseToken,
      sources: [],
      warnings: ['SEARCH_HTTP_429', 'https://secret.invalid'],
    });
    const second = await at(1, () => service.queue({ kind: 'collect' }));
    expect(second.snapshot.searchKeywords).toEqual(['设备', '钻机', '岩芯']);
    await at(1, () => service.cancel(second.id));
    await expect(
      at(1, () => service.queue({ kind: 'collect' })),
    ).rejects.toThrow('采集任务上限');
    const state = await at(1, () => service.state());
    expect(state.usage.collectToday).toBe(2);
    expect(state.jobs.find((j) => j.id === first.id)!.error).toBe(
      'SEARCH_HTTP_429',
    );
    expect((await at(2, () => service.state())).usage.collectToday).toBe(0);
    expect((await at(2, () => service.state())).plan.config.searchEnabled).toBe(
      false,
    );
  });
  it('quality checks reject duplicates within the site, prefer CN text and do not leak other sites', async () => {
    await enable();
    const job = await finishDraft();
    const other = await db.getRepository(News).save(
      db.getRepository(News).create({
        siteId: 2,
        menuId: 20,
        title: draft.title,
        content: draft.content,
      }),
    );
    const report = await at(1, () =>
      service.check(job.id, { revision: job.revision, draft }),
    );
    expect(report.issues).toEqual([]);
    expect(report.stats.comparedCount).toBe(0);
    await expect(
      at(2, () => service.check(job.id, { revision: job.revision, draft })),
    ).rejects.toThrow('没有此任务');
    await db
      .getRepository(News)
      .update(other.id, { siteId: 1, title: 'Not the Chinese title' });
    await db.getRepository(NewsTranslation).save(
      db.getRepository(NewsTranslation).create({
        newsId: other.id,
        lang: 'zh-CN',
        title: draft.title,
        content: draft.content,
      }),
    );
    expect(
      (
        await at(1, () =>
          service.check(job.id, { revision: job.revision, draft }),
        )
      ).issues.join(),
    ).toContain('标题重复');
    await expect(scheduleJob(job)).rejects.toThrow('标题重复');
    expect(news.syncToPboot).not.toHaveBeenCalled();
  });
  it('normalizes legacy plans without a data migration and provides read-only health', async () => {
    const legacy = defaultPlan();
    delete legacy.searchEnabled;
    delete legacy.dailyCollectLimit;
    await db.getRepository(SeoPlan).save({ siteId: 1, config: legacy });
    expect(
      (await at(1, () => service.state())).plan.config.dailyCollectLimit,
    ).toBe(4);
    expect(
      (await db.getRepository(SeoPlan).findOneBy({ siteId: 1 }))!.config,
    ).not.toHaveProperty('dailyCollectLimit');
    expect(await service.workerHealth()).toMatchObject({
      ok: true,
      paused: true,
      protocol: 2,
    });
    expect(await db.getRepository(SeoControl).count()).toBe(0);
    expect(await db.getRepository(SeoJob).count()).toBe(0);
  });
  it('uses DeepSeek without Brave and snapshots versioned rules while limiting searches and retries', async () => {
    await enable();
    const plan = (await at(1, () => service.state())).plan;
    await at(1, () =>
      service.savePlan({
        revision: plan.revision,
        config: {
          ...plan.config,
          searchEnabled: true,
          searchProvider: 'deepseek',
          dailySearchLimit: 1,
          feeds: [],
        },
      }),
    );
    const queued = await at(1, () => service.queue({ kind: 'collect' }));
    expect(queued.snapshot.editorial!.rules).toHaveLength(5);
    expect(queued.snapshot.editorial!.version).toMatch(/^[0-9a-f]{16}$/);
    const lease = (await service.claim())!;
    await service.fail(lease.id, lease.leaseToken, 'SEARCH_HTTP_429');
    await expect(at(1, () => service.retry(lease.id))).rejects.toThrow(
      '搜索请求上限',
    );
    await expect(
      at(1, () => service.queue({ kind: 'collect' })),
    ).rejects.toThrow('搜索请求上限');
    const state = await at(1, () => service.state());
    expect(state.integrations.deepseekConfigured).toBe(true);
    expect(state.integrations.braveConfigured).toBe(false);
    expect(state.usage.searchToday).toBe(1);
    expect(state.sources).toHaveLength(0);
  });
  it('stores research text as unverified and never replaces edited or verified material on repeated collection', async () => {
    await enable();
    const original = await at(1, () =>
      service.saveSource({
        title: '钻机旧资料',
        url: 'https://example.com/existing',
        notes: '人工核实内容',
        verified: true,
      }),
    );
    await at(1, () => service.queue({ kind: 'collect' }));
    const lease = (await service.claim())!;
    await service.complete(lease.id, {
      leaseToken: lease.leaseToken,
      tokens: 50,
      sources: [
        {
          title: '钻机新资料',
          url: 'https://example.com/new',
          publishedAt: '',
          notes: '<p>待核实的文字摘要</p><img src="https://example.com/a.jpg">',
        },
        {
          title: original.title,
          url: original.url,
          publishedAt: '',
          notes: '不要覆盖原来的笔记',
        },
      ],
    });
    const sources = (await at(1, () => service.state())).sources;
    expect(sources.find((s) => s.id === original.id)!.notes).toBe(
      '人工核实内容',
    );
    const added = sources.find((s) => s.url.endsWith('new'))!;
    expect(added.notes).toBe('待核实的文字摘要');
    expect(added.verified).toBe(false);
    await expect(
      at(1, () => service.queue({ kind: 'generate', sourceId: added.id })),
    ).rejects.toThrow('已核实素材');
  });
  it('only snapshots explicitly selected products belonging to the active site, never their media', async () => {
    await enable();
    const product = await db.getRepository(Product).save({
      siteId: 1,
      menuId: 10,
      title: 'CR600P',
      content: '<p>钻探深度600m</p><img src="/static/private.jpg">',
      largeImage: '/private.jpg',
    });
    const foreign = await db
      .getRepository(Product)
      .save({ siteId: 2, menuId: 20, title: '秘密的其他站点型号' });
    const plan = (await at(1, () => service.state())).plan;
    await expect(
      at(1, () =>
        service.savePlan({
          revision: plan.revision,
          config: { ...plan.config, productIds: [foreign.id] },
        }),
      ),
    ).rejects.toThrow('不属于当前网站');
    await at(1, () =>
      service.savePlan({
        revision: plan.revision,
        config: {
          ...plan.config,
          productIds: [product.id],
          knowledge: '本站已核实知识',
        },
      }),
    );
    const job = await queueDraft();
    expect(job.snapshot.products![0].text).toBe('钻探深度600m');
    expect(JSON.stringify(job.snapshot)).not.toMatch(
      /private\.jpg|秘密的其他站点/,
    );
    expect(job.snapshot.knowledge).toBe('本站已核实知识');
  });
  async function updateDraft() {
    await enable();
    const article = await db.getRepository(News).save({
      siteId: 1,
      menuId: 10,
      title: '钻机旧文',
      urlName: 'cn-original',
      summary: '原始摘要',
      content:
        '<p>原文内容</p><img src="/static/keep.jpg" alt="已有图片"><p>原文结尾</p>',
      thumbnail: '/static/thumb.jpg',
    });
    await db.getRepository(NewsTranslation).save({
      newsId: article.id,
      lang: 'en',
      title: 'English original',
      content: '<p>Do not change</p>',
      urlName: 'en-original',
    });
    const source = await at(1, () =>
      service.saveSource({
        title: '钻机新事实',
        url: '',
        notes: '核实后的新资料',
        verified: true,
      }),
    );
    const queued = await at(1, () =>
      service.queue({
        kind: 'generate',
        sourceId: source.id,
        newsId: article.id,
      }),
    );
    const lease = (await service.claim())!;
    const proposed = {
      ...draft,
      title: '钻机旧文',
      content: '<p>新的实质内容</p><p>[[SEO_MEDIA_1]]</p><p>补充核实资料</p>',
    };
    await service.complete(lease.id, {
      leaseToken: lease.leaseToken,
      draft: proposed,
    });
    return {
      article,
      source,
      proposed,
      job: (await db.getRepository(SeoJob).findOneBy({ id: queued.id }))!,
    };
  }
  it('updates the same CN article and URL only after review, retaining media, publication date and history', async () => {
    const { article, job, proposed } = await updateDraft();
    expect(job.snapshot.previous!.draft.content).toContain('[[SEO_MEDIA_1]]');
    expect(job.snapshot.previous!.draft.content).not.toContain('<img');
    expect(
      (await db.getRepository(News).findOneBy({ id: article.id }))!.content,
    ).toBe(article.content);
    const report = await at(1, () =>
      service.check(job.id, { revision: job.revision, draft: proposed }),
    );
    expect(report.issues).toEqual([]);
    const lease = await scheduleJob(job);
    await service.publish(lease.id, lease.leaseToken);
    const updated = (await db
      .getRepository(News)
      .findOneBy({ id: article.id }))!;
    expect(updated.id).toBe(article.id);
    expect(updated.urlName).toBe('cn-original');
    expect(updated.content).toContain(
      '<img src="/static/keep.jpg" alt="已有图片"',
    );
    expect(updated.content).toContain('新的实质内容');
    expect(updated.thumbnail).toBe(article.thumbnail);
    expect(news.syncToPboot.mock.calls[0][3]).toBe(true);
    expect(updated.createTime).toEqual(article.createTime);
    const en = (await db
      .getRepository(NewsTranslation)
      .findOneBy({ newsId: article.id, lang: 'en' }))!;
    expect(en.content).toBe('<p>Do not change</p>');
    expect(
      (await at(1, () => service.history(article.id)))[0].snapshot.previous!
        .draft.title,
    ).toBe('钻机旧文');
    await expect(at(2, () => service.history(article.id))).rejects.toThrow(
      '当前网站',
    );
    expect(await db.getRepository(News).count()).toBe(1);
  });
  it('blocks missing media, unchanged body, revoked source and stale original before scheduling', async () => {
    const { article, source, job, proposed } = await updateDraft();
    const inspect = (value: ArticleDraft) =>
      at(1, () =>
        service.check(job.id, { revision: job.revision, draft: value }),
      );
    expect(
      (
        await inspect({ ...proposed, content: '<p>删除图片</p>' })
      ).issues.join(),
    ).toContain('占位符');
    expect(
      (
        await inspect({
          ...proposed,
          content: job.snapshot.previous!.draft.content,
        })
      ).issues.join(),
    ).toContain('实质变化');
    await db.getRepository(SeoSource).update(source.id, { verified: false });
    expect((await inspect(proposed)).issues.join()).toContain('撤销核实');
    await db.getRepository(SeoSource).update(source.id, { verified: true });
    await db
      .getRepository(News)
      .update(article.id, { content: '<p>新的人工修改</p>' });
    await expect(scheduleJob(job)).rejects.toThrow('原文已被修改');
    expect(news.syncToPboot).not.toHaveBeenCalled();
  });
  it('does not flag previous publications of the same article as duplicate titles on later updates', async () => {
    const { article, source, job, proposed } = await updateDraft();
    const publishLease = await scheduleJob(job);
    await service.publish(publishLease.id, publishLease.leaseToken);
    const queued = await at(1, () =>
      service.queue({
        kind: 'generate',
        sourceId: source.id,
        newsId: article.id,
      }),
    );
    const lease = (await service.claim())!;
    const nextDraft = {
      ...proposed,
      content: '<p>进一步补充经过核实的钻机选型资料</p><p>[[SEO_MEDIA_1]]</p>',
    };
    await service.complete(lease.id, {
      leaseToken: lease.leaseToken,
      draft: nextDraft,
    });
    const updatedJob = (await db
      .getRepository(SeoJob)
      .findOneBy({ id: queued.id }))!;
    const report = await at(1, () =>
      service.check(updatedJob.id, {
        revision: updatedJob.revision,
        draft: nextDraft,
      }),
    );
    expect(report.issues).toEqual([]);
    expect(report.stats.comparedCount).toBe(0);
  });
  it('refuses complex media instead of silently removing it during a text update', async () => {
    const { article, source, job } = await updateDraft();
    await at(1, () => service.cancel(job.id));
    await db.getRepository(News).update(article.id, {
      content:
        '<p>钻机资料</p><picture><source srcset="/large.webp"><img src="/keep.jpg"></picture>',
    });
    await expect(
      at(1, () =>
        service.queue({
          kind: 'generate',
          sourceId: source.id,
          newsId: article.id,
        }),
      ),
    ).rejects.toThrow('复杂图片');
    expect(news.syncToPboot).not.toHaveBeenCalled();
  });
  it('rechecks original immediately before publication and does not overwrite edits made after scheduling', async () => {
    const { article, job } = await updateDraft();
    const lease = await scheduleJob(job);
    await db
      .getRepository(News)
      .update(article.id, { title: '排期后人工改名' });
    await expect(service.publish(lease.id, lease.leaseToken)).rejects.toThrow(
      '草稿检查',
    );
    expect(
      (await db.getRepository(News).findOneBy({ id: article.id }))!.title,
    ).toBe('排期后人工改名');
    expect(news.syncToPboot).not.toHaveBeenCalled();
  });
});
