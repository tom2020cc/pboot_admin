import { contentTranslationProgress, missingTranslationFields, TranslationContent, TranslationRecord } from '../common/content-translation-progress';

export const missingProductTranslationFields = (source: TranslationContent, target?: TranslationContent) =>
  missingTranslationFields(source, target, '详情');

export const productTranslationProgress = (product: TranslationContent, translations: TranslationRecord[], languages: string[]) =>
  contentTranslationProgress(product, translations, languages, '详情');
