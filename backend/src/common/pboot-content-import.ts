import { Menu } from '../menu/entities/menu.entity';

export const PBOOT_LANG_MAP: Record<string, string> = {
  cn: 'zh-CN',
  en: 'en',
  es: 'es',
  fr: 'fr',
  ru: 'ru',
  ar: 'ar',
  pt: 'pt',
};

const PBOOT_LANGS = Object.keys(PBOOT_LANG_MAP);
const PREFERRED_LANGS = ['cn', 'en', 'es', 'fr', 'ru', 'ar', 'pt'];

export type PbootContentRow = {
  id: number;
  acode: string;
  scode: string;
  title: string;
  subtitle: string;
  filename: string;
  author: string;
  source: string;
  date: string;
  ico: string;
  pics: string;
  content: string;
  keywords: string;
  description: string;
  sorting: number;
  status: string;
  create_time: string;
  update_time: string;
  picstitle: string;
  mcode: string;
  sort_filename: string;
  sort_name: string;
  ext_bigpic?: string;
  ext_video?: string;
};

export type PbootContentGroup = {
  key: string;
  slug: string;
  rows: PbootContentRow[];
  byLang: Map<string, PbootContentRow>;
};

type PbootSortRow = {
  acode: string;
  scode: string;
  name: string;
  filename: string;
  mcode: string;
};

export const queryPbootRows = <T>(db: any, sql: string, params: any[] = []) => {
  const stmt = db.prepare(sql);
  const rows: T[] = [];
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
};

export const normalizePbootImage = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return raw;
  if (/^(static|upload|uploads)\//i.test(raw)) return `/${raw}`;
  return raw;
};

export const splitPbootList = (value: string) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const toPbootDate = (value: unknown) => {
  if (value === null || value === undefined || value === '') return new Date();
  if (typeof value === 'number') {
    const date = new Date(value > 9999999999 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} /.test(text) ? text.replace(' ', 'T') : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

export const normalizePbootSlug = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const generatedMatch = raw.match(/^(vue-(?:news|product)-\d+)-(cn|en|es|fr|ru|ar|pt)$/i);
  if (generatedMatch) return generatedMatch[1].toLowerCase();
  return raw
    .replace(/^\/+/, '')
    .replace(new RegExp(`^(${PBOOT_LANGS.join('|')})[-_/]+`, 'i'), '')
    .toLowerCase();
};

export const readPbootContentGroups = (db: any, mcode: string, typeName: string) => {
  const rows = queryPbootRows<PbootContentRow>(
    db,
    `select c.*, e.ext_bigpic, e.ext_video, s.mcode, s.filename as sort_filename, s.name as sort_name
     from ay_content c
     join ay_content_sort s on s.acode = c.acode and s.scode = c.scode
     left join ay_content_ext e on e.contentid = c.id
     where s.mcode = ?
     order by c.id asc`,
    [mcode],
  );

  const groups = new Map<string, PbootContentGroup>();
  for (const row of rows) {
    const acode = String(row.acode || '').trim();
    const slug = normalizePbootSlug(row.filename) || normalizePbootSlug(row.title) || `id-${row.id}`;
    const titleSlug = normalizePbootSlug(row.title);
    let key = `${typeName}:${slug}`;

    if (groups.get(key)?.byLang.has(acode)) {
      key = `${typeName}:${slug}:${titleSlug || row.id}`;
      if (groups.get(key)?.byLang.has(acode)) key = `${typeName}:${slug}:${titleSlug || row.id}:${row.id}`;
    }

    if (!groups.has(key)) groups.set(key, { key, slug, rows: [], byLang: new Map() });
    const group = groups.get(key);
    group.rows.push(row);
    group.byLang.set(acode, row);
  }

  return { sourceRows: rows.length, groups: [...groups.values()] };
};

export const readPbootNewsContentGroups = (db: any) => {
  const rows = queryPbootRows<PbootContentRow>(
    db,
    `select c.*, s.mcode, s.filename as sort_filename, s.name as sort_name
     from ay_content c
     join ay_content_sort s on s.acode = c.acode and s.scode = c.scode
     where s.mcode = '2'
     order by c.id asc`,
  );

  const groups = new Map<string, PbootContentGroup>();
  for (const row of rows) {
    const acode = String(row.acode || '').trim();
    const sortSlug = normalizePbootSlug(row.sort_filename) || normalizePbootSlug(row.sort_name) || String(row.scode || '').trim();
    const dateKey = normalizePbootDateKey(row.date || row.create_time || row.update_time);
    const fallback = normalizePbootSlug(row.filename) || normalizePbootSlug(row.title) || `id-${row.id}`;
    let key = `news:${sortSlug}:${dateKey || fallback}`;

    if (groups.get(key)?.byLang.has(acode)) {
      key = `news:${sortSlug}:${fallback}`;
      if (groups.get(key)?.byLang.has(acode)) key = `news:${sortSlug}:${fallback}:${row.id}`;
    }

    if (!groups.has(key)) groups.set(key, { key, slug: key, rows: [], byLang: new Map() });
    const group = groups.get(key);
    group.rows.push(row);
    group.byLang.set(acode, row);
  }

  return { sourceRows: rows.length, groups: [...groups.values()] };
};

const normalizePbootDateKey = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').replace(/[^\d]/g, '').slice(0, 14);
};

export const choosePbootBaseRow = (group: PbootContentGroup) => {
  for (const lang of PREFERRED_LANGS) {
    if (group.byLang.has(lang)) return group.byLang.get(lang);
  }
  return group.rows[0];
};

export const createPbootMenuResolver = (db: any, menus: Menu[], mcode: string, fallbackCode: string) => {
  const sorts = queryPbootRows<PbootSortRow>(db, 'select acode,scode,name,filename,mcode from ay_content_sort');
  const menuByCode = new Map(menus.map((menu) => [String(menu.code || ''), menu]));
  const sortByAcodeScode = new Map(sorts.map((sort) => [`${sort.acode}:${sort.scode}`, sort]));
  const cnSortByTypeAndSlug = new Map<string, PbootSortRow>();

  for (const sort of sorts) {
    if (sort.acode !== 'cn') continue;
    const slug = normalizePbootSlug(sort.filename) || normalizePbootSlug(sort.name);
    if (slug) cnSortByTypeAndSlug.set(`${sort.mcode}:${slug}`, sort);
  }

  return (row: PbootContentRow) => {
    const directCnCode = `pboot:cn:${row.scode}`;
    if (row.acode === 'cn' && menuByCode.has(directCnCode)) return Number(menuByCode.get(directCnCode).id);

    const sort = sortByAcodeScode.get(`${row.acode}:${row.scode}`);
    const slug = sort ? normalizePbootSlug(sort.filename) || normalizePbootSlug(sort.name) : '';
    const cnSort = slug ? cnSortByTypeAndSlug.get(`${sort?.mcode || mcode}:${slug}`) : null;
    const cnCode = cnSort ? `pboot:cn:${cnSort.scode}` : '';
    if (cnCode && menuByCode.has(cnCode)) return Number(menuByCode.get(cnCode).id);

    const directCode = `pboot:${row.acode}:${row.scode}`;
    if (menuByCode.has(directCode)) return Number(menuByCode.get(directCode).id);

    return Number(menuByCode.get(fallbackCode)?.id || 0);
  };
};
