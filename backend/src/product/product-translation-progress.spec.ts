import { missingProductTranslationFields, productTranslationProgress } from './product-translation-progress';

const languages = ['zh-CN', 'en', 'es', 'fr', 'ru', 'ar', 'pt', 'id', 'tr', 'vi'];
const source = { title: 'CR600', content: '<h2>钻机</h2><p>参数</p>' };
const translated = (lang: string) => ({ lang, title: 'CR600', content: '<p>Translated description</p>' });

describe('product translation completeness', () => {
  it('does not count pre-created empty rows or model-only titles as translated', () => {
    const rows = languages.map(lang => ({ lang, title: 'CR600', content: '' }));
    expect(productTranslationProgress(source, rows, languages)).toMatchObject({ status: 'untranslated', completed: 0, total: 9 });
  });

  it('includes Indonesian, Turkish and Vietnamese instead of stopping at Portuguese', () => {
    const rows = languages.slice(1, 7).map(translated);
    const progress = productTranslationProgress(source, rows, languages);
    expect(progress).toMatchObject({ status: 'partial', completed: 6, total: 9 });
    expect(progress.missing.map(item => item.lang)).toEqual(['id', 'tr', 'vi']);
    expect(productTranslationProgress(source, languages.slice(1).map(translated), languages))
      .toMatchObject({ status: 'complete', completed: 9, total: 9, missing: [] });
  });

  it('recalculates when a site adds a language and ignores disabled languages', () => {
    expect(productTranslationProgress(source, [translated('en')], ['zh-CN', 'en']).status).toBe('complete');
    expect(productTranslationProgress(source, [translated('en')], ['zh-CN', 'en', 'id']).status).toBe('partial');
    expect(productTranslationProgress(source, [], ['zh-CN'])).toMatchObject({ status: 'not-required', total: 0 });
  });

  it('checks optional fields and carousel captions only when the Chinese source has them', () => {
    const cn = { ...source, subtitle: '副标题', keywords: '钻机', summary: '摘要', carouselTitles: ['整体', '', '操作'] };
    expect(missingProductTranslationFields(cn, translated('en'))).toEqual(['副标题', '关键词', '描述', '轮播标题']);
    expect(missingProductTranslationFields(cn, { ...translated('en'), subtitle: 'Subtitle', keywords: 'rig', summary: 'Summary', carouselTitles: ['Machine', '', 'Operation'] })).toEqual([]);
    expect(missingProductTranslationFields(source, translated('en'))).toEqual([]);
    expect(productTranslationProgress(source, [{ ...cn, lang: 'zh-CN' }, translated('en')], ['zh-CN', 'en']).status).toBe('partial');
  });

  it.each(['<p><br></p>', '<p>&nbsp;</p>', '<img src="rig.jpg">', '&lt;p&gt; &lt;/p&gt;', '<script>example()</script>'])('rejects placeholder-only HTML: %s', content => {
    expect(missingProductTranslationFields(source, { title: 'CR600', content })).toContain('详情');
  });
});
