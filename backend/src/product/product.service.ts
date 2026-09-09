import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_NEWS_LANG, NEWS_LANGUAGES, resolveNewsLang } from '../news/news-languages';
import { Product } from './entities/product.entity';
import { ProductTranslation } from './entities/product-translation.entity';
import { CreateProductDto, ProductTranslationDto } from './dto/create-product.dto';
import { SyncProductDto } from './dto/sync-product.dto';
import { TranslateProductDto } from './dto/translate-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Menu } from '../menu/entities/menu.entity';
import {
  choosePbootBaseRow,
  createPbootMenuResolver,
  normalizePbootImage,
  PBOOT_LANG_MAP,
  PbootContentGroup,
  PbootContentRow,
  queryPbootRows,
  readPbootContentGroups,
  splitPbootList,
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
import { ProductFieldsService } from './product-fields.service';
import { ensureFolderThumbnail, resolveProductThumbnailDirectory, saveUploadedProductThumbnail } from './product-thumbnail';
import { UploadProductThumbnailDto } from './dto/upload-product-thumbnail.dto';
import { ImportProductFolderDto } from './dto/import-product-folder.dto';
import { ensurePbootParameterFields, normalizeSharedParameters, publicParameterValues, readPbootParameters, sharedParameterRows } from './product-shared-parameters';
import { mapFolderParameters } from './product-folder-parameters';
import { ProductFieldDefinition } from './product-fields';
import { missingProductTranslationFields, productTranslationProgress } from './product-translation-progress';
import {
  buildImportedProductContent,
  readDetailHtml,
  safeProductAssetSegment,
  scanProductFolders,
  type ProductFolderCandidate,
} from './product-folder-import';

const initSqlJs = require('sql.js');

type ProductWithTranslations = Omit<Product, 'author' | 'source'> & {
  lang?: string;
  translations?: ProductTranslation[];
};

type PbootProductConfig = {
  acode: string;
  scode: string;
  sortFilename: string;
};

type ProductContent = {
  lang: string;
  title: string;
  urlName: string;
  subtitle: string;
  keywords: string;
  description: string;
  summary: string;
  content: string;
  carouselTitles: string[];
};

const PBOOT_PRODUCT_SORTS: Record<string, PbootProductConfig> = {
  'zh-CN': { acode: 'cn', scode: '302', sortFilename: 'cn-products' },
  en: { acode: 'en', scode: '102', sortFilename: 'products' },
  es: { acode: 'es', scode: '702', sortFilename: 'es-products' },
  fr: { acode: 'fr', scode: '768', sortFilename: 'fr-products' },
  ru: { acode: 'ru', scode: '502', sortFilename: 'ru-products' },
  ar: { acode: 'ar', scode: '834', sortFilename: 'ar-products' },
  pt: { acode: 'pt', scode: '900', sortFilename: 'pt-products' },
  id: { acode: 'id', scode: '', sortFilename: 'id-products' },
  tr: { acode: 'tr', scode: '', sortFilename: 'tr-products' },
  vi: { acode: 'vi', scode: '', sortFilename: 'vi-products' },
};

@Injectable()
export class ProductService {
  private readonly menuTranslationJobs = new Map<string, MenuTranslationJob>();
  private readonly adoptedLegacySites = new Set<number>();

  constructor(
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductTranslation) private readonly translationRepo: Repository<ProductTranslation>,
    @InjectRepository(Menu) private readonly menusRepo: Repository<Menu>,
    private readonly config: ConfigService,
    private readonly syncGuard: SyncGuardService,
    private readonly sitesService: SitesService,
    @Optional() private readonly productFields?: ProductFieldsService,
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

  async translateDraft(postObj: TranslateProductDto) {
    if (!postObj.title?.trim() && !postObj.summary?.trim() && !postObj.content?.trim()) {
      throw new BadRequestException('请先填写中文标题、描述或详情');
    }

    const imageProtection = this.protectImageMarkup(postObj);
    const translated = await this.translateDraftRaw(imageProtection.draft);
    const translatedTitles = this.normalizeArray(translated.carouselTitles);
    const translatedImageAlts = translatedTitles.slice(imageProtection.carouselTitleCount);

    translated.content = this.restoreProtectedImageMarkup(
      translated.content || '',
      imageProtection.images,
      translatedImageAlts,
    );
    translated.carouselTitles = translatedTitles.slice(0, imageProtection.carouselTitleCount);
    return translated;
  }

  private async translateDraftRaw(postObj: TranslateProductDto) {
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
    postObj: TranslateProductDto,
    model: ReturnType<ProductService['findTranslationModels']>[number],
    signal?: AbortSignal,
  ) {
    if (model.value === 'qwen-mt-lite') return await this.translateWithQwenMtLite(postObj, signal);
    if (model.provider === 'zhipu') return await this.translateWithZhipu(postObj, signal);
    if (model.provider === 'deepseek') return await this.translateWithDeepSeek(postObj, signal);
    if (model.provider === 'qwen') return await this.translateWithQwen(postObj, signal);
    if (model.provider === 'google') return await this.translateWithGoogleFree(postObj, signal);
    if (model.provider === 'mymemory') return await this.translateWithMyMemoryFree(postObj, signal);
    return await this.translateWithOpenAI(postObj, signal);
  }

  private protectImageMarkup(postObj: TranslateProductDto) {
    const carouselTitles = this.normalizeArray(postObj.carouselTitles);
    const imageAlts: string[] = [];
    const images: Array<{ token: string; tag: string; altIndex?: number }> = [];
    const content = String(postObj.content || '').replace(/<img\b[^>]*>/gi, (tag) => {
      const token = `@@PBOOTCMS_IMAGE_${String(images.length).padStart(4, '0')}@@`;
      const alt = tag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
      const altValue = String(alt?.[2] || '').trim();
      const altIndex = altValue ? imageAlts.push(altValue) - 1 : undefined;
      images.push({ token, tag, altIndex });
      return token;
    });

    return {
      draft: {
        ...postObj,
        content,
        carouselTitles: [...carouselTitles, ...imageAlts],
      },
      images,
      carouselTitleCount: carouselTitles.length,
    };
  }

  private restoreProtectedImageMarkup(
    translatedContent: string,
    images: Array<{ token: string; tag: string; altIndex?: number }>,
    translatedImageAlts: string[],
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

    return images.reduce((result, image) => {
      let restoredTag = image.tag;
      if (image.altIndex !== undefined) {
        const translatedAlt = String(translatedImageAlts[image.altIndex] || '').trim();
        if (!translatedAlt) {
          throw new BadRequestException(
            'Translation quality check failed: an existing image alt value was not translated.',
          );
        }
        restoredTag = restoredTag.replace(
          /(\balt\s*=\s*)(["'])(.*?)\2/i,
          (_match, prefix: string, quote: string) =>
            `${prefix}${quote}${this.escapeImageAlt(translatedAlt, quote)}${quote}`,
        );
      }
      return result.replace(image.token, restoredTag);
    }, content);
  }

  private escapeImageAlt(value: string, quote: string) {
    let escaped = String(value || '')
      .replace(/&(?!#\d+;|#x[\da-f]+;|[a-z][a-z\d]+;)/gi, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    escaped = quote === "'" ? escaped.replace(/'/g, '&#39;') : escaped.replace(/"/g, '&quot;');
    return escaped;
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
    const scope = resolveChineseMenuScope(menus, postObj.menuId, postObj.targetLang, '3');
    const rows = await this.productRepo.find({
      where: { siteId, menuId: In(scope.sourceMenuIds) },
      order: { orderNum: 'ASC', id: 'DESC' },
    });
    if (!rows.length) {
      throw new BadRequestException('The matching Chinese source menu contains no products.');
    }
    const sourceRows = await this.filterChineseSourceProducts(rows);
    if (!sourceRows.length) {
      throw new BadRequestException('The matching Chinese source menu contains no usable Chinese source products.');
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
      `product_translate_menu_${postObj.targetLang}`,
      'product',
    );
    await this.deleteNonChineseSourceTranslations(rows, sourceRows, postObj.targetLang);
    const job: MenuTranslationJob = {
      id: `product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      module: 'product',
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

    const rows = await this.productRepo.find({
      where: { siteId: await this.currentSiteId(), id: In(failedIds) },
      order: { orderNum: 'ASC', id: 'DESC' },
    });
    const sourceRows = await this.filterChineseSourceProducts(rows);
    if (!sourceRows.length) {
      throw new BadRequestException('There are no usable Chinese source product items to retry.');
    }

    const protection = await this.syncGuard.protectBeforeDangerousSync(
      `product_retry_menu_${previous.targetLang}`,
      'product',
    );
    const job: MenuTranslationJob = {
      ...previous,
      id: `product-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

  private async runMenuTranslation(job: MenuTranslationJob, rows: Product[]) {
    if (this.isMenuTranslationCancelled(job)) return;
    job.status = 'running';
    job.message = 'Translating the selected Chinese menu into the target language.';
    try {
      const ids = rows.map((row) => row.id);
      const translations = await this.translationRepo.find({
        where: { productId: In(ids) },
      });
      const translationMap = new Map(
        translations.map((item) => [`${item.productId}:${item.lang}`, item]),
      );

      for (const product of rows) {
        if (this.isMenuTranslationCancelled(job)) break;
        const source = translationMap.get(`${product.id}:${DEFAULT_NEWS_LANG}`);
        if (!this.isChineseSourceProduct(product, source)) {
          job.processed += 1;
          continue;
        }
        const current = translationMap.get(`${product.id}:${job.targetLang}`);
        const sourceTitle = source?.title || product.title || `Product #${product.id}`;
        job.currentTitle = sourceTitle;

        try {
          if (this.isMenuTranslationCancelled(job)) break;
          if (this.isZhipuModel(job.model)) {
            await sleep(2500);
          }
          if (this.isMenuTranslationCancelled(job)) break;
          const translated = await this.translateDraft({
            sourceLang: DEFAULT_NEWS_LANG,
            targetLang: job.targetLang,
            model: job.model,
            title: source?.title ?? product.title ?? '',
            subtitle: source?.subtitle ?? product.subtitle ?? '',
            keywords: source?.keywords ?? product.keywords ?? '',
            summary: source?.summary ?? product.summary ?? '',
            content: source?.content ?? product.content ?? '',
            carouselTitles: this.normalizeArray(
              source?.carouselTitles?.length ? source.carouselTitles : product.carouselTitles,
            ),
          });
          if (this.isMenuTranslationCancelled(job)) break;
          const translatedRow =
            current ||
            this.translationRepo.create({
              productId: product.id,
              lang: job.targetLang,
            });
          translatedRow.title = String(translated.title || '').trim();
          translatedRow.subtitle = String(translated.subtitle || '').trim();
          translatedRow.keywords = String(translated.keywords || '').trim();
          translatedRow.summary = String(translated.summary || '').trim();
          translatedRow.description = translatedRow.summary;
          translatedRow.content = this.compactHtmlForStorage(String(translated.content || ''));
          translatedRow.carouselTitles = this.normalizeArray(translated.carouselTitles);
          translatedRow.urlName = this.pickMenuTranslationUrl(
            current?.urlName,
            source?.urlName ?? product.urlName,
            job.targetLang,
            product.id,
            translated.title,
          );
          await this.translationRepo.save(translatedRow);
          translationMap.set(`${product.id}:${job.targetLang}`, translatedRow);
          job.succeeded += 1;
        } catch (error) {
          job.failed += 1;
          const message = formatAiErrorMessage(error);
          job.failedItems.push({
            id: product.id,
            title: sourceTitle,
            error: message,
          });
          if (job.errors.length < 30) {
            job.errors.push(`#${product.id} ${sourceTitle}: ${message}`);
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
    sourceUrl: string | undefined,
    targetLang: string,
    productId: number,
    translatedTitle?: string,
  ) {
    const current = String(currentUrl || '').trim().replace(/^\/+/, '');
    const source = String(sourceUrl || '').trim().replace(/^\/+/, '');
    const prefix = targetLang === DEFAULT_NEWS_LANG ? 'cn' : String(targetLang || 'cn').toLowerCase();
    if (new RegExp(`^${prefix}[-_/]+`, 'i').test(current)) return current;
    return buildLanguageSeoUrlName(
      targetLang,
      String(translatedTitle || source),
      source || `product-${productId}`,
    );
  }

  private async filterChineseSourceProducts(rows: Product[]) {
    const ids = rows.map((row) => row.id);
    const sourceTranslations = ids.length
      ? await this.translationRepo.find({
          where: { productId: In(ids), lang: DEFAULT_NEWS_LANG },
        })
      : [];
    const sourceMap = new Map(sourceTranslations.map((item) => [item.productId, item]));
    return rows.filter((row) => this.isChineseSourceProduct(row, sourceMap.get(row.id)));
  }

  private async deleteNonChineseSourceTranslations(rows: Product[], sourceRows: Product[], targetLang: string) {
    const sourceIds = new Set(sourceRows.map((row) => row.id));
    const staleIds = rows.map((row) => row.id).filter((id) => !sourceIds.has(id));
    if (!staleIds.length) return;
    await this.translationRepo.delete({
      productId: In(staleIds),
      lang: targetLang,
    });
  }

  private isChineseSourceProduct(product: Product, source?: ProductTranslation) {
    return this.hasMeaningfulChinese(
      source?.title,
      source?.subtitle,
      source?.keywords,
      source?.summary,
      source?.content,
      product.title,
      product.subtitle,
      product.keywords,
      product.summary,
      product.content,
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
    if (!postObj.title?.trim() && !postObj.summary?.trim() && !postObj.content?.trim()) {
      throw new BadRequestException('请先填写中文产品标题、描述或详情');
    }
    if (postObj.onlyAlts && !postObj.content?.trim()) {
      throw new BadRequestException('请先填写产品详情，才能补全图片 ALT');
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
        '你是工程机械行业的中文 SEO 产品编辑。只处理图片 ALT，不改正文。',
        '为产品详情 HTML 中每个缺少 alt 或 alt 为空的 img 按原顺序生成一个 imageAlts 项。imageAlts 可以是字符串数组，也可以是包含 src、alt 的对象数组。',
        'ALT 必须优先结合当前产品关键词、型号、产品类型和图片附近正文，简洁准确，不堆砌关键词，不猜测图片中无法确认的部件或工况。',
        '不得改写标题、关键词、描述、详情文字或轮播标题，不添加或删除图片，不修改任何 src、href、iframe 或已有非空 ALT。',
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
      const altFallback = [altKeywords.split(',')[0], altTitle].filter(Boolean).join(' - ') || '产品详情图片';
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
        carouselTitles: this.normalizeArraySlots(postObj.carouselTitles),
      };
    }

    const prompt = [
      '你是工程机械行业的中文 SEO 产品编辑。优化下面这份简体中文产品草稿。',
      '必须保持产品型号、技术参数、数字、品牌、配置和适用工况准确，不得编造参数、认证、案例或性能。',
      '输入中的产品标题已经人工确认，只作为理解产品的上下文，不得润色、改写或生成新标题，也不要在 JSON 中返回 title 字段；副标题必须生成并补充核心卖点和搜索意图，不要留空。',
      '关键词只输出 3-5 个中文短语，用英文逗号分隔，宁少勿多，避免堆砌；描述控制在 80-160 个中文字符。',
      '正文保持原有 HTML 标签、表格、iframe、图片地址、链接和属性不变，可改善段落与 H2/H3 结构。',
      '为每个缺少 alt 或 alt 为空的 img 按原顺序生成一个 imageAlts 项。imageAlts 可以是字符串数组，也可以是包含 src、alt 的对象数组。ALT 必须优先结合当前产品关键词、型号、产品类型和图片附近正文，简洁准确，不堆砌关键词，不猜测图片中无法确认的部件或工况。',
      '如果 urlName 已填写，必须原样返回；如果为空，生成简短、语义明确的 lowercase ASCII slug，不含域名、斜杠和语言前缀，例如 2-ton-excavator。',
      '不添加或删除图片，不修改任何 src、href、iframe 或已有非空 ALT。',
      '轮播标题必须结合产品详情 content 中的产品类型、用途、核心配置或适用工况重新编写，简洁自然，不要只复述输入的旧轮播标题，也不要描述详情中没有的信息。',
      '轮播标题按输入顺序返回，数量必须与输入 carouselTitles 数量完全一致；每项都必须是非空字符串。',
      '只返回严格 JSON，键必须是 subtitle、keywords、summary、urlName、content、imageAlts、carouselTitles，不要返回 title。',
      JSON.stringify({
        title: postObj.title || '',
        subtitle: postObj.subtitle || '',
        keywords: postObj.keywords || '',
        summary: postObj.summary || '',
        urlName: postObj.urlName || '',
        content: postObj.content || '',
        carouselTitles: this.normalizeArraySlots(postObj.carouselTitles),
      }),
    ].join('\n');

    const rawText = await this.requestSeoOptimization(postObj.model, model.provider, prompt);
    const parsed = this.parseTranslationJson(rawText);
    const sourceCarouselTitles = this.normalizeArraySlots(postObj.carouselTitles);
    const optimizedCarouselTitles = this.normalizeArraySlots(parsed.carouselTitles);
    const title = String(postObj.title || '').trim();
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
        fallbackAlt || '产品详情图片',
      ),
      carouselTitles: sourceCarouselTitles.map((sourceTitle, index) => (
        String(optimizedCarouselTitles[index] || '').trim() || sourceTitle || `${title} 产品图 ${index + 1}`
      )),
    };
  }

  async create(postObj: CreateProductDto) {
    const defaultContent = this.getDefaultContent(postObj);
    const product = this.productRepo.create({
      ...postObj,
      siteId: await this.currentSiteId(),
      title: defaultContent.title,
      urlName: defaultContent.urlName,
      subtitle: defaultContent.subtitle,
      keywords: defaultContent.keywords,
      summary: defaultContent.summary,
      description: defaultContent.summary,
      content: defaultContent.content,
      largeImage: postObj.largeImage || '',
      videoUrl: postObj.videoUrl || '',
      sharedParameters: normalizeSharedParameters(postObj.sharedParameters),
      carouselImages: this.normalizeArray(postObj.carouselImages),
      carouselTitles: this.normalizeArray(defaultContent.carouselTitles.length ? defaultContent.carouselTitles : postObj.carouselTitles),
    });
    const saved = await this.productRepo.save(product);
    await this.ensureTranslations(saved, postObj.translations);
    return await this.findOneById(saved.id);
  }

  async uploadThumbnail(postObj: UploadProductThumbnailDto, file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('请选择缩略图');
    if (file.buffer.length > 5 * 1024 * 1024) throw new BadRequestException('上传图片不能超过 5MB');
    const product = postObj.productId ? await this.findProductEntity(postObj.productId) : undefined;
    if (!product && !postObj.menuId) throw new BadRequestException('请先选择中文产品栏目，再上传缩略图');
    const menu = product ? undefined : await this.requireChineseProductImportMenu(postObj.menuId);
    const modelName = product?.title || postObj.modelName || '';
    const references = product
      ? [product.thumbnail, product.largeImage, ...this.normalizeArray(product.carouselImages)]
      : [postObj.referenceImage || ''];
    const root = this.getPbootSiteRoot();
    const directory = resolveProductThumbnailDirectory(root, modelName, references, this.sitesService.getPbootPublicBaseUrl(), Number(product?.menuId || menu.id));
    return saveUploadedProductThumbnail(root, directory, file.buffer);
  }

  async scanProductFolderImport(postObj: ImportProductFolderDto) {
    const menu = await this.requireChineseProductImportMenu(postObj.menuId);
    const candidates = scanProductFolders(postObj.sourceDirectory, postObj.parameterType);
    const duplicateNames = await this.findDuplicateProductNames(postObj.menuId, candidates);
    const fields = this.productFields ? await this.productFields.getImportDefinitions() : [];
    const items = candidates.map((candidate) => this.createProductFolderScanItem(candidate, duplicateNames, fields));
    return {
      sourceDirectory: path.resolve(String(postObj.sourceDirectory || '').trim().replace(/^(["'])([\s\S]*)\1$/, '$2')),
      menuId: Number(menu.id),
      menuName: menu.name,
      total: items.length,
      importable: items.filter((item) => !item.duplicate && !item.errors.length).length,
      blocked: items.filter((item) => !item.duplicate && item.errors.length).length,
      duplicates: items.filter((item) => item.duplicate).length,
      items,
    };
  }

  async importProductFolders(postObj: ImportProductFolderDto) {
    const menu = await this.requireChineseProductImportMenu(postObj.menuId);
    const candidates = scanProductFolders(postObj.sourceDirectory, postObj.parameterType);
    if (!candidates.length) throw new BadRequestException('没有找到符合命名规则的产品型号文件夹。');
    const duplicateNames = await this.findDuplicateProductNames(postObj.menuId, candidates);
    const protection = await this.syncGuard.protectBeforeDangerousSync('product_folder_import');
    const siteRoot = this.getPbootSiteRoot();

    const siteId = await this.currentSiteId();
    const existing = await this.productRepo.find({ where: { siteId, menuId: Number(menu.id) } });
    let nextOrder = existing.reduce((maximum, product) => Math.max(maximum, Number(product.orderNum || 0)), 0) + 1;
    const created: Array<{ id: number; modelName: string; relativePath: string }> = [];
    const skipped: Array<{ modelName: string; reason: string }> = [];
    const failed: Array<{ modelName: string; reason: string }> = [];

    for (const candidate of candidates) {
      const normalizedName = candidate.modelName.trim().toLocaleLowerCase();
      if (duplicateNames.has(normalizedName)) {
        skipped.push({ modelName: candidate.modelName, reason: '同栏目已存在相同型号' });
        continue;
      }

      try {
        if (candidate.parameters.errors.length) throw new BadRequestException(candidate.parameters.errors.join('；'));
        if (!this.productFields) throw new BadRequestException('产品字段服务未初始化，请重启后端');
        const sharedParameters = await this.productFields.prepareFolderParameters(candidate.parameters);
        const title = candidate.modelName.trim().slice(0, 120);
        const generatedThumbnail = await ensureFolderThumbnail(candidate.directory, candidate.thumbnailSourceFile);
        const resolveAsset = createFolderAssetResolver(siteRoot, candidate.directory,
          path.join('static', 'codex', 'folder-import', String(menu.id), safeProductAssetSegment(candidate.modelName)));
        const largeImage = resolveAsset(candidate.largeImageFile);
        const carouselImages = candidate.carouselImageFiles.map(resolveAsset);
        const thumbnail = resolveAsset(generatedThumbnail || candidate.thumbnailImageFile) || carouselImages[0] || largeImage;
        const detailImages = candidate.detailImageFiles.map(resolveAsset);
        const sourceHtml = readDetailHtml(candidate);
        const content = buildImportedProductContent(sourceHtml, title, detailImages);
        const summary = `${title} 产品参数与详情`;
        const carouselTitles = carouselImages.map((_image, index) => `${title} 产品图 ${index + 1}`);
        const saved = await this.create({
          menuId: Number(menu.id),
          title,
          urlName: buildLanguageSeoUrlName(DEFAULT_NEWS_LANG, title, title),
          subtitle: '',
          keywords: title,
          thumbnail,
          largeImage,
          videoUrl: '',
          sharedParameters,
          carouselImages,
          carouselTitles,
          summary,
          content,
          author: 'admin',
          source: '文件夹批量导入',
          show: true,
          orderNum: nextOrder,
          translations: [{
            lang: DEFAULT_NEWS_LANG,
            title,
            urlName: buildLanguageSeoUrlName(DEFAULT_NEWS_LANG, title, title),
            subtitle: '',
            keywords: title,
            summary,
            content,
            carouselTitles,
          }],
        });
        nextOrder += 1;
        duplicateNames.add(normalizedName);
        created.push({ id: saved.id, modelName: candidate.modelName, relativePath: candidate.relativePath });
      } catch (error) {
        failed.push({ modelName: candidate.modelName, reason: error instanceof Error ? error.message : String(error) });
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
    const rows = await this.productRepo.find({
      where: menuIds?.length ? { siteId, menuId: In(menuIds) } : { siteId },
      order: { orderNum: 'ASC', id: 'DESC' },
    });

    const translations = rows.length
      ? await this.translationRepo.find({ where: { productId: In(rows.map(row => row.id)) } })
      : [];
    const languages = await this.getConfiguredLanguageCodes();
    const grouped = new Map<number, ProductTranslation[]>();
    for (const translation of translations) {
      const group = grouped.get(translation.productId) || [];
      group.push(translation);
      grouped.set(translation.productId, group);
    }
    return rows.flatMap(row => {
      const saved = grouped.get(row.id) || [];
      const translation = saved.find(item => item.lang === targetLang);
      if (!translation && targetLang !== DEFAULT_NEWS_LANG) return [];
      return [{ ...this.mergeTranslation(row, translation, targetLang),
        translationProgress: productTranslationProgress(row, saved, languages) }];
    });
  }

  async getPbootStats(menuId?: number, lang?: string) {
    const targetLang = resolveNewsLang(lang);
    const localCount = (await this.findAll(menuId, targetLang)).length;
    const pbootCount = await this.countPbootContent(menuId, targetLang, '3');

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
    return resolveChineseMenuScope(menus, menuId, resolveNewsLang(lang), '3').sourceMenuIds;
  }

  private async requireChineseProductImportMenu(menuId: number) {
    const siteId = await this.currentSiteId();
    const menu = await this.menusRepo.findOne({ where: { id: String(menuId), siteId } });
    if (!menu) throw new BadRequestException('指定的产品栏目不存在或不属于当前网站。');
    if (!String(menu.code || '').startsWith('pboot:cn:') || String(menu.model || '') !== '3') {
      throw new BadRequestException('文件夹产品只能导入到当前网站的中文产品栏目。');
    }
    return menu;
  }

  private async findDuplicateProductNames(menuId: number, candidates: ProductFolderCandidate[]) {
    if (!candidates.length) return new Set<string>();
    const siteId = await this.currentSiteId();
    const existing = await this.productRepo.find({ where: { siteId, menuId: Number(menuId) } });
    return new Set(existing.map((product) => String(product.title || '').trim().toLocaleLowerCase()).filter(Boolean));
  }

  private createProductFolderScanItem(candidate: ProductFolderCandidate, duplicateNames: Set<string>, fields: ProductFieldDefinition[]) {
    const mapped = mapFolderParameters(candidate.parameters, fields);
    return {
      modelName: candidate.modelName,
      relativePath: candidate.relativePath,
      thumbnailImage: candidate.thumbnailImageFile,
      thumbnailWillGenerate: Boolean(candidate.thumbnailSourceFile),
      largeImage: candidate.largeImageFile,
      carouselImages: candidate.carouselImageFiles,
      detailHtml: candidate.detailHtmlFile,
      detailImages: candidate.detailImageFiles,
      duplicate: duplicateNames.has(candidate.modelName.trim().toLocaleLowerCase()),
      warnings: candidate.warnings,
      parameterType: candidate.parameters.type,
      parameterFiles: candidate.parameters.files,
      parameters: candidate.parameters.items.map((item) => ({ ...item, ...mapped.mappings.find((mapping) => mapping.key === item.key) })),
      errors: mapped.errors,
    };
  }

  private normalizeMenuSlug(menu: Pick<Menu, 'urlName' | 'href' | 'name'>) {
    return String(menu.urlName || menu.href || menu.name || '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/^(cn|en|es|fr|ru|ar|pt|id|tr|vi)[-_/]+/i, '')
      .toLowerCase();
  }

  async findOneById(id: number, lang?: string): Promise<ProductWithTranslations> {
    if (!id) return null;
    const product = await this.findProductEntity(id);

    await this.ensureTranslations(product);
    const targetLang = resolveNewsLang(lang);
    const [translation, translations] = await Promise.all([
      this.translationRepo.findOneBy({ productId: id, lang: targetLang }),
      this.translationRepo.find({ where: { productId: id }, order: { id: 'ASC' } }),
    ]);

    return this.mergeTranslation(product, translation, targetLang, translations);
  }

  async update(id: number, postObj: UpdateProductDto) {
    const product = await this.findProductEntity(id);
    const defaultContent = this.getDefaultContent(postObj, product);
    const saved = await this.productRepo.save({
      ...product,
      ...postObj,
      title: defaultContent.title,
      urlName: defaultContent.urlName,
      subtitle: defaultContent.subtitle,
      keywords: defaultContent.keywords,
      summary: defaultContent.summary,
      description: defaultContent.summary,
      content: defaultContent.content,
      largeImage: postObj.largeImage ?? product.largeImage ?? '',
      videoUrl: postObj.videoUrl ?? product.videoUrl ?? '',
      sharedParameters: postObj.sharedParameters === undefined ? product.sharedParameters : normalizeSharedParameters(postObj.sharedParameters),
      carouselImages: this.normalizeArray(postObj.carouselImages ?? product.carouselImages),
      carouselTitles: this.normalizeArray(defaultContent.carouselTitles.length ? defaultContent.carouselTitles : postObj.carouselTitles ?? product.carouselTitles),
    });

    await this.ensureTranslations(saved, postObj.translations, true);
    return await this.findOneById(id);
  }

  async syncToPboot(id: number, options: SyncProductDto = {}) {
    const product = await this.findProductEntity(id);
    await this.ensureTranslations(product);
    const translations = await this.translationRepo.find({ where: { productId: id }, order: { id: 'ASC' } });
    const translationMap = new Map(translations.map((item) => [item.lang, item]));
    const langs = await this.resolveConfiguredSyncLanguages(options.all !== false, options.lang, DEFAULT_NEWS_LANG);
    const dbPath = this.getPbootDbPath();
    const siteRoot = this.getPbootSiteRoot();

    if (!fs.existsSync(dbPath)) throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);
    if (!fs.existsSync(siteRoot)) throw new BadRequestException(`PbootCMS site root not found: ${siteRoot}`);

    await this.syncGuard.protectBeforeDangerousSync('product_push_one', 'product');
    const backupPath = this.backupPbootDatabase(dbPath);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const synced = [];
    const skipped: { lang: string; reason: string; reasonCode: string }[] = [];

    try {
      for (const lang of langs) {
        const config = PBOOT_PRODUCT_SORTS[lang];
        if (!config) continue;
        const translation = translationMap.get(lang);
        if (lang !== DEFAULT_NEWS_LANG && (!translation?.title?.trim() || !translation?.content?.trim())) {
          skipped.push({ lang, reason: '该语言标题或详情为空，请先完成翻译', reasonCode: 'translation-missing' });
          continue;
        }
        const content = this.pickContentForPboot(product, translation, lang);
        if (!content.title.trim()) continue;
        let resolvedConfig: PbootProductConfig;
        try {
          resolvedConfig = await this.resolvePbootConfigFromMenu(config, product.menuId);
        } catch (error) {
          if (!(error instanceof BadRequestException)) throw error;
          skipped.push({ lang, reason: error.message, reasonCode: 'project-menu-missing' });
          continue;
        }
        const websiteMenu = this.queryOne(db, 'select scode,mcode from ay_content_sort where acode=? and scode=? limit 1', [resolvedConfig.acode, resolvedConfig.scode]);
        if (!websiteMenu) {
          skipped.push({ lang, reason: '项目栏目已存在，但尚未写入 PB 网站', reasonCode: 'pboot-menu-missing' });
          continue;
        }
        if (String(websiteMenu.mcode).trim() !== '3') {
          skipped.push({ lang, reason: `PB 栏目 ${resolvedConfig.scode} 的模型为 ${websiteMenu.mcode}，不是产品模型`, reasonCode: 'pboot-menu-model-mismatch' });
          continue;
        }
        synced.push(this.upsertPbootProduct(db, product, content, lang, resolvedConfig, siteRoot));
      }

      if (!synced.length) throw new BadRequestException(`没有可同步的产品语言。${skipped.map((item) => `${item.lang}: ${item.reason}`).join('；')}`);
      fs.writeFileSync(dbPath, Buffer.from(db.export()));
    } finally {
      db.close();
    }

    return { msg: 'PbootCMS product sync completed', backupPath, synced, skipped, siteId: product.siteId, siteName: this.sitesService.getCurrentSite().name };
  }

  async syncChineseProductScope(menuId: number, execute = false) {
    const siteId = await this.currentSiteId();
    const menus = await this.findSiteMenus();
    const menu = menus.find((item) => Number(item.id) === menuId);
    if (!menu?.code?.startsWith('pboot:cn:') || String(menu.model) !== '3') {
      throw new BadRequestException('请选择当前网站的中文产品栏目');
    }
    const scope = resolveChineseMenuScope(menus, menuId, DEFAULT_NEWS_LANG, '3');
    const products = await this.productRepo.find({
      where: { siteId, menuId: In(scope.sourceMenuIds) }, order: { orderNum: 'ASC', id: 'ASC' },
    });
    const translations = products.length ? await this.translationRepo.find({
      where: { productId: In(products.map((item) => item.id)) },
    }) : [];
    const translationMap = new Map(translations.map((item) => [`${item.productId}:${item.lang}`, item]));
    const langs = await this.getConfiguredLanguageCodes();
    const dbPath = this.getPbootDbPath();
    const siteRoot = this.getPbootSiteRoot();
    if (!fs.existsSync(dbPath) || !fs.existsSync(siteRoot)) throw new BadRequestException('当前网站的 PB 数据库或网站目录不存在');
    const SQL = await initSqlJs();
    const originalBytes = fs.readFileSync(dbPath);
    const db = new SQL.Database(new Uint8Array(originalBytes));
    const skipped: { productId: number; title: string; lang: string; reason: string }[] = [];
    const blocked: typeof skipped = [];
    const ready: { product: Product; content: ProductContent; lang: string; config: PbootProductConfig }[] = [];
    const configs = new Map<string, PbootProductConfig | string>();
    const destinations = new Set<string>();
    try {
      for (const product of products) {
        const source = translationMap.get(`${product.id}:${DEFAULT_NEWS_LANG}`) || product;
        for (const lang of langs) {
          const translation = translationMap.get(`${product.id}:${lang}`);
          const fields = missingProductTranslationFields(source, lang === DEFAULT_NEWS_LANG ? source : translation);
          const item = { productId: product.id, title: product.title, lang };
          if (fields.length) {
            skipped.push({ ...item, reason: `缺少${fields.join('、')}` });
            continue;
          }
          const key = `${product.menuId}:${lang}`;
          if (!configs.has(key)) {
            try {
              const config = await this.resolvePbootConfigFromMenu(PBOOT_PRODUCT_SORTS[lang], product.menuId);
              const websiteMenu = this.queryOne(db, 'select mcode from ay_content_sort where acode=? and scode=? limit 1', [config.acode, config.scode]);
              configs.set(key, !websiteMenu ? '对应栏目尚未写入 PB，请先同步栏目'
                : String(websiteMenu.mcode) !== '3' ? `PB 栏目 ${config.scode} 不是产品模型` : config);
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
          const content = this.pickContentForPboot(product, translation, lang);
          const requestedFilename = this.normalizePbootFilename(content.urlName);
          const filename = requestedFilename || `vue-product-${product.id}-${config.acode}`;
          const existing = this.queryOne(db, 'select id,scode from ay_content where acode=? and filename=? limit 1', [config.acode, filename]);
          if (existing && String(existing.scode) !== config.scode) {
            blocked.push({ ...item, reason: `URL ${filename} 已被 PB 其他栏目使用，请先修改 URL 名称` });
            continue;
          }
          const destination = requestedFilename ? `${config.acode}:url:${filename}`
            : `${config.acode}:title:${config.scode}:${content.title.trim()}`;
          if (destinations.has(destination)) {
            blocked.push({ ...item, reason: '本次范围内存在重复 URL 或同栏目同名产品，请先检查' });
            continue;
          }
          destinations.add(destination);
          ready.push({ product, content, lang, config });
        }
      }
      const preview = {
        siteId, siteName: this.sitesService.getCurrentSite().name, menuId, menuName: menu.name,
        totalProducts: products.length, totalLanguages: langs.length, readyCount: ready.length, skipped, blocked,
      };
      if (!execute) return { ...preview, syncedCount: 0, created: 0, updated: 0, deleted: 0, backupPath: '' };
      if (blocked.length) throw new BadRequestException(`同步前检查未通过，未写入任何产品：${blocked.slice(0, 5).map((item) => `${item.title} / ${item.lang}：${item.reason}`).join('；')}`);
      if (!ready.length) throw new BadRequestException('所选栏目及子栏目没有内容完整的产品语言版本可同步');
      await this.syncGuard.protectBeforeDangerousSync('product_chinese_scope_all_languages', 'product');
      // The PB file may have changed while asynchronous preflight/backup checks were running.
      if (!fs.readFileSync(dbPath).equals(originalBytes)) throw new BadRequestException('PB 数据刚刚发生变化，本次未写入，请重新检查后同步');
      const backupPath = this.backupPbootDatabase(dbPath);
      const synced = ready.map(({ product, content, lang, config }) => this.upsertPbootProduct(db, product, content, lang, config, siteRoot));
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

    if (!fs.existsSync(dbPath)) throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);
    if (!fs.existsSync(siteRoot)) throw new BadRequestException(`PbootCMS site root not found: ${siteRoot}`);

    await this.syncGuard.protectBeforeDangerousSync('product_push_all', 'product');
    const products = await this.productRepo.find({
      where: { siteId: await this.currentSiteId() },
      order: { orderNum: 'ASC', id: 'ASC' },
    });
    await Promise.all(products.map((row) => this.ensureTranslations(row)));
    const langs = await this.getConfiguredLanguageCodes();

    const backupPath = this.backupPbootDatabase(dbPath);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const synced = [];
    let deleted = 0;

    try {
      deleted = this.deletePbootGeneratedContent(db, 'vue-product-%');

      for (const product of products) {
        const translations = await this.translationRepo.find({ where: { productId: product.id }, order: { id: 'ASC' } });
        const translationMap = new Map(translations.map((item) => [item.lang, item]));

        for (const lang of langs) {
          const config = PBOOT_PRODUCT_SORTS[lang];
          if (!config) continue;

          const content = this.pickContentForPboot(product, translationMap.get(lang), lang);
          if (!content.title.trim()) continue;

          const resolvedConfig = await this.resolvePbootConfigFromMenu(config, product.menuId);
          synced.push(this.upsertPbootProduct(db, product, content, lang, resolvedConfig, siteRoot));
        }
      }

      fs.writeFileSync(dbPath, Buffer.from(db.export()));
    } finally {
      db.close();
    }

    return {
      msg: 'PbootCMS all product sync completed',
      backupPath,
      deleted,
      totalProducts: products.length,
      syncedCount: synced.length,
      synced,
    };
  }

  async pullPbootScope(menuId: number, lang?: string) {
    const targetLang = resolveNewsLang(lang);
    const acode = this.langToPbootAcode(targetLang);
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);

    const guard = await this.syncGuard.protectBeforeDangerousSync('product_scope_import_from_pboot');
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    try {
      const siteId = await this.currentSiteId();
      const menus = await this.findSiteMenus();
      const scope = resolveChineseMenuScope(menus, menuId, targetLang, '3');
      const scodes = await this.resolvePbootFilterScodes(db, menuId, acode, '3');
      const scodeSet = new Set(scodes || []);
      const { groups } = readPbootContentGroups(db, '3', 'product');
      const scopedGroups = groups.filter((group) => {
        const row = group.byLang.get(acode);
        return row && scodeSet.has(String(row.scode));
      });
      const resolveMenuId = createPbootMenuResolver(db, menus, '3', 'pboot:cn:302');
      const existingRows = await this.productRepo.find({ where: { siteId, menuId: In(scope.sourceMenuIds) } });
      const existingTranslations = existingRows.length
        ? await this.translationRepo.find({
            where: existingRows.map((row) => ({ productId: row.id, lang: targetLang })),
          })
        : [];
      const translationByProduct = new Map(existingTranslations.map((row) => [row.productId, row]));
      const matchedProductIds = new Set<number>();
      let created = 0;
      let updated = 0;

      for (const group of scopedGroups) {
        const targetRow = group.byLang.get(acode);
        if (!targetRow) continue;
        let product = this.matchProductForPbootGroup(group, targetRow, existingRows, existingTranslations);
        const baseRow = choosePbootBaseRow(group) || targetRow;

        if (!product) {
          const resolvedMenuId = resolveMenuId(baseRow);
          const sourceMenuId = scope.sourceMenuIds.includes(resolvedMenuId) ? resolvedMenuId : Number(scope.sourceMenu.id);
          product = await this.productRepo.save(this.productRepo.create({ siteId, ...this.productValuesFromPboot(baseRow, sourceMenuId) }));
          existingRows.push(product);
          created += 1;
        } else if (targetLang === DEFAULT_NEWS_LANG) {
          product = await this.productRepo.save({ ...product, ...this.productValuesFromPboot(targetRow, product.menuId), sharedParameters: product.sharedParameters });
          updated += 1;
        }

        const existingTranslation = translationByProduct.get(product.id);
        const savedTranslation = await this.translationRepo.save(
          this.translationRepo.create({
            ...(existingTranslation || {}),
            productId: product.id,
            lang: targetLang,
            ...this.productTranslationValuesFromPboot(targetRow),
          }),
        );
        translationByProduct.set(product.id, savedTranslation);
        matchedProductIds.add(product.id);
      }

      let deleted = 0;
      if (targetLang === DEFAULT_NEWS_LANG) {
        const stale = existingRows.filter((row) => !matchedProductIds.has(row.id));
        if (stale.length) {
          await this.productRepo.remove(stale);
          deleted = stale.length;
        }
      } else {
        const stale = existingTranslations.filter((row) => !matchedProductIds.has(row.productId));
        if (stale.length) {
          await this.translationRepo.remove(stale);
          deleted = stale.length;
        }
      }

      return {
        msg: 'Current product scope was overwritten from PbootCMS.',
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
    if (!fs.existsSync(siteRoot)) throw new BadRequestException(`PbootCMS site root not found: ${siteRoot}`);

    await this.syncGuard.protectBeforeDangerousSync('product_scope_push_to_pboot', 'product');
    const backupPath = this.backupPbootDatabase(dbPath);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    try {
      const siteId = await this.currentSiteId();
      const menus = await this.findSiteMenus();
      const scope = resolveChineseMenuScope(menus, menuId, targetLang, '3');
      const scodes = await this.resolvePbootFilterScodes(db, menuId, acode, '3');
      const rows = await this.productRepo.find({
        where: { siteId, menuId: In(scope.sourceMenuIds) },
        order: { orderNum: 'ASC', id: 'ASC' },
      });
      const translations = rows.length
        ? await this.translationRepo.find({ where: rows.map((row) => ({ productId: row.id, lang: targetLang })) })
        : [];
      const translationMap = new Map(translations.map((row) => [row.productId, row]));
      const placeholders = (scodes || []).map(() => '?').join(',');
      const params = [acode, ...(scodes || [])];
      const pbootRows = scodes?.length
        ? queryPbootRows<{ id: number }>(db, `select id from ay_content where acode=? and scode in (${placeholders})`, params)
        : [];
      if (pbootRows.length) {
        this.runSql(
          db,
          `delete from ay_content_ext where contentid in (${pbootRows.map(() => '?').join(',')})`,
          pbootRows.map((row) => Number(row.id)),
        );
      }
      const deleted = scodes?.length
        ? this.runDeleteSql(db, `delete from ay_content where acode=? and scode in (${placeholders})`, params)
        : 0;
      const synced = [];

      for (const product of rows) {
        const translation = translationMap.get(product.id);
        if (!translation) continue;
        const content = this.pickContentForPboot(product, translation, targetLang);
        if (!content.title.trim()) continue;
        const config = await this.resolvePbootConfigFromMenu(PBOOT_PRODUCT_SORTS[targetLang], product.menuId);
        if (!scodes?.includes(String(config.scode))) {
          throw new BadRequestException(`Product ${product.id} resolved outside the selected PbootCMS scope.`);
        }
        synced.push(this.upsertPbootProduct(db, product, content, targetLang, config, siteRoot));
      }

      fs.writeFileSync(dbPath, Buffer.from(db.export()));
      return {
        msg: 'Current product scope was overwritten in PbootCMS.',
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

  private matchProductForPbootGroup(
    group: PbootContentGroup,
    targetRow: PbootContentRow,
    products: Product[],
    translations: ProductTranslation[],
  ) {
    const generated = String(targetRow.filename || '').match(/^vue-product-(\d+)(?:-|$)/i);
    if (generated) {
      const direct = products.find((row) => row.id === Number(generated[1]));
      if (direct) return direct;
    }
    const filenames = new Set(group.rows.map((row) => this.normalizePbootFilename(row.filename)).filter(Boolean));
    const titles = new Set(group.rows.map((row) => String(row.title || '').trim()).filter(Boolean));
    const translated = translations.find(
      (row) => filenames.has(this.normalizePbootFilename(row.urlName)) || titles.has(String(row.title || '').trim()),
    );
    if (translated) return products.find((row) => row.id === translated.productId);
    return products.find(
      (row) => filenames.has(this.normalizePbootFilename(row.urlName)) || titles.has(String(row.title || '').trim()),
    );
  }

  private productValuesFromPboot(row: PbootContentRow, menuId: number) {
    return {
      menuId,
      title: row.title || '',
      urlName: row.filename || '',
      subtitle: row.subtitle || '',
      keywords: row.keywords || '',
      description: row.description || '',
      thumbnail: normalizePbootImage(row.ico),
      largeImage: normalizePbootImage(String(row.ext_bigpic || '')),
      videoUrl: String(row.ext_video || ''),
      sharedParameters: readPbootParameters(row),
      carouselImages: splitPbootList(row.pics).map(normalizePbootImage),
      carouselTitles: splitPbootList(row.picstitle),
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

  private productTranslationValuesFromPboot(row: PbootContentRow) {
    return {
      title: row.title || '',
      urlName: row.filename || '',
      subtitle: row.subtitle || '',
      keywords: row.keywords || '',
      description: row.description || '',
      summary: row.description || '',
      content: row.content || '',
      carouselTitles: splitPbootList(row.picstitle),
      createTime: toPbootDate(row.date || row.create_time),
      updateTime: toPbootDate(row.update_time || row.date || row.create_time),
    };
  }

  async importFromPboot() {
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) {
      throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);
    }

    const guard = await this.syncGuard.protectBeforeDangerousSync('product_import_from_pboot');
    const localBackupPath = guard.backupPath;
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    try {
      const { sourceRows, groups } = readPbootContentGroups(db, '3', 'product');
      const siteId = await this.currentSiteId();
      const menus = await this.findSiteMenus();
      const resolveMenuId = createPbootMenuResolver(db, menus, '3', 'pboot:cn:302');

      const existingProducts = await this.productRepo.find({ where: { siteId } });
      const existingTranslations = existingProducts.length
        ? await this.translationRepo.find({ where: { productId: In(existingProducts.map((product) => product.id)) } })
        : [];
      const retainedParameters = new Map(groups.map((group) => {
        const base = choosePbootBaseRow(group);
        if (!base) return [group.key, null] as const;
        const candidates = existingProducts.filter((product) => product.menuId === resolveMenuId(base));
        const ids = new Set(candidates.map((product) => product.id));
        const matched = this.matchProductForPbootGroup(group, base, candidates, existingTranslations.filter((item) => ids.has(item.productId)));
        return [group.key, matched ? matched.sharedParameters : readPbootParameters(base)] as const;
      }));
      await this.deleteSiteProducts(siteId);

      let imported = 0;
      let importedTranslations = 0;

      for (const group of groups) {
        const base = choosePbootBaseRow(group);
        if (!base) continue;

        const menuId = resolveMenuId(base);
        if (!menuId) continue;

        const carouselImages = splitPbootList(base.pics).map(normalizePbootImage);
        const carouselTitles = splitPbootList(base.picstitle);
        const created = toPbootDate(base.date || base.create_time);
        const updated = toPbootDate(base.update_time || base.date || base.create_time);
        const saved = await this.productRepo.save(
          this.productRepo.create({
            siteId,
            menuId,
            title: base.title || '',
            urlName: base.filename || '',
            subtitle: base.subtitle || '',
            keywords: base.keywords || '',
            description: base.description || '',
            thumbnail: normalizePbootImage(base.ico),
            largeImage: normalizePbootImage(String(base.ext_bigpic || '')),
            videoUrl: String(base.ext_video || ''),
            sharedParameters: retainedParameters.get(group.key) || null,
            carouselImages,
            carouselTitles,
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
              productId: saved.id,
              lang,
              title: row.title || '',
              urlName: row.filename || '',
              subtitle: row.subtitle || '',
              keywords: row.keywords || '',
              description: row.description || '',
              summary: row.description || '',
              content: row.content || '',
              carouselTitles: splitPbootList(row.picstitle),
              createTime: toPbootDate(row.date || row.create_time),
              updateTime: toPbootDate(row.update_time || row.date || row.create_time),
            });
          })
          .filter(Boolean) as ProductTranslation[];

        if (translations.length) {
          await this.translationRepo.save(translations);
          importedTranslations += translations.length;
        }
      }

      return {
        msg: 'PbootCMS product import completed',
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
    const product = await this.findProductEntity(id);
    const pbootDelete = await this.deleteFromPboot(product);
    await this.translationRepo.delete({ productId: id });
    const res = await this.productRepo.remove(product);
    return { msg: '删除成功', res, pbootDelete };
  }

  private async deleteFromPboot(product: Product) {
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) {
      return { skipped: true, reason: `PbootCMS database not found: ${dbPath}`, deleted: 0, backupPath: '' };
    }

    const backupPath = this.backupPbootDatabase(dbPath);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const translations = await this.translationRepo.find({ where: { productId: product.id }, order: { id: 'ASC' } });
    const translationMap = new Map(translations.map((item) => [item.lang, item]));
    const langs = await this.getConfiguredLanguageCodes();
    let deleted = 0;

    try {
      deleted += this.deletePbootGeneratedContent(db, `vue-product-${product.id}-%`);

      for (const lang of langs) {
        const config = PBOOT_PRODUCT_SORTS[lang];
        if (!config) continue;

        const content = this.pickContentForPboot(product, translationMap.get(lang), lang);
        if (!content.title.trim()) continue;

        const resolvedConfig = await this.resolvePbootConfigFromMenu(config, product.menuId);
        deleted += this.deletePbootImportedContent(db, resolvedConfig.acode, resolvedConfig.scode, content.title);
      }

      fs.writeFileSync(dbPath, Buffer.from(db.export()));
      return { skipped: false, deleted, backupPath };
    } finally {
      db.close();
    }
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

  private getDefaultContent(postObj: Partial<CreateProductDto>, fallback?: Product) {
    const defaultTranslation = postObj.translations?.find((item) => item.lang === DEFAULT_NEWS_LANG);
    return {
      title: defaultTranslation?.title ?? postObj.title ?? fallback?.title ?? '',
      urlName: defaultTranslation?.urlName ?? postObj.urlName ?? fallback?.urlName ?? '',
      subtitle: defaultTranslation?.subtitle ?? postObj.subtitle ?? fallback?.subtitle ?? '',
      keywords: defaultTranslation?.keywords ?? postObj.keywords ?? fallback?.keywords ?? '',
      summary: defaultTranslation?.summary ?? postObj.summary ?? fallback?.summary ?? '',
      description: defaultTranslation?.summary ?? postObj.summary ?? fallback?.summary ?? fallback?.description ?? '',
      content: this.compactHtmlForStorage(defaultTranslation?.content ?? postObj.content ?? fallback?.content ?? ''),
      carouselTitles: this.normalizeArray(defaultTranslation?.carouselTitles ?? postObj.carouselTitles ?? fallback?.carouselTitles),
    };
  }

  private async ensureTranslations(product: Product, incoming: ProductTranslationDto[] = [], updateExisting = false) {
    const existing = await this.translationRepo.find({ where: { productId: product.id } });
    const existingMap = new Map(existing.map((item) => [item.lang, item]));
    const inputMap = new Map(incoming.map((item) => [item.lang, item]));
    const seed = this.getDefaultContent({
      translations: incoming,
      title: product.title,
      urlName: product.urlName,
      subtitle: product.subtitle,
      keywords: product.keywords,
      summary: product.summary,
      content: product.content,
      carouselTitles: product.carouselTitles,
    });

    const rows = NEWS_LANGUAGES.map(({ code }) => {
      const input = inputMap.get(code);
      const current = existingMap.get(code);

      if (current) {
        if (!updateExisting && !input) return null;
        return {
          ...current,
          title: input?.title ?? (code === DEFAULT_NEWS_LANG ? seed.title : current.title),
          urlName: input?.urlName ?? (code === DEFAULT_NEWS_LANG ? seed.urlName : current.urlName),
          subtitle: input?.subtitle ?? (code === DEFAULT_NEWS_LANG ? seed.subtitle : current.subtitle),
          keywords: input?.keywords ?? (code === DEFAULT_NEWS_LANG ? seed.keywords : current.keywords),
          summary: input?.summary ?? (code === DEFAULT_NEWS_LANG ? seed.summary : current.summary),
          description: input?.summary ?? (code === DEFAULT_NEWS_LANG ? seed.summary : current.summary),
          content: this.compactHtmlForStorage(input?.content ?? (code === DEFAULT_NEWS_LANG ? seed.content : current.content)),
          carouselTitles: this.normalizeArray(input?.carouselTitles ?? (code === DEFAULT_NEWS_LANG ? seed.carouselTitles : current.carouselTitles)),
        };
      }

      const fallback = code === DEFAULT_NEWS_LANG
        ? seed
        : { title: '', urlName: '', subtitle: '', keywords: '', summary: '', content: '', carouselTitles: [] };
      return this.translationRepo.create({
        productId: product.id,
        lang: code,
        title: input?.title ?? fallback.title,
        urlName: input?.urlName ?? fallback.urlName,
        subtitle: input?.subtitle ?? fallback.subtitle,
        keywords: input?.keywords ?? fallback.keywords,
        summary: input?.summary ?? fallback.summary,
        description: input?.summary ?? fallback.summary,
        content: this.compactHtmlForStorage(input?.content ?? fallback.content),
        carouselTitles: this.normalizeArray(input?.carouselTitles ?? fallback.carouselTitles),
      });
    }).filter(Boolean) as ProductTranslation[];

    if (rows.length) await this.translationRepo.save(rows);
  }

  private mergeTranslation(product: Product, translation?: ProductTranslation, lang = DEFAULT_NEWS_LANG, translations?: ProductTranslation[]) {
    const { author, source, ...cleanProduct } = product as Product & { author?: string; source?: string };
    const normalizedTranslations = translations?.map((item) => ({
      ...item,
      content: repairTranslatedHtml(this.decodeHtmlEntities(item.content)),
    }));
    return {
      ...cleanProduct,
      lang,
      parameterRows: this.productFields ? this.productFields.parameterRows(product.sharedParameters, lang) : sharedParameterRows(product.sharedParameters, lang),
      carouselImages: this.normalizeArray(product.carouselImages),
      carouselTitles: this.normalizeArray(translation?.carouselTitles?.length ? translation.carouselTitles : product.carouselTitles),
      title: translation?.title || product.title,
      urlName: translation?.urlName ?? product.urlName,
      subtitle: translation?.subtitle ?? product.subtitle,
      keywords: translation?.keywords ?? product.keywords,
      summary: translation?.summary ?? product.summary,
      description: translation?.summary ?? product.summary,
      content: repairTranslatedHtml(this.decodeHtmlEntities(translation?.content ?? product.content)),
      translations: normalizedTranslations,
    };
  }

  private pickContentForPboot(product: Product, translation: ProductTranslation | undefined, lang: string): ProductContent {
    return {
      lang,
      title: translation?.title || product.title || '',
      urlName: translation?.urlName ?? product.urlName ?? '',
      subtitle: translation?.subtitle ?? product.subtitle ?? '',
      keywords: translation?.keywords ?? product.keywords ?? '',
      summary: translation?.summary ?? product.summary ?? '',
      description: translation?.summary ?? product.summary ?? '',
      content: repairTranslatedHtml(this.decodeHtmlEntities(translation?.content ?? product.content ?? '')),
      carouselTitles: this.normalizeArray(translation?.carouselTitles?.length ? translation.carouselTitles : product.carouselTitles),
    };
  }

  private upsertPbootProduct(db: any, product: Product, content: ProductContent, lang: string, config: PbootProductConfig, siteRoot: string) {
    const now = this.formatPbootDate(new Date());
    const requestedFilename = this.normalizePbootFilename(content.urlName);
    const filename = requestedFilename || `vue-product-${product.id}-${config.acode}`;
    const ico = this.preparePbootImage(product.thumbnail, siteRoot, now);
    const pics = this.normalizeArray(product.carouselImages).map((item) => this.preparePbootImage(item, siteRoot, now)).filter(Boolean).join(',');
    const picstitle = content.carouselTitles.join(',');
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
      pics,
      content: pbootContent,
      tags: '',
      enclosure: '',
      keywords: (content.keywords || content.title).slice(0, 200),
      description: (content.summary || this.stripHtml(content.content)).slice(0, 500),
      sorting: Number(product.orderNum || 0),
      status: product.show ? '1' : '0',
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
      picstitle,
    };

    if (row) {
      const fields = ['scode', 'title', 'subtitle', 'filename', 'date', 'ico', 'pics', 'content', 'keywords', 'description', 'sorting', 'status', 'update_user', 'update_time', 'picstitle'];
      this.runSql(db, `update ay_content set ${fields.map((field) => `${field}=?`).join(',')} where id=?`, [...fields.map((field) => values[field]), row.id]);
      this.upsertPbootProductExt(db, row.id, product, siteRoot, now, lang);
      return this.createPbootSyncItem(lang, config, row.id, values.title, filename, 'updated');
    }

    const columns = Object.keys(values);
    this.runSql(db, `insert into ay_content (${columns.join(',')}) values (${columns.map(() => '?').join(',')})`, columns.map((field) => values[field]));
    const inserted = this.getPbootExistingRow(db, config.acode, filename);
    if (inserted?.id) this.upsertPbootProductExt(db, inserted.id, product, siteRoot, now, lang);
    return this.createPbootSyncItem(lang, config, inserted?.id || 0, values.title, filename, 'created');
  }

  private async resolvePbootConfigFromMenu(config: PbootProductConfig, menuId: number) {
    if (!menuId) return config;

    const siteId = await this.currentSiteId();
    const sourceMenu = await this.menusRepo.findOne({ where: { id: String(menuId), siteId } });
    if (!sourceMenu?.code?.startsWith('pboot:')) return config;

    const menus = await this.findSiteMenus();
    const targetLang = PBOOT_LANG_MAP[config.acode] || config.acode;
    const targetMenu = menus.find((menu) => {
      if (!menu.code?.startsWith(`pboot:${config.acode}:`)) return false;
      try {
        return Number(resolveChineseMenuScope(menus, Number(menu.id), targetLang, '3').sourceMenu.id) === Number(sourceMenu.id);
      } catch {
        return false;
      }
    });

    if (!targetMenu) throw new BadRequestException('缺少对应语言的产品栏目，请先创建并同步栏目');

    const scode = this.getPbootScode(targetMenu.code) || config.scode;
    return {
      ...config,
      scode,
      sortFilename: this.hrefToSortFilename(targetMenu.href) || config.sortFilename,
    };
  }

  private createPbootSyncItem(lang: string, config: PbootProductConfig, pbootId: number, title: string, filename: string, action: 'created' | 'updated') {
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
            { role: 'system', content: '你是严谨的中文产品 SEO 编辑，只返回有效 JSON。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.15,
        }),
      });
      if (!response.ok) {
        throw new BadRequestException(`智谱中文产品 SEO 优化失败：${(await response.text()).slice(0, 500)}`);
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
              { role: 'system', content: '你是严谨的中文产品 SEO 编辑，只返回有效 JSON。' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.15,
          }),
        },
        { attempts: 4, baseDelayMs: 8000, maxDelayMs: 45000 },
      );
      if (!response.ok) {
        throw new BadRequestException(`DeepSeek 中文产品 SEO 优化失败：${(await response.text()).slice(0, 500)}`);
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
              { role: 'system', content: 'You are a strict Chinese product SEO editor. Return valid JSON only.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.15,
          }),
        },
        { attempts: 4, baseDelayMs: 8000, maxDelayMs: 45000 },
      );
      if (!response.ok) {
        throw new BadRequestException(`Qwen 中文产品 SEO 优化失败：${(await response.text()).slice(0, 500)}`);
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
              { role: 'system', content: '你是严谨的中文产品 SEO 编辑，只返回有效 JSON。' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.15,
          }),
        },
        { attempts: 4, baseDelayMs: 8000, maxDelayMs: 45000 },
      );
    } catch (error) {
      throw new BadRequestException(`OpenAI 中文产品 SEO 优化失败（重试耗尽）：${formatAiErrorMessage(error)}`);
    }
    if (!response.ok) {
      throw new BadRequestException(`OpenAI 中文产品 SEO 优化失败：${(await response.text()).slice(0, 500)}`);
    }
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || '');
  }

  private isZhipuModel(model: string) {
    return /^glm-/i.test(String(model || ''));
  }

  private async translateWithDeepSeek(postObj: TranslateProductDto, signal?: AbortSignal) {
    const apiKey = this.getAiProviderKey('deepseek');
    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://api.deepseek.com/chat/completions',
        {
          method: 'POST',
          signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: postObj.model,
            messages: [
              { role: 'system', content: 'You are a professional CMS product translator. Return strict JSON only.' },
              { role: 'user', content: this.buildTranslationPrompt(postObj) },
            ],
            temperature: 0.2,
            max_tokens: 8192,
          }),
        },
        { attempts: 2, baseDelayMs: 5000, maxDelayMs: 8000, requestTimeoutMs: 55000, totalTimeoutMs: 70000 },
      );
    } catch (error) {
      throw new BadRequestException(`DeepSeek product translation failed after retries: ${formatAiErrorMessage(error)}`);
    }
    if (!response.ok) throw new BadRequestException(`DeepSeek product translation failed: ${(await response.text()).slice(0, 500)}`);
    const data = await response.json();
    return this.toTranslationResult(postObj, extractAiChoiceText(data, 'DeepSeek 产品翻译'));
  }

  private async translateWithQwen(postObj: TranslateProductDto, signal?: AbortSignal) {
    const apiKey = this.getAiProviderKey('qwen');
    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        {
          method: 'POST',
          signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: postObj.model,
            messages: [
              { role: 'system', content: 'You are a professional CMS product translator. Return strict JSON only.' },
              { role: 'user', content: this.buildTranslationPrompt(postObj) },
            ],
            temperature: 0.2,
            enable_thinking: false,
            max_tokens: 8192,
          }),
        },
        { attempts: 2, baseDelayMs: 5000, maxDelayMs: 8000, requestTimeoutMs: 55000, totalTimeoutMs: 70000 },
      );
    } catch (error) {
      throw new BadRequestException(`Qwen product translation failed after retries: ${formatAiErrorMessage(error)}`);
    }
    if (!response.ok) throw new BadRequestException(`Qwen product translation failed: ${(await response.text()).slice(0, 500)}`);
    const data = await response.json();
    return this.toTranslationResult(postObj, extractAiChoiceText(data, 'Qwen 产品翻译'));
  }

  private async translateWithZhipu(postObj: TranslateProductDto, signal?: AbortSignal) {
    const apiKey = this.getAiProviderKey('zhipu');
    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        {
          method: 'POST',
          signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: postObj.model,
            messages: [
              { role: 'system', content: 'You are a professional CMS product translator. Return strict JSON only.' },
              { role: 'user', content: this.buildTranslationPrompt(postObj) },
            ],
            temperature: 0.2,
            max_tokens: 8192,
          }),
        },
        { attempts: 2, baseDelayMs: 5000, maxDelayMs: 8000, requestTimeoutMs: 55000, totalTimeoutMs: 70000 },
      );
    } catch (error) {
      throw new BadRequestException(`Zhipu product translation failed after retries: ${formatAiErrorMessage(error)}`);
    }
    const data = await response.json();
    return this.toTranslationResult(postObj, extractAiChoiceText(data, '智谱产品翻译'));
  }

  private async translateWithOpenAI(postObj: TranslateProductDto, signal?: AbortSignal) {
    const apiKey = this.getAiProviderKey('openai');
    const prompt = this.buildTranslationPrompt(postObj);
    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: postObj.model,
            messages: [
              { role: 'system', content: 'You are a professional CMS product translator. Return strict JSON only.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            max_completion_tokens: 8192,
          }),
        },
        { attempts: 2, baseDelayMs: 5000, maxDelayMs: 8000, requestTimeoutMs: 55000, totalTimeoutMs: 70000 },
      );
    } catch (error) {
      throw new BadRequestException(`OpenAI product translation failed after retries: ${formatAiErrorMessage(error)}`);
    }
    if (!response.ok) throw new BadRequestException(`OpenAI product translation failed: ${(await response.text()).slice(0, 500)}`);
    const data = await response.json();
    return this.toTranslationResult(postObj, extractAiChoiceText(data, 'OpenAI 产品翻译'));
  }

  private toTranslationResult(postObj: TranslateProductDto, rawText: string) {
    const parsed = this.parseTranslationJson(rawText);
    const result = {
      targetLang: postObj.targetLang,
      model: postObj.model,
      title: parsed.title || '',
      subtitle: parsed.subtitle || '',
      keywords: parsed.keywords || '',
      summary: parsed.summary || '',
      content: repairTranslatedHtml(parsed.content || ''),
      carouselTitles: this.normalizeArray(parsed.carouselTitles),
    };
    this.assertTranslationResult(postObj, result);
    return result;
  }

  private assertTranslationResult(
    source: TranslateProductDto,
    result: {
      title: string;
      subtitle: string;
      keywords: string;
      summary: string;
      content: string;
      carouselTitles: string[];
    },
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

    const expectedTitles = this.normalizeArray(source.carouselTitles).length;
    if (result.carouselTitles.length !== expectedTitles) {
      throw new BadRequestException(
        `Translation quality check failed: expected ${expectedTitles} carousel titles but received ${result.carouselTitles.length}.`,
      );
    }
  }

  private buildTranslationPrompt(postObj: TranslateProductDto) {
    const targetLanguage = this.getTargetLanguageName(postObj.targetLang);
    return [
      `Translate the following CMS product fields from Chinese to natural, professional ${targetLanguage}.`,
      `Every human-readable Chinese phrase must become ${targetLanguage}. Do not return Chinese text unless it is a brand name, model name, URL, file name, or image attribute value that should stay unchanged.`,
      'The title field is product marketing text and must be translated. Keep only short alphanumeric model codes such as SL24, SD46, or SH220 unchanged.',
      'Keep HTML tags, attributes, URLs, numbers, product model names, and formatting intact.',
      'Tokens such as @@PBOOTCMS_IMAGE_0000@@ represent complete protected image tags. Return every token exactly once, unchanged, and in the original order.',
      'Translate every item in carouselTitles into the same target language.',
      'Translate or rewrite subtitle and SEO keywords naturally for the target language.',
      'Keep keywords as a concise comma-separated list.',
      'Return only valid JSON with keys: title, subtitle, keywords, summary, content, carouselTitles.',
      'Escape every double quote and line break inside JSON string values. Do not wrap the JSON in Markdown.',
      '',
      JSON.stringify({
        title: postObj.title || '',
        subtitle: postObj.subtitle || '',
        keywords: postObj.keywords || '',
        summary: postObj.summary || '',
        content: postObj.content || '',
        carouselTitles: this.normalizeArray(postObj.carouselTitles),
      }),
    ].join('\n');
  }

  private async translateWithGoogleFree(postObj: TranslateProductDto, signal?: AbortSignal) {
    try {
      const [title, subtitle, keywords, summary, content, ...carouselTitles] = await Promise.all([
        this.googleTranslateText(postObj.title || '', postObj.targetLang, signal),
        this.googleTranslateText(postObj.subtitle || '', postObj.targetLang, signal),
        this.googleTranslateText(postObj.keywords || '', postObj.targetLang, signal),
        this.googleTranslateText(postObj.summary || '', postObj.targetLang, signal),
        translateHtmlContentSafely(postObj.content || '', (text) => this.googleTranslateText(text, postObj.targetLang, signal)),
        ...this.normalizeArray(postObj.carouselTitles).map((item) => this.googleTranslateText(item, postObj.targetLang, signal)),
      ]);
      return {
        targetLang: postObj.targetLang,
        model: postObj.model,
        title,
        subtitle,
        keywords,
        summary,
        content,
        carouselTitles,
      };
    } catch {
      return await this.translateWithMyMemoryFree({ ...postObj, model: 'mymemory-free' }, signal);
    }
  }

  private async translateWithQwenMtLite(postObj: TranslateProductDto, signal?: AbortSignal) {
    const title = await this.qwenMtTranslateText(postObj.title || '', postObj.targetLang, signal);
    const subtitle = await this.qwenMtTranslateText(postObj.subtitle || '', postObj.targetLang, signal);
    const keywords = await this.qwenMtTranslateText(postObj.keywords || '', postObj.targetLang, signal);
    const summary = await this.qwenMtTranslateText(postObj.summary || '', postObj.targetLang, signal);
    const content = await translateHtmlContentSafely(
      postObj.content || '',
      (text) => this.qwenMtTranslateText(text, postObj.targetLang, signal),
    );
    const carouselTitles: string[] = [];
    for (const item of this.normalizeArray(postObj.carouselTitles)) {
      carouselTitles.push(await this.qwenMtTranslateText(item, postObj.targetLang, signal));
    }

    return {
      targetLang: postObj.targetLang,
      model: postObj.model,
      title,
      subtitle,
      keywords,
      summary,
      content,
      carouselTitles,
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
        throw new BadRequestException(`Qwen MT product translation failed after retries: ${formatAiErrorMessage(error)}`);
      }
      if (!response.ok) {
        throw new BadRequestException(`Qwen MT product translation failed: ${(await response.text()).slice(0, 500)}`);
      }
      const data = await response.json();
      translated.push(String(data?.choices?.[0]?.message?.content || ''));
    }
    return translated.join('');
  }

  private async translateWithMyMemoryFree(postObj: TranslateProductDto, signal?: AbortSignal) {
    const [title, subtitle, keywords, summary, content, ...carouselTitles] = await Promise.all([
      this.myMemoryTranslateText(postObj.title || '', postObj.targetLang, signal),
      this.myMemoryTranslateText(postObj.subtitle || '', postObj.targetLang, signal),
      this.myMemoryTranslateText(postObj.keywords || '', postObj.targetLang, signal),
      this.myMemoryTranslateText(postObj.summary || '', postObj.targetLang, signal),
      translateHtmlContentSafely(postObj.content || '', (text) => this.myMemoryTranslateText(text, postObj.targetLang, signal)),
      ...this.normalizeArray(postObj.carouselTitles).map((item) => this.myMemoryTranslateText(item, postObj.targetLang, signal)),
    ]);
    return {
      targetLang: postObj.targetLang,
      model: postObj.model,
      title,
      subtitle,
      keywords,
      summary,
      content,
      carouselTitles,
    };
  }

  private async googleTranslateText(text: string, targetLang: string, signal?: AbortSignal) {
    if (!text?.trim()) return '';
    const translated: string[] = [];
    const chunks = this.splitTextForGoogleTranslate(text);
    for (const chunk of chunks) {
      translated.push(await this.googleTranslateChunk(chunk, targetLang, signal));
    }
    return translated.join('');
  }

  private async googleTranslateChunk(text: string, targetLang: string, signal?: AbortSignal) {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'zh-CN',
      tl: targetLang,
      dt: 't',
      q: text,
    });
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal,
    });
    if (!response.ok) throw new BadRequestException(`Google product translation failed: ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.[0]) ? data[0].map((item) => item?.[0] || '').join('') : '';
  }

  private splitTextForGoogleTranslate(text: string, maxLength = 1600) {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let current = '';
    const rows = text.split(/(<\/p>|<\/h[1-6]>|<\/li>|<br\s*\/?>)/i);
    for (let i = 0; i < rows.length; i += 2) {
      const segment = `${rows[i] || ''}${rows[i + 1] || ''}`;
      if ((current + segment).length > maxLength && current) {
        chunks.push(current);
        current = '';
      }
      if (segment.length > maxLength) {
        for (let offset = 0; offset < segment.length; offset += maxLength) {
          chunks.push(segment.slice(offset, offset + maxLength));
        }
      } else {
        current += segment;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  private async myMemoryTranslateText(text: string, targetLang: string, signal?: AbortSignal) {
    if (!text?.trim()) return '';
    const translated: string[] = [];
    const chunks = this.splitTextForGoogleTranslate(text, 450);
    for (const chunk of chunks) {
      translated.push(await this.myMemoryTranslateChunk(chunk, targetLang, signal));
    }
    return translated.join('');
  }

  private async myMemoryTranslateChunk(text: string, targetLang: string, signal?: AbortSignal) {
    const params = new URLSearchParams({
      q: text,
      langpair: `zh-CN|${targetLang}`,
    });
    const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal,
    });
    if (!response.ok) throw new BadRequestException(`MyMemory product translation failed: ${response.status}`);
    const data = await response.json();
    return data?.responseData?.translatedText || '';
  }

  private async findProductEntity(id: number) {
    if (!id) return null;
    const product = await this.productRepo.findOneBy({ id, siteId: await this.currentSiteId() });
    if (!product) throw new NotFoundException('没有找到该产品');
    return product;
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
    const scoped = await this.productRepo.countBy({ siteId });
    if (this.sitesService.isDefaultSite(siteId) && !scoped && await this.productRepo.countBy({ siteId: 0 })) {
      await this.productRepo.update({ siteId: 0 }, { siteId });
    }
    this.adoptedLegacySites.add(siteId);
    return siteId;
  }

  private async deleteSiteProducts(siteId: number) {
    const rows = await this.productRepo.find({ where: { siteId }, select: { id: true } });
    for (let offset = 0; offset < rows.length; offset += 300) {
      const ids = rows.slice(offset, offset + 300).map((row) => row.id);
      await this.translationRepo.delete({ productId: In(ids) });
    }
    await this.productRepo.delete({ siteId });
  }

  private normalizeArray(value?: string[] | string) {
    if (!value) return [];
    const rows = Array.isArray(value) ? value : String(value).split(',');
    return rows.map((item) => String(item || '').trim()).filter(Boolean);
  }

  private normalizeArraySlots(value?: string[] | string) {
    if (!value) return [];
    const rows = Array.isArray(value) ? value : String(value).split(',');
    return rows.map((item) => String(item || '').trim());
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
    const backupPath = `${base}.before_product_sync_${this.formatCompactDate(new Date())}${ext}`;
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

  private preparePbootImage(image: string, siteRoot: string, now: string) {
    return copyUploadedImageToPboot(image, this.sitesService, siteRoot, now, 'products');
  }

  private preparePbootContent(content: string, siteRoot: string, now: string) {
    return rewriteUploadedHtmlImages(content, src => this.preparePbootImage(src, siteRoot, now));
  }

  private upsertPbootProductExt(db: any, contentId: number, product: Product, siteRoot: string, now: string, lang: string) {
    const normalizedParameters = normalizeSharedParameters(product.sharedParameters);
    let parameterValues: Record<string, string> = {};
    if (normalizedParameters) {
      if (this.productFields) parameterValues = this.productFields.writeProductValues(db, normalizedParameters);
      else {
        ensurePbootParameterFields(db, normalizedParameters);
        parameterValues = publicParameterValues(normalizedParameters);
      }
    }
    const columns = queryPbootRows<{ name: string }>(db, 'pragma table_info(ay_content_ext)').map((row) => String(row.name));
    const values: Record<string, string> = {};
    // Reuse the site's native image/video fields, never add alternative columns.
    const bigPictureField = columns.find((name) => name.toLowerCase() === 'ext_cp_bigpic')
      || columns.find((name) => name.toLowerCase() === 'ext_bigpic')
      || columns.find((name) => /^ext_.*big_?pic/i.test(name));
    const videoField = columns.find((name) => name.toLowerCase() === 'ext_video');
    if (bigPictureField) values[bigPictureField] = this.preparePbootImage(product.largeImage || '', siteRoot, now);
    if (videoField) values[videoField] = product.videoUrl || '';
    if (normalizedParameters) {
      for (const field of columns) {
        if (Object.prototype.hasOwnProperty.call(parameterValues, field)) values[field] = parameterValues[field];
      }
    }
    const fields = Object.keys(values);
    if (!fields.length) return;
    const exists = this.queryOne(db, 'select contentid from ay_content_ext where contentid=? limit 1', [contentId]);

    if (exists) {
      this.runSql(db, `update ay_content_ext set ${fields.map((field) => `${field}=?`).join(',')} where contentid=?`, [...fields.map((field) => values[field]), contentId]);
      return;
    }

    this.runSql(db, `insert into ay_content_ext (contentid,${fields.join(',')}) values (?,${fields.map(() => '?').join(',')})`, [contentId, ...fields.map((field) => values[field])]);
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
    const rows = queryPbootRows<{ id: number }>(db, 'select id from ay_content where filename like ?', [filenamePattern]);
    const result = this.queryOne(db, 'select count(*) as count from ay_content where filename like ?', [filenamePattern]);
    const count = Number(result?.count || 0);
    if (rows.length) this.runSql(db, `delete from ay_content_ext where contentid in (${rows.map(() => '?').join(',')})`, rows.map((row) => Number(row.id)));
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
    const rows = queryPbootRows<{ id: number }>(db, `select id from ay_content where ${where}`, params);
    const result = this.queryOne(db, `select count(*) as count from ay_content where ${where}`, params);
    const count = Number(result?.count || 0);
    if (count) {
      this.runSql(db, `delete from ay_content_ext where contentid in (${rows.map(() => '?').join(',')})`, rows.map((row) => Number(row.id)));
      this.runSql(db, `delete from ay_content where ${where}`, params);
    }
    return count;
  }

  private formatPbootDate(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private formatCompactDate(date: Date) {
    return this.formatPbootDate(date).replace(/[-: ]/g, '');
  }

  private stripHtml(html: string) {
    return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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

  private parseTranslationJson(text: string) {
    return extractTranslationJson(text, 'AI 产品翻译');
  }
}
