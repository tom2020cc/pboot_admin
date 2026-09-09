import request from "@/utils/request";
import {
  DEFAULT_NEWS_LANG,
  NEWS_LANGUAGES,
  type MenuTranslationJob,
  type MenuTranslationPayload,
  type NewsLanguageCode,
  type TranslationModel,
  type PbootScopePayload,
} from "@/api/news";
import { compactHtmlForStorage } from "@/utils/htmlContent";
import type { ProductSharedParameters } from '@/utils/productParameters';

const LONG_REQUEST_TIMEOUT = 180000;
const MAX_PRODUCT_PAYLOAD_BYTES = 8 * 1024 * 1024;

export const DEFAULT_PRODUCT_LANG = DEFAULT_NEWS_LANG;
export const PRODUCT_LANGUAGES = NEWS_LANGUAGES;

export type ProductLanguageCode = NewsLanguageCode | string;

export type ProductTranslation = {
  id?: number;
  productId?: number;
  lang: ProductLanguageCode;
  title: string;
  urlName: string;
  subtitle: string;
  keywords: string;
  description: string;
  summary: string;
  content: string;
  carouselTitles: string[];
};

export type ProductItem = {
  translationProgress?: ProductTranslationProgress;
  sharedParameters?: ProductSharedParameters | null;
  parameterRows?: { name: string; value: string; unit: string }[];
  id: number;
  menuId: number;
  title: string;
  urlName: string;
  subtitle: string;
  keywords: string;
  description: string;
  thumbnail: string;
  largeImage: string;
  videoUrl: string;
  carouselImages: string[];
  carouselTitles: string[];
  summary: string;
  content: string;
  author: string;
  source: string;
  show: boolean;
  orderNum: number;
  lang?: string;
  translations?: ProductTranslation[];
  createTime?: string;
  updateTime?: string;
};

export type ProductForm = Omit<ProductItem, "id" | "createTime" | "updateTime" | "translationProgress">;

export type ProductTranslationProgress = {
  status: 'complete' | 'partial' | 'untranslated' | 'not-required';
  total: number;
  completed: number;
  completedLanguages: string[];
  missing: { lang: string; fields: string[] }[];
};

export type ProductScopeSyncResult = {
  siteId: number;
  siteName: string;
  menuId: number;
  menuName: string;
  totalProducts: number;
  totalLanguages: number;
  readyCount: number;
  skipped: { productId: number; title: string; lang: string; reason: string }[];
  blocked: { productId: number; title: string; lang: string; reason: string }[];
  syncedCount: number;
  created: number;
  updated: number;
  deleted: number;
  backupPath: string;
};

export const previewProductScopeSync = (menuId: number) => request<ProductScopeSyncResult>({
  method: 'POST', url: '/products/pboot-scope/preview-all', data: { menuId }, timeout: LONG_REQUEST_TIMEOUT,
});

export const syncAllProductScopeLanguages = (menuId: number) => request<ProductScopeSyncResult>({
  method: 'POST', url: '/products/pboot-scope/sync-all', data: { menuId }, timeout: 10 * 60 * 1000,
});

export type TranslateProductPayload = {
  sourceLang: string;
  targetLang: string;
  model: string;
  title: string;
  subtitle?: string;
  keywords?: string;
  summary: string;
  content: string;
  carouselTitles: string[];
};

export type TranslateProductResult = {
  targetLang: string;
  model: string;
  requestedModel?: string;
  fallbackUsed?: boolean;
  title: string;
  subtitle: string;
  keywords: string;
  summary: string;
  content: string;
  carouselTitles: string[];
};

export type OptimizeProductSeoPayload = {
  model: string;
  contentType: "product";
  title: string;
  subtitle?: string;
  keywords?: string;
  urlName?: string;
  summary?: string;
  content?: string;
  carouselTitles?: string[];
};

export type OptimizeProductSeoResult = {
  model: string;
  lang: string;
  title: string;
  subtitle: string;
  keywords: string;
  urlName: string;
  summary: string;
  content: string;
  carouselTitles: string[];
  imageAlts?: { src: string; alt: string }[];
};

export type PbootProductSyncPayload = {
  lang?: string;
  all?: boolean;
};

export type PbootProductSyncItem = {
  lang: string;
  acode: string;
  scode: string;
  pbootId: number;
  title: string;
  filename: string;
  url: string;
  action: "created" | "updated";
};

export type PbootProductSyncResult = {
  msg: string;
  backupPath: string;
  synced: PbootProductSyncItem[];
  skipped?: { lang: string; reason: string; reasonCode?: string }[];
  siteId?: number;
  siteName?: string;
};

export type PbootProductImportResult = {
  msg: string;
  localBackupPath: string;
  sourceRows: number;
  imported: number;
  importedTranslations: number;
};

export type PbootProductScopeResult = {
  msg: string;
  lang: string;
  menuId: number;
  backupPath?: string;
  localBackupPath?: string;
  pbootCount?: number;
  created?: number;
  updated?: number;
  deleted: number;
  syncedCount?: number;
  synced?: PbootProductSyncItem[];
};

export type PbootProductStats = {
  lang: string;
  menuId: number | null;
  localCount: number;
  pbootCount: number;
  syncCount: number;
  diff: number;
};

export type ProductFolderScanItem = {
  modelName: string;
  relativePath: string;
  thumbnailImage: string;
  thumbnailWillGenerate: boolean;
  largeImage: string;
  carouselImages: string[];
  detailHtml: string;
  detailImages: string[];
  duplicate: boolean;
  warnings: string[];
  parameterType: 'core' | 'water-well' | 'unknown';
  parameterFiles: string[];
  parameters: { key: string; label: string; unit: string; value: string; fieldName?: string; fieldLabel?: string; create?: boolean }[];
  errors: string[];
};

export type ProductFolderScanResult = {
  sourceDirectory: string;
  menuId: number;
  menuName: string;
  total: number;
  importable: number;
  blocked: number;
  duplicates: number;
  items: ProductFolderScanItem[];
};

export type ProductFolderImportResult = {
  menuId: number;
  menuName: string;
  localBackupPath: string;
  total: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  created: Array<{ id: number; modelName: string; relativePath: string }>;
  skipped: Array<{ modelName: string; reason: string }>;
  failed: Array<{ modelName: string; reason: string }>;
};

export const createEmptyProductTranslations = (): ProductTranslation[] =>
  PRODUCT_LANGUAGES.map((item) => ({
    lang: item.code,
    title: "",
    urlName: "",
    subtitle: "",
    keywords: "",
    description: "",
    summary: "",
    content: "",
    carouselTitles: [],
  }));

export const ensureProductTranslations = (translations: ProductTranslation[] = []) => {
  const map = new Map(translations.map((item) => [item.lang, item]));
  return PRODUCT_LANGUAGES.map((item) => ({
    lang: item.code,
    title: map.get(item.code)?.title || "",
    urlName: map.get(item.code)?.urlName || "",
    subtitle: map.get(item.code)?.subtitle || "",
    keywords: map.get(item.code)?.keywords || "",
    description: map.get(item.code)?.description || "",
    summary: map.get(item.code)?.summary || "",
    content: map.get(item.code)?.content || "",
    carouselTitles: Array.isArray(map.get(item.code)?.carouselTitles) ? map.get(item.code)?.carouselTitles || [] : [],
  }));
};

export const createEmptyProductForm = (): ProductForm => ({
  menuId: 0,
  title: "",
  urlName: "",
  subtitle: "",
  keywords: "",
  description: "",
  thumbnail: "",
  largeImage: "",
  videoUrl: "",
  sharedParameters: null,
  carouselImages: [],
  carouselTitles: [],
  summary: "",
  content: "",
    author: "",
  source: "",
  show: true,
  orderNum: 0,
  lang: DEFAULT_PRODUCT_LANG,
  translations: createEmptyProductTranslations(),
});

export const normalizeProductPayload = (form: ProductForm): ProductForm => {
  const translations = ensureProductTranslations(form.translations).map((item) => ({
    ...item,
    content: compactHtmlForStorage(item.content),
  }));
  const defaultTranslation = translations.find((item) => item.lang === DEFAULT_PRODUCT_LANG) || translations[0];

  return {
    ...form,
    menuId: Number(form.menuId),
    orderNum: Number(form.orderNum || 0),
    carouselImages: Array.isArray(form.carouselImages) ? form.carouselImages : [],
    carouselTitles: defaultTranslation.carouselTitles || form.carouselTitles || [],
    title: defaultTranslation.title || form.title || "",
    urlName: defaultTranslation.urlName || form.urlName || "",
    subtitle: defaultTranslation.subtitle || form.subtitle || "",
    keywords: defaultTranslation.keywords || form.keywords || "",
    summary: defaultTranslation.summary || form.summary || "",
    description: defaultTranslation.summary || form.summary || "",
    content: defaultTranslation.content || compactHtmlForStorage(form.content) || "",
    translations,
  };
};

const prepareProductPayload = (form: ProductForm): ProductForm => {
  const payload = normalizeProductPayload(form);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;

  if (payloadBytes > MAX_PRODUCT_PAYLOAD_BYTES) {
    const payloadMegabytes = (payloadBytes / 1024 / 1024).toFixed(2);
    throw new Error(
      `\u4ea7\u54c1\u4fdd\u5b58\u6570\u636e\u4e3a ${payloadMegabytes} MB\uff0c\u8d85\u8fc7 8 MB \u5b89\u5168\u4e0a\u9650\u3002\u8bf7\u68c0\u67e5\u6b63\u6587\u662f\u5426\u7c98\u8d34\u4e86 Base64 \u56fe\u7247\uff1b\u56fe\u7247\u5e94\u5148\u4e0a\u4f20\u518d\u4f7f\u7528 URL\u3002`,
    );
  }

  return payload;
};

export const getProductList = (menuId?: number | string, lang: string = DEFAULT_PRODUCT_LANG) => {
  return request<ProductItem[]>({
    method: "GET",
    url: "/products",
    params: {
      ...(menuId ? { menuId } : {}),
      lang,
    },
  });
};

export const getProductPbootStats = (menuId?: number | string, lang: string = DEFAULT_PRODUCT_LANG) => {
  return request<PbootProductStats>({
    method: "GET",
    url: "/products/pboot-stats",
    params: {
      ...(menuId ? { menuId } : {}),
      lang,
    },
  });
};

export const createProduct = (postObj: ProductForm) => {
  return request<ProductItem>({ method: "POST", url: "/products", data: prepareProductPayload(postObj) });
};

export const uploadProductThumbnail = (file: File, options: {
  productId?: number; menuId: number; modelName: string; referenceImage?: string;
}) => {
  const data = new FormData();
  data.append('image', file);
  if (options.productId) data.append('productId', String(options.productId));
  if (options.menuId) data.append('menuId', String(options.menuId));
  data.append('modelName', options.modelName);
  if (options.referenceImage) data.append('referenceImage', options.referenceImage);
  return request<{ url: string; width: number; height: number }>({ method: 'POST', url: '/products/thumbnail', data, timeout: 60000 });
};

export const scanProductFolderImport = (postObj: { sourceDirectory: string; menuId: number; parameterType?: 'auto' | 'core' | 'water-well' }) => {
  return request<ProductFolderScanResult>({
    method: "POST",
    url: "/products/folder-import/scan",
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const importProductFolders = (postObj: { sourceDirectory: string; menuId: number; parameterType?: 'auto' | 'core' | 'water-well' }) => {
  return request<ProductFolderImportResult>({
    method: "POST",
    url: "/products/folder-import",
    data: postObj,
    timeout: 10 * 60 * 1000,
  });
};

export const getProductById = (id: number | string, lang: string = DEFAULT_PRODUCT_LANG) => {
  return request<ProductItem>({ method: "GET", url: `/products/${id}`, params: { lang } });
};

export const updateProduct = (id: number | string, postObj: ProductForm) => {
  return request<ProductItem>({ method: "PATCH", url: `/products/${id}`, data: prepareProductPayload(postObj) });
};

export const getProductTranslationModels = () => {
  return request<TranslationModel[]>({ method: "GET", url: "/products/translation-models" });
};

export const translateProductDraft = (postObj: TranslateProductPayload) => {
  return request<TranslateProductResult>({
    method: "POST",
    url: "/products/translate-draft",
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const startProductMenuTranslation = (postObj: MenuTranslationPayload) => {
  return request<MenuTranslationJob>({
    method: "POST",
    url: "/products/translate-menu",
    data: postObj,
  });
};

export const getProductMenuTranslationJob = (jobId: string) => {
  return request<MenuTranslationJob>({
    method: "GET",
    url: `/products/translate-menu/${jobId}`,
  });
};

export const retryProductMenuTranslationFailures = (jobId: string, model: string) => {
  return request<MenuTranslationJob>({
    method: "POST",
    url: `/products/translate-menu/${jobId}/retry`,
    data: { model },
  });
};

export const cancelProductMenuTranslation = (jobId: string) => {
  return request<MenuTranslationJob>({
    method: "POST",
    url: `/products/translate-menu/${jobId}/cancel`,
  });
};

export const optimizeProductSeoDraft = (postObj: OptimizeProductSeoPayload) => {
  return request<OptimizeProductSeoResult>({
    method: "POST",
    url: "/products/optimize-seo",
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const syncProductToPboot = (id: number | string, postObj: PbootProductSyncPayload = {}) => {
  return request<PbootProductSyncResult>({
    method: "POST",
    url: `/products/${id}/pboot-sync`,
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const importProductsFromPboot = () => {
  return request<PbootProductImportResult>({
    method: "POST",
    url: "/products/pboot-import",
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const pullProductPbootScope = (postObj: PbootScopePayload) => {
  return request<PbootProductScopeResult>({
    method: "POST",
    url: "/products/pboot-scope/pull",
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const pushProductPbootScope = (postObj: PbootScopePayload) => {
  return request<PbootProductScopeResult>({
    method: "POST",
    url: "/products/pboot-scope/push",
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const removeProduct = (id: number | string) => {
  return request({ method: "DELETE", url: `/products/${id}` });
};
