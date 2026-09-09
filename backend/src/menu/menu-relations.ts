export type RelatedMenu = {
  id: string | number; parentId: number; code: string; href: string; urlName: string;
  siteId?: number; sourceMenuId?: number; pendingDelete?: boolean;
};

export function menuLanguage(menu: RelatedMenu, menus: RelatedMenu[] = [], seen = new Set<number>()): string {
  const lang = String(menu.code || '').match(/^pboot:([^:]+):/)?.[1];
  if (lang) return lang;
  if (seen.has(Number(menu.id))) return '';
  seen.add(Number(menu.id));
  const parent = menus.find(item => Number(item.id) === Number(menu.parentId));
  return parent ? menuLanguage(parent, menus, seen) : 'cn';
}

export function menuSlug(menu: Pick<RelatedMenu, 'urlName' | 'href'>) {
  return String(menu.urlName || menu.href || '').trim().replace(/^\/+|\/+$/g, '')
    .replace(/^(cn|en|es|fr|ru|ar|pt|id|tr|vi)[-_/]+/i, '').toLowerCase();
}

// Legacy links are inferred only from unique URLs within matching parent trees.
// Explicit source IDs remain authoritative even after URL edits or sibling deletion.
export function resolveMenuSources<T extends RelatedMenu>(menus: T[]) {
  const result = new Map<number, number>();
  const byId = new Map(menus.map(menu => [Number(menu.id), menu]));
  const visiting = new Set<number>();
  const resolve = (menu: T): number => {
    const id = Number(menu.id);
    if (result.has(id)) return result.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const lang = menuLanguage(menu, menus);
    let sourceId = 0;
    if (lang === 'cn') sourceId = id;
    else if (menu.sourceMenuId) {
      const source = byId.get(Number(menu.sourceMenuId));
      if (source && source.siteId === menu.siteId && menuLanguage(source, menus) === 'cn') sourceId = Number(source.id);
    } else {
      const parent = byId.get(Number(menu.parentId));
      const parentSource = parent ? resolve(parent) : 0;
      const slug = menuSlug(menu);
      if (slug && (!menu.parentId || parentSource)) {
        const candidates = menus.filter(item => item.siteId === menu.siteId && menuLanguage(item, menus) === 'cn'
          && Number(item.parentId) === parentSource && menuSlug(item) === slug);
        const peers = menus.filter(item => item.siteId === menu.siteId && menuLanguage(item, menus) === lang
          && Number(item.parentId) === Number(menu.parentId) && menuSlug(item) === slug);
        if (candidates.length === 1 && peers.length === 1) sourceId = Number(candidates[0].id);
      }
    }
    visiting.delete(id);
    result.set(id, sourceId);
    return sourceId;
  };
  menus.forEach(resolve);
  return result;
}
