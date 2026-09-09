import { contentTranslationProgress, missingTranslationFields } from '../common/content-translation-progress';
import { NewsService } from './news.service';
import { SyncNewsScopeDto } from './dto/sync-news-scope.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

const languages = ['zh-CN', 'en', 'es', 'fr', 'ru', 'ar', 'pt', 'id', 'tr', 'vi'];
const source = { title: '客户来访', content: '<h2>新闻正文</h2>' };
const translated = (lang: string) => ({ lang, title: 'Customer visit', content: '<p>News content</p>' });

describe('news translation completeness', () => {
  it('counts saved content, not empty language placeholders or titles alone', () => {
    const placeholders = languages.map(lang => ({ lang, title: source.title, content: '' }));
    expect(contentTranslationProgress(source, placeholders, languages)).toMatchObject({ status: 'untranslated', completed: 0, total: 9 });
    expect(missingTranslationFields(source, { title: 'Title', content: '<p>&nbsp;<br></p>' })).toEqual(['正文']);
  });

  it('includes all three new languages and recalculates against enabled site languages', () => {
    const rows = languages.slice(1, 7).map(translated);
    expect(contentTranslationProgress(source, rows, languages)).toMatchObject({ status: 'partial', completed: 6, total: 9 });
    expect(contentTranslationProgress(source, rows, languages).missing.map(item => item.lang)).toEqual(['id', 'tr', 'vi']);
    expect(contentTranslationProgress(source, languages.slice(1).map(translated), languages).status).toBe('complete');
    expect(contentTranslationProgress(source, [translated('en')], ['zh-CN', 'en']).status).toBe('complete');
    expect(contentTranslationProgress(source, [translated('en')], ['zh-CN', 'en', 'vi']).status).toBe('partial');
    expect(contentTranslationProgress(source, [], ['zh-CN'])).toMatchObject({ status: 'not-required', total: 0 });
  });

  it('requires SEO fields only when present in Chinese, without product-only media requirements', () => {
    const cn = { ...source, subtitle: '副标题', keywords: '客户', summary: '摘要' };
    expect(missingTranslationFields(cn, translated('en'))).toEqual(['副标题', '关键词', '描述']);
    expect(missingTranslationFields(cn, { ...translated('en'), subtitle: 'Visit', keywords: 'customer', summary: 'Summary' })).toEqual([]);
    expect(missingTranslationFields(source, translated('en'))).toEqual([]);
  });

  it('returns progress across languages even while displaying English and retains legacy Chinese rows', async () => {
    const articles = [{ ...source, id: 1, siteId: 2, menuId: 1 }, { ...source, id: 2, siteId: 2, menuId: 1 }];
    const translations = languages.slice(1).map(lang => ({ ...translated(lang), newsId: 1 }));
    const findNews = jest.fn(async () => articles);
    const findTranslations = jest.fn(async () => translations);
    const service: any = new NewsService({ find: findNews } as any, { find: findTranslations } as any,
      {} as any, {} as any, {} as any, { getCurrentSiteLanguages: async () => languages.map(code => ({ code })) } as any);
    service.currentSiteId = async () => 2;
    service.resolveMenuFilterIds = async () => undefined;
    const chinese = await service.findAll(undefined, 'zh-CN');
    expect(chinese.map(item => item.translationProgress.status)).toEqual(['complete', 'untranslated']);
    const english = await service.findAll(undefined, 'en');
    expect(english).toHaveLength(1);
    expect(english[0]).toMatchObject({ title: 'Customer visit', lang: 'en', translationProgress: { status: 'complete', completed: 9 } });
    expect(findNews).toHaveBeenLastCalledWith(expect.objectContaining({ where: { siteId: 2 } }));
    expect(findTranslations.mock.calls).toHaveLength(2);
  });

  it.each([0, -1, 1.5, 'bad', undefined])('rejects invalid scope IDs: %s', async menuId => {
    expect((await validate(plainToInstance(SyncNewsScopeDto, { menuId }))).length).toBeGreaterThan(0);
  });
});
