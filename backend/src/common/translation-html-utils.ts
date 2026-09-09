const HTML_TAG_PATTERN = /(<[^>]+>)/g;

export function decodeEscapedHtml(content: string) {
  const html = String(content || '');
  // Already-parsed markup may contain escaped quotes in image attributes.
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(html)) return html;
  return html.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&apos;/gi, "'").replace(/&amp;/gi, '&');
}

export function repairTranslatedHtml(content: string) {
  if (!content) return '';

  return decodeEscapedHtml(content)
    .replace(/<\s*(\/?)\s*([a-z][a-z0-9:-]*)([^<>]*?)\s*>/gi, (match, slash, tagName, rawAttrs) => {
      const name = String(tagName || '').toLowerCase();
      const attrs = repairTagAttributes(name, rawAttrs);

      if (slash) return `</${name}>`;
      return `<${name}${attrs ? ` ${attrs}` : ''}>`;
    })
    .replace(/<\s*br\s*\/\s*>/gi, '<br />')
    .replace(/<\s*img\b([^>]*)>\s*<\/\s*img\s*>/gi, '<img$1>');
}

function repairTagAttributes(tagName: string, rawAttrs: string) {
  let attrs = String(rawAttrs || '')
    .replace(/\s*=\s*/g, '=')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\/$/, ' /')
    .trim();

  if (tagName === 'img') {
    attrs = attrs
      .replace(/\bsrc=([^\s"'<>]+)/i, 'src="$1"')
      .replace(/\salt=([^\s"'<>][^<>]*?)(?=\s+[a-z:-]+=|\s*\/?$)/i, (_match, value) => {
        return ` alt="${escapeHtmlAttribute(String(value || '').trim())}"`;
      });
  }

  return attrs;
}

export async function translateHtmlContentSafely(
  content: string,
  translatePlainText: (text: string) => Promise<string>,
) {
  if (!content?.trim()) return '';
  if (!/<[a-z][\s\S]*>/i.test(content)) return await translatePlainText(content);

  const parts = String(content).split(HTML_TAG_PATTERN);
  const translated: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('<') && part.endsWith('>')) {
      translated.push(await translateHtmlTagAttributes(part, translatePlainText));
    } else {
      translated.push(await translatePlainText(part));
    }
  }

  return repairTranslatedHtml(translated.join(''));
}

async function translateHtmlTagAttributes(tag: string, translatePlainText: (text: string) => Promise<string>) {
  const repaired = repairTranslatedHtml(tag);
  if (!/^<img\b/i.test(repaired)) return repaired;

  const altMatch = repaired.match(/\balt=(["'])(.*?)\1/i);
  if (!altMatch?.[2]?.trim()) return repaired;

  const translatedAlt = await translatePlainText(altMatch[2]);
  return repaired.replace(/\balt=(["'])(.*?)\1/i, `alt=${altMatch[1]}${escapeHtmlAttribute(translatedAlt)}${altMatch[1]}`);
}

function escapeHtmlAttribute(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
