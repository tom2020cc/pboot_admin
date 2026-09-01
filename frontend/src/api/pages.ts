import request from "@/utils/request";
import { compactHtmlForStorage } from "@/utils/htmlContent";
import {
  DEFAULT_NEWS_LANG,
  NEWS_LANGUAGES,
  type NewsLanguageCode,
  type TranslateDraftPayload,
  type TranslateDraftResult,
  type TranslationModel,
} from "@/api/news";

const LONG_REQUEST_TIMEOUT = 180000;

export { DEFAULT_NEWS_LANG, NEWS_LANGUAGES };

export type PageTranslation = {
  id?: number;
  pageId?: number;
  lang: NewsLanguageCode | string;
  title: string;
  urlName: string;
  subtitle: string;
  keywords: string;
  description: string;
  content: string;
};

export type PageItem = {
  id: number;
  menuId: number;
  title: string;
  urlName: string;
  subtitle: string;
  keywords: string;
  description: string;
  content: string;
  show: boolean;
  orderNum: number;
  lang?: string;
  translations?: PageTranslation[];
  createTime?: string;
  updateTime?: string;
};

export type PageForm = Omit<PageItem, "id" | "createTime" | "updateTime">;

export type PageSyncPayload = {
  lang?: string;
  all?: boolean;
};

export const createEmptyPageTranslations = (): PageTranslation[] =>
  NEWS_LANGUAGES.map((item) => ({
    lang: item.code,
    title: "",
    urlName: "",
    subtitle: "",
    keywords: "",
    description: "",
    content: "",
  }));

export const ensurePageTranslations = (translations: PageTranslation[] = []) => {
  const map = new Map(translations.map((item) => [item.lang, item]));
  return NEWS_LANGUAGES.map((item) => ({
    lang: item.code,
    title: map.get(item.code)?.title || "",
    urlName: map.get(item.code)?.urlName || "",
    subtitle: map.get(item.code)?.subtitle || "",
    keywords: map.get(item.code)?.keywords || "",
    description: map.get(item.code)?.description || "",
    content: map.get(item.code)?.content || "",
  }));
};

export const buildPageUrlName = (sourceUrlName: string, targetLang: string, fallbackTitle: string) => {
  const prefix = targetLang === DEFAULT_NEWS_LANG ? "cn" : String(targetLang || "cn").toLowerCase();
  const normalized = String(sourceUrlName || fallbackTitle || "content")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^(?:cn|en|es|fr|ru|ar|pt)-/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return `${prefix}-${normalized || "content"}`;
};

export const findMissingPageSeoFields = (translation: PageTranslation) => {
  const fields: Array<[keyof PageTranslation, string]> = [
    ["title", "标题"],
    ["urlName", "URL 名称"],
    ["keywords", "关键词"],
    ["description", "描述"],
    ["content", "正文"],
  ];
  return fields.filter(([field]) => !String(translation[field] || "").trim()).map(([, label]) => label);
};

export const createEmptyPageForm = (): PageForm => ({
  menuId: 0,
  title: "",
  urlName: "",
  subtitle: "",
  keywords: "",
  description: "",
  content: "",
  show: true,
  orderNum: 0,
  lang: DEFAULT_NEWS_LANG,
  translations: createEmptyPageTranslations(),
});

export const normalizePagePayload = (form: PageForm): PageForm => {
  const translations = ensurePageTranslations(form.translations).map((item) => ({
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
    description: defaultTranslation.description || form.description || "",
    content: defaultTranslation.content || compactHtmlForStorage(form.content) || "",
    translations,
  };
};

export const getPageList = (menuId?: number | string, lang: string = DEFAULT_NEWS_LANG) => {
  return request<PageItem[]>({ method: "GET", url: "/pages", params: { ...(menuId ? { menuId } : {}), lang } });
};

export const getPageById = (id: number | string, lang: string = DEFAULT_NEWS_LANG) => {
  return request<PageItem>({ method: "GET", url: `/pages/${id}`, params: { lang } });
};

export const createPage = (postObj: PageForm) => {
  return request<PageItem>({ method: "POST", url: "/pages", data: normalizePagePayload(postObj) });
};

export const updatePage = (id: number | string, postObj: PageForm) => {
  return request<PageItem>({ method: "PATCH", url: `/pages/${id}`, data: normalizePagePayload(postObj) });
};

export const syncPageToPboot = (id: number | string, postObj: PageSyncPayload = {}) => {
  return request({ method: "POST", url: `/pages/${id}/pboot-sync`, data: postObj, timeout: LONG_REQUEST_TIMEOUT });
};

export const syncAllPagesToPboot = () => {
  return request({ method: "POST", url: "/pages/pboot-sync-all", timeout: LONG_REQUEST_TIMEOUT });
};

export const importPagesFromPboot = () => {
  return request({ method: "POST", url: "/pages/pboot-import", timeout: LONG_REQUEST_TIMEOUT });
};

export const getPageTranslationModels = () => {
  return request<TranslationModel[]>({ method: "GET", url: "/pages/translation-models" });
};

export const translatePageDraft = (postObj: TranslateDraftPayload) => {
  return request<TranslateDraftResult>({
    method: "POST",
    url: "/pages/translate-draft",
    data: postObj,
    timeout: LONG_REQUEST_TIMEOUT,
  });
};

export const removePage = (id: number | string) => {
  return request({ method: "DELETE", url: `/pages/${id}` });
};
