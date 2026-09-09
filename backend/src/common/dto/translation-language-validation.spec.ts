import { validate } from 'class-validator';
import { TranslateMenuContentDto } from './translate-menu-content.dto';
import { PbootScopeDto } from './pboot-scope.dto';
import { TranslateNewsDto } from '../../news/dto/translate-news.dto';
import { TranslateProductDto } from '../../product/dto/translate-product.dto';

describe('translation language validation', () => {
  const targetLanguages = ['id', 'tr', 'vi'];

  it.each(targetLanguages)('accepts %s in every translation and sync DTO', async (lang) => {
    const product = Object.assign(new TranslateProductDto(), {
      targetLang: lang,
      model: 'deepseek-chat',
      title: '测试产品',
    });
    const news = Object.assign(new TranslateNewsDto(), {
      targetLang: lang,
      model: 'deepseek-chat',
      title: '测试新闻',
    });
    const menuContent = Object.assign(new TranslateMenuContentDto(), {
      menuId: 1,
      targetLang: lang,
      model: 'deepseek-chat',
    });
    const pbootScope = Object.assign(new PbootScopeDto(), { menuId: 1, lang });

    const results = await Promise.all([
      validate(product),
      validate(news),
      validate(menuContent),
      validate(pbootScope),
    ]);

    expect(results.every((errors) => errors.length === 0)).toBe(true);
  });
});
