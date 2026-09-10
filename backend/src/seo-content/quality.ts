import { ArticleDraft } from './seo-content.entity';
const sanitize = require('sanitize-html');

export const textOnly = (value: string) =>
  sanitize(String(value || ''), {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/&nbsp;|&#160;/gi, ' ')
    .trim();
export const normalizedText = (value: string) =>
  textOnly(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

export interface ComparisonArticle {
  id: string;
  kind: 'news' | 'job';
  title: string;
  content: string;
  blocksDuplicate: boolean;
}

// Character shingles are a local similarity hint, not an originality certificate.
function shingles(value: string) {
  const result = new Set<string>();
  for (let i = 0; i + 5 <= value.length; i++) result.add(value.slice(i, i + 5));
  return result;
}
export function inspectQuality(
  draft: ArticleDraft,
  keywords: string[],
  references: ComparisonArticle[],
) {
  const body = textOnly(draft.content),
    normalized = normalizedText(draft.content);
  const title = normalizedText(draft.title),
    grams = shingles(normalized);
  const matched = keywords.filter(
    (k) =>
      k.trim() &&
      normalizedText(draft.title + body).includes(normalizedText(k)),
  );
  const warnings: string[] = [],
    issues: string[] = [];
  const headings = (draft.content.match(/<h[23]\b/gi) || []).length;
  if (normalized.length < 300)
    warnings.push('正文较短，请检查是否充分回答了读者的问题');
  if (!headings) warnings.push('缺少小标题，可按问题、选型依据或结论组织正文');
  if (!matched.length && keywords.length)
    warnings.push('没有覆盖本站计划关键词，请检查选题是否属于当前行业');
  if (normalizedText(draft.summary).length > 180)
    warnings.push('SEO 描述较长，建议保留清晰简洁的摘要');
  const similar = references
    .flatMap((row) => {
      const exactTitle = !!title && normalizedText(row.title) === title;
      const other = normalizedText(row.content);
      let score = 0;
      if (normalized.length >= 80 && other.length >= 80) {
        const theirs = shingles(other);
        let overlap = 0;
        for (const gram of grams) if (theirs.has(gram)) overlap++;
        score = Math.round((200 * overlap) / (grams.size + theirs.size));
      }
      if (exactTitle && row.blocksDuplicate)
        issues.push(`与本站已有文章标题重复：${row.title}`);
      if (score < 60 && !exactTitle) return [];
      return [
        { id: row.id, kind: row.kind, title: row.title, score, exactTitle },
      ];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (similar.some((row) => row.score >= 60))
    warnings.push('与本站已有内容较相似，请核对重复段落并补充真实的新信息');
  return {
    issues: [...new Set(issues)],
    warnings,
    stats: {
      bodyChars: normalized.length,
      headings,
      matchedKeywords: matched,
      missingKeywords: keywords.filter((k) => !matched.includes(k)),
      comparedCount: references.length,
    },
    similar,
  };
}
