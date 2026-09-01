import {
  applyImageAltsOnly,
  buildLanguageSeoUrlName,
  findMissingAltImages,
} from './seo-content-utils';

describe('seo-content-utils alt helpers', () => {
  describe('buildLanguageSeoUrlName', () => {
    it('replaces an existing language prefix instead of stacking prefixes', () => {
      expect(buildLanguageSeoUrlName('en', 'cn-1691', 'About us')).toBe('en-1691');
      expect(buildLanguageSeoUrlName('pt', 'es-company-profile', 'Company profile')).toBe('pt-company-profile');
    });
  });

  describe('findMissingAltImages', () => {
    it('lists only images whose alt is missing or empty', () => {
      const html = [
        `<img src="/a.jpg" alt="已有描述">`,
        `<img src="/b.jpg">`,
        `<img src="/c.jpg" alt="">`,
        `<img src="/d.jpg" alt='  '>`,
      ].join('');

      expect(findMissingAltImages(html)).toEqual([
        { src: '/b.jpg', index: 1 },
        { src: '/c.jpg', index: 2 },
        { src: '/d.jpg', index: 3 },
      ]);
    });

    it('returns empty for html without images or without missing alts', () => {
      expect(findMissingAltImages('<p>纯文字</p>')).toEqual([]);
      expect(findMissingAltImages('<img src="/a.jpg" alt="齐全">')).toEqual([]);
    });
  });

  describe('applyImageAltsOnly', () => {
    it('applies object suggestions by src and preserves existing alt and text', () => {
      const html = '<p>挖掘机交付</p><img src="/a.jpg" alt="已有描述"><img src="/b.jpg" loading="lazy">';
      const { html: repaired, imageAlts } = applyImageAltsOnly(
        html,
        [{ src: '/b.jpg', alt: '挖掘机施工现场' }],
        '兜底描述',
      );

      expect(repaired).toBe(
        '<p>挖掘机交付</p><img src="/a.jpg" alt="已有描述"><img src="/b.jpg" loading="lazy" alt="挖掘机施工现场">',
      );
      expect(imageAlts).toEqual([{ src: '/b.jpg', alt: '挖掘机施工现场' }]);
    });

    it('applies sequential string suggestions in document order', () => {
      const html = '<img src="/one.jpg"><img src="/two.jpg">';
      const { html: repaired, imageAlts } = applyImageAltsOnly(
        html,
        ['第一张图', '第二张图'],
        '兜底描述',
      );

      expect(repaired).toBe('<img src="/one.jpg" alt="第一张图"><img src="/two.jpg" alt="第二张图">');
      expect(imageAlts).toEqual([
        { src: '/one.jpg', alt: '第一张图' },
        { src: '/two.jpg', alt: '第二张图' },
      ]);
    });

    it('falls back to the provided fallback alt when suggestions run out', () => {
      const { html: repaired, imageAlts } = applyImageAltsOnly(
        '<img src="/a.jpg">',
        [],
        '挖掘机 - 产品图',
      );

      expect(repaired).toBe('<img src="/a.jpg" alt="挖掘机 - 产品图">');
      expect(imageAlts).toEqual([{ src: '/a.jpg', alt: '挖掘机 - 产品图' }]);
    });

    it('escapes html in suggestions and truncates to 120 characters', () => {
      const { html: repaired } = applyImageAltsOnly(
        '<img src="/a.jpg">',
        ['挖掘机"施工"现场 <重点>'],
        '兜底',
      );
      const longAlt = '长'.repeat(150);
      const { html: truncated } = applyImageAltsOnly('<img src="/a.jpg">', [longAlt], '兜底');

      expect(repaired).toBe('<img src="/a.jpg" alt="挖掘机&quot;施工&quot;现场 &lt;重点&gt;">');
      expect(truncated).toBe(`<img src="/a.jpg" alt="${'长'.repeat(120)}">`);
    });

    it('keeps html unchanged and reports nothing when no image lacks alt', () => {
      const html = '<p>文字</p><img src="/a.jpg" alt="齐全">';
      const { html: repaired, imageAlts } = applyImageAltsOnly(html, ['不该出现'], '兜底');

      expect(repaired).toBe(html);
      expect(imageAlts).toEqual([]);
    });

    it('never touches text outside img tags even with odd suggestions', () => {
      const html = '<h2>标题</h2><p>正文段落保持原样</p>';
      const { html: repaired, imageAlts } = applyImageAltsOnly(html, [{ alt: 'x' }, 'y'], '兜底');

      expect(repaired).toBe(html);
      expect(imageAlts).toEqual([]);
    });
  });
});
