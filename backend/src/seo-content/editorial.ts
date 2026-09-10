import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { EditorialRules } from './seo-content.entity';

const sanitize = require('sanitize-html');
export const plainText = (value: string) =>
  sanitize(String(value || ''), {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
export function loadEditorialRules(): EditorialRules {
  const definitions = [
    ['topics', '行业选题'],
    ['research', '文字素材研究'],
    ['writing', '中文 SEO 写作'],
    ['review', '质量复核'],
    ['update', '旧文更新'],
  ];
  const rules = definitions.map(([id, title]) => ({
    id,
    title,
    text: readFileSync(
      resolve(
        __dirname,
        '../../../tools/seo-content-worker/skills',
        `${id}.md`,
      ),
      'utf8',
    ).trim(),
  }));
  return {
    version: createHash('sha256')
      .update(JSON.stringify(rules))
      .digest('hex')
      .slice(0, 16),
    rules,
  };
}

// Existing media is never sent to models. Only inert, ordered placeholders are editable.
export function maskMedia(content: string) {
  const media: string[] = [];
  const html = sanitize(content, {
    allowedTags: [...sanitize.defaults.allowedTags, 'img'],
    allowedAttributes: {},
    transformTags: {
      img: (_tag: string, attributes: Record<string, string>) => {
        const safe = sanitize(
          '<img ' +
            Object.entries(attributes)
              .map(
                ([k, v]) =>
                  `${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`,
              )
              .join(' ') +
            '>',
          {
            allowedTags: ['img'],
            allowedAttributes: {
              img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
            },
            allowedSchemes: ['http', 'https'],
            allowProtocolRelative: false,
          },
        );
        media.push(safe);
        return {
          tagName: 'span',
          attribs: {},
          text: `[[SEO_MEDIA_${media.length}]]`,
        };
      },
    },
  });
  return { html, media };
}
export function mediaIssues(content: string, media: string[] = []) {
  const tokens = content.match(/\[\[SEO_MEDIA_\d+\]\]/g) || [];
  return JSON.stringify(tokens) ===
    JSON.stringify(media.map((_, i) => `[[SEO_MEDIA_${i + 1}]]`))
    ? []
    : ['原文图片占位符缺失、重复或顺序变化，请保留原文图片位置'];
}
export function restoreMedia(content: string, media: string[]) {
  if (mediaIssues(content, media).length) throw new Error('原文图片占位符无效');
  return content.replace(
    /\[\[SEO_MEDIA_(\d+)\]\]/g,
    (_, i) => media[Number(i) - 1],
  );
}
