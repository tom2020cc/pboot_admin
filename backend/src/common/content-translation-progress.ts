import { DEFAULT_NEWS_LANG } from '../news/news-languages';

export type TranslationContent = {
  title?: string; content?: string; subtitle?: string; keywords?: string;
  summary?: string; description?: string; carouselTitles?: string[];
};
export type TranslationRecord = TranslationContent & { lang: string };

const hasText = (value?: string) => Boolean(String(value || '')
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160|#x0*a0);/gi, '')
  .replace(/[\s\u200b-\u200d\ufeff]/g, ''));

export function missingTranslationFields(source: TranslationContent, target?: TranslationContent, bodyLabel = '正文') {
  const missing: string[] = [];
  if (!hasText(target?.title)) missing.push('标题');
  if (!hasText(target?.content)) missing.push(bodyLabel);
  for (const [key, label] of [['subtitle', '副标题'], ['keywords', '关键词']] as const) {
    if (hasText(source[key]) && !hasText(target?.[key])) missing.push(label);
  }
  if (hasText(source.summary || source.description) && !hasText(target?.summary || target?.description)) missing.push('描述');
  if ((source.carouselTitles || []).some((title, index) => hasText(title) && !hasText(target?.carouselTitles?.[index]))) {
    missing.push('轮播标题');
  }
  return missing;
}

export function contentTranslationProgress(content: TranslationContent, translations: TranslationRecord[], languages: string[], bodyLabel = '正文') {
  const source = translations.find(item => item.lang === DEFAULT_NEWS_LANG) || content;
  const targets = [...new Set(languages)].filter(lang => lang !== DEFAULT_NEWS_LANG);
  const missing: { lang: string; fields: string[] }[] = [];
  const completed: string[] = [];
  let started = false;
  for (const lang of targets) {
    const translation = translations.find(item => item.lang === lang);
    const fields = missingTranslationFields(source, translation, bodyLabel);
    if (fields.length) missing.push({ lang, fields });
    else completed.push(lang);
    if (translation && [translation.content, translation.subtitle, translation.summary, translation.description, translation.keywords]
      .some(hasText)) started = true;
  }
  return {
    status: !targets.length ? 'not-required' as const : !missing.length ? 'complete' as const
      : completed.length || started ? 'partial' as const : 'untranslated' as const,
    total: targets.length,
    completed: completed.length,
    completedLanguages: completed,
    missing,
  };
}
