import { Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { News } from './entities/news.entity';
import { NewsTranslation } from './entities/news-translation.entity';
import { CreateNewsDto, NewsTranslationDto } from './dto/create-news.dto';
import { SyncNewsDto } from './dto/sync-news.dto';
import { TranslateNewsDto } from './dto/translate-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';
import { DEFAULT_NEWS_LANG, NEWS_LANGUAGES, resolveNewsLang } from './news-languages';
import { Menu } from '../menu/entities/menu.entity';
import {
  choosePbootBaseRow,
  createPbootMenuResolver,
  normalizePbootImage,
  PBOOT_LANG_MAP,
  PbootContentGroup,
  PbootContentRow,
  queryPbootRows,
  readPbootNewsContentGroups,
  toPbootDate,
} from '../common/pboot-content-import';
import { SyncGuardService } from '../common/sync-guard.service';
import { OptimizeSeoDto } from '../common/dto/optimize-seo.dto';
import {
  applyImageAltsOnly,
  buildLanguageSeoUrlName,
  repairOptimizedHtml,
} from '../common/seo-content-utils';
import { TranslateMenuContentDto } from '../common/dto/translate-menu-content.dto';
import { MenuTranslationJob } from '../common/menu-translation-job';
import { resolveChineseMenuScope } from '../common/menu-translation-scope';
import { fetchWithAiRetry, formatAiErrorMessage, isFallbackableAiErrorText, sleep } from '../common/ai-retry';
import { decodeEscapedHtml, repairTranslatedHtml, translateHtmlContentSafely } from '../common/translation-html-utils';
import { buildTranslationModelCatalog, buildTranslationModelFallbackChain } from '../common/translation-model-catalog';
import { extractAiChoiceText, extractTranslationJson } from '../common/ai-json';
import { SitesService } from '../sites/sites.service';
import { copyUploadedImageToPboot, rewriteUploadedHtmlImages } from '../common/pboot-uploaded-images';
import { createFolderAssetResolver } from '../common/folder-import-assets';
import { ensureFolderThumbnail, resolveContentThumbnailDirectory, saveUploadedContentThumbnail } from '../common/content-thumbnail';
import { UploadNewsThumbnailDto } from './dto/upload-news-thumbnail.dto';
import { contentTranslationProgress, missingTranslationFields } from '../common/content-translation-progress';
import { ImportNewsFolderDto } from './dto/import-news-folder.dto';
import {
  buildImportedNewsContent,
  readNewsDetailHtml,
  safeNewsAssetSegment,
  scanNewsFolders,
  type NewsFolderCandidate,
} from './news-folder-import';

const initSqlJs = require('sql.js');

type NewsWithTranslations = Omit<News, 'author' | 'source'> & {
  lang?: string;
  translations?: NewsTranslation[];
};

type PbootLanguageConfig = {
  acode: string;
  scode: string;
  sortFilename: string;
};

type NewsContent = {
  lang: string; title: string; urlName: string; subtitle: string; keywords: string;
  description: string; summary: string; content: string;
};

type PbootSyncItem = {
  lang: string;
  acode: string;
  scode: string;
  pbootId: number;
  title: string;
  filename: string;
  url: string;
  action: 'created' | 'updated';
};

const PBOOT_NEWS_SORTS: Record<string, PbootLanguageConfig> = {
  'zh-CN': { acode: 'cn', scode: '330', sortFilename: 'cn-Industry-News' },
  en: { acode: 'en', scode: '130', sortFilename: 'Industry-News' },
  es: { acode: 'es', scode: '730', sortFilename: 'es-Industry-News' },
  fr: { acode: 'fr', scode: '796', sortFilename: 'fr-Industry-News' },
  ru: { acode: 'ru', scode: '530', sortFilename: 'ru-Industry-News' },
  ar: { acode: 'ar', scode: '862', sortFilename: 'ar-Industry-News' },
  pt: { acode: 'pt', scode: '928', sortFilename: 'pt-Industry-News' },
  id: { acode: 'id', scode: '', sortFilename: 'id-Industry-News' },
  tr: { acode: 'tr', scode: '', sortFilename: 'tr-Industry-News' },
  vi: { acode: 'vi', scode: '', sortFilename: 'vi-Industry-News' },
};

@Injectable()
export class NewsService {
  private readonly menuTranslationJobs = new Map<string, MenuTranslationJob>();
  private readonly adoptedLegacySites = new Set<number>();

  constructor(
    @InjectRepository(News) private readonly newsRepo: Repository<News>,
    @InjectRepository(NewsTranslation) private readonly translationRepo: Repository<NewsTranslation>,
    @InjectRepository(Menu) private readonly menusRepo: Repository<Menu>,
    private readonly config: ConfigService,
    private readonly syncGuard: SyncGuardService,
    private readonly sitesService: SitesService,
  ) {}

  async findLanguages() {
    const configured = new Set((await this.sitesService.getCurrentSiteLanguages()).map((item) => item.code));
    return NEWS_LANGUAGES.filter((item) => configured.has(item.code));
  }

  findTranslationModels() {
    return buildTranslationModelCatalog({
      openai: Boolean(this.getAiProviderKey('openai')),
      zhipu: Boolean(this.getAiProviderKey('zhipu')),
      deepseek: Boolean(this.getAiProviderKey('deepseek')),
      qwen: Boolean(this.getAiProviderKey('qwen')),
    });
  }

  private getAiProviderEnvName(provider: 'zhipu' | 'openai' | 'deepseek' | 'qwen') {
    if (provider === 'zhipu') return 'ZHIPU_API_KEY';
    if (provider === 'deepseek') return 'DEEPSEEK_API_KEY';
    if (provider === 'qwen') return 'DASHSCOPE_API_KEY';
    return 'OPENAI_API_KEY';
  }

  private getAiProviderConfigKey(provider: 'zhipu' | 'openai' | 'deepseek' | 'qwen') {
    if (provider === 'zhipu') return 'zhipuApiKey';
    if (provider === 'deepseek') return 'deepseekApiKey';
    if (provider === 'qwen') return 'dashscopeApiKey';
    return 'openaiApiKey';
  }

  private getAiProviderKey(provider: 'zhipu' | 'openai' | 'deepseek' | 'qwen') {
    const envName = this.getAiProviderEnvName(provider);
    const configured = String(this.config.get<string>(envName) || '').trim();
    if (configured) return configured;

    const candidates = [
      path.resolve(process.cwd(), '../tools/seo_publish_tool/ai.config.json'),
      path.resolve(process.cwd(), 'tools/seo_publish_tool/ai.config.json'),
    ];
    for (const configPath of candidates) {
      try {
        const localConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const keyName = this.getAiProviderConfigKey(provider);
        const key = String(localConfig?.[keyName] || '').trim();
        if (key) return key;
      } catch {
        // The main backend can still run when the standalone SEO tool is absent.
      }
    }
    return '';
  }

  async translateDraft(postObj: TranslateNewsDto) {
    if (!postObj.title?.trim() && !postObj.summary?.trim() && !postObj.content?.trim()) {
      throw new BadRequestException('请先填写中文标题、描述或正文');
    }

    const imageProtection = this.protectImageMarkup(postObj);
    const translated = await this.translateDraftRaw(imageProtection.draft);
    translated.content = this.restoreProtectedImageMarkup(
      translated.content || '',
      imageProtection.images,
    );
    return await this.ensureTranslationHasNoChineseResidue(postObj, translated);
  }

  private async translateDraftRaw(postObj: TranslateNewsDto) {
    const models = this.findTranslationModels();
    const model = models.find((item) => item.value === postObj.model);
    if (!model) throw new BadRequestException('不支持该翻译模型');
    if (!model.available) {
      const envName = this.getAiProviderEnvName(model.provider as 'zhipu' | 'openai' | 'deepseek' | 'qwen');
      throw new BadRequestException(`未配置 ${envName}，暂时不能调用该翻译模型`);
    }

    const chain = buildTranslationModelFallbackChain(models, model.value);
    const controller = new AbortController();
    const deadlineMs = 165000;
    let deadlineReached = false;
    const timer = setTimeout(() => {
      deadlineReached = true;
      controller.abort();
    }, deadlineMs);

    try {
      let lastError: unknown;
      for (const candidate of chain) {
        if (deadlineReached) break;
        try {
          const translated = await this.translateDraftWithModel(
            { ...postObj, model: candidate.value },
            candidate,
            controller.signal,
          );
          return {
            ...translated,
            requestedModel: postObj.model,
            fallbackUsed: candidate.value !== postObj.model,
          };
        } catch (error) {
          lastError = error;
          if (deadlineReached) break;
          if (!isFallbackableAiErrorText(error instanceof Error ? error.message : String(error))) throw error;
        }
      }
      if (deadlineReached) {
        throw new BadRequestException('当前语言在 165 秒内未完成，后台已停止本次请求，可从已保存进度继续');
      }
      throw lastError instanceof Error ? lastError : new BadRequestException('所有可用翻译模型均调用失败');
    } finally {
      clearTimeout(timer);
    }
  }

  private async translateDraftWithModel(
    postObj: TranslateNewsDto,
    model: ReturnType<NewsService['findTranslationModels']>[number],
    signal?: AbortSignal,
  ) {
    if (model.value === 'google-free') return await this.translateWithGoogleFree(postObj, signal);
    if (model.value === 'mymemory-free') return await this.translateWithMyMemoryFree(postObj, signal);
    if (model.value === 'qwen-mt-lite') return await this.translateWithQwenMtLite(postObj, signal);
    if (model.provider === 'zhipu') return await this.translateWithZhipu(postObj, signal);
    if (model.provider === 'deepseek') return await this.translateWithDeepSeek(postObj, signal);
    if (model.provider === 'qwen') return await this.translateWithQwen(postObj, signal);

    return await this.translateWithOpenAI(postObj, signal);
  }

  async startMenuTranslation(postObj: TranslateMenuContentDto) {
    const model = this.findTranslationModels().find((item) => item.value === postObj.model);
    if (!model) throw new BadRequestException('Unsupported translation model.');
    if (!model.available) throw new BadRequestException('The selected translation model is not configured.');
    if (!(await this.getConfiguredLanguageCodes()).includes(postObj.targetLang)) {
      throw new BadRequestException(`当前网站未配置 ${postObj.targetLang} 语言区域，无法翻译`);
    }

    const siteId = await this.currentSiteId();
    const menus = await this.findSiteMenus();
    const scope = resolveChineseMenuScope(menus, postObj.menuId, postObj.targetLang, '2');
    const rows = await this.newsRepo.find({
      where: { siteId, menuId: In(scope.sourceMenuIds) },
      order: { orderNum: 'ASC', id: 'DESC' },
    });
    if (!rows.length) {
      throw new BadRequestException('The matching Chinese source menu contains no news.');
    }
    const sourceRows = await this.filterChineseSourceNews(rows);
    if (!sourceRows.length) {
      throw new BadRequestException('The matching Chinese source menu contains no usable Chinese source news.');
    }
    if (postObj.targetLang === DEFAULT_NEWS_LANG) {
      throw new BadRequestException('Chinese source content does not need menu translation.');
    }

    const running = [...this.menuTranslationJobs.values()].find(
      (item) =>
        ['pending', 'running'].includes(item.status) &&
        item.menuId === Number(postObj.menuId) &&
        item.targetLang === postObj.targetLang,
    );
    if (running) return running;

    const protection = await this.syncGuard.protectBeforeDangerousSync(
      `news_translate_menu_${postObj.targetLang}`,
      'news',
    );
    await this.deleteNonChineseSourceTranslations(rows, sourceRows, postObj.targetLang);
    const job: MenuTranslationJob = {
      id: `news-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      module: 'news',
      status: 'pending',
      menuId: Number(postObj.menuId),
      targetLang: postObj.targetLang,
      model: postObj.model,
      sourceMenuId: Number(scope.sourceMenu.id),
      sourceMenuName: scope.sourceMenu.name,
      targetMenuName: scope.targetMenu.name,
      total: sourceRows.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      failedItems: [],
      currentTitle: '',
      errors: [],
      backupPath: protection.backupPath,
      startedAt: new Date().toISOString(),
      message: 'Translation job is waiting to start.',
    };
    this.menuTranslationJobs.set(job.id, job);
    this.pruneMenuTranslationJobs();
    void this.runMenuTranslation(job, sourceRows);
    return job;
  }

  findMenuTranslationJob(jobId: string) {
    const job = this.menuTranslationJobs.get(jobId);
    if (!job) throw new NotFoundException('The menu translation job was not found.');
    return job;
  }

  cancelMenuTranslationJob(jobId: string) {
    const job = this.findMenuTranslationJob(jobId);
    if (!['pending', 'running'].includes(job.status)) return job;
    job.status = 'cancelled';
    job.currentTitle = '';
    job.finishedAt = new Date().toISOString();
    job.message = `Stopped after ${job.processed}/${job.total} item(s).`;
    return job;
  }

  private isMenuTranslationCancelled(job: MenuTranslationJob) {
    return this.menuTranslationJobs.get(job.id)?.status === 'cancelled';
  }

  async retryMenuTranslationFailures(jobId: string, modelValue: string) {
    const previous = this.findMenuTranslationJob(jobId);
    if (['pending', 'running'].includes(previous.status)) {
      throw new BadRequestException('The previous translation job is still running.');
    }
    const failedIds = Array.from(new Set((previous.failedItems || []).map((item) => Number(item.id)).filter(Boolean)));
    if (!failedIds.length) {
      throw new BadRequestException('The previous translation job has no failed items to retry.');
    }

    const model = this.findTranslationModels().find((item) => item.value === modelValue);
    if (!model) throw new BadRequestException('Unsupported translation model.');
    if (!model.available) throw new BadRequestException('The selected translation model is not configured.');

    const rows = await this.newsRepo.find({
      where: { siteId: await this.currentSiteId(), id: In(failedIds) },
      order: { orderNum: 'ASC', id: 'DESC' },
    });
    const sourceRows = await this.filterChineseSourceNews(rows);
    if (!sourceRows.length) {
      throw new BadRequestException('There are no usable Chinese source news items to retry.');
    }

    const protection = await this.syncGuard.protectBeforeDangerousSync(
      `news_retry_menu_${previous.targetLang}`,
      'news',
    );
    const job: MenuTranslationJob = {
      ...previous,
      id: `news-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      model: modelValue,
      total: sourceRows.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      failedItems: [],
      currentTitle: '',
      errors: [],
      backupPath: protection.backupPath,
      startedAt: new Date().toISOString(),
      finishedAt: undefined,
      message: 'Retry job is waiting to start.',
    };
    this.menuTranslationJobs.set(job.id, job);
    this.pruneMenuTranslationJobs();
    void this.runMenuTranslation(job, sourceRows);
    return job;
  }

  private async runMenuTranslation(job: MenuTranslationJob, rows: News[]) {
    if (this.isMenuTranslationCancelled(job)) return;
    job.status = 'running';
    job.message = 'Translating the selected Chinese menu into the target language.';
    try {
      const ids = rows.map((row) => row.id);
      const translations = await this.translationRepo.find({
        where: { newsId: In(ids) },
      });
      const translationMap = new Map(
        translations.map((item) => [`${item.newsId}:${item.lang}`, item]),
      );

      for (const news of rows) {
        if (this.isMenuTranslationCancelled(job)) break;
        const source = translationMap.get(`${news.id}:${DEFAULT_NEWS_LANG}`);
        if (!this.isChineseSourceNews(news, source)) {
          job.processed += 1;
          continue;
        }
        const current = translationMap.get(`${news.id}:${job.targetLang}`);
        const sourceTitle = source?.title || news.title || `News #${news.id}`;
        job.currentTitle = sourceTitle;

        try {
          if (this.isMenuTranslationCancelled(job)) break;
          if (this.isZhipuModel(job.model)) {
            await sleep(2500);
          }
          if (this.isMenuTranslationCancelled(job)) break;
          const translated = await this.translateDraft({
            contentType: 'news',
            sourceLang: DEFAULT_NEWS_LANG,
            targetLang: job.targetLang,
            model: job.model,
            title: source?.title ?? news.title ?? '',
            subtitle: source?.subtitle ?? news.subtitle ?? '',
            keywords: source?.keywords ?? news.keywords ?? '',
            summary: source?.summary ?? news.summary ?? '',
            content: source?.content ?? news.content ?? '',
          });
          if (this.isMenuTranslationCancelled(job)) break;
          const translatedRow =
            current ||
            this.translationRepo.create({
              newsId: news.id,
              lang: job.targetLang,
            });
          translatedRow.title = String(translated.title || '').trim();
          translatedRow.subtitle = String(translated.subtitle || '').trim();
          translatedRow.keywords = String(translated.keywords || '').trim();
          translatedRow.summary = String(translated.summary || '').trim();
          translatedRow.description = translatedRow.summary;
          translatedRow.content = this.compactHtmlForStorage(String(translated.content || ''));
          translatedRow.urlName = this.pickMenuTranslationUrl(
            current?.urlName,
            job.targetLang,
            news.id,
          );
          await this.translationRepo.save(translatedRow);
          translationMap.set(`${news.id}:${job.targetLang}`, translatedRow);
          job.succeeded += 1;
        } catch (error) {
          job.failed += 1;
          const message = formatAiErrorMessage(error);
          job.failedItems.push({
            id: news.id,
            title: sourceTitle,
            error: message,
          });
          if (job.errors.length < 30) {
            job.errors.push(`#${news.id} ${sourceTitle}: ${message}`);
          }
        } finally {
          if (!this.isMenuTranslationCancelled(job)) job.processed += 1;
        }
      }

      if (this.isMenuTranslationCancelled(job)) {
        job.message = `Stopped after ${job.processed}/${job.total} item(s).`;
      } else {
        job.status = job.succeeded ? 'completed' : 'failed';
        job.message = job.failed
          ? `Completed with ${job.succeeded} successful and ${job.failed} failed item(s).`
          : `Completed ${job.succeeded} item(s).`;
      }
    } catch (error) {
      if (!this.isMenuTranslationCancelled(job)) {
        job.status = 'failed';
        job.message = error instanceof Error ? error.message : String(error);
      }
    } finally {
      job.currentTitle = '';
      job.finishedAt = new Date().toISOString();
    }
  }

  private pickMenuTranslationUrl(
    currentUrl: string | undefined,
    targetLang: string,
    newsId: number,
  ) {
    const current = String(currentUrl || '').trim().replace(/^\/+/, '');
    const prefix = targetLang === DEFAULT_NEWS_LANG ? 'cn' : String(targetLang || 'cn').toLowerCase();
    if (new RegExp(`^${prefix}[-_/]+`, 'i').test(current)) return current;
    return this.getDefaultNewsUrlName(targetLang, newsId);
  }

  private async filterChineseSourceNews(rows: News[]) {
    const ids = rows.map((row) => row.id);
    const sourceTranslations = ids.length
      ? await this.translationRepo.find({
          where: { newsId: In(ids), lang: DEFAULT_NEWS_LANG },
        })
      : [];
    const sourceMap = new Map(sourceTranslations.map((item) => [item.newsId, item]));
    return rows.filter((row) => this.isChineseSourceNews(row, sourceMap.get(row.id)));
  }

  private async deleteNonChineseSourceTranslations(rows: News[], sourceRows: News[], targetLang: string) {
    const sourceIds = new Set(sourceRows.map((row) => row.id));
    const staleIds = rows.map((row) => row.id).filter((id) => !sourceIds.has(id));
    if (!staleIds.length) return;
    await this.translationRepo.delete({
      newsId: In(staleIds),
      lang: targetLang,
    });
  }

  private isChineseSourceNews(news: News, source?: NewsTranslation) {
    return this.hasMeaningfulChinese(
      source?.title,
      source?.subtitle,
      source?.keywords,
      source?.summary,
      source?.content,
      news.title,
      news.subtitle,
      news.keywords,
      news.summary,
      news.content,
    );
  }

  private hasMeaningfulChinese(...values: Array<string | undefined | null>) {
    const text = values
      .map((value) => String(value || ''))
      .join(' ')
      .replace(/<[^>]*>/g, ' ');
    const chineseCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
    return chineseCount >= 4;
  }

  private pruneMenuTranslationJobs() {
    if (this.menuTranslationJobs.size <= 50) return;
    for (const [id, job] of this.menuTranslationJobs) {
      if (!['pending', 'running'].includes(job.status)) this.menuTranslationJobs.delete(id);
      if (this.menuTranslationJobs.size <= 40) break;
    }
  }

  async optimizeSeoDraft(postObj: OptimizeSeoDto) {
    const contentLabel = postObj.contentType === 'page' ? '单页' : '新闻';
    if (!postObj.title?.trim() && !postObj.summary?.trim() && !postObj.content?.trim()) {
      throw new BadRequestException(`请先填写中文${contentLabel}标题、描述或正文`);
    }
    if (postObj.onlyAlts && !postObj.content?.trim()) {
      throw new BadRequestException('请先填写正文内容，才能补全图片 ALT');
    }

    const model = this.findTranslationModels().find((item) => item.value === postObj.model);
    if (!model || !['zhipu', 'openai', 'deepseek', 'qwen'].includes(model.provider)) {
      throw new BadRequestException('中文 SEO 优化需要选择已配置的智谱、DeepSeek 或 OpenAI 模型');
    }
    if (!model.available) {
      const envName = this.getAiProviderEnvName(model.provider as 'zhipu' | 'openai' | 'deepseek' | 'qwen');
      throw new BadRequestException(`未配置 ${envName}，暂时不能优化中文 SEO`);
    }

    if (postObj.onlyAlts) {
      const altPrompt = [
        `你是工程机械行业的中文 SEO 编辑。只处理${contentLabel}图片 ALT，不改正文。`,
        '为正文 HTML 中每个缺少 alt 或 alt 为空的 img 按原顺序生成一个 imageAlts 项。imageAlts 可以是字符串数组，也可以是包含 src、alt 的对象数组。',
        'ALT 要结合标题、关键词和图片附近正文，简洁准确，不堆砌关键词，不猜测图片中无法确认的细节。',
        '不得改写标题、关键词、描述或正文文字，不添加或删除图片，不修改任何 src、href、iframe 或已有非空 ALT。',
        '只返回严格 JSON，键必须是 title、keywords、content、imageAlts；title、keywords、content 必须原样返回。',
        JSON.stringify({
          title: postObj.title || '',
          keywords: postObj.keywords || '',
          content: postObj.content || '',
        }),
      ].join('\n');
      const altRawText = await this.requestSeoOptimization(postObj.model, model.provider, altPrompt);
      const altParsed = this.parseTranslationJson(altRawText);
      const altKeywords = String(postObj.keywords || '').trim();
      const altTitle = String(postObj.title || '').trim();
      const altFallback = [altKeywords.split(',')[0], altTitle].filter(Boolean).join(' - ') || `${contentLabel}内容图片`;
      const { html, imageAlts } = applyImageAltsOnly(
        postObj.content || '',
        Array.isArray(altParsed.imageAlts) ? altParsed.imageAlts : [],
        altFallback,
      );
      return {
        model: postObj.model,
        lang: DEFAULT_NEWS_LANG,
        title: altTitle,
        subtitle: postObj.subtitle || '',
        keywords: altKeywords,
        summary: postObj.summary || '',
        urlName: String(postObj.urlName || '').trim(),
        content: html,
        imageAlts,
      };
    }

    const prompt = [
      `你是工程机械行业的中文 SEO 编辑。优化下面这份简体中文${contentLabel}草稿。`,
      '必须保持事实、产品型号、数字、公司名和技术参数准确，不得编造卖点、案例或数据。',
      '标题要自然清晰并包含核心主题，避免关键词堆砌和夸张点击诱导。',
      '副标题必须生成并补充搜索意图或核心卖点，不要留空；关键词只输出 3-5 个中文短语，用英文逗号分隔，宁少勿多，避免堆砌；描述控制在 80-160 个中文字符。',
      '正文保持原有 HTML 标签、表格、iframe、图片地址、链接和属性不变，可改善段落与 H2/H3 标题。',
      '为每个缺少 alt 或 alt 为空的 img 按原顺序生成一个 imageAlts 项。imageAlts 可以是字符串数组，也可以是包含 src、alt 的对象数组。ALT 要结合关键词、标题和图片附近正文，简洁准确，不堆砌关键词，不猜测图片中无法确认的细节。',
      '如果 urlName 已填写，必须原样返回；如果为空，生成简短、语义明确的 lowercase ASCII slug，不含域名、斜杠和语言前缀。',
      '不添加或删除图片，不修改任何 src、href、iframe 或已有非空 ALT。',
      '只返回严格 JSON，键必须是 title、subtitle、keywords、summary、urlName、content、imageAlts。',
      JSON.stringify({
        title: postObj.title || '',
        subtitle: postObj.subtitle || '',
        keywords: postObj.keywords || '',
        summary: postObj.summary || '',
        urlName: postObj.urlName || '',
        content: postObj.content || '',
      }),
    ].join('\n');

    const rawText = await this.requestSeoOptimization(postObj.model, model.provider, prompt);
    const parsed = this.parseTranslationJson(rawText);
    const title = String(parsed.title || postObj.title || '').trim();
    const keywords = String(parsed.keywords || postObj.keywords || '').trim();
    const fallbackAlt = [keywords.split(',')[0], title].filter(Boolean).join(' - ');
    const urlName =
      String(postObj.urlName || '').trim() ||
      buildLanguageSeoUrlName(
        DEFAULT_NEWS_LANG,
        String(parsed.urlName || ''),
        title,
      );
    return {
      model: postObj.model,
      lang: DEFAULT_NEWS_LANG,
      title,
      subtitle: String(parsed.subtitle || postObj.subtitle || '').trim(),
      keywords,
      summary: String(parsed.summary || postObj.summary || '').trim(),
      urlName,
      content: repairOptimizedHtml(
        postObj.content || '',
        String(parsed.content || postObj.content || ''),
        Array.isArray(parsed.imageAlts) ? parsed.imageAlts : [],
        fallbackAlt || `${contentLabel}内容图片`,
      ),
    };
  }

  async create(postObj: CreateNewsDto) {
    const defaultContent = this.getDefaultContent(postObj);
    const news = this.newsRepo.create({
      ...postObj,
      siteId: await this.currentSiteId(),
      title: defaultContent.title,
      urlName: defaultContent.urlName,
      subtitle: defaultContent.subtitle,
      keywords: defaultContent.keywords,
      summary: defaultContent.summary,
      description: defaultContent.summary,
      content: defaultContent.content,
    });
    const saved = await this.newsRepo.save(news);
    if (!String(saved.urlName || '').trim()) {
      saved.urlName = this.getDefaultNewsUrlName(DEFAULT_NEWS_LANG, saved.id);
      await this.newsRepo.save(saved);
    }
    await this.ensureTranslations(saved, postObj.translations);
    return await this.findOneById(saved.id);
  }

  async uploadThumbnail(postObj: UploadNewsThumbnailDto, file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('请选择缩略图');
    if (file.buffer.length > 5 * 1024 * 1024) throw new BadRequestException('上传图片不能超过 5MB');
    const news = postObj.newsId ? await this.findNewsEntity(postObj.newsId) : undefined;
    if (!news && !postObj.menuId) throw new BadRequestException('请先选择中文新闻栏目，再上传缩略图');
    const menu = news ? undefined : await this.requireChineseNewsImportMenu(postObj.menuId);
    const title = news?.title || postObj.title || '';
    const references = news ? [postObj.referenceImage || '', news.thumbnail] : [postObj.referenceImage || ''];
    const root = this.getPbootSiteRoot();
    const directory = resolveContentThumbnailDirectory(root, title, references, this.sitesService.getPbootPublicBaseUrl(), Number(news?.menuId || menu.id), 'news');
    return saveUploadedContentThumbnail(root, directory, file.buffer);
  }

  async scanNewsFolderImport(postObj: ImportNewsFolderDto) {
    const menu = await this.requireChineseNewsImportMenu(postObj.menuId);
    const candidates = scanNewsFolders(postObj.sourceDirectory);
    const duplicateNames = await this.findDuplicateNewsTitles(postObj.menuId, candidates);
    const items = candidates.map((candidate) => this.createNewsFolderScanItem(candidate, duplicateNames));
    return {
      sourceDirectory: path.resolve(String(postObj.sourceDirectory || '').trim().replace(/^(["'])([\s\S]*)\1$/, '$2')),
      menuId: Number(menu.id),
      menuName: menu.name,
      total: items.length,
      importable: items.filter((item) => !item.duplicate).length,
      duplicates: items.filter((item) => item.duplicate).length,
      items,
    };
  }

  async importNewsFolders(postObj: ImportNewsFolderDto) {
    const menu = await this.requireChineseNewsImportMenu(postObj.menuId);
    const candidates = scanNewsFolders(postObj.sourceDirectory);
    if (!candidates.length) throw new BadRequestException('没有找到符合命名规则的新闻文件夹。');
    const duplicateNames = await this.findDuplicateNewsTitles(postObj.menuId, candidates);
    const protection = await this.syncGuard.protectBeforeDangerousSync('news_folder_import', 'news');
    const siteRoot = this.getPbootSiteRoot();

    const siteId = await this.currentSiteId();
    const existing = await this.newsRepo.find({ where: { siteId, menuId: Number(menu.id) } });
    let nextOrder = existing.reduce((maximum, news) => Math.max(maximum, Number(news.orderNum || 0)), 0) + 1;
    const created: Array<{ id: number; title: string; relativePath: string }> = [];
    const skipped: Array<{ title: string; reason: string }> = [];
    const failed: Array<{ title: string; reason: string }> = [];

    for (const candidate of candidates) {
      const normalizedTitle = candidate.title.trim().toLocaleLowerCase();
      if (duplicateNames.has(normalizedTitle)) {
        skipped.push({ title: candidate.title, reason: '同栏目已存在相同标题' });
        continue;
      }

      try {
        const title = candidate.title.trim().slice(0, 120);
        const generatedThumbnail = await ensureFolderThumbnail(candidate.directory, candidate.thumbnailSourceFile);
        const resolveAsset = createFolderAssetResolver(siteRoot, candidate.directory,
          path.join('static', 'codex', 'news-folder-import', String(menu.id), safeNewsAssetSegment(candidate.title)));
        const thumbnail = resolveAsset(generatedThumbnail || candidate.thumbnailImageFile);
        const detailImages = candidate.detailImageFiles.map(resolveAsset);
        const sourceHtml = readNewsDetailHtml(candidate);
        const content = buildImportedNewsContent(sourceHtml, title, detailImages);
        const summary = `${title} 新闻详情`;
        const urlName = buildLanguageSeoUrlName(DEFAULT_NEWS_LANG, title, title);
        const saved = await this.create({
          menuId: Number(menu.id),
          title,
          urlName,
          subtitle: '',
          keywords: title,
          thumbnail,
          summary,
          content,
          author: 'admin',
          source: '文件夹批量导入',
          show: true,
          orderNum: nextOrder,
          translations: [{
            lang: DEFAULT_NEWS_LANG,
            title,
            urlName,
            subtitle: '',
            keywords: title,
            summary,
            content,
          }],
        });
        nextOrder += 1;
        duplicateNames.add(normalizedTitle);
        created.push({ id: saved.id, title: candidate.title, relativePath: candidate.relativePath });
      } catch (error) {
        failed.push({ title: candidate.title, reason: error instanceof Error ? error.message : String(error) });
      }
    }

    return {
      menuId: Number(menu.id),
      menuName: menu.name,
      localBackupPath: protection.backupPath,
      total: candidates.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      created,
      skipped,
      failed,
    };
  }

  async findAll(menuId?: number, lang?: string) {
    const targetLang = resolveNewsLang(lang);
    const menuIds = await this.resolveMenuFilterIds(menuId, targetLang);
    const siteId = await this.currentSiteId();
    const rows = await this.newsRepo.find({
      where: menuIds?.length ? { siteId, menuId: In(menuIds) } : { siteId },
      order: { orderNum: 'ASC', id: 'DESC' },
    });

    const translations = rows.length
      ? await this.translationRepo.find({ where: { newsId: In(rows.map(row => row.id)) } })
      : [];
    const languages = await this.getConfiguredLanguageCodes();
    const grouped = new Map<number, NewsTranslation[]>();
    for (const translation of translations) {
      const group = grouped.get(translation.newsId) || [];
      group.push(translation);
      grouped.set(translation.newsId, group);
    }
    return rows.flatMap(row => {
      const saved = grouped.get(row.id) || [];
      const translation = saved.find(item => item.lang === targetLang);
      if (!translation && targetLang !== DEFAULT_NEWS_LANG) return [];
      return [{ ...this.mergeTranslation(row, translation, targetLang),
        translationProgress: contentTranslationProgress(row, saved, languages) }];
    });
  }

  async getPbootStats(menuId?: number, lang?: string) {
    const targetLang = resolveNewsLang(lang);
    const localCount = (await this.findAll(menuId, targetLang)).length;
    const pbootCount = await this.countPbootContent(menuId, targetLang, '2');

    return {
      lang: targetLang,
      menuId: menuId || null,
      localCount,
      pbootCount,
      syncCount: pbootCount,
      diff: pbootCount - localCount,
    };
  }

  private async resolveMenuFilterIds(menuId?: number, lang = DEFAULT_NEWS_LANG) {
    if (!menuId) return undefined;

    const menus = await this.findSiteMenus();
    return resolveChineseMenuScope(menus, menuId, resolveNewsLang(lang), '2').sourceMenuIds;
  }

  private async requireChineseNewsImportMenu(menuId: number) {
    const siteId = await this.currentSiteId();
    const menu = await this.menusRepo.findOne({ where: { id: String(menuId), siteId } });
    if (!menu) throw new BadRequestException('指定的新闻栏目不存在或不属于当前网站。');
    if (!String(menu.code || '').startsWith('pboot:cn:') || String(menu.model || '') !== '2') {
      throw new BadRequestException('文件夹新闻只能导入到当前网站的中文新闻栏目。');
    }
    return menu;
  }

  private async findDuplicateNewsTitles(menuId: number, candidates: NewsFolderCandidate[]) {
    if (!candidates.length) return new Set<string>();
    const siteId = await this.currentSiteId();
    const existing = await this.newsRepo.find({ where: { siteId, menuId: Number(menuId) } });
    return new Set(existing.map((news) => String(news.title || '').trim().toLocaleLowerCase()).filter(Boolean));
  }

  private createNewsFolderScanItem(candidate: NewsFolderCandidate, duplicateNames: Set<string>) {
    return {
      title: candidate.title,
      relativePath: candidate.relativePath,
      thumbnailImage: candidate.thumbnailImageFile,
      thumbnailWillGenerate: Boolean(candidate.thumbnailSourceFile),
      detailHtml: candidate.detailHtmlFile,
      detailImages: candidate.detailImageFiles,
      duplicate: duplicateNames.has(candidate.title.trim().toLocaleLowerCase()),
      warnings: candidate.warnings,
    };
  }

  private normalizeMenuSlug(menu: Pick<Menu, 'urlName' | 'href' | 'name'>) {
    return String(menu.urlName || menu.href || menu.name || '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/^(cn|en|es|fr|ru|ar|pt|id|tr|vi)[-_/]+/i, '')
      .toLowerCase();
  }

  async findOneById(id: number, lang?: string): Promise<NewsWithTranslations> {
    if (!id) return null;
    const news = await this.findNewsEntity(id);

    await this.ensureTranslations(news);
    const targetLang = resolveNewsLang(lang);
    const [translation, translations] = await Promise.all([
      this.translationRepo.findOneBy({ newsId: id, lang: targetLang }),
      this.translationRepo.find({ where: { newsId: id }, order: { id: 'ASC' } }),
    ]);

    return this.mergeTranslation(news, translation, targetLang, translations);
  }

  async update(id: number, postObj: UpdateNewsDto) {
    const news = await this.findNewsEntity(id);
    const defaultContent = this.getDefaultContent(postObj, news);
    const saved = await this.newsRepo.save({
      ...news,
      ...postObj,
      title: defaultContent.title,
      urlName: this.normalizeNewsUrlName(defaultContent.urlName, DEFAULT_NEWS_LANG, id),
      subtitle: defaultContent.subtitle,
      keywords: defaultContent.keywords,
      summary: defaultContent.summary,
      description: defaultContent.summary,
      content: defaultContent.content,
    });

    await this.ensureTranslations(saved, postObj.translations, true);
    return await this.findOneById(id);
  }

  async translate(id: number) {
    const news = await this.findNewsEntity(id);
    await this.ensureTranslations(news);
    return await this.findOneById(id);
  }

  async syncToPboot(id: number, options: SyncNewsDto = {}, beforeWrite?: () => Promise<void>) {
    const news = await this.findNewsEntity(id);
    await this.ensureTranslations(news);
    const translations = await this.translationRepo.find({ where: { newsId: id }, order: { id: 'ASC' } });
    const translationMap = new Map(translations.map((item) => [item.lang, item]));
    const langs = await this.resolveConfiguredSyncLanguages(options.all, options.lang, 'en');
    const dbPath = this.getPbootDbPath();
    const siteRoot = this.getPbootSiteRoot();

    if (!fs.existsSync(dbPath)) {
      throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);
    }
    if (!fs.existsSync(siteRoot)) {
      throw new BadRequestException(`PbootCMS site root not found: ${siteRoot}`);
    }

    await this.syncGuard.protectBeforeDangerousSync('news_push_one', 'news');
    const backupPath = this.backupPbootDatabase(dbPath);
    const SQL = await initSqlJs();
    const dbFile = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbFile);
    const synced: PbootSyncItem[] = [];

    try {
      for (const lang of langs) {
        const config = PBOOT_NEWS_SORTS[lang];
        if (!config) continue;
        const translation = translationMap.get(lang);
        const content = this.pickContentForPboot(news, translation, lang);
        if (!content.title.trim()) continue;

        const resolvedConfig = await this.resolvePbootConfigFromMenu(config, news.menuId);
        const item = this.upsertPbootNews(db, news, content, lang, resolvedConfig, siteRoot);
        synced.push(item);
      }

      if (!synced.length) {
        throw new BadRequestException('No publishable language content was found for PbootCMS sync.');
      }

      if (beforeWrite) await beforeWrite();
      const exported = db.export();
      if (!fs.readFileSync(dbPath).equals(dbFile)) throw new BadRequestException('PB 数据库已被其他操作修改，请重新同步');
      fs.writeFileSync(dbPath, Buffer.from(exported));
    } finally {
      db.close();
    }

    return {
      msg: 'PbootCMS sync completed',
      backupPath,
      synced,
    };
  }

  async syncChineseNewsScope(menuId: number, execute = false) {
    const siteId = await this.currentSiteId();
    const menus = await this.findSiteMenus();
    const menu = menus.find((item) => Number(item.id) === menuId);
    if (!menu?.code?.startsWith('pboot:cn:') || String(menu.model) !== '2') {
      throw new BadRequestException('请选择当前网站的中文新闻栏目');
    }
    const scope = resolveChineseMenuScope(menus, menuId, DEFAULT_NEWS_LANG, '2');
    const articles = await this.newsRepo.find({
      where: { siteId, menuId: In(scope.sourceMenuIds) }, order: { orderNum: 'ASC', id: 'ASC' },
    });
    const translations = articles.length ? await this.translationRepo.find({
      where: { newsId: In(articles.map((item) => item.id)) },
    }) : [];
    const translationMap = new Map(translations.map((item) => [`${item.newsId}:${item.lang}`, item]));
    const langs = await this.getConfiguredLanguageCodes();
    const dbPath = this.getPbootDbPath();
    const siteRoot = this.getPbootSiteRoot();
    if (!fs.existsSync(dbPath) || !fs.existsSync(siteRoot)) throw new BadRequestException('当前网站的 PB 数据库或网站目录不存在');
    const SQL = await initSqlJs();
    const originalBytes = fs.readFileSync(dbPath);
    const db = new SQL.Database(new Uint8Array(originalBytes));
    const skipped: { newsId: number; title: string; lang: string; reason: string }[] = [];
    const blocked: typeof skipped = [];
    const ready: { article: News; content: NewsContent; lang: string; config: PbootLanguageConfig }[] = [];
    const configs = new Map<string, PbootLanguageConfig | string>();
    const destinations = new Set<string>();
    try {
      for (const article of articles) {
        const source = translationMap.get(`${article.id}:${DEFAULT_NEWS_LANG}`) || article;
        for (const lang of langs) {
          const translation = translationMap.get(`${article.id}:${lang}`);
          const fields = missingTranslationFields(source, lang === DEFAULT_NEWS_LANG ? source : translation);
          const item = { newsId: article.id, title: article.title, lang };
          if (fields.length) {
            skipped.push({ ...item, reason: `缺少${fields.join('、')}` });
            continue;
          }
          const key = `${article.menuId}:${lang}`;
          if (!configs.has(key)) {
            try {
              const config = await this.resolvePbootConfigFromMenu(PBOOT_NEWS_SORTS[lang], article.menuId);
              const websiteMenu = this.queryOne(db, 'select mcode from ay_content_sort where acode=? and scode=? limit 1', [config.acode, config.scode]);
              configs.set(key, !websiteMenu ? '对应栏目尚未写入 PB，请先同步栏目'
                : String(websiteMenu.mcode) !== '2' ? `PB 栏目 ${config.scode} 不是新闻模型` : config);
            } catch (error) {
              if (!(error instanceof BadRequestException)) throw error;
              configs.set(key, error.message);
            }
          }
          const config = configs.get(key)!;
          if (typeof config === 'string') {
            blocked.push({ ...item, reason: config });
            continue;
          }
          const content = this.pickContentForPboot(article, translation, lang);
          const requestedFilename = this.normalizePbootFilename(content.urlName);
          const filename = requestedFilename || `vue-news-${article.id}-${config.acode}`;
          const existing = this.queryOne(db, 'select id,scode from ay_content where acode=? and filename=? limit 1', [config.acode, filename]);
          if (existing && String(existing.scode) !== config.scode) {
            blocked.push({ ...item, reason: `URL ${filename} 已被 PB 其他栏目使用，请先修改 URL 名称` });
            continue;
          }
          const destination = requestedFilename ? `${config.acode}:url:${filename}`
            : `${config.acode}:title:${config.scode}:${content.title.trim()}`;
          if (destinations.has(destination)) {
            blocked.push({ ...item, reason: '本次范围内存在重复 URL 或同栏目同名新闻，请先检查' });
            continue;
          }
          destinations.add(destination);
          ready.push({ article, content, lang, config });
        }
      }
      const preview = {
        siteId, siteName: this.sitesService.getCurrentSite().name, menuId, menuName: menu.name,
        totalNews: articles.length, totalLanguages: langs.length, readyCount: ready.length, skipped, blocked,
      };
      if (!execute) return { ...preview, syncedCount: 0, created: 0, updated: 0, deleted: 0, backupPath: '' };
      if (blocked.length) throw new BadRequestException(`同步前检查未通过，未写入任何新闻：${blocked.slice(0, 5).map((item) => `${item.title} / ${item.lang}：${item.reason}`).join('；')}`);
      if (!ready.length) throw new BadRequestException('所选栏目及子栏目没有内容完整的新闻语言版本可同步');
      await this.syncGuard.protectBeforeDangerousSync('news_chinese_scope_all_languages', 'news');
      // The PB file may have changed while asynchronous preflight/backup checks were running.
      if (!fs.readFileSync(dbPath).equals(originalBytes)) throw new BadRequestException('PB 数据刚刚发生变化，本次未写入，请重新检查后同步');
      const backupPath = this.backupPbootDatabase(dbPath);
      const synced = ready.map(({ article, content, lang, config }) => this.upsertPbootNews(db, article, content, lang, config, siteRoot));
      if (!fs.readFileSync(dbPath).equals(originalBytes)) throw new BadRequestException('PB 数据刚刚发生变化，本次未写入，请重新检查后同步');
      fs.writeFileSync(dbPath, Buffer.from(db.export()));
      return {
        ...preview, backupPath, syncedCount: synced.length, deleted: 0,
        created: synced.filter((item) => item.action === 'created').length,
        updated: synced.filter((item) => item.action === 'updated').length,
      };
    } finally {
      db.close();
    }
  }

  async syncAllToPboot() {
    const dbPath = this.getPbootDbPath();
    const siteRoot = this.getPbootSiteRoot();

    if (!fs.existsSync(dbPath)) {
      throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);
    }
    if (!fs.existsSync(siteRoot)) {
      throw new BadRequestException(`PbootCMS site root not found: ${siteRoot}`);
    }

    await this.syncGuard.protectBeforeDangerousSync('news_push_all', 'news');
    const newsRows = await this.newsRepo.find({
      where: { siteId: await this.currentSiteId() },
      order: { orderNum: 'ASC', id: 'ASC' },
    });
    await Promise.all(newsRows.map((row) => this.ensureTranslations(row)));
    const langs = await this.getConfiguredLanguageCodes();

    const backupPath = this.backupPbootDatabase(dbPath);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const synced: PbootSyncItem[] = [];
    let deleted = 0;

    try {
      deleted = this.deletePbootGeneratedContent(db, 'vue-news-%');

      for (const news of newsRows) {
        const translations = await this.translationRepo.find({ where: { newsId: news.id }, order: { id: 'ASC' } });
        const translationMap = new Map(translations.map((item) => [item.lang, item]));

        for (const lang of langs) {
          const config = PBOOT_NEWS_SORTS[lang];
          if (!config) continue;

          const content = this.pickContentForPboot(news, translationMap.get(lang), lang);
          if (!content.title.trim()) continue;

          const resolvedConfig = await this.resolvePbootConfigFromMenu(config, news.menuId);
          synced.push(this.upsertPbootNews(db, news, content, lang, resolvedConfig, siteRoot));
        }
      }

      fs.writeFileSync(dbPath, Buffer.from(db.export()));
    } finally {
      db.close();
    }

    return {
      msg: 'PbootCMS all news sync completed',
      backupPath,
      deleted,
      totalNews: newsRows.length,
      syncedCount: synced.length,
      synced,
    };
  }

  async pullPbootScope(menuId: number, lang?: string) {
    const targetLang = resolveNewsLang(lang);
    const acode = this.langToPbootAcode(targetLang);
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);

    const guard = await this.syncGuard.protectBeforeDangerousSync('news_scope_import_from_pboot');
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    try {
      const siteId = await this.currentSiteId();
      const menus = await this.findSiteMenus();
      const scope = resolveChineseMenuScope(menus, menuId, targetLang, '2');
      const scodes = await this.resolvePbootFilterScodes(db, menuId, acode, '2');
      const scodeSet = new Set(scodes || []);
      const { groups } = readPbootNewsContentGroups(db);
      const scopedGroups = groups.filter((group) => {
        const row = group.byLang.get(acode);
        return row && scodeSet.has(String(row.scode));
      });
      const resolveMenuId = createPbootMenuResolver(db, menus, '2', 'pboot:cn:330');
      const existingRows = await this.newsRepo.find({ where: { siteId, menuId: In(scope.sourceMenuIds) } });
      const existingTranslations = existingRows.length
        ? await this.translationRepo.find({
            where: existingRows.map((row) => ({ newsId: row.id, lang: targetLang })),
          })
        : [];
      const translationByNews = new Map(existingTranslations.map((row) => [row.newsId, row]));
      const matchedNewsIds = new Set<number>();
      let created = 0;
      let updated = 0;

      for (const group of scopedGroups) {
        const targetRow = group.byLang.get(acode);
        if (!targetRow) continue;
        let news = this.matchNewsForPbootGroup(group, targetRow, existingRows, existingTranslations);
        const baseRow = choosePbootBaseRow(group) || targetRow;

        if (!news) {
          const resolvedMenuId = resolveMenuId(baseRow);
          const sourceMenuId = scope.sourceMenuIds.includes(resolvedMenuId) ? resolvedMenuId : Number(scope.sourceMenu.id);
          news = await this.newsRepo.save(this.newsRepo.create({ siteId, ...this.newsValuesFromPboot(baseRow, sourceMenuId) }));
          existingRows.push(news);
          created += 1;
        } else if (targetLang === DEFAULT_NEWS_LANG) {
          news = await this.newsRepo.save({ ...news, ...this.newsValuesFromPboot(targetRow, news.menuId) });
          updated += 1;
        }

        const existingTranslation = translationByNews.get(news.id);
        const savedTranslation = await this.translationRepo.save(
          this.translationRepo.create({
            ...(existingTranslation || {}),
            newsId: news.id,
            lang: targetLang,
            ...this.newsTranslationValuesFromPboot(targetRow),
          }),
        );
        translationByNews.set(news.id, savedTranslation);
        matchedNewsIds.add(news.id);
      }

      let deleted = 0;
      if (targetLang === DEFAULT_NEWS_LANG) {
        const stale = existingRows.filter((row) => !matchedNewsIds.has(row.id));
        if (stale.length) {
          await this.newsRepo.remove(stale);
          deleted = stale.length;
        }
      } else {
        const stale = existingTranslations.filter((row) => !matchedNewsIds.has(row.newsId));
        if (stale.length) {
          await this.translationRepo.remove(stale);
          deleted = stale.length;
        }
      }

      return {
        msg: 'Current news scope was overwritten from PbootCMS.',
        localBackupPath: guard.backupPath,
        lang: targetLang,
        menuId,
        pbootCount: scopedGroups.length,
        created,
        updated,
        deleted,
      };
    } finally {
      db.close();
    }
  }

  async pushPbootScope(menuId: number, lang?: string) {
    const targetLang = resolveNewsLang(lang);
    const acode = this.langToPbootAcode(targetLang);
    const dbPath = this.getPbootDbPath();
    const siteRoot = this.getPbootSiteRoot();
    if (!fs.existsSync(dbPath)) throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);

    await this.syncGuard.protectBeforeDangerousSync('news_scope_push_to_pboot', 'news');
    const backupPath = this.backupPbootDatabase(dbPath);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    try {
      const siteId = await this.currentSiteId();
      const menus = await this.findSiteMenus();
      const scope = resolveChineseMenuScope(menus, menuId, targetLang, '2');
      const scodes = await this.resolvePbootFilterScodes(db, menuId, acode, '2');
      const rows = await this.newsRepo.find({
        where: { siteId, menuId: In(scope.sourceMenuIds) },
        order: { orderNum: 'ASC', id: 'ASC' },
      });
      const translations = rows.length
        ? await this.translationRepo.find({ where: rows.map((row) => ({ newsId: row.id, lang: targetLang })) })
        : [];
      const translationMap = new Map(translations.map((row) => [row.newsId, row]));
      const params = [acode, ...(scodes || [])];
      const placeholders = (scodes || []).map(() => '?').join(',');
      const deleted = scodes?.length
        ? this.runDeleteSql(db, `delete from ay_content where acode=? and scode in (${placeholders})`, params)
        : 0;
      const synced: PbootSyncItem[] = [];

      for (const news of rows) {
        const translation = translationMap.get(news.id);
        if (!translation) continue;
        const content = this.pickContentForPboot(news, translation, targetLang);
        if (!content.title.trim()) continue;
        const config = await this.resolvePbootConfigFromMenu(PBOOT_NEWS_SORTS[targetLang], news.menuId);
        if (!scodes?.includes(String(config.scode))) {
          throw new BadRequestException(`News ${news.id} resolved outside the selected PbootCMS scope.`);
        }
        synced.push(this.upsertPbootNews(db, news, content, targetLang, config, siteRoot));
      }

      fs.writeFileSync(dbPath, Buffer.from(db.export()));
      return {
        msg: 'Current news scope was overwritten in PbootCMS.',
        backupPath,
        lang: targetLang,
        menuId,
        deleted,
        syncedCount: synced.length,
        synced,
      };
    } finally {
      db.close();
    }
  }

  private matchNewsForPbootGroup(
    group: PbootContentGroup,
    targetRow: PbootContentRow,
    newsRows: News[],
    translations: NewsTranslation[],
  ) {
    const generated = String(targetRow.filename || '').match(/^vue-news-(\d+)(?:-|$)/i);
    if (generated) {
      const direct = newsRows.find((row) => row.id === Number(generated[1]));
      if (direct) return direct;
    }
    const filenames = new Set(group.rows.map((row) => this.normalizePbootFilename(row.filename)).filter(Boolean));
    const titles = new Set(group.rows.map((row) => String(row.title || '').trim()).filter(Boolean));
    const translated = translations.find(
      (row) => filenames.has(this.normalizePbootFilename(row.urlName)) || titles.has(String(row.title || '').trim()),
    );
    if (translated) return newsRows.find((row) => row.id === translated.newsId);
    return newsRows.find(
      (row) => filenames.has(this.normalizePbootFilename(row.urlName)) || titles.has(String(row.title || '').trim()),
    );
  }

  private newsValuesFromPboot(row: PbootContentRow, menuId: number) {
    return {
      menuId,
      title: row.title || '',
      urlName: row.filename || '',
      subtitle: row.subtitle || '',
      keywords: row.keywords || '',
      description: row.description || '',
      thumbnail: normalizePbootImage(row.ico),
      summary: row.description || '',
      content: row.content || '',
      author: '',
      source: '',
      show: String(row.status) !== '0',
      orderNum: Number(row.sorting || 0),
      createTime: toPbootDate(row.date || row.create_time),
      updateTime: toPbootDate(row.update_time || row.date || row.create_time),
    };
  }

  private newsTranslationValuesFromPboot(row: PbootContentRow) {
    return {
      title: row.title || '',
      urlName: row.filename || '',
      subtitle: row.subtitle || '',
      keywords: row.keywords || '',
      description: row.description || '',
      summary: row.description || '',
      content: row.content || '',
      createTime: toPbootDate(row.date || row.create_time),
      updateTime: toPbootDate(row.update_time || row.date || row.create_time),
    };
  }

  async importFromPboot() {
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) {
      throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);
    }

    const guard = await this.syncGuard.protectBeforeDangerousSync('news_import_from_pboot');
    const localBackupPath = guard.backupPath;
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    try {
      const { sourceRows, groups } = readPbootNewsContentGroups(db);
      const siteId = await this.currentSiteId();
      const menus = await this.findSiteMenus();
      const resolveMenuId = createPbootMenuResolver(db, menus, '2', 'pboot:cn:330');

      await this.deleteSiteNews(siteId);

      let imported = 0;
      let importedTranslations = 0;

      for (const group of groups) {
        const base = choosePbootBaseRow(group);
        if (!base) continue;

        const menuId = resolveMenuId(base);
        if (!menuId) continue;

        const created = toPbootDate(base.date || base.create_time);
        const updated = toPbootDate(base.update_time || base.date || base.create_time);
        const saved = await this.newsRepo.save(
          this.newsRepo.create({
            siteId,
            menuId,
            title: base.title || '',
            urlName: base.filename || '',
            subtitle: base.subtitle || '',
            keywords: base.keywords || '',
            description: base.description || '',
            thumbnail: normalizePbootImage(base.ico),
            summary: base.description || '',
            content: base.content || '',
            author: '',
            source: '',
            show: String(base.status) !== '0',
            orderNum: Number(base.sorting || 0),
            createTime: created,
            updateTime: updated,
          }),
        );
        imported += 1;

        const translations = [...group.byLang.entries()]
          .map(([acode, row]) => {
            const lang = PBOOT_LANG_MAP[acode];
            if (!lang) return null;
            return this.translationRepo.create({
              newsId: saved.id,
              lang,
              title: row.title || '',
              urlName: row.filename || '',
              subtitle: row.subtitle || '',
              keywords: row.keywords || '',
              description: row.description || '',
              summary: row.description || '',
              content: row.content || '',
              createTime: toPbootDate(row.date || row.create_time),
              updateTime: toPbootDate(row.update_time || row.date || row.create_time),
            });
          })
          .filter(Boolean) as NewsTranslation[];

        if (translations.length) {
          await this.translationRepo.save(translations);
          importedTranslations += translations.length;
        }
      }

      return {
        msg: 'PbootCMS news import completed',
        localBackupPath,
        sourceRows,
        imported,
        importedTranslations,
      };
    } finally {
      db.close();
    }
  }

  async remove(id: number) {
    const news = await this.findNewsEntity(id);
    const pbootDelete = await this.deleteFromPboot(news);
    await this.translationRepo.delete({ newsId: id });
    const res = await this.newsRepo.remove(news);
    return { msg: '删除成功', res, pbootDelete };
  }

  private async deleteFromPboot(news: News) {
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) {
      return { skipped: true, reason: `PbootCMS database not found: ${dbPath}`, deleted: 0, backupPath: '' };
    }

    const backupPath = this.backupPbootDatabase(dbPath);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const translations = await this.translationRepo.find({ where: { newsId: news.id }, order: { id: 'ASC' } });
    const translationMap = new Map(translations.map((item) => [item.lang, item]));
    const langs = await this.getConfiguredLanguageCodes();
    let deleted = 0;

    try {
      deleted += this.deletePbootGeneratedContent(db, `vue-news-${news.id}-%`);

      for (const lang of langs) {
        const config = PBOOT_NEWS_SORTS[lang];
        if (!config) continue;

        const content = this.pickContentForPboot(news, translationMap.get(lang), lang);
        if (!content.title.trim()) continue;

        const resolvedConfig = await this.resolvePbootConfigFromMenu(config, news.menuId);
        deleted += this.deletePbootImportedContent(db, resolvedConfig.acode, resolvedConfig.scode, content.title);
      }

      fs.writeFileSync(dbPath, Buffer.from(db.export()));
      return { skipped: false, deleted, backupPath };
    } finally {
      db.close();
    }
  }

  private getPbootDbPath() {
    return this.sitesService.getPbootDbPath();
  }

  private getPbootSiteRoot() {
    return this.sitesService.getPbootSiteRoot();
  }

  private getPbootPublicBaseUrl() {
    return this.sitesService.getPbootPublicBaseUrl();
  }

  private backupPbootDatabase(dbPath: string) {
    const ext = path.extname(dbPath);
    const base = dbPath.slice(0, -ext.length);
    const stamp = this.formatCompactDate(new Date());
    const backupPath = `${base}.before_admin_sync_${stamp}${ext}`;
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
  }

  private backupLocalDatabase(reason: string) {
    const configured = this.config.get<string>('DB_SQLJS_LOCATION', 'dev.sqlite');
    if (!configured) return '';

    const dbPath = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
    if (!fs.existsSync(dbPath)) return '';

    const parsed = path.parse(dbPath);
    const backupPath = path.join(parsed.dir, `${parsed.name}.before_${reason}_${this.formatCompactDate(new Date())}${parsed.ext}`);
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
  }

  private pickContentForPboot(news: News, translation: NewsTranslation | undefined, lang: string) {
    return {
      lang,
      title: translation?.title || news.title || '',
      urlName: this.normalizeNewsUrlName(translation?.urlName ?? news.urlName ?? '', lang, news.id),
      subtitle: translation?.subtitle ?? news.subtitle ?? '',
      keywords: translation?.keywords ?? news.keywords ?? '',
      summary: translation?.summary ?? news.summary ?? '',
      description: translation?.summary ?? news.summary ?? '',
      content: repairTranslatedHtml(this.decodeHtmlEntities(translation?.content ?? news.content ?? '')),
    };
  }

  private upsertPbootNews(
    db: any,
    news: News,
    content: { lang: string; title: string; urlName: string; subtitle: string; keywords: string; description: string; summary: string; content: string },
    lang: string,
    config: PbootLanguageConfig,
    siteRoot: string,
  ): PbootSyncItem {
    const now = this.formatPbootDate(new Date());
    const requestedFilename = this.normalizePbootFilename(content.urlName);
    const filename = requestedFilename || `vue-news-${news.id}-${config.acode}`;
    const ico = this.preparePbootImage(news.thumbnail, siteRoot, now);
    const pbootContent = this.preparePbootContent(content.content || '', siteRoot, now);
    const row = requestedFilename
      ? this.getPbootExistingRow(db, config.acode, filename)
      : this.getPbootExistingContentRow(db, config.acode, config.scode, content.title);
    const values = {
      acode: config.acode,
      scode: config.scode,
      subscode: '',
      title: content.title.slice(0, 100),
      titlecolor: '',
      subtitle: content.subtitle.slice(0, 100),
      filename,
      author: '',
      source: '',
      outlink: '',
      date: now,
      ico,
      pics: '',
      content: pbootContent,
      tags: '',
      enclosure: '',
      keywords: (content.keywords || content.title).slice(0, 200),
      description: (content.summary || this.stripHtml(content.content)).slice(0, 500),
      sorting: Number(news.orderNum || 0),
      status: news.show ? '1' : '0',
      istop: '0',
      isrecommend: '0',
      isheadline: '0',
      visits: 0,
      likes: 0,
      oppose: 0,
      create_user: 'admin',
      update_user: 'admin',
      create_time: now,
      update_time: now,
      gtype: '4',
      gid: '',
      gnote: '',
      picstitle: '',
    };

    if (row) {
      const fields = [
        'scode',
        'title',
        'subtitle',
        'filename',
        'date',
        'ico',
        'content',
        'keywords',
        'description',
        'sorting',
        'status',
        'update_user',
        'update_time',
      ];
      this.runSql(
        db,
        `update ay_content set ${fields.map((field) => `${field}=?`).join(',')} where id=?`,
        [...fields.map((field) => values[field]), row.id],
      );
      return this.createPbootSyncItem(lang, config, row.id, values.title, filename, 'updated');
    }

    const columns = Object.keys(values);
    this.runSql(
      db,
      `insert into ay_content (${columns.join(',')}) values (${columns.map(() => '?').join(',')})`,
      columns.map((field) => values[field]),
    );
    const inserted = this.getPbootExistingRow(db, config.acode, filename);
    return this.createPbootSyncItem(lang, config, inserted?.id || 0, values.title, filename, 'created');
  }

  private async resolvePbootConfigFromMenu(config: PbootLanguageConfig, menuId: number) {
    if (!menuId) return config;

    const siteId = await this.currentSiteId();
    const sourceMenu = await this.menusRepo.findOne({ where: { id: String(menuId), siteId } });
    if (!sourceMenu?.code?.startsWith('pboot:')) return config;

    const menus = await this.findSiteMenus();
    const targetLang = PBOOT_LANG_MAP[config.acode] || config.acode;
    const targetMenus = menus.filter((menu) => {
      if (!menu.code?.startsWith(`pboot:${config.acode}:`)) return false;
      try {
        return Number(resolveChineseMenuScope(menus, Number(menu.id), targetLang, '2').sourceMenu.id) === Number(sourceMenu.id);
      } catch {
        return false;
      }
    });

    if (!targetMenus.length) throw new BadRequestException('缺少对应语言的新闻栏目，或中文来源不唯一，请先在菜单管理确认关联并同步栏目');
    if (targetMenus.length > 1) throw new BadRequestException('对应语言的新闻栏目匹配不唯一，请先检查栏目');
    const targetMenu = targetMenus[0];

    const scode = this.getPbootScode(targetMenu.code) || config.scode;
    return {
      ...config,
      scode,
      sortFilename: this.hrefToSortFilename(targetMenu.href) || config.sortFilename,
    };
  }

  private getPbootExistingRow(db: any, acode: string, filename: string) {
    const result = this.queryOne(db, 'select id from ay_content where acode=? and filename=? limit 1', [acode, filename]);
    return result ? { id: Number(result.id) } : null;
  }

  private getPbootExistingContentRow(db: any, acode: string, scode: string, title: string) {
    const result = this.queryOne(db, 'select id from ay_content where acode=? and scode=? and title=? limit 1', [acode, scode, String(title || '').trim()]);
    return result ? { id: Number(result.id) } : null;
  }

  private getPbootScode(code: string) {
    return String(code || '').match(/^pboot:[^:]+:(.+)$/)?.[1] || '';
  }

  private hrefToSortFilename(href: string) {
    return String(href || '').replace(/^\/+/, '').trim();
  }

  private normalizeMenuHref(href: string) {
    return this.hrefToSortFilename(href)
      .replace(/^(cn|es|fr|ru|ar|pt)-/i, '')
      .toLowerCase();
  }

  private createPbootSyncItem(lang: string, config: PbootLanguageConfig, pbootId: number, title: string, filename: string, action: 'created' | 'updated'): PbootSyncItem {
    return {
      lang,
      acode: config.acode,
      scode: config.scode,
      pbootId,
      title,
      filename,
      url: `${this.getPbootPublicBaseUrl()}/${config.sortFilename}/${filename}.html`,
      action,
    };
  }

  private preparePbootImage(thumbnail: string, siteRoot: string, now: string) {
    return copyUploadedImageToPboot(thumbnail, this.sitesService, siteRoot, now, 'news');
  }

  private preparePbootContent(content: string, siteRoot: string, now: string) {
    return rewriteUploadedHtmlImages(content, src => this.preparePbootImage(src, siteRoot, now));
  }

  private normalizePbootFilename(value: string) {
    return String(value || '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/\.html?$/i, '');
  }

  private async countPbootContent(menuId: number | undefined, lang: string, mcode: string) {
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) return 0;

    const acode = this.langToPbootAcode(lang);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    try {
      const scodes = await this.resolvePbootFilterScodes(db, menuId, acode, mcode);
      const params: any[] = [acode, mcode];
      let scodeSql = '';

      if (scodes?.length) {
        scodeSql = ` and c.scode in (${scodes.map(() => '?').join(',')})`;
        params.push(...scodes);
      }

      const row = this.queryOne(
        db,
        `select count(*) as count
         from ay_content c
         join ay_content_sort s on s.acode = c.acode and s.scode = c.scode
         where c.acode = ? and s.mcode = ?${scodeSql}`,
        params,
      );
      return Number(row?.count || 0);
    } finally {
      db.close();
    }
  }

  private async resolvePbootFilterScodes(db: any, menuId: number | undefined, acode: string, mcode: string) {
    if (!menuId) return undefined;

    const menus = await this.findSiteMenus();
    const selected = menus.find((menu) => Number(menu.id) === Number(menuId));
    if (!selected) throw new BadRequestException('The selected menu no longer exists.');
    const targetLang = PBOOT_LANG_MAP[acode] || acode;
    resolveChineseMenuScope(menus, menuId, targetLang, mcode);
    if (!selected.code?.startsWith(`pboot:${acode}:`)) {
      throw new BadRequestException('The selected menu does not belong to the current language.');
    }

    const rootScode = this.getPbootScode(selected.code);
    if (!rootScode) throw new BadRequestException('The selected menu has no PbootCMS column code.');

    const sorts = queryPbootRows<{ scode: string; pcode: string }>(
      db,
      'select scode,pcode from ay_content_sort where acode=? and mcode=?',
      [acode, mcode],
    );
    const result = new Set<string>([rootScode]);
    let changed = true;

    while (changed) {
      changed = false;
      for (const row of sorts) {
        const scode = String(row.scode || '').trim();
        const pcode = String(row.pcode || '').trim();
        if (scode && result.has(pcode) && !result.has(scode)) {
          result.add(scode);
          changed = true;
        }
      }
    }

    return [...result];
  }

  private langToPbootAcode(lang: string) {
    return lang === DEFAULT_NEWS_LANG ? 'cn' : String(lang || 'en');
  }

  private queryOne(db: any, sql: string, params: any[] = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      if (!stmt.step()) return null;
      return stmt.getAsObject();
    } finally {
      stmt.free();
    }
  }

  private runSql(db: any, sql: string, params: any[] = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.run(params);
    } finally {
      stmt.free();
    }
  }

  private runDeleteSql(db: any, sql: string, params: any[] = []) {
    this.runSql(db, sql, params);
    return Number(this.queryOne(db, 'select changes() as count')?.count || 0);
  }

  private deletePbootGeneratedContent(db: any, filenamePattern: string) {
    const result = this.queryOne(db, 'select count(*) as count from ay_content where filename like ?', [filenamePattern]);
    const count = Number(result?.count || 0);
    this.runSql(db, 'delete from ay_content where filename like ?', [filenamePattern]);
    return count;
  }

  private deletePbootImportedContent(db: any, acode: string, scode: string, title: string) {
    const cleanTitle = String(title || '').trim();
    if (!acode || !scode || !cleanTitle) return 0;

    const where = `
      acode=?
      and scode=?
      and title=?
    `;
    const params = [acode, scode, cleanTitle];
    const result = this.queryOne(db, `select count(*) as count from ay_content where ${where}`, params);
    const count = Number(result?.count || 0);
    if (count) this.runSql(db, `delete from ay_content where ${where}`, params);
    return count;
  }

  private formatPbootDate(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private formatCompactDate(date: Date) {
    return this.formatPbootDate(date).replace(/[-: ]/g, '');
  }

  private compactHtmlForStorage(content: string) {
    return repairTranslatedHtml(this.decodeHtmlEntities(content || ''))
      .trim()
      .replace(/\r\n?/g, '\n')
      .replace(/>\s+</g, '><')
      .replace(/\n+/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private decodeHtmlEntities(content: string) {
    return decodeEscapedHtml(content);
  }

  private stripHtml(html: string) {
    return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private getNewsUrlLangPrefix(lang: string) {
    if (lang === DEFAULT_NEWS_LANG) return 'cn';
    return String(lang || 'en').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'en';
  }

  private getDefaultNewsUrlName(lang: string, id?: number) {
    if (!id) return '';
    return `${this.getNewsUrlLangPrefix(lang)}-${id}`;
  }

  private normalizeNewsUrlName(value: string | undefined | null, lang: string, id?: number) {
    const cleaned = String(value || '').trim().replace(/^\/+/, '');
    return cleaned || this.getDefaultNewsUrlName(lang, id);
  }

  private async findNewsEntity(id: number) {
    if (!id) return null;
    const news = await this.newsRepo.findOneBy({ id, siteId: await this.currentSiteId() });
    if (!news) throw new NotFoundException('没有找到该新闻');
    return news;
  }

  private async findSiteMenus() {
    return this.menusRepo.find({ where: { siteId: await this.currentSiteId() } });
  }

  private async getConfiguredLanguageCodes() {
    const supported = new Set<string>(NEWS_LANGUAGES.map((item) => item.code));
    const configured = (await this.sitesService.getCurrentSiteLanguages())
      .map((item) => item.code)
      .filter((code) => supported.has(code));
    return configured.length ? configured : [DEFAULT_NEWS_LANG];
  }

  private async resolveConfiguredSyncLanguages(all: boolean | undefined, lang: string | undefined, fallback: string) {
    const configured = await this.getConfiguredLanguageCodes();
    if (all) return configured;
    const target = resolveNewsLang(lang || fallback);
    if (!configured.includes(target)) throw new BadRequestException(`当前网站未配置 ${target} 语言区域，无法同步`);
    return [target];
  }

  private async currentSiteId() {
    const siteId = this.sitesService.getCurrentSiteId();
    if (!siteId || this.adoptedLegacySites.has(siteId)) return siteId;
    const scoped = await this.newsRepo.countBy({ siteId });
    if (this.sitesService.isDefaultSite(siteId) && !scoped && await this.newsRepo.countBy({ siteId: 0 })) {
      await this.newsRepo.update({ siteId: 0 }, { siteId });
    }
    this.adoptedLegacySites.add(siteId);
    return siteId;
  }

  private async deleteSiteNews(siteId: number) {
    const rows = await this.newsRepo.find({ where: { siteId }, select: { id: true } });
    for (let offset = 0; offset < rows.length; offset += 300) {
      const ids = rows.slice(offset, offset + 300).map((row) => row.id);
      await this.translationRepo.delete({ newsId: In(ids) });
    }
    await this.newsRepo.delete({ siteId });
  }

  private getDefaultContent(postObj: Partial<CreateNewsDto>, fallback?: News) {
    const defaultTranslation = postObj.translations?.find((item) => item.lang === DEFAULT_NEWS_LANG);
    return {
      title: defaultTranslation?.title ?? postObj.title ?? fallback?.title ?? '',
      urlName: defaultTranslation?.urlName ?? postObj.urlName ?? fallback?.urlName ?? '',
      subtitle: defaultTranslation?.subtitle ?? postObj.subtitle ?? fallback?.subtitle ?? '',
      keywords: defaultTranslation?.keywords ?? postObj.keywords ?? fallback?.keywords ?? '',
      summary: defaultTranslation?.summary ?? postObj.summary ?? fallback?.summary ?? '',
      description: defaultTranslation?.summary ?? postObj.summary ?? fallback?.summary ?? fallback?.description ?? '',
      content: this.compactHtmlForStorage(defaultTranslation?.content ?? postObj.content ?? fallback?.content ?? ''),
    };
  }

  private async ensureTranslations(news: News, incoming: NewsTranslationDto[] = [], updateExisting = false) {
    const existing = await this.translationRepo.find({ where: { newsId: news.id } });
    const existingMap = new Map(existing.map((item) => [item.lang, item]));
    const inputMap = new Map(incoming.map((item) => [item.lang, item]));
    const seed = this.getDefaultContent({
      translations: incoming,
      title: news.title,
      urlName: news.urlName,
      subtitle: news.subtitle,
      keywords: news.keywords,
      summary: news.summary,
      content: news.content,
    });

    const rows = NEWS_LANGUAGES.map(({ code }) => {
      const input = inputMap.get(code);
      const current = existingMap.get(code);
      const base = code === DEFAULT_NEWS_LANG
        ? seed
        : { title: '', urlName: '', subtitle: '', keywords: '', summary: '', content: '' };

      if (current) {
        if (!updateExisting && !input) return null;
        return {
          ...current,
          title: input?.title ?? (code === DEFAULT_NEWS_LANG ? seed.title : current.title),
          urlName: this.normalizeNewsUrlName(
            input?.urlName ?? (code === DEFAULT_NEWS_LANG ? seed.urlName : current.urlName),
            code,
            news.id,
          ),
          subtitle: input?.subtitle ?? (code === DEFAULT_NEWS_LANG ? seed.subtitle : current.subtitle),
          keywords: input?.keywords ?? (code === DEFAULT_NEWS_LANG ? seed.keywords : current.keywords),
          summary: input?.summary ?? (code === DEFAULT_NEWS_LANG ? seed.summary : current.summary),
          description: input?.summary ?? (code === DEFAULT_NEWS_LANG ? seed.summary : current.summary),
          content: this.compactHtmlForStorage(input?.content ?? (code === DEFAULT_NEWS_LANG ? seed.content : current.content)),
        };
      }

      return this.translationRepo.create({
        newsId: news.id,
        lang: code,
        title: input?.title ?? base.title,
        urlName: this.normalizeNewsUrlName(input?.urlName ?? base.urlName, code, news.id),
        subtitle: input?.subtitle ?? base.subtitle,
        keywords: input?.keywords ?? base.keywords,
        summary: input?.summary ?? base.summary,
        description: input?.summary ?? base.summary,
        content: this.compactHtmlForStorage(input?.content ?? base.content),
      });
    }).filter(Boolean) as NewsTranslation[];

    if (rows.length) await this.translationRepo.save(rows);
  }

  private mergeTranslation(news: News, translation?: NewsTranslation, lang = DEFAULT_NEWS_LANG, translations?: NewsTranslation[]) {
    const { author, source, ...cleanNews } = news as News & { author?: string; source?: string };
    const normalizedTranslations = translations?.map((item) => ({
      ...item,
      urlName: this.normalizeNewsUrlName(item.urlName, item.lang, news.id),
      content: repairTranslatedHtml(this.decodeHtmlEntities(item.content)),
    }));
    return {
      ...cleanNews,
      lang,
      title: translation?.title || news.title,
      urlName: this.normalizeNewsUrlName(translation?.urlName ?? news.urlName, lang, news.id),
      subtitle: translation?.subtitle ?? news.subtitle,
      keywords: translation?.keywords ?? news.keywords,
      summary: translation?.summary ?? news.summary,
      description: translation?.summary ?? news.summary,
      content: repairTranslatedHtml(this.decodeHtmlEntities(translation?.content ?? news.content)),
      translations: normalizedTranslations,
    };
  }

  private async requestSeoOptimization(model: string, provider: string, prompt: string) {
    if (provider === 'zhipu') {
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.getAiProviderKey('zhipu')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是严谨的中文 SEO 编辑，只返回有效 JSON。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.15,
        }),
      });
      if (!response.ok) {
        throw new BadRequestException(`智谱中文 SEO 优化失败：${(await response.text()).slice(0, 500)}`);
      }
      const data = await response.json();
      return String(data?.choices?.[0]?.message?.content || '');
    }
    if (provider === 'deepseek') {
      const response = await fetchWithAiRetry(
        'https://api.deepseek.com/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.getAiProviderKey('deepseek')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: '你是严谨的中文 SEO 编辑，只返回有效 JSON。' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.15,
          }),
        },
        { attempts: 4, baseDelayMs: 8000, maxDelayMs: 45000 },
      );
      if (!response.ok) {
        throw new BadRequestException(`DeepSeek 中文 SEO 优化失败：${(await response.text()).slice(0, 500)}`);
      }
      const data = await response.json();
      return String(data?.choices?.[0]?.message?.content || '');
    }
    if (provider === 'qwen') {
      const response = await fetchWithAiRetry(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.getAiProviderKey('qwen')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'You are a strict Chinese SEO editor. Return valid JSON only.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.15,
          }),
        },
        { attempts: 4, baseDelayMs: 8000, maxDelayMs: 45000 },
      );
      if (!response.ok) {
        throw new BadRequestException(`Qwen 中文 SEO 优化失败：${(await response.text()).slice(0, 500)}`);
      }
      const data = await response.json();
      return String(data?.choices?.[0]?.message?.content || '');
    }

    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.getAiProviderKey('openai')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: '你是严谨的中文 SEO 编辑，只返回有效 JSON。' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.15,
          }),
        },
        { attempts: 4, baseDelayMs: 8000, maxDelayMs: 45000 },
      );
    } catch (error) {
      throw new BadRequestException(`OpenAI 中文 SEO 优化失败（重试耗尽）：${formatAiErrorMessage(error)}`);
    }
    if (!response.ok) {
      throw new BadRequestException(`OpenAI 中文 SEO 优化失败：${(await response.text()).slice(0, 500)}`);
    }
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || '');
  }

  private async translateWithOpenAI(postObj: TranslateNewsDto, signal?: AbortSignal) {
    const apiKey = this.getAiProviderKey('openai');
    const prompt = this.buildTranslationPrompt(postObj);

    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: postObj.model,
            messages: [
              {
                role: 'system',
                content: 'You are a professional CMS translator. Return strict JSON only.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.2,
            max_completion_tokens: 8192,
          }),
        },
        { attempts: 2, baseDelayMs: 5000, maxDelayMs: 8000, requestTimeoutMs: 55000, totalTimeoutMs: 70000 },
      );
    } catch (error) {
      throw new BadRequestException(`OpenAI translation failed after retries: ${formatAiErrorMessage(error)}`);
    }

    if (!response.ok) {
      throw new BadRequestException(`OpenAI 翻译失败：${(await response.text()).slice(0, 500)}`);
    }
    const data = await response.json();
    return this.toTranslationResult(postObj, extractAiChoiceText(data, 'OpenAI 内容翻译'));
  }

  private isZhipuModel(model: string) {
    return /^glm-/i.test(String(model || ''));
  }

  private async translateWithDeepSeek(postObj: TranslateNewsDto, signal?: AbortSignal) {
    const apiKey = this.getAiProviderKey('deepseek');
    const prompt = this.buildTranslationPrompt(postObj);

    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://api.deepseek.com/chat/completions',
        {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: postObj.model,
            messages: [
              {
                role: 'system',
                content: 'You are a professional CMS translator. Return strict JSON only.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.2,
            max_tokens: 8192,
          }),
        },
        { attempts: 2, baseDelayMs: 5000, maxDelayMs: 8000, requestTimeoutMs: 55000, totalTimeoutMs: 70000 },
      );
    } catch (error) {
      throw new BadRequestException(`DeepSeek translation failed after retries: ${formatAiErrorMessage(error)}`);
    }

    if (!response.ok) {
      throw new BadRequestException(`DeepSeek 翻译失败：${(await response.text()).slice(0, 500)}`);
    }
    const data = await response.json();
    return this.toTranslationResult(postObj, extractAiChoiceText(data, 'DeepSeek 内容翻译'));
  }

  private async translateWithQwen(postObj: TranslateNewsDto, signal?: AbortSignal) {
    const apiKey = this.getAiProviderKey('qwen');
    const prompt = this.buildTranslationPrompt(postObj);

    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: postObj.model,
            messages: [
              {
                role: 'system',
                content: 'You are a professional CMS translator. Return strict JSON only.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.2,
            enable_thinking: false,
            max_tokens: 8192,
          }),
        },
        { attempts: 2, baseDelayMs: 5000, maxDelayMs: 8000, requestTimeoutMs: 55000, totalTimeoutMs: 70000 },
      );
    } catch (error) {
      throw new BadRequestException(`Qwen translation failed after retries: ${formatAiErrorMessage(error)}`);
    }

    if (!response.ok) {
      throw new BadRequestException(`Qwen 翻译失败：${(await response.text()).slice(0, 500)}`);
    }
    const data = await response.json();
    return this.toTranslationResult(postObj, extractAiChoiceText(data, 'Qwen 内容翻译'));
  }

  private async translateWithZhipu(postObj: TranslateNewsDto, signal?: AbortSignal) {
    const apiKey = this.getAiProviderKey('zhipu');
    const prompt = this.buildTranslationPrompt(postObj);

    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: postObj.model,
            messages: [
              {
                role: 'system',
                content: 'You are a professional CMS translator. Return strict JSON only.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.2,
            max_tokens: 8192,
          }),
        },
        { attempts: 2, baseDelayMs: 5000, maxDelayMs: 8000, requestTimeoutMs: 55000, totalTimeoutMs: 70000 },
      );
    } catch (error) {
      throw new BadRequestException(`Zhipu translation failed after retries: ${formatAiErrorMessage(error)}`);
    }

    const data = await response.json();
    return this.toTranslationResult(postObj, extractAiChoiceText(data, '智谱内容翻译'));
  }

  private toTranslationResult(postObj: TranslateNewsDto, rawText: string) {
    const parsed = this.parseTranslationJson(rawText);

    const result = {
      targetLang: postObj.targetLang,
      model: postObj.model,
      title: parsed.title || '',
      subtitle: parsed.subtitle || '',
      keywords: parsed.keywords || '',
      summary: parsed.summary || '',
      content: repairTranslatedHtml(parsed.content || ''),
    };
    this.assertTranslationResult(postObj, result);
    return result;
  }

  private assertTranslationResult(
    source: TranslateNewsDto,
    result: { title: string; subtitle: string; keywords: string; summary: string; content: string },
  ) {
    const requiredFields = ['title', 'subtitle', 'keywords', 'summary', 'content'] as const;
    const missing = requiredFields.filter(
      (field) => String(source[field] || '').trim() && !String(result[field] || '').trim(),
    );
    if (missing.length) {
      throw new BadRequestException(`Translation quality check failed: empty ${missing.join(', ')} output.`);
    }

    const sourceTokens = String(source.content || '').match(/@@PBOOTCMS_IMAGE_\d{4}@@/g) || [];
    const resultTokens = String(result.content || '').match(/@@PBOOTCMS_IMAGE_\d{4}@@/g) || [];
    if (sourceTokens.join('|') !== resultTokens.join('|')) {
      throw new BadRequestException('Translation quality check failed: an image placeholder was removed, duplicated, or reordered.');
    }
  }

  private containsChineseText(value: unknown) {
    return /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(String(value || ''));
  }

  private protectImageMarkup(postObj: TranslateNewsDto) {
    const images: Array<{ token: string; tag: string }> = [];
    const content = String(postObj.content || '').replace(/<img\b[^>]*>/gi, (tag) => {
      const token = `@@PBOOTCMS_IMAGE_${String(images.length).padStart(4, '0')}@@`;
      images.push({ token, tag });
      return token;
    });

    return {
      draft: { ...postObj, content },
      images,
    };
  }

  private restoreProtectedImageMarkup(
    translatedContent: string,
    images: Array<{ token: string; tag: string }>,
  ) {
    if (!images.length) return translatedContent;

    const content = String(translatedContent || '');
    let previousIndex = -1;
    for (const image of images) {
      const firstIndex = content.indexOf(image.token);
      const lastIndex = content.lastIndexOf(image.token);
      if (firstIndex < 0 || firstIndex !== lastIndex || firstIndex <= previousIndex) {
        throw new BadRequestException(
          'Translation quality check failed: an image placeholder was removed, duplicated, or reordered.',
        );
      }
      previousIndex = firstIndex;
    }

    return images.reduce(
      (result, image) => result.replace(image.token, image.tag),
      content,
    );
  }

  private async ensureTranslationHasNoChineseResidue(
    postObj: TranslateNewsDto,
    translated: ReturnType<NewsService['toTranslationResult']>,
  ) {
    if (postObj.targetLang === DEFAULT_NEWS_LANG) return translated;

    const repaired = { ...translated };
    const textFields = ['title', 'subtitle', 'keywords', 'summary'] as const;

    for (const field of textFields) {
      repaired[field] = await this.repairChineseResidueInText(
        repaired[field],
        postObj,
        field,
      );
    }

    repaired.content = await this.restoreSourceImageMarkup(
      postObj.content || '',
      repaired.content || '',
      postObj,
    );
    repaired.content = await this.repairHtmlTextWithoutChangingMarkup(
      repaired.content,
      postObj,
    );

    const invalidFields = [
      ...textFields.filter((field) => this.containsChineseText(repaired[field])),
      ...(this.containsChineseText(this.extractTranslatableHtmlText(repaired.content))
        ? ['content' as const]
        : []),
    ];
    if (invalidFields.length) {
      throw new BadRequestException(
        `Translation quality check failed: Chinese text remains in ${invalidFields.join(', ')}.`,
      );
    }

    return repaired;
  }

  private async repairChineseResidueInText(
    value: string,
    postObj: TranslateNewsDto,
    field: 'title' | 'subtitle' | 'keywords' | 'summary' | 'content',
  ) {
    let result = String(value || '');
    if (!this.containsChineseText(result)) return result;

    for (let attempt = 0; attempt < 2 && this.containsChineseText(result); attempt += 1) {
      const repairDraft: TranslateNewsDto = {
        ...postObj,
        title: field === 'title' || field === 'content' ? result : '',
        subtitle: field === 'subtitle' ? result : '',
        keywords: field === 'keywords' ? result : '',
        summary: field === 'summary' ? result : '',
        content: '',
      };
      const retry = await this.translateDraftRaw(repairDraft);
      result = String(
        field === 'content' ? retry.title : retry[field] || '',
      ).trim();
    }

    if (this.containsChineseText(result)) {
      result = await this.googleTranslateText(result, postObj.targetLang);
    }
    if (this.containsChineseText(result)) {
      throw new BadRequestException(
        `Translation quality check failed: Chinese text remains in ${field}.`,
      );
    }
    return result;
  }

  private extractTranslatableHtmlText(content: string) {
    return String(content || '')
      .replace(/<img\b[^>]*\balt=(["'])(.*?)\1[^>]*>/gi, ' $2 ')
      .replace(/<[^>]+>/g, ' ');
  }

  private async restoreSourceImageMarkup(
    sourceContent: string,
    translatedContent: string,
    postObj: TranslateNewsDto,
  ) {
    const sourceImages = String(sourceContent || '').match(/<img\b[^>]*>/gi) || [];
    if (!sourceImages.length) return translatedContent;

    const translatedImages = String(translatedContent || '').match(/<img\b[^>]*>/gi) || [];
    if (sourceImages.length !== translatedImages.length) {
      throw new BadRequestException(
        `Translation quality check failed: image count changed from ${sourceImages.length} to ${translatedImages.length}.`,
      );
    }

    let imageIndex = 0;
    return String(translatedContent || '').replace(/<img\b[^>]*>/gi, () => {
      const sourceTag = sourceImages[imageIndex];
      const translatedTag = translatedImages[imageIndex];
      imageIndex += 1;

      const sourceAlt = sourceTag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
      if (!sourceAlt) return sourceTag;

      const translatedAlt = translatedTag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
      const candidate = String(translatedAlt?.[2] || sourceAlt[2] || '');
      return sourceTag.replace(
        /\balt\s*=\s*(["'])(.*?)\1/i,
        (_match, quote: string) => `alt=${quote}${candidate}${quote}`,
      );
    });
  }

  private async repairHtmlTextWithoutChangingMarkup(
    content: string,
    postObj: TranslateNewsDto,
  ) {
    const parts = String(content || '').split(/(<[^>]+>)/g);
    const output: string[] = [];

    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('<') && part.endsWith('>')) {
        if (!/^<img\b/i.test(part)) {
          output.push(part);
          continue;
        }

        const alt = part.match(/\balt\s*=\s*(["'])(.*?)\1/i);
        if (!alt || !this.containsChineseText(alt[2])) {
          output.push(part);
          continue;
        }
        const translatedAlt = await this.repairChineseResidueInText(
          alt[2],
          postObj,
          'content',
        );
        output.push(
          part.replace(
            /\balt\s*=\s*(["'])(.*?)\1/i,
            (_match, quote: string) => `alt=${quote}${translatedAlt}${quote}`,
          ),
        );
        continue;
      }

      output.push(
        this.containsChineseText(part)
          ? await this.repairChineseResidueInText(part, postObj, 'content')
          : part,
      );
    }

    return output.join('');
  }

  private buildTranslationPrompt(postObj: TranslateNewsDto) {
    const contentLabel = postObj.contentType === 'page' ? 'CMS single-page fields' : 'CMS news fields';
    return [
      `Translate the following ${contentLabel} from Chinese to natural, professional ${this.getTargetLanguageName(postObj.targetLang)}.`,
      'Keep HTML tags, attributes, URLs, numbers, product model names, and formatting intact.',
      'Tokens such as @@PBOOTCMS_IMAGE_0000@@ represent complete protected image tags. Return every token exactly once, unchanged, and in the original order.',
      'Translate or rewrite SEO fields naturally for the target language. Keep keywords as a concise comma-separated list.',
      'Do not create or translate URL slugs. Return only valid JSON with keys: title, subtitle, keywords, summary, content.',
      'Escape every double quote and line break inside JSON string values. Do not wrap the JSON in Markdown.',
      '',
      JSON.stringify({
        title: postObj.title || '',
        subtitle: postObj.subtitle || '',
        keywords: postObj.keywords || '',
        summary: postObj.summary || '',
        content: postObj.content || '',
      }),
    ].join('\n');
  }

  private async translateWithGoogleFree(postObj: TranslateNewsDto, signal?: AbortSignal) {
    try {
      const [title, subtitle, keywords, summary, content] = await Promise.all([
        this.googleTranslateText(postObj.title || '', postObj.targetLang, signal),
        this.googleTranslateText(postObj.subtitle || '', postObj.targetLang, signal),
        this.googleTranslateText(postObj.keywords || '', postObj.targetLang, signal),
        this.googleTranslateText(postObj.summary || '', postObj.targetLang, signal),
        translateHtmlContentSafely(postObj.content || '', (text) => this.googleTranslateText(text, postObj.targetLang, signal)),
      ]);

      return {
        targetLang: postObj.targetLang,
        model: postObj.model,
        title,
        subtitle,
        keywords,
        summary,
        content,
      };
    } catch {
      return await this.translateWithMyMemoryFree({ ...postObj, model: 'mymemory-free' }, signal);
    }
  }

  private async translateWithQwenMtLite(postObj: TranslateNewsDto, signal?: AbortSignal) {
    const title = await this.qwenMtTranslateText(postObj.title || '', postObj.targetLang, signal);
    const subtitle = await this.qwenMtTranslateText(postObj.subtitle || '', postObj.targetLang, signal);
    const keywords = await this.qwenMtTranslateText(postObj.keywords || '', postObj.targetLang, signal);
    const summary = await this.qwenMtTranslateText(postObj.summary || '', postObj.targetLang, signal);
    const content = await translateHtmlContentSafely(
      postObj.content || '',
      (text) => this.qwenMtTranslateText(text, postObj.targetLang, signal),
    );

    return {
      targetLang: postObj.targetLang,
      model: postObj.model,
      title,
      subtitle,
      keywords,
      summary,
      content,
    };
  }

  private async qwenMtTranslateText(text: string, targetLang: string, signal?: AbortSignal) {
    if (!text?.trim()) return '';

    const apiKey = this.getAiProviderKey('qwen');
    const chunks = this.splitTextForGoogleTranslate(text, 1200);
    const translated: string[] = [];
    for (const chunk of chunks) {
      let response: Response;
      try {
        response = await fetchWithAiRetry(
          'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
          {
            method: 'POST',
            signal,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'qwen-mt-lite',
              messages: [{ role: 'user', content: chunk }],
              translation_options: {
                source_lang: 'Chinese',
                target_lang: this.getTargetLanguageName(targetLang),
                domains: 'Construction machinery, mining equipment, manufacturing and export trade. Keep brand names and model numbers unchanged.',
              },
            }),
          },
          { attempts: 4, baseDelayMs: 5000, maxDelayMs: 30000 },
        );
      } catch (error) {
        throw new BadRequestException(`Qwen MT translation failed after retries: ${formatAiErrorMessage(error)}`);
      }
      if (!response.ok) {
        throw new BadRequestException(`Qwen MT translation failed: ${(await response.text()).slice(0, 500)}`);
      }
      const data = await response.json();
      translated.push(String(data?.choices?.[0]?.message?.content || ''));
    }
    return translated.join('');
  }

  private async translateWithMyMemoryFree(postObj: TranslateNewsDto, signal?: AbortSignal) {
    const [title, subtitle, keywords, summary, content] = await Promise.all([
      this.myMemoryTranslateText(postObj.title || '', postObj.targetLang, signal),
      this.myMemoryTranslateText(postObj.subtitle || '', postObj.targetLang, signal),
      this.myMemoryTranslateText(postObj.keywords || '', postObj.targetLang, signal),
      this.myMemoryTranslateText(postObj.summary || '', postObj.targetLang, signal),
      translateHtmlContentSafely(postObj.content || '', (text) => this.myMemoryTranslateText(text, postObj.targetLang, signal)),
    ]);

    return {
      targetLang: postObj.targetLang,
      model: postObj.model,
      title,
      subtitle,
      keywords,
      summary,
      content,
    };
  }

  private async googleTranslateText(text: string, targetLang: string, signal?: AbortSignal) {
    if (!text.trim()) return '';

    const chunks = this.splitTextForGoogleTranslate(text);
    const translated: string[] = [];

    for (const chunk of chunks) {
      translated.push(await this.googleTranslateChunk(chunk, targetLang, signal));
    }

    return translated.join('');
  }

  private async googleTranslateChunk(text: string, targetLang: string, signal?: AbortSignal) {
    const body = new URLSearchParams({
      client: 'gtx',
      sl: 'zh-CN',
      tl: targetLang,
      dt: 't',
      q: text,
    });

    const response = await fetch('https://translate.googleapis.com/translate_a/single', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'Mozilla/5.0',
      },
      body,
      signal,
    });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new BadRequestException(`Google 翻译接口请求失败：${response.status} ${message.slice(0, 120)}`);
    }

    const data = await response.json();
    return Array.isArray(data?.[0]) ? data[0].map((item) => item?.[0] || '').join('') : '';
  }

  private splitTextForGoogleTranslate(text: string, maxLength = 1600) {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    const lines = text.split(/(\n+)/);
    let current = '';

    for (const line of lines) {
      if (line.length > maxLength) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        for (let index = 0; index < line.length; index += maxLength) {
          chunks.push(line.slice(index, index + maxLength));
        }
        continue;
      }

      if (current.length + line.length > maxLength) {
        chunks.push(current);
        current = line;
      } else {
        current += line;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  private async myMemoryTranslateText(text: string, targetLang: string, signal?: AbortSignal) {
    if (!text.trim()) return '';

    const chunks = this.splitTextForGoogleTranslate(text, 450);
    const translated: string[] = [];
    for (const chunk of chunks) {
      translated.push(await this.myMemoryTranslateChunk(chunk, targetLang, signal));
    }
    return translated.join('');
  }

  private async myMemoryTranslateChunk(text: string, targetLang: string, signal?: AbortSignal) {
    const params = new URLSearchParams({
      q: text,
      langpair: `zh-CN|${this.getMyMemoryTargetLang(targetLang)}`,
    });
    const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal,
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new BadRequestException(`MyMemory translation failed: ${response.status} ${message.slice(0, 120)}`);
    }

    const data = await response.json();
    if (data?.responseStatus && Number(data.responseStatus) >= 400) {
      throw new BadRequestException(`MyMemory translation failed: ${data.responseDetails || data.responseStatus}`);
    }
    return data?.responseData?.translatedText || '';
  }

  private getTargetLanguageName(lang: string) {
    const map: Record<string, string> = {
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      ru: 'Russian',
      ar: 'Arabic',
      pt: 'Portuguese',
      id: 'Indonesian',
      tr: 'Turkish',
      vi: 'Vietnamese',
    };
    return map[lang] || lang;
  }

  private getMyMemoryTargetLang(lang: string) {
    const map: Record<string, string> = {
      en: 'en-GB',
      es: 'es-ES',
      fr: 'fr-FR',
      ru: 'ru-RU',
      ar: 'ar-SA',
      pt: 'pt-PT',
      id: 'id-ID',
      tr: 'tr-TR',
      vi: 'vi-VN',
    };
    return map[lang] || lang;
  }

  private parseTranslationJson(text: string) {
    return extractTranslationJson(text, 'AI 翻译');
  }
}
