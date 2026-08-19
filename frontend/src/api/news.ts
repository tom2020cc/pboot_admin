import request from "@/utils/request";
import { compactHtmlForStorage } from "@/utils/htmlContent";

const LONG_REQUEST_TIMEOUT = 180000;

export const DEFAULT_NEWS_LANG = "zh-CN";

export const NEWS_LANGUAGES = [
  { code: "zh-CN", name: "中文" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "ru", name: "Русский" },
  { code: "ar", name: "العربية" },
  { code: "pt", name: "Português" },
] as const;

export type NewsLanguageCode = (typeof NEWS_LANGUAGES)[number]["code"];

export type NewsTranslation = {
  id?: number;
  newsId?: number;
  lang: NewsLanguageCode | string;
  title: string;
  urlName: string;
  subtitle: string;
  keywords: string;
  description: string;
  summary: string;
  content: string;
};

export type NewsItem = {
  id: number;
  menuId: number;
  title: string;
  urlName: string;
  subtitle: string;
  keywords: string;
  description: string;
  thumbnail: string;
  summary: string;
  content: string;
  author: string;
  source: string;
  show: boolean;
  orderNum: number;
  lang?: string;
  translations?: NewsTranslation[];
  createTime?: string;
  updateTime?: string;
};

export type NewsForm = Omit<NewsItem, "id" | "createTime" | "updateTime">;

export type TranslationModel = {
  value: string;
  label: string;
  displayLabel?: string;
  provider: string;
  available: boolean;
  priority?: number;
  recommended?: boolean;
  purpose?: string;
  quotaStatus?: "public-free" | "check-console" | "unconfigured";
  quotaText?: string;
  quotaUrl?: string;
  remainingQuota?: number | null;
};

export type TranslateDraftPayload = {
  sourceLang: string;
  targetLang: string;
  model: string;
  title: string;
  subtitle?: string;
  keywords?: string;
  summary: string;
  content: string;
};

export type TranslateDraftResult = {
  targetLang: string;
  model: string;
  title: string;
  subtitle: string;
  keywords: string;
  summary: string;
  content: string;
};

export type OptimizeNewsSeoPayload = {
  model: string;
  contentType: "news";
  title: string;
  subtitle?: string;
  keywords?: string;
  urlName?: string;
  summary?: string;
  content?: string;
  onlyAlts?: boolean;
};

export type ImageAltDetail = {
  src: string;
  alt: string;
};

export type OptimizeNewsSeoResult = {
  model: string;
  lang: string;
  title: string;
  subtitle: string;
  keywords: string;
  urlName: string;
  summary: string;
  content: string;
  imageAlts?: ImageAltDetail[];
};

export type PbootSyncPayload = {
  lang?: string;
  all?: boolean;
};

export type PbootSyncItem = {
  lang: string;
  acode: string;
  scode: string;
  pbootId: number;
  title: string;
  filename: string;
  url: string;
  action: "created" | "updated";
};

export type PbootSyncResult = {
  msg: string;
  backupPath: string;
  synced: PbootSyncItem[];
};

export type PbootImportResult = {
  msg: string;
  localBackupPath: string;
  sourceRows: number;
  imported: number;
  importedTranslations: number;
};

export type PbootScopePayload = {
  menuId: number;
  lang: string;
};

export type PbootScopeResult = {
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
  synced?: PbootSyncItem[];
};

export type PbootContentStats = {
  lang: string;
  menuId: number | null;
  localCount: number;
  pbootCount: number;
  syncCount: number;
  diff: number;
};

export type MenuTranslationPayload = {
  menuId: number;
  targetLang: string;
  model: string;
};

export type MenuTranslationJob = {
  id: string;
  module: "news" | "product";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  menuId: number;
  targetLang: string;
  model: string;
  sourceMenuId: number;
  sourceMenuName: string;
  targetMenuName: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  failedItems: Array<{
    id: number;
    title: string;
    error: string;
  }>;
  currentTitle: string;
  errors: string[];
  backupPath: string;
  startedAt: string;
  finishedAt?: string;
  message: string;
};

export const createEmptyTranslations = (): NewsTranslation[] =>
  NEWS_LANGUAGES.map((item) => ({
    lang: item.code,
    title: "",
    urlName: "",
    subtitle: "",
    keywords: "",
    description: "",
    summary: "",
    content: "",
  }));

export const ensureNewsTranslations = (translations: NewsTranslation[] = []) => {
  const map = new Map(translations.map((item) => [item.lang, item]));
  return NEWS_LANGUAGES.map((item) => ({
    lang: item.code,
    title: map.get(item.code)?.title || "",
    urlName: map.get(item.code)?.urlName || "",
    subtitle: map.get(item.code)?.subtitle || "",
    keywords: map.get(item.code)?.keywords || "",
    description: map.get(item.code)?.description || "",
    summary: map.get(item.code)?.summary || "",
    content: map.get(item.code)?.content || "",
  }));
};

export const createEmptyNewsForm = (): NewsForm => ({
  menuId: 0,
  title: "",
  urlName: "",
  subtitle: "",
  keywords: "",
  description: "",
  thumbnail: "",
  summary: "",
  content: "",
    author: "",
  source: "",
  show: true,
  orderNum: 0,
  lang: DEFAULT_NEWS_LANG,
  translations: createEmptyTranslations(),
});

export const normalizeNewsPayload = (form: NewsForm): NewsForm => {
  const translations = ensureNewsTranslations(form.translations).map((item) => ({
    ...item,
    content: compactHtmlForStorage(item.content),
  }));
  const defaultTranslation = translations.find((item) => item.lang === DEFAULT_NEWS_LANG) || translations[0];

  return {
    ...form,
    menuId: Number(form.menuId),
    orderNum: Number(form.orderNum || 0),
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

export const getNewsList = (menuId?: number | string, lang: string = DEFAULT_NEWS_LANG) => {
  return request<NewsItem[]>({
    method: "GET",
    url: "/news",
    params: {
      ...(menuId ? { menuId } : {}),
      lang,
    },
  });
};

export const getNewsPbootStats = (menuId?: number | string, lang: string = DEFAULT_NEWS_LANG) => {
  return request<PbootContentStats>({
    method: "GET",
    url: "/news/pboot-stats",
    params: {
      ...(menuId ? { menuId } : {}),
      lang,
    },
  });
};

export const createNews = (postObj: NewsForm) => {
  return request<NewsItem>({ method: "POST", url: "/news", data: normalizeNewsPayload(postObj) });
};

export const getNewsById = (id: number | string, lang: string = DEFAULT_NEWS_LANG) => {
  return request<NewsItem>({ method: "GET", url: `/news/${id}`, params: { lang } });
};

export const updateNews = (id: number | string, postObj: NewsForm) => {
  return request<NewsItem>({ method: "PATCH", url: `/news/${id}`, data: normalizeNewsPayload(postObj) });
};

export const getTranslationModels = () => {
  return request<TranslationModel[]>({ method: "GET", url: "/news/translation-models" });
};

export const translateNewsDraft = (postObj: TranslateDraftPayload) => {
  return request<TranslateDraftResult>({
    method: "POST",
    url: "/news/translate-draft",
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const startNewsMenuTranslation = (postObj: MenuTranslationPayload) => {
  return request<MenuTranslationJob>({
    method: "POST",
    url: "/news/translate-menu",
    data: postObj,
  });
};

export const getNewsMenuTranslationJob = (jobId: string) => {
  return request<MenuTranslationJob>({
    method: "GET",
    url: `/news/translate-menu/${jobId}`,
  });
};

export const retryNewsMenuTranslationFailures = (jobId: string, model: string) => {
  return request<MenuTranslationJob>({
    method: "POST",
    url: `/news/translate-menu/${jobId}/retry`,
    data: { model },
  });
};

export const cancelNewsMenuTranslation = (jobId: string) => {
  return request<MenuTranslationJob>({
    method: "POST",
    url: `/news/translate-menu/${jobId}/cancel`,
  });
};

export const optimizeNewsSeoDraft = (postObj: OptimizeNewsSeoPayload) => {
  return request<OptimizeNewsSeoResult>({
    method: "POST",
    url: "/news/optimize-seo",
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const translateNews = (id: number | string) => {
  return request<NewsItem>({ method: "POST", url: `/news/${id}/translate`, timeout: LONG_REQUEST_TIMEOUT });
};

export const syncNewsToPboot = (id: number | string, postObj: PbootSyncPayload = {}) => {
  return request<PbootSyncResult>({
    method: "POST",
    url: `/news/${id}/pboot-sync`,
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const importNewsFromPboot = () => {
  return request<PbootImportResult>({
    method: "POST",
    url: "/news/pboot-import",
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const pullNewsPbootScope = (postObj: PbootScopePayload) => {
  return request<PbootScopeResult>({
    method: "POST",
    url: "/news/pboot-scope/pull",
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const pushNewsPbootScope = (postObj: PbootScopePayload) => {
  return request<PbootScopeResult>({
    method: "POST",
    url: "/news/pboot-scope/push",
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const removeNews = (id: number | string) => {
  return request({ method: "DELETE", url: `/news/${id}` });
};
