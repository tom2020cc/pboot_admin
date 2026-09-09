import { Menu } from '../menu/entities/menu.entity';

export const PBOOT_LANG_MAP: Record<string, string> = {
  cn: 'zh-CN',
  en: 'en',
  es: 'es',
  fr: 'fr',
  ru: 'ru',
  ar: 'ar',
  pt: 'pt',
  id: 'id',
  tr: 'tr',
  vi: 'vi',
};

const PBOOT_LANGS = Object.keys(PBOOT_LANG_MAP);
const PREFERRED_LANGS = ['cn', 'en', 'es', 'fr', 'ru', 'ar', 'pt', 'id', 'tr', 'vi'];

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
  ext_drill_depth?: string;
  ext_core_capacity?: string;
  ext_drill_diameter?: string;
  ext_pullback?: string;
  ext_pullback_unit?: string;
  ext_engine?: string;
  ext_parameter_values?: Record<string, string>;
  ext_custom_parameters?: { fieldName: string; name: string; value: string }[];
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

const quoteSqliteIdentifier = (value: string) => `"${String(value || '').replace(/"/g, '""')}"`;

const readPbootTableColumns = (db: any, tableName: string) => {
  const table = queryPbootRows<{ name: string }>(
    db,
    'select name from sqlite_master where type = ? and lower(name) = lower(?) limit 1',
    ['table', tableName],
  )[0];
  if (!table?.name) return [];
  return queryPbootRows<{ name: string }>(db, `pragma table_info(${quoteSqliteIdentifier(table.name)})`)
    .map((column) => String(column.name || '').trim())
    .filter(Boolean);
};

const buildOptionalContentExtSql = (db: any) => {
  const columns = readPbootTableColumns(db, 'ay_content_ext');
  const byLowerName = new Map(columns.map((column) => [column.toLowerCase(), column]));
  const contentIdColumn = byLowerName.get('contentid');
  if (!contentIdColumn) {
    return {
      projection: `'' as ext_bigpic, '' as ext_video`,
      join: '',
    };
  }

  const findColumns = (preferred: string[], fallback: (column: string) => boolean) => {
    const result: string[] = [];
    for (const name of preferred) {
      const actual = byLowerName.get(name.toLowerCase());
      if (actual && !result.includes(actual)) result.push(actual);
    }
    for (const column of columns) {
      if (fallback(column.toLowerCase()) && !result.includes(column)) result.push(column);
    }
    return result;
  };
  const bigPictureColumns = findColumns(
    ['ext_bigpic', 'ext_cp_bigpic', 'ext_rig_big_pic'],
    (column) => column.startsWith('ext_') && /big_?pic/.test(column),
  );
  const videoColumns = findColumns(
    ['ext_video', 'ext_rig_video'],
    (column) => column.startsWith('ext_') && column.includes('video') && !column.includes('isnot'),
  );
  const coalesce = (columnNames: string[], alias: string) => {
    if (!columnNames.length) return `'' as ${alias}`;
    const values = columnNames.map(
      (column) => `nullif(trim(cast(e.${quoteSqliteIdentifier(column)} as text)), '')`,
    );
    return `coalesce(${values.join(', ')}, '') as ${alias}`;
  };

  const parameterNames = ['ext_drill_depth', 'ext_core_capacity', 'ext_drill_diameter', 'ext_pullback', 'ext_pullback_unit', 'ext_engine'];
  const customFields = readPbootTableColumns(db, 'ay_extfield').includes('name')
    ? queryPbootRows<{ name: string }>(db, 'select name from ay_extfield where mcode=? and type=1', ['3'])
      .map((field) => field.name).filter((name) => /^ext_[a-zA-Z][a-zA-Z0-9_]{0,55}$/.test(name) && !parameterNames.includes(name) && name !== 'ext_video' && name !== 'ext_bigpic') : [];
  return {
    projection: [coalesce(bigPictureColumns, 'ext_bigpic'), coalesce(videoColumns, 'ext_video'),
      ...[...parameterNames, ...customFields].map((name) => coalesce(byLowerName.has(name.toLowerCase()) ? [byLowerName.get(name.toLowerCase())] : [], quoteSqliteIdentifier(name))),
    ].join(', '),
    join: `left join ay_content_ext e on e.${quoteSqliteIdentifier(contentIdColumn)} = c.id`,
  };
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
  const generatedMatch = raw.match(/^(vue-(?:news|product)-\d+)-(cn|en|es|fr|ru|ar|pt|id|tr|vi)$/i);
  if (generatedMatch) return generatedMatch[1].toLowerCase();
  return raw
    .replace(/^\/+/, '')
    .replace(new RegExp(`^(${PBOOT_LANGS.join('|')})[-_/]+`, 'i'), '')
    .toLowerCase();
};

export const readPbootContentGroups = (db: any, mcode: string, typeName: string) => {
  const contentExt = buildOptionalContentExtSql(db);
  const rows = queryPbootRows<PbootContentRow>(
    db,
    `select c.*, ${contentExt.projection}, s.mcode, s.filename as sort_filename, s.name as sort_name
     from ay_content c
     join ay_content_sort s on s.acode = c.acode and s.scode = c.scode
     ${contentExt.join}
     where s.mcode = ?
     order by c.id asc`,
    [mcode],
  );

  if (mcode === '3' && readPbootTableColumns(db, 'ay_extfield').includes('name')) {
    const fields = queryPbootRows<{ name: string; description: string }>(db, 'select name,description from ay_extfield where mcode=? and type=1', ['3'])
      .filter((field) => /^ext_[a-zA-Z][a-zA-Z0-9_]{0,55}$/.test(field.name));
    for (const row of rows) {
      const values = fields.map((field) => ({ fieldName: field.name, name: field.description, value: String((row as unknown as Record<string, unknown>)[field.name] || '') }));
      row.ext_custom_parameters = values.filter((field) => /^ext_param_[a-z0-9_]{1,48}$/.test(field.fieldName));
      row.ext_parameter_values = Object.fromEntries(values.map((field) => [field.fieldName, field.value]));
      const engine = values.find((field) => field.fieldName === 'ext_engine') || values.find((field) => /^(发动机|发动机参数|engine)$/i.test(field.name.trim()));
      if (engine) row.ext_engine = engine.value;
    }
  }

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
