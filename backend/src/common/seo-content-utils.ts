function escapeAttribute(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function imageSources(html: string) {
  return (String(html || '').match(/<img\b[^>]*>/gi) || []).map(
    (tag) => tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '',
  );
}

export type ImageAltSuggestion =
  | string
  | {
      src?: string;
      alt?: string;
    };

export function buildLanguageSeoUrlName(
  lang: string,
  suggestedSlug: string,
  fallbackTitle: string,
) {
  const prefix = lang === 'zh-CN' ? 'cn' : String(lang || 'cn').toLowerCase();
  const normalized = String(suggestedSlug || fallbackTitle || 'content')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/^(?:cn|en|es|fr|ru|ar|pt)-/i, '')
    .replace(new RegExp(`^${prefix}-`, 'i'), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return `${prefix}-${normalized || 'content'}`;
}

export function repairOptimizedHtml(
  originalHtml: string,
  optimizedHtml: string,
  imageAlts: ImageAltSuggestion[],
  fallbackAlt: string,
) {
  const original = String(originalHtml || '');
  const candidate = String(optimizedHtml || original);
  const originalSources = imageSources(original);
  const candidateSources = imageSources(candidate);
  const assetsPreserved =
    originalSources.length === candidateSources.length &&
    originalSources.every((src, index) => src === candidateSources[index]);
  const safeHtml = assetsPreserved ? candidate : original;
  const originalTags = original.match(/<img\b[^>]*>/gi) || [];
  const suggestionsBySource = new Map(
    (imageAlts || [])
      .filter((item): item is { src?: string; alt?: string } => typeof item === 'object' && item !== null)
      .map(
        (item) =>
          [String(item.src || '').trim(), String(item.alt || '').trim()] as const,
      )
      .filter(([src, alt]) => src && alt),
  );
  const sequentialSuggestions = (imageAlts || [])
    .map((item) => (typeof item === 'string' ? item : item?.alt))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  let imageIndex = 0;
  let missingIndex = 0;

  return safeHtml.replace(/<img\b[^>]*>/gi, (tag) => {
    const originalTag = originalTags[imageIndex] || '';
    imageIndex += 1;
    const originalAlt = originalTag.match(/\balt\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    if (originalAlt) {
      const preserved = escapeAttribute(originalAlt.slice(0, 120));
      if (/\balt\s*=/i.test(tag)) {
        return tag.replace(/\balt\s*=\s*(["'])[\s\S]*?\1/i, `alt="${preserved}"`);
      }
      return tag.replace(/\/?>$/, (ending) => ` alt="${preserved}"${ending}`);
    }
    const generatedAlt = tag.match(/\balt\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    const source = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || '';
    const suggested = String(
      suggestionsBySource.get(source) ||
        sequentialSuggestions[missingIndex] ||
        generatedAlt ||
        fallbackAlt ||
        '内容图片',
    ).trim();
    missingIndex += 1;
    const alt = escapeAttribute(suggested.slice(0, 120));
    if (/\balt\s*=/i.test(tag)) {
      return tag.replace(/\balt\s*=\s*(["'])[\s\S]*?\1/i, `alt="${alt}"`);
    }
    return tag.replace(/\/?>$/, (ending) => ` alt="${alt}"${ending}`);
  });
}

export function findMissingAltImages(html: string): { src: string; index: number }[] {
  return (String(html || '').match(/<img\b[^>]*>/gi) || [])
    .map((tag, index) => ({
      src: tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || '',
      index,
      hasAlt: Boolean(tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1]?.trim()),
    }))
    .filter((item) => !item.hasAlt)
    .map(({ src, index }) => ({ src, index }));
}

export function applyImageAltsOnly(
  html: string,
  suggestions: ImageAltSuggestion[],
  fallbackAlt: string,
): { html: string; imageAlts: { src: string; alt: string }[] } {
  const original = String(html || '');
  // Pass the original as the "optimized" candidate too: in ALT-only mode the AI
  // response body is never trusted, so text can only gain alt attributes.
  const repaired = repairOptimizedHtml(original, original, suggestions, fallbackAlt);
  const originalTags = original.match(/<img\b[^>]*>/gi) || [];
  const repairedTags = repaired.match(/<img\b[^>]*>/gi) || [];
  const imageAlts = originalTags
    .map((tag, index) => ({
      index,
      hadAlt: Boolean(tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1]?.trim()),
    }))
    .filter((item) => !item.hadAlt)
    .map(({ index }) => {
      const tag = repairedTags[index] || '';
      return {
        src: tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || '',
        alt: tag.match(/\balt\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || '',
      };
    })
    .filter((item) => item.src && item.alt);
  return { html: repaired, imageAlts };
}
