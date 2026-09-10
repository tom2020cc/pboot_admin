import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ComparisonArticle, inspectQuality } from './quality';
import { createHash, randomUUID } from 'crypto';
import { SitesService } from '../sites/sites.service';
import { SiteRequestContextService } from '../sites/site-request-context.service';
import { Menu } from '../menu/entities/menu.entity';
import { News } from '../news/entities/news.entity';
import { NewsTranslation } from '../news/entities/news-translation.entity';
import { NewsService } from '../news/news.service';
import { Product } from '../product/entities/product.entity';
import { ProductTranslation } from '../product/entities/product-translation.entity';
import {
  loadEditorialRules,
  plainText,
  maskMedia,
  mediaIssues,
  restoreMedia,
} from './editorial';
import {
  ArticleDraft,
  defaultPlan,
  PlanConfig,
  SeoControl,
  SeoJob,
  SeoPlan,
  SeoSource,
} from './seo-content.entity';
import {
  CompleteJobDto,
  QueueDto,
  SaveDraftDto,
  SavePlanDto,
  ScheduleDto,
  SourceDto,
} from './seo-content.dto';
const sanitize = require('sanitize-html');
const iso = () => new Date().toISOString();
const later = (hours: number) =>
  new Date(Date.now() + hours * 3600000).toISOString();
export function cleanDraft(input: ArticleDraft): ArticleDraft {
  const plain = (s: string) =>
    sanitize(String(s || ''), {
      allowedTags: [],
      allowedAttributes: {},
    }).trim();
  return {
    title: plain(input.title).slice(0, 120),
    subtitle: plain(input.subtitle).slice(0, 200),
    keywords: plain(input.keywords).slice(0, 250),
    summary: plain(input.summary).slice(0, 1000),
    content: sanitize(String(input.content || ''), {
      allowedTags: [
        'p',
        'h2',
        'h3',
        'ul',
        'ol',
        'li',
        'strong',
        'em',
        'blockquote',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'br',
      ],
      allowedAttributes: {},
    }),
  };
}
export function checkDraft(input: ArticleDraft | null) {
  if (!input) return ['尚无正文'];
  const problems: string[] = [];
  if (!input.title.trim()) problems.push('标题为空');
  if (!input.summary.trim()) problems.push('SEO 描述为空');
  if (!input.keywords.trim()) problems.push('关键词为空');
  const text = sanitize(input.content, {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
  if (!text) problems.push('正文为空');
  if (!/[\u3400-\u9fff]/u.test(input.title + text))
    problems.push('不是中文草稿');
  return problems;
}
export function sourceFingerprint(title: string, url: string) {
  return createHash('sha256')
    .update((url || title).trim().toLowerCase())
    .digest('hex');
}
export function validateSourceUrl(value: string, required = false) {
  if (!value && !required) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('来源必须是完整 HTTPS 地址');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new BadRequestException('来源仅允许无凭据的 HTTPS 443 地址');
}

@Injectable()
export class SeoContentService {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly db: DataSource,
    private readonly sites: SitesService,
    private readonly context: SiteRequestContextService,
    private readonly news: NewsService,
    private readonly config: ConfigService,
  ) {}
  // One API process owns sql.js. Serialize workflow transitions, not external calls.
  private lock<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work, work);
    this.pending = result.catch(() => undefined);
    return result;
  }
  private siteId() {
    const id = this.context.getSiteId();
    if (
      !id ||
      this.sites.getCurrentSite().id !== id ||
      !this.sites.getCurrentSite().enabled
    )
      throw new BadRequestException('请明确选择一个已启用的网站');
    return id;
  }
  private async validSite(id: number) {
    return (await this.sites.findAll()).some((s) => s.id === id && s.enabled);
  }
  private async plan(id: number) {
    const plan =
      (await this.db.getRepository(SeoPlan).findOneBy({ siteId: id })) ||
      Object.assign(new SeoPlan(), {
        siteId: id,
        enabled: false,
        revision: 0,
        config: defaultPlan(),
        nextRunAt: '',
      });
    plan.config = {
      ...defaultPlan(),
      ...plan.config,
      searchProvider:
        plan.config.searchProvider ||
        (plan.config.searchEnabled ? 'brave' : 'deepseek'),
    };
    return plan;
  }
  private async control() {
    return (
      (await this.db.getRepository(SeoControl).findOneBy({ id: 1 })) ||
      Object.assign(new SeoControl(), { id: 1, paused: true, heartbeat: '' })
    );
  }
  private async allowed(id: number) {
    return (
      !(await this.control()).paused &&
      (await this.plan(id)).enabled &&
      (await this.validSite(id))
    );
  }
  private async assertAllowed(id: number) {
    if (!(await this.allowed(id)))
      throw new BadRequestException('全局已暂停、网站开关已关闭或网站已停用');
  }
  private async menu(siteId: number, menuId: number) {
    const row = await this.db
      .getRepository(Menu)
      .findOneBy({ id: String(menuId), siteId });
    if (
      !row ||
      !row.code?.startsWith('pboot:cn:') ||
      row.model !== '2' ||
      row.pendingDelete
    )
      throw new BadRequestException('请选择当前网站的中文新闻栏目');
    return row;
  }
  models() {
    const models = this.news
      .findTranslationModels()
      .filter(
        (m) =>
          ['openai', 'qwen', 'deepseek', 'zhipu'].includes(m.provider) &&
          !/\bmt\b|coder|\bvl\b/i.test(m.value),
      );
    const deepseek = models.find((m) => m.provider === 'deepseek');
    for (const value of ['deepseek-v4-flash', 'deepseek-v4-pro'])
      if (!models.some((m) => m.value === value))
        models.push({
          ...(deepseek || {}),
          value,
          label:
            value === 'deepseek-v4-flash'
              ? 'DeepSeek V4 Flash'
              : 'DeepSeek V4 Pro',
          provider: 'deepseek',
          available:
            !!deepseek?.available || !!this.config.get('DEEPSEEK_API_KEY'),
        } as any);
    return models;
  }
  async workerHealth() {
    return {
      ok: true,
      protocol: 2,
      paused: (await this.control()).paused,
      editorialVersion: loadEditorialRules().version,
    };
  }
  private searchConfigured(provider: string = 'brave') {
    return provider === 'deepseek'
      ? this.models().some((m) => m.provider === 'deepseek' && m.available)
      : !!String(this.config.get('BRAVE_SEARCH_API_KEY') || '').trim();
  }
  private async validateConfig(
    id: number,
    config: PlanConfig,
    enabled: boolean,
  ) {
    for (const url of config.feeds) validateSourceUrl(url, true);
    if (
      enabled &&
      config.searchEnabled &&
      !this.searchConfigured(config.searchProvider)
    )
      throw new BadRequestException(
        config.searchProvider === 'deepseek'
          ? '请配置 DeepSeek 模型密钥，或关闭本站关键词搜索'
          : '关键词搜索尚未配置，请在服务端设置 BRAVE_SEARCH_API_KEY，或关闭本站关键词搜索',
      );
    if (config.productIds?.length)
      await this.productFacts(id, config.productIds);
    if (config.menuId || enabled) await this.menu(id, config.menuId);
    if (
      enabled &&
      (!config.industry.trim() ||
        !config.keywords.some((k) => k.trim()) ||
        !this.models().some((m) => m.value === config.model && m.available))
    )
      throw new BadRequestException(
        '请填写行业、关键词，并选择已配置的写作模型',
      );
  }
  private async job(id: string, siteId: number) {
    const job = await this.db.getRepository(SeoJob).findOneBy({ id, siteId });
    if (!job) throw new NotFoundException('当前网站没有此任务');
    return job;
  }
  async state() {
    const id = this.siteId();
    const plan = await this.plan(id);
    const jobs = await this.db
      .getRepository(SeoJob)
      .find({ where: { siteId: id }, order: { createdAt: 'DESC' }, take: 200 });
    return {
      plan,
      control: await this.control(),
      integrations: {
        searchConfigured: this.searchConfigured(plan.config.searchProvider),
        deepseekConfigured: this.searchConfigured('deepseek'),
        braveConfigured: this.searchConfigured('brave'),
        workerConfigured:
          String(this.config.get('SEO_WORKER_TOKEN') || '').length >= 32,
      },
      usage: {
        generateToday: await this.todayCount(id, 'generate'),
        collectToday: await this.todayCount(id, 'collect'),
        searchToday: await this.todaySearchCount(id),
      },
      editorial: loadEditorialRules(),
      articles: await this.articleList(id),
      products: this.db.hasMetadata(Product)
        ? await this.db.getRepository(Product).find({
            select: { id: true, title: true },
            where: { siteId: id },
            order: { id: 'DESC' },
            take: 1000,
          })
        : [],
      models: this.models(),
      menus: (await this.db.getRepository(Menu).findBy({ siteId: id }))
        .filter(
          (m) =>
            m.code?.startsWith('pboot:cn:') &&
            m.model === '2' &&
            !m.pendingDelete,
        )
        .map((m) => ({ id: Number(m.id), name: m.name })),
      sources: await this.db.getRepository(SeoSource).find({
        where: { siteId: id },
        order: { createdAt: 'DESC' },
        take: 500,
      }),
      jobs: jobs.map(({ leaseToken, ...job }) => ({
        ...job,
        checks: checkDraft(job.draft),
      })),
    };
  }
  async savePlan(input: SavePlanDto) {
    const id = this.siteId();
    return this.lock(async () => {
      const plan = await this.plan(id);
      if (plan.revision !== input.revision)
        throw new ConflictException('配置已更新，请刷新后重试');
      const config = {
        ...defaultPlan(),
        ...input.config,
        keywords: [
          ...new Set(
            input.config.keywords.map((k) => k.trim()).filter(Boolean),
          ),
        ],
        feeds: [
          ...new Set(
            input.config.feeds.map((url) => url.trim()).filter(Boolean),
          ),
        ],
      };
      await this.validateConfig(id, config, plan.enabled);
      plan.config = config;
      plan.revision++;
      plan.nextRunAt = later(input.config.intervalHours);
      return this.db.getRepository(SeoPlan).save(plan);
    });
  }
  private async pauseJobs(siteId?: number) {
    const rows = await this.db.getRepository(SeoJob).findBy({
      ...(siteId ? { siteId } : {}),
      status: In(['queued', 'scheduled', 'publishing']),
    });
    for (const job of rows) {
      if (job.status === 'queued') job.status = 'paused';
      else if (job.status === 'scheduled') {
        job.status = 'draft';
        job.scheduledAt = '';
      } else if (job.status === 'publishing') {
        job.status = 'uncertain';
        job.leaseToken = '';
      } else continue;
      job.revision++;
      job.error =
        job.status === 'uncertain'
          ? '发布期间关闭开关，请人工核实 PB 是否已写入'
          : '开关关闭，任务已暂停；需手动重新排期';
      await this.db.getRepository(SeoJob).save(job);
    }
  }
  async switchSite(enabled: boolean) {
    const id = this.siteId();
    return this.lock(async () => {
      const plan = await this.plan(id);
      if (enabled) await this.validateConfig(id, plan.config, true);
      plan.enabled = enabled;
      plan.revision++;
      plan.nextRunAt = later(plan.config.intervalHours);
      await this.db.getRepository(SeoPlan).save(plan);
      if (!enabled) await this.pauseJobs(id);
      return plan;
    });
  }
  async switchGlobal(enabled: boolean) {
    this.siteId();
    return this.lock(async () => {
      const control = await this.control();
      control.paused = !enabled;
      await this.db.getRepository(SeoControl).save(control);
      if (!enabled) await this.pauseJobs();
      else
        for (const plan of await this.db.getRepository(SeoPlan).find()) {
          plan.nextRunAt = later(plan.config.intervalHours);
          await this.db.getRepository(SeoPlan).save(plan);
        }
      return control;
    });
  }
  async saveSource(input: SourceDto, sourceId?: number) {
    const id = this.siteId();
    return this.lock(async () => {
      validateSourceUrl(input.url);
      if (!input.title.trim() || (input.verified && !input.notes.trim()))
        throw new BadRequestException(
          '标题必填，确认素材前需要填写核实过的事实资料',
        );
      const repo = this.db.getRepository(SeoSource);
      const source = sourceId
        ? await repo.findOneBy({ id: sourceId, siteId: id })
        : repo.create({ siteId: id, publishedAt: '' });
      if (!source) throw new NotFoundException('当前网站没有此素材');
      const fingerprint = sourceFingerprint(input.title, input.url);
      const existing = await repo.findOneBy({ siteId: id, fingerprint });
      if (existing && existing.id !== sourceId)
        throw new ConflictException('当前网站已收录此来源或选题');
      Object.assign(source, input, { fingerprint });
      return repo.save(source);
    });
  }
  private async createJob(siteId: number, input: QueueDto) {
    await this.assertAllowed(siteId);
    const plan = await this.plan(siteId);
    await this.validateConfig(siteId, plan.config, true);
    const repo = this.db.getRepository(SeoJob);
    const rows = await repo.findBy({ siteId });
    if (
      rows.some(
        (j) =>
          j.kind === input.kind &&
          ['queued', 'running', 'publishing'].includes(j.status),
      )
    )
      throw new ConflictException('已有同类任务排队或执行中');
    const snapshot: SeoJob['snapshot'] = JSON.parse(
      JSON.stringify(plan.config),
    );
    snapshot.editorial = loadEditorialRules();
    snapshot.existingTitles = (await this.articleList(siteId)).map(
      (n) => n.title,
    );
    if (input.newsId && input.kind !== 'generate')
      throw new BadRequestException('只有写作任务可以更新旧文');
    if (input.kind === 'collect') {
      if (!snapshot.feeds.length && !snapshot.searchEnabled)
        throw new BadRequestException('请配置 RSS/Atom 来源或开启关键词搜索');
      if (
        (await this.todayCount(siteId, 'collect')) >=
        (snapshot.dailyCollectLimit ?? 4)
      )
        throw new BadRequestException(
          '已达到今日采集任务上限（UTC），失败任务也计入上限',
        );
      if (snapshot.searchEnabled) {
        const keywords = snapshot.keywords.filter((k) => k.trim());
        const offset =
          rows.filter((j) => j.kind === 'collect' && j.snapshot.searchEnabled)
            .length * 3;
        snapshot.searchKeywords = Array.from(
          {
            length: Math.min(
              3,
              keywords.length,
              Math.max(
                0,
                (snapshot.dailySearchLimit ?? 3) -
                  (await this.todaySearchCount(siteId)),
              ),
            ),
          },
          (_, i) => keywords[(offset + i) % keywords.length],
        );
        if (!snapshot.searchKeywords.length)
          throw new BadRequestException('已达到今日搜索请求上限（UTC）');
        snapshot.searchReservations = [iso().slice(0, 10)];
      }
    } else {
      if (
        rows.filter(
          (j) =>
            j.kind === 'generate' &&
            j.createdAt.toISOString().slice(0, 10) === iso().slice(0, 10),
        ).length >= snapshot.dailyLimit
      )
        throw new BadRequestException(
          '已达到今日生成任务上限（UTC），失败任务也计入上限',
        );
      const used = new Set(
        rows
          .filter((j) => j.kind === 'generate')
          .map((j) => j.snapshot.source?.id),
      );
      const sources = await this.db.getRepository(SeoSource).find({
        where: { siteId, verified: true },
        order: { createdAt: 'ASC' },
      });
      const source = input.sourceId
        ? sources.find((s) => s.id === input.sourceId)
        : sources.find((s) => !used.has(s.id));
      if (!source || !source.notes.trim())
        throw new BadRequestException('没有可用的已核实素材，请先补充事实资料');
      if (used.has(source.id) && !input.newsId)
        throw new ConflictException(
          '该素材已有写作任务，请编辑原草稿或重试原任务',
        );
      snapshot.source = {
        id: source.id,
        title: source.title,
        url: source.url,
        notes: source.notes,
      };
      snapshot.products = await this.productFacts(
        siteId,
        snapshot.productIds || [],
      );
      if (input.newsId) {
        if (
          rows.some(
            (j) =>
              j.snapshot.previous?.id === input.newsId &&
              !['published', 'done', 'failed', 'paused'].includes(j.status),
          )
        )
          throw new ConflictException('该旧文已有更新草稿，请先处理原任务');
        const current = await this.article(siteId, input.newsId);
        if (!(current.cn?.urlName || current.news.urlName).trim())
          throw new BadRequestException(
            '旧文没有稳定的 URL 名称，请先在新闻编辑页保存并同步地址',
          );
        if (current.news.menuId !== snapshot.menuId)
          throw new BadRequestException('旧文不属于当前计划的中文新闻栏目');
        if (
          /\[\[SEO_MEDIA_|<(?:iframe|video|audio|object|embed|picture|svg|canvas)\b/i.test(
            current.draft.content,
          )
        )
          throw new BadRequestException(
            '旧文含视频、复杂图片或嵌入内容，请在新闻编辑页维护；本功能只更新文字并保留已有普通图片',
          );
        const masked = maskMedia(current.draft.content);
        snapshot.previous = {
          id: input.newsId,
          hash: current.hash,
          urlName: current.cn?.urlName || current.news.urlName,
          draft: {
            ...current.draft,
            content: cleanDraft({ ...current.draft, content: masked.html })
              .content,
          },
          media: masked.media,
        };
      }
      snapshot.provider = this.models().find(
        (m) => m.value === snapshot.model,
      )!.provider;
    }
    return repo.save(
      repo.create({
        id: randomUUID(),
        siteId,
        kind: input.kind,
        status: 'queued',
        snapshot,
        draft: null,
      }),
    );
  }
  async queue(input: QueueDto) {
    const id = this.siteId();
    return this.lock(() => this.createJob(id, input));
  }
  private async todayCount(siteId: number, kind: string) {
    return this.db
      .getRepository(SeoJob)
      .createQueryBuilder('job')
      .where('job.siteId = :siteId AND job.kind = :kind', { siteId, kind })
      .andWhere('job.createdAt >= :today', {
        today: new Date(iso().slice(0, 10) + 'T00:00:00.000Z'),
      })
      .getCount();
  }
  private async todaySearchCount(siteId: number) {
    const jobs = await this.db
      .getRepository(SeoJob)
      .findBy({ siteId, kind: 'collect' });
    return jobs.reduce(
      (total, j) =>
        total +
        (j.snapshot.searchEnabled
          ? (j.snapshot.searchKeywords?.length ||
              Math.min(3, j.snapshot.keywords.length)) *
            (
              j.snapshot.searchReservations ||
              Array(Math.max(1, j.attempts)).fill(
                j.createdAt.toISOString().slice(0, 10),
              )
            ).filter((d) => d === iso().slice(0, 10)).length
          : 0),
      0,
    );
  }
  private async articleList(siteId: number) {
    const rows = await this.db
      .getRepository(News)
      .find({ where: { siteId }, order: { updateTime: 'DESC' }, take: 200 });
    const menus = await this.db
      .getRepository(Menu)
      .findBy({ siteId, model: '2' });
    const valid = new Set(
      menus
        .filter((m) => m.code?.startsWith('pboot:cn:') && !m.pendingDelete)
        .map((m) => Number(m.id)),
    );
    const cn = rows.length
      ? await this.db
          .getRepository(NewsTranslation)
          .findBy({ newsId: In(rows.map((n) => n.id)), lang: 'zh-CN' })
      : [];
    return rows
      .filter((n) => valid.has(n.menuId))
      .map((n) => ({
        id: n.id,
        title: cn.find((t) => t.newsId === n.id)?.title || n.title,
        menuId: n.menuId,
        urlName: cn.find((t) => t.newsId === n.id)?.urlName || n.urlName,
        updateTime: n.updateTime,
      }));
  }
  private async article(
    siteId: number,
    id: number,
    store: Pick<DataSource, 'getRepository'> = this.db,
  ) {
    const news = await store.getRepository(News).findOneBy({ id, siteId });
    if (!news) throw new NotFoundException('当前网站没有此中文文章');
    await this.menu(siteId, news.menuId);
    const cn = await store
      .getRepository(NewsTranslation)
      .findOneBy({ newsId: id, lang: 'zh-CN' });
    const text = cn || news;
    const draft: ArticleDraft = {
      title: text.title,
      subtitle: text.subtitle,
      keywords: text.keywords,
      summary: text.summary || text.description,
      content: text.content,
    };
    const { createTime, updateTime, ...base } = news;
    const {
      createTime: _created,
      updateTime: _updated,
      ...translation
    } = cn || {};
    const hash = createHash('sha256')
      .update(JSON.stringify({ base, translation }))
      .digest('hex');
    return { news, cn, draft, hash };
  }
  private async productFacts(siteId: number, ids: number[]) {
    if (!ids.length) return [];
    const rows = await this.db
      .getRepository(Product)
      .findBy({ siteId, id: In(ids) });
    if (new Set(ids).size !== rows.length)
      throw new BadRequestException('参考产品已删除或不属于当前网站');
    const cn = await this.db
      .getRepository(ProductTranslation)
      .findBy({ productId: In(ids), lang: 'zh-CN' });
    return rows.map((p) => {
      const t = cn.find((t) => t.productId === p.id);
      const parameters = p.sharedParameters;
      const publicParameters = parameters
        ? {
            depthM: parameters.depthM,
            coreCapacity: parameters.coreCapacity,
            coreBqM: parameters.coreBqM,
            coreNqM: parameters.coreNqM,
            coreHqM: parameters.coreHqM,
            diameterMm: parameters.diameterMm,
            engine: parameters.engine,
            pullback: parameters.pullback,
            pullbackUnit: parameters.pullbackUnit,
            custom: (parameters.custom || []).map((p) => ({
              name: p.name,
              value: p.value,
              unit: p.unit,
            })),
          }
        : undefined;
      return {
        id: p.id,
        title: plainText(t?.title || p.title),
        text:
          plainText(
            [
              t?.subtitle || p.subtitle,
              t?.summary || p.summary,
              t?.content || p.content,
            ].join('\n'),
          ).slice(0, 3000) +
          (publicParameters
            ? '\n本站型号参数：' +
              plainText(JSON.stringify(publicParameters)).slice(0, 4000)
            : ''),
      };
    });
  }
  private async quality(job: SeoJob, draft: ArticleDraft) {
    const articles = await this.db.getRepository(News).find({
      where: { siteId: job.siteId },
      order: { updateTime: 'DESC' },
      take: 200,
    });
    const translations = articles.length
      ? await this.db.getRepository(NewsTranslation).findBy({
          newsId: In(articles.map((n) => n.id)),
          lang: 'zh-CN',
        })
      : [];
    const references: ComparisonArticle[] = articles
      .filter((n) => n.id !== job.newsId && n.id !== job.snapshot.previous?.id)
      .map((n) => {
        const translation = translations.find((t) => t.newsId === n.id);
        return {
          id: String(n.id),
          kind: 'news',
          title: translation?.title || n.title,
          content: translation?.content || n.content,
          blocksDuplicate: true,
        };
      });
    const jobs = await this.db.getRepository(SeoJob).find({
      where: {
        siteId: job.siteId,
        kind: 'generate',
        status: In(['draft', 'scheduled', 'publishing', 'published']),
      },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    for (const other of jobs) {
      if (
        other.id === job.id ||
        !other.draft ||
        (other.newsId &&
          (other.newsId === job.newsId ||
            other.newsId === job.snapshot.previous?.id)) ||
        references.some(
          (r) => r.kind === 'news' && r.id === String(other.newsId),
        )
      )
        continue;
      references.push({
        id: other.id,
        kind: 'job',
        title: other.draft.title,
        content: other.draft.content,
        blocksDuplicate: other.status !== 'draft',
      });
    }
    const report = inspectQuality(draft, job.snapshot.keywords, references);
    report.issues.unshift(...checkDraft(draft));
    if (job.snapshot.source) {
      const source = await this.db
        .getRepository(SeoSource)
        .findOneBy({ siteId: job.siteId, id: job.snapshot.source.id });
      if (!source?.verified || source.notes !== job.snapshot.source.notes)
        report.issues.push('素材已变更或撤销核实，请重新核实并生成草稿');
    }
    report.issues.push(
      ...mediaIssues(draft.content, job.snapshot.previous?.media),
    );
    if (job.snapshot.previous) {
      const previous = job.snapshot.previous;
      const current = await this.article(job.siteId, previous.id);
      if (current.hash !== (job.snapshot.appliedHash || previous.hash))
        report.issues.push(
          '原文已被修改，请撤销本次更新并基于最新原文重新生成',
        );
      if (
        plainText(draft.content).replace(/\s/g, '') ===
        plainText(previous.draft.content).replace(/\s/g, '')
      )
        report.issues.push('正文没有实质变化，不可仅修改标题或日期后更新');
    }
    return report;
  }
  async check(id: string, input: SaveDraftDto) {
    const job = await this.job(id, this.siteId());
    if (job.revision !== input.revision)
      throw new ConflictException('草稿已变化，请重新打开后检查');
    return this.quality(job, cleanDraft(input.draft));
  }
  async saveDraft(id: string, input: SaveDraftDto) {
    const siteId = this.siteId();
    return this.lock(async () => {
      const job = await this.job(id, siteId);
      if (job.status !== 'draft' || job.revision !== input.revision)
        throw new ConflictException(
          '草稿状态已变化，请刷新；已排期文章需先撤销排期',
        );
      job.draft = cleanDraft(input.draft);
      job.revision++;
      job.error = '';
      return this.db.getRepository(SeoJob).save(job);
    });
  }
  async schedule(id: string, input: ScheduleDto) {
    const siteId = this.siteId();
    return this.lock(async () => {
      await this.assertAllowed(siteId);
      const job = await this.job(id, siteId);
      if (job.status !== 'draft' || job.revision !== input.revision)
        throw new ConflictException('草稿已变化，请重新审核');
      await this.menu(siteId, job.snapshot.menuId);
      const problems = job.draft
        ? (await this.quality(job, job.draft)).issues
        : checkDraft(null);
      if (problems.length) throw new BadRequestException(problems.join('；'));
      const timestamp = Date.parse(input.scheduledAt);
      if (!Number.isFinite(timestamp) || timestamp < Date.now())
        throw new BadRequestException('请选择将来的发布时间');
      job.status = 'scheduled';
      job.scheduledAt = new Date(timestamp).toISOString();
      job.revision++;
      return this.db.getRepository(SeoJob).save(job);
    });
  }
  async cancel(id: string) {
    const siteId = this.siteId();
    return this.lock(async () => {
      const job = await this.job(id, siteId);
      if (!['queued', 'scheduled', 'running', 'draft'].includes(job.status))
        throw new BadRequestException('当前任务不能撤销');
      job.status =
        job.status === 'draft' ? 'paused' : job.draft ? 'draft' : 'paused';
      job.scheduledAt = '';
      job.leaseToken = '';
      job.revision++;
      return this.db.getRepository(SeoJob).save(job);
    });
  }
  async retry(id: string) {
    const siteId = this.siteId();
    return this.lock(async () => {
      await this.assertAllowed(siteId);
      const job = await this.job(id, siteId);
      if (!['failed', 'paused'].includes(job.status) || job.newsId)
        throw new BadRequestException(
          '该任务不能自动重试；发布结果不确定时需人工核实',
        );
      if (job.attempts >= 3)
        throw new BadRequestException('已达三次尝试上限，请检查模型和素材');
      if (!job.draft && job.kind === 'collect' && job.snapshot.searchEnabled) {
        const count =
          job.snapshot.searchKeywords?.length ||
          Math.min(3, job.snapshot.keywords.length);
        if (
          (await this.todaySearchCount(siteId)) + count >
          ((await this.plan(siteId)).config.dailySearchLimit ?? 3)
        )
          throw new BadRequestException('重试会超过今日搜索请求上限');
        job.snapshot.searchReservations ||= Array(
          Math.max(1, job.attempts),
        ).fill(job.createdAt.toISOString().slice(0, 10));
        job.snapshot.searchReservations.push(iso().slice(0, 10));
      }
      job.status = job.draft ? 'draft' : 'queued';
      job.error = '';
      job.revision++;
      return this.db.getRepository(SeoJob).save(job);
    });
  }
  async claim() {
    return this.lock(async () => {
      const control = await this.control();
      control.heartbeat = iso();
      await this.db.getRepository(SeoControl).save(control);
      const repo = this.db.getRepository(SeoJob);
      for (const job of await repo.findBy({
        status: In(['running', 'publishing']),
      })) {
        if (
          ['running', 'publishing'].includes(job.status) &&
          job.leaseUntil < iso()
        ) {
          job.status = job.status === 'publishing' ? 'uncertain' : 'failed';
          job.error = '任务进程中断或租约到期，请人工检查后处理';
          job.leaseToken = '';
          job.revision++;
          await repo.save(job);
        }
      }
      if (control.paused) return null;
      for (const plan of await this.db
        .getRepository(SeoPlan)
        .findBy({ enabled: true })) {
        if (
          !(await this.validSite(plan.siteId)) ||
          !plan.nextRunAt ||
          plan.nextRunAt > iso()
        )
          continue;
        plan.nextRunAt = later(plan.config.intervalHours);
        await this.db.getRepository(SeoPlan).save(plan);
        for (const kind of ['collect', 'generate']) {
          try {
            await this.createJob(plan.siteId, { kind });
          } catch (error) {
            if (!(
              error instanceof BadRequestException ||
              error instanceof ConflictException
            ))
              throw error;
            // A skipped interval is recorded, never backfilled in a restart burst.
            await repo.save(
              repo.create({
                id: randomUUID(),
                siteId: plan.siteId,
                kind: 'notice',
                status: 'done',
                snapshot: plan.config,
                error: `${kind}: ${error.message}`,
              }),
            );
          }
        }
      }
      const jobs = await repo.find({
        where: { status: In(['queued', 'scheduled', 'running', 'publishing']) },
        order: { createdAt: 'ASC' },
      });
      const allowedSites = new Map<number, boolean>();
      for (const job of jobs) {
        if (!allowedSites.has(job.siteId))
          allowedSites.set(job.siteId, await this.allowed(job.siteId));
        if (!allowedSites.get(job.siteId)) continue;
        if (
          jobs.some(
            (j) =>
              j.siteId === job.siteId &&
              ['running', 'publishing'].includes(j.status),
          )
        )
          continue;
        const publish = job.status === 'scheduled' && job.scheduledAt <= iso();
        if (job.status !== 'queued' && !publish) continue;
        if (publish && Date.now() - Date.parse(job.scheduledAt) > 3600000) {
          job.status = 'draft';
          job.scheduledAt = '';
          job.error = '错过发布时间超过一小时，请重新审核排期';
          job.revision++;
          await repo.save(job);
          continue;
        }
        job.status = publish ? 'publishing' : 'running';
        job.leaseToken = randomUUID();
        job.leaseUntil = later(5 / 60);
        job.attempts++;
        job.revision++;
        await repo.save(job);
        return { ...job, action: publish ? 'publish' : job.kind };
      }
      return null;
    });
  }
  private async leased(id: string, token: string) {
    const job = await this.db.getRepository(SeoJob).findOneBy({ id });
    if (
      !job ||
      !token ||
      job.leaseToken !== token ||
      !['running', 'publishing'].includes(job.status) ||
      job.leaseUntil < iso()
    )
      throw new ConflictException('任务租约已失效');
    return job;
  }
  async heartbeat(id: string, token: string) {
    return this.lock(async () => {
      const job = await this.leased(id, token);
      const active = await this.allowed(job.siteId);
      const control = await this.control();
      control.heartbeat = iso();
      await this.db.getRepository(SeoControl).save(control);
      job.leaseUntil = later(5 / 60);
      await this.db.getRepository(SeoJob).save(job);
      return { active };
    });
  }
  async complete(id: string, input: CompleteJobDto) {
    return this.lock(async () => {
      const job = await this.leased(id, input.leaseToken);
      if (job.status !== 'running')
        throw new ConflictException('发布任务不能通过写作回调完成');
      if (job.kind === 'generate') {
        if (!input.draft) throw new BadRequestException('缺少草稿');
        job.draft = cleanDraft(input.draft);
        job.status = 'draft';
        job.tokens = input.tokens || 0;
        job.error = checkDraft(job.draft).join('；');
      } else if (job.kind === 'collect') {
        const sources = this.db.getRepository(SeoSource);
        for (const item of input.sources || []) {
          validateSourceUrl(item.url, true);
          if (
            !job.snapshot.keywords.some((k) =>
              item.title.toLowerCase().includes(k.toLowerCase()),
            )
          )
            continue;
          const fingerprint = sourceFingerprint(item.title, item.url);
          if (await sources.findOneBy({ siteId: job.siteId, fingerprint }))
            continue;
          await sources.save(
            sources.create({
              ...item,
              siteId: job.siteId,
              fingerprint,
              verified: false,
              notes: plainText(item.notes || '').slice(0, 12000),
            }),
          );
        }
        job.status = 'done';
        job.tokens = input.tokens || 0;
        job.error = (input.warnings || [])
          .filter((message) => /^[A-Z][A-Z0-9_]{0,99}$/.test(message))
          .join('；');
      } else throw new BadRequestException('不支持的任务');
      job.leaseToken = '';
      job.leaseUntil = '';
      job.revision++;
      await this.db.getRepository(SeoJob).save(job);
      return { ok: true };
    });
  }
  async fail(id: string, token: string, message: string) {
    return this.lock(async () => {
      const job = await this.leased(id, token);
      job.status = job.status === 'publishing' ? 'uncertain' : 'failed';
      const readable: Record<string, string> = {
        MODEL_HTTP_429:
          '模型额度不足或请求限流（429），请检查模型账户后手动重试',
        MODEL_HTTP_401: '模型密钥无效或已过期（401），请检查模型配置',
        MODEL_KEY_NOT_CONFIGURED: '任务选用的模型未在 worker 配置密钥',
        SEARCH_HTTP_429:
          '搜索接口限流或额度不足（429），请检查当前搜索服务账户',
        SEARCH_KEY_NOT_CONFIGURED: 'worker 未配置 BRAVE_SEARCH_API_KEY',
        SEARCH_NO_CITATIONS:
          '研究结果没有可核实的搜索来源，未保存素材；请更换研究模型或调整关键词',
        SEARCH_NO_TOOL_CALL:
          '模型没有实际执行联网搜索，已拒绝把生成内容当作搜索结果',
        SEARCH_OUTPUT_TRUNCATED:
          '联网研究输出被截断，请提高单次输出上限或缩小选题',
        SEARCH_MODEL_NOT_SUPPORTED:
          '研究模型不支持当前联网接口，请选择 DeepSeek V4 Flash 或 Pro',
        SEARCH_JSON_INVALID: '联网研究没有返回有效的结构化文字素材',
      };
      job.error = readable[message] || message.slice(0, 300);
      job.leaseToken = '';
      job.revision++;
      await this.db.getRepository(SeoJob).save(job);
      return { ok: true };
    });
  }
  async publish(id: string, token: string) {
    const job = await this.lock(async () => {
      const job = await this.leased(id, token);
      if (job.status !== 'publishing' || !job.draft)
        throw new ConflictException('任务尚未审核排期');
      await this.assertAllowed(job.siteId);
      await this.menu(job.siteId, job.snapshot.menuId);
      if ((await this.quality(job, job.draft)).issues.length)
        throw new BadRequestException('草稿检查未通过');
      if (!job.newsId && job.snapshot.previous) {
        await this.db.transaction(async (manager) => {
          const previous = job.snapshot.previous!;
          const current = await this.article(job.siteId, previous.id, manager);
          if (current.hash !== previous.hash)
            throw new ConflictException('原文已变化，停止更新以保护人工修改');
          const content = restoreMedia(job.draft!.content, previous.media);
          const updated = {
            ...job.draft!,
            content,
            description: job.draft!.summary,
          };
          const { createTime, updateTime, ...newsMatch } = current.news;
          const result = await manager.update(News, newsMatch, updated);
          if (result.affected !== 1)
            throw new ConflictException('原文正在被修改，请重新审核');
          if (current.cn) {
            const {
              createTime: _created,
              updateTime: _updated,
              ...translationMatch
            } = current.cn;
            const translated = await manager.update(
              NewsTranslation,
              translationMatch,
              updated,
            );
            if (translated.affected !== 1)
              throw new ConflictException('中文原文正在被修改，请重新审核');
          } else
            await manager.save(
              manager.create(NewsTranslation, {
                ...updated,
                newsId: previous.id,
                lang: 'zh-CN',
                urlName: previous.urlName,
              }),
            );
          job.newsId = previous.id;
          job.snapshot.appliedHash = (
            await this.article(job.siteId, previous.id, manager)
          ).hash;
          await manager.save(job);
        });
      } else if (!job.newsId)
        await this.db.transaction(async (manager) => {
          const article = manager.create(News, {
            ...job.draft!,
            siteId: job.siteId,
            menuId: job.snapshot.menuId,
            urlName: `cn-seo-${job.siteId}-${job.id}`,
            description: job.draft!.summary,
            show: true,
            thumbnail: '',
            author: '编辑部',
            source: job.snapshot.source?.url || '',
            orderNum: 0,
          });
          const saved = await manager.save(article);
          await manager.save(
            manager.create(NewsTranslation, {
              ...job.draft!,
              newsId: saved.id,
              lang: 'zh-CN',
              urlName: saved.urlName,
              description: job.draft!.summary,
            }),
          );
          job.newsId = saved.id;
          await manager.save(job);
        });
      return job;
    });
    return new Promise((resolve, reject) =>
      this.context.run(job.siteId, () => {
        void (async () => {
          try {
            const result = await this.news.syncToPboot(
              job.newsId,
              { lang: 'zh-CN', all: false },
              async () => {
                await this.assertAllowed(job.siteId);
                await this.leased(id, token);
                await this.menu(job.siteId, job.snapshot.menuId);
                if (
                  job.snapshot.appliedHash &&
                  (await this.article(job.siteId, job.newsId)).hash !==
                    job.snapshot.appliedHash
                )
                  throw new ConflictException(
                    '同步期间原文已变化，停止写入 PB',
                  );
              },
              !!job.snapshot.previous,
            );
            await this.lock(async () => {
              const latest = await this.leased(id, token);
              latest.status = 'published';
              latest.leaseToken = '';
              latest.error = '';
              latest.revision++;
              await this.db.getRepository(SeoJob).save(latest);
            });
            resolve(result);
          } catch (error) {
            await this.fail(
              id,
              token,
              '发布未确认完成，请检查新闻和 PB 后人工处理',
            ).catch(() => undefined);
            reject(error);
          }
        })();
      }),
    );
  }
  async history(newsId: number) {
    const siteId = this.siteId();
    await this.article(siteId, newsId);
    const rows = await this.db.getRepository(SeoJob).find({
      where: { siteId, kind: 'generate' },
      order: { createdAt: 'DESC' },
    });
    return rows
      .filter((j) => j.snapshot.previous?.id === newsId || j.newsId === newsId)
      .slice(0, 100)
      .map(({ leaseToken, ...job }) => job);
  }
}
