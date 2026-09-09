import { BadRequestException } from '@nestjs/common';
import { NewsService } from '../news/news.service';
import { ProductService } from '../product/product.service';

describe('translation image markup guard', () => {
  it('keeps every product image attribute unchanged except an existing alt value', () => {
    const service = Object.create(ProductService.prototype) as ProductService;
    const sourceTag =
      `<img src='/static/product.jpg' class="hero" data-id='7' alt = '24吨履带挖掘机施工图片' loading="lazy">`;
    const untouchedTag = `<img src="/static/detail.jpg" data-kind='detail' loading='eager'>`;
    const protection = (service as any).protectImageMarkup({
      content: `<p>产品图片</p>${sourceTag}<p>细节</p>${untouchedTag}`,
      carouselTitles: ['产品正面图'],
    });

    expect(protection.draft.content).toBe(
      '<p>产品图片</p>@@PBOOTCMS_IMAGE_0000@@<p>细节</p>@@PBOOTCMS_IMAGE_0001@@',
    );
    expect(protection.draft.carouselTitles).toEqual([
      '产品正面图',
      '24吨履带挖掘机施工图片',
    ]);

    const restored = (service as any).restoreProtectedImageMarkup(
      '<p>Images du produit</p>@@PBOOTCMS_IMAGE_0000@@<p>Détails</p>@@PBOOTCMS_IMAGE_0001@@',
      protection.images,
      ["Photo de travail de l'excavateur sur chenilles de 24 tonnes"],
    );

    expect(restored).toBe(
      `<p>Images du produit</p><img src='/static/product.jpg' class="hero" data-id='7' alt = 'Photo de travail de l&#39;excavateur sur chenilles de 24 tonnes' loading="lazy"><p>Détails</p>${untouchedTag}`,
    );
  });

  it('rejects product translations that remove or reorder image placeholders', () => {
    const service = Object.create(ProductService.prototype) as ProductService;
    const protection = (service as any).protectImageMarkup({
      content: '<img src="/a.jpg"><img src="/b.jpg">',
      carouselTitles: [],
    });

    expect(() =>
      (service as any).restoreProtectedImageMarkup(
        '@@PBOOTCMS_IMAGE_0001@@@@PBOOTCMS_IMAGE_0000@@',
        protection.images,
        [],
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an otherwise valid model response before fallback when a protected image token is missing', () => {
    const service = Object.create(ProductService.prototype) as ProductService;
    const source = {
      targetLang: 'fr',
      model: 'deepseek-chat',
      title: '钻机',
      subtitle: '',
      keywords: '',
      summary: '',
      content: '<p>说明</p>@@PBOOTCMS_IMAGE_0000@@',
      carouselTitles: [],
    };
    const response = JSON.stringify({
      title: 'Foreuse',
      subtitle: '',
      keywords: '',
      summary: '',
      content: '<p>Description</p>',
      carouselTitles: [],
    });

    expect(() => (service as any).toTranslationResult(source, response)).toThrow(BadRequestException);
  });

  it('restores news image tags byte-for-byte before alt-only repair', () => {
    const service = Object.create(NewsService.prototype) as NewsService;
    const tag = `<img src='/static/news.jpg' class="article" data-id='9' alt = '新闻图片' loading="lazy">`;
    const protection = (service as any).protectImageMarkup({ content: `<p>新闻</p>${tag}` });
    const restored = (service as any).restoreProtectedImageMarkup(
      '<p>Actualités</p>@@PBOOTCMS_IMAGE_0000@@',
      protection.images,
    );

    expect(restored).toBe(`<p>Actualités</p>${tag}`);
  });
});
