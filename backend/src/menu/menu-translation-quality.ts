import { BadRequestException } from '@nestjs/common';

export const MENU_TRANSLATION_LANGUAGES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', ru: 'Russian', ar: 'Arabic',
  pt: 'Portuguese', id: 'Indonesian', vi: 'Vietnamese', tr: 'Turkish',
};

// These are conservative rejection checks, not proof of translation accuracy.
export function assertMenuTranslationQuality(source: string[], translated: string[], acode: string) {
  const fail = (reason: string) => {
    throw new BadRequestException(`栏目翻译校验失败 (${acode})：${reason} [quality check failed]`);
  };
  if (!MENU_TRANSLATION_LANGUAGES[acode]) fail('不支持的目标语言');
  if (!Array.isArray(translated) || translated.length !== source.length ||
      translated.some(value => typeof value !== 'string' || !value.trim())) {
    fail('返回数量不完整或存在空值');
  }
  const chineseIndex = translated.findIndex(value => /[\u3400-\u9fff]/u.test(value));
  if (chineseIndex >= 0) fail(`第 ${chineseIndex + 1} 项仍含中文，未保存该语言`);

  const prose = translated.filter((_, index) => /[\u3400-\u9fff]/u.test(source[index]));
  const text = prose.join(' ').normalize('NFD');
  // A whole Vietnamese category/SEO batch without any Vietnamese marks is suspicious.
  // Short shared words and model-only lists (Video, BQ, CR1200I) are not rejected.
  if (acode === 'vi' && prose.length >= 3 && (text.match(/[a-z]/gi) || []).length >= 100 &&
      !/[đĐ\u0300-\u036f]/u.test(text)) {
    fail('整批文本没有越南语特征，疑似返回了英文，未保存该语言');
  }
}
