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

describe('SEO content: isolated durable workflow', () => {
  let db: DataSource,
    service: SeoContentService,
    context: SiteRequestContextService;
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
    await db
      .getRepository(SeoJob)
      .update(job.id, {
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
    service = new SeoContentService(db, sites as any, context, news as any);
    for (const siteId of [1, 2])
      await db
        .getRepository(Menu)
        .save(
          db
            .getRepository(Menu)
            .create({
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
    expect(service.models().map((m) => m.value)).toEqual(['writer']);
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
    service = new SeoContentService(db, sites as any, context, news as any);
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
    await db
      .getRepository(SeoJob)
      .update(job.id, {
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
});
