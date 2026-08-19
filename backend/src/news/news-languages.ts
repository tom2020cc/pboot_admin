export const DEFAULT_NEWS_LANG = 'zh-CN';

export const NEWS_LANGUAGES = [
  { code: 'zh-CN', name: '中文' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' },
  { code: 'pt', name: 'Português' },
] as const;

export type NewsLanguageCode = (typeof NEWS_LANGUAGES)[number]['code'];

export const isSupportedNewsLang = (lang?: string): lang is NewsLanguageCode =>
  Boolean(lang && NEWS_LANGUAGES.some((item) => item.code === lang));

export const resolveNewsLang = (lang?: string): NewsLanguageCode =>
  isSupportedNewsLang(lang) ? lang : DEFAULT_NEWS_LANG;
