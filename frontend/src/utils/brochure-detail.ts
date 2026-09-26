import DOMPurify from 'dompurify';

// Keep content structure, but discard website layout, scripts and tracking embeds.
export function cleanBrochureDetail(html = '') {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'div', 'section', 'article', 'span', 'bdi', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup', 'br', 'hr', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'figure', 'figcaption', 'img', 'a'],
    ALLOWED_ATTR: ['src', 'alt', 'title', 'href', 'colspan', 'rowspan', 'scope', 'span', 'start', 'lang', 'dir'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  });
}

export function renderBrochureDetail(html: string, rtl: boolean) {
  const clean = cleanBrochureDetail(html);
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  if (rtl) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest('[dir="ltr"], bdi, code, pre')) continue;
    const text = node.textContent || '';
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(/[A-Za-z0-9][A-Za-z0-9 \t.,/%°()+:=-]*/g)) {
      const value = match[0].trimEnd();
      fragment.append(text.slice(cursor, match.index));
      const isolate = doc.createElement('bdi'); isolate.dir = 'ltr'; isolate.textContent = value;
      fragment.append(isolate); cursor = match.index! + value.length;
    }
    if (cursor) { fragment.append(text.slice(cursor)); node.replaceWith(fragment); }
  }
  }
  // Normalize only presentation in the export copy; source HTML stays editable and unchanged.
  doc.querySelectorAll('table').forEach(table => {
    if (table.querySelector('table')) return;
    const first = table.rows[0];
    if (!table.tHead && first?.parentElement?.tagName === 'TBODY' && first.cells.length > 1
      && Array.from(first.cells).every(cell => cell.tagName === 'TH' && cell.rowSpan === 1)) {
      table.createTHead().append(first);
    }
    const columns = Math.max(0, ...Array.from(table.rows, row => Array.from(row.cells).reduce((sum, cell) => sum + cell.colSpan, 0)));
    Array.from(table.rows).forEach(row => {
      const cell = row.cells[0];
      if (row.parentElement?.tagName === 'TBODY' && row.cells.length === 1 && cell?.tagName === 'TH'
        && cell.colSpan === columns && columns > 1 && cell.rowSpan === 1) row.classList.add('table-group');
      if ((row.textContent || '').length > 600) row.classList.add('long-value');
    });
  });
  return doc.body.innerHTML;
}

export function mapDetailImages(html: string, map: (src: string) => string) {
  const doc = new DOMParser().parseFromString(cleanBrochureDetail(html), 'text/html');
  doc.querySelectorAll('img').forEach(image => {
    const src = map(image.getAttribute('src') || '');
    if (src) image.setAttribute('src', src);
    else removeBrochureImage(image);
  });
  return cleanBrochureDetail(doc.body.innerHTML);
}

export function removeBrochureImage(image: Element) {
  const figure = image.closest('figure');
  let parent = image.parentElement;
  image.remove();
  if (figure && !figure.querySelector('img')) {
    figure.querySelectorAll('figcaption').forEach(caption => caption.remove());
    if (!figure.textContent?.trim()) { parent = figure.parentElement; figure.remove(); }
  }
  while (parent && parent.matches('p,span,a,figure') && !parent.textContent?.trim() && !parent.querySelector('img,table')) {
    const next = parent.parentElement; parent.remove(); parent = next;
  }
}

export function detailImages(html = '') {
  const doc = new DOMParser().parseFromString(cleanBrochureDetail(html), 'text/html');
  return Array.from(doc.querySelectorAll('img'), image => image.getAttribute('src') || '').filter(Boolean);
}
