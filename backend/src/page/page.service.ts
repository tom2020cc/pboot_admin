import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Menu } from '../menu/entities/menu.entity';
import { DEFAULT_NEWS_LANG, NEWS_LANGUAGES, resolveNewsLang } from '../news/news-languages';
import { TranslateNewsDto } from '../news/dto/translate-news.dto';
import { NewsService } from '../news/news.service';
import { normalizePbootImage, PBOOT_LANG_MAP, queryPbootRows, toPbootDate } from '../common/pboot-content-import';
import { SyncGuardService } from '../common/sync-guard.service';
import { buildLanguageSeoUrlName } from '../common/seo-content-utils';
import { PageTranslation } from './entities/page-translation.entity';
import { Page } from './entities/page.entity';
import { SavePageDto, SyncPageDto } from './dto/page.dto';

const initSqlJs = require('sql.js');

type PbootSingleRow = {
  id: number;
  acode: string;
  scode: string;
  title: string;
  subtitle: string;
  filename: string;
  date: string;
  ico: string;
  content: string;
  keywords: string;
  description: string;
  sorting: number;
  status: string;
  create_time: string;
  update_time: string;
  sort_name: string;
  sort_filename: string;
};

@Injectable()
export class PageService {
  constructor(
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(PageTranslation) private readonly translationRepo: Repository<PageTranslation>,
    @InjectRepository(Menu) private readonly menusRepo: Repository<Menu>,
    private readonly config: ConfigService,
    private readonly syncGuard: SyncGuardService,
    private readonly newsService: NewsService,
  ) {}

  findLanguages() {
    return NEWS_LANGUAGES;
  }

  findTranslationModels() {
    return this.newsService.findTranslationModels();
  }

  translateDraft(body: TranslateNewsDto) {
    return this.newsService.translateDraft({ ...body, contentType: 'page' });
  }

  async findAll(menuId?: number, lang?: string) {
    const targetLang = resolveNewsLang(lang);
    const pages = await this.pageRepo.find({ order: { orderNum: 'ASC', id: 'ASC' } });
    const filtered = menuId ? await this.filterByEquivalentMenu(pages, menuId) : pages;
    const translations = filtered.length
      ? await this.translationRepo.find({ where: filtered.map((page) => ({ pageId: page.id, lang: targetLang })) })
      : [];
    const map = new Map(translations.map((item) => [item.pageId, item]));
    return filtered.filter((page) => map.has(page.id)).map((page) => this.mergeTranslation(page, map.get(page.id), targetLang));
  }

  async findOneById(id: number, lang?: string) {
    const page = await this.findPageEntity(id);
    await this.ensureTranslations(page);
    const targetLang = resolveNewsLang(lang);
    const [translation, translations] = await Promise.all([
      this.translationRepo.findOneBy({ pageId: id, lang: targetLang }),
      this.translationRepo.find({ where: { pageId: id }, order: { id: 'ASC' } }),
    ]);
    return this.mergeTranslation(page, translation, targetLang, translations);
  }

  async create(body: SavePageDto) {
    const seed = this.getDefaultContent(body);
    const saved = await this.pageRepo.save(
      this.pageRepo.create({
        menuId: Number(body.menuId || 0),
        title: seed.title,
        urlName: seed.urlName,
        subtitle: seed.subtitle,
        keywords: seed.keywords,
        description: seed.description,
        content: seed.content,
        show: body.show ?? true,
        orderNum: Number(body.orderNum || 0),
      }),
    );
    await this.ensureTranslations(saved, body.translations, true);
    return await this.findOneById(saved.id);
  }

  async update(id: number, body: SavePageDto) {
    const page = await this.findPageEntity(id);
    const seed = this.getDefaultContent(body, page);
    const saved = await this.pageRepo.save({
      ...page,
      menuId: Number(body.menuId ?? page.menuId),
      title: seed.title,
      urlName: seed.urlName,
      subtitle: seed.subtitle,
      keywords: seed.keywords,
      description: seed.description,
      content: seed.content,
      show: body.show ?? page.show,
      orderNum: Number(body.orderNum ?? page.orderNum),
    });
    await this.ensureTranslations(saved, body.translations, true);
    return await this.findOneById(id);
  }

  async importFromPboot() {
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);

    const guard = await this.syncGuard.protectBeforeDangerousSync('page_import_from_pboot');
    const localBackupPath = guard.backupPath;
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    try {
      const rows = this.readPbootSingleRows(db);
      const menus = await this.menusRepo.find();
      const groups = this.groupPbootRows(rows);

      await this.translationRepo.createQueryBuilder().delete().from(PageTranslation).execute();
      await this.pageRepo.createQueryBuilder().delete().from(Page).execute();

      let imported = 0;
      let importedTranslations = 0;

      for (const group of groups) {
        const base = this.chooseBaseRow(group.rows);
        const menu = this.findCnMenuForGroup(menus, group.slug, base);
        if (!menu) continue;

        const saved = await this.pageRepo.save(
          this.pageRepo.create({
            menuId: Number(menu.id),
            title: base.title || base.sort_name || '',
            urlName: base.filename || '',
            subtitle: base.subtitle || '',
            keywords: base.keywords || '',
            description: base.description || '',
            content: base.content || '',
            show: String(base.status) !== '0',
            orderNum: Number(base.sorting || 0),
            createTime: toPbootDate(base.date || base.create_time),
            updateTime: toPbootDate(base.update_time || base.date || base.create_time),
          }),
        );
        imported += 1;

        const translations = group.rows
          .map((row) => {
            const lang = PBOOT_LANG_MAP[String(row.acode || '').trim()];
            if (!lang) return null;
            return this.translationRepo.create({
              pageId: saved.id,
              lang,
              title: row.title || row.sort_name || '',
              urlName: row.filename || '',
              subtitle: row.subtitle || '',
              keywords: row.keywords || '',
              description: row.description || '',
              content: row.content || '',
              createTime: toPbootDate(row.date || row.create_time),
              updateTime: toPbootDate(row.update_time || row.date || row.create_time),
            });
          })
          .filter(Boolean) as PageTranslation[];

        if (translations.length) {
          await this.translationRepo.save(translations);
          importedTranslations += translations.length;
        }
      }

      return { msg: 'PbootCMS single pages import completed', localBackupPath, sourceRows: rows.length, imported, importedTranslations };
    } finally {
      db.close();
    }
  }

  async syncToPboot(id: number, options: SyncPageDto = {}) {
    const page = await this.findPageEntity(id);
    await this.ensureTranslations(page);
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);

    const langs = options.all ? NEWS_LANGUAGES.map((item) => item.code) : [resolveNewsLang(options.lang || DEFAULT_NEWS_LANG)];
    const translations = await this.translationRepo.find({ where: { pageId: id }, order: { id: 'ASC' } });
    const translationMap = new Map(translations.map((item) => [item.lang, item]));
    for (const lang of langs) this.assertTranslationSeoReady(translationMap.get(lang), lang);

    await this.syncGuard.protectBeforeDangerousSync('page_push_one', 'page');
    const backupPath = this.backupPbootDatabase(dbPath);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const synced = [];

    try {
      for (const lang of langs) {
        const translation = translationMap.get(lang);
        const targetMenu = await this.findEquivalentMenu(page.menuId, lang);
        if (!targetMenu) throw new BadRequestException(`单页 ${lang} 缺少对应语言栏目，无法同步`);
        synced.push(this.upsertPbootSinglePage(db, page, translation, targetMenu));
      }

      if (!synced.length) throw new BadRequestException('没有找到可同步的单页语言内容或对应栏目');
      fs.writeFileSync(dbPath, Buffer.from(db.export()));
      return { msg: 'PbootCMS single page sync completed', backupPath, synced };
    } finally {
      db.close();
    }
  }

  async syncAllToPboot() {
    await this.syncGuard.protectBeforeDangerousSync('page_push_all', 'page');
    const pages = await this.pageRepo.find({ order: { orderNum: 'ASC', id: 'ASC' } });
    const synced = [];
    let backupPath = '';

    for (const page of pages) {
      const result = await this.syncToPboot(page.id, { all: true });
      backupPath = result.backupPath;
      synced.push(...result.synced);
    }

    return { msg: 'PbootCMS all single pages sync completed', backupPath, totalPages: pages.length, syncedCount: synced.length, synced };
  }

  async remove(id: number) {
    const page = await this.findPageEntity(id);
    await this.translationRepo.delete({ pageId: id });
    const res = await this.pageRepo.remove(page);
    return { msg: '删除成功', res };
  }

  private async ensureTranslations(page: Page, incoming: any[] = [], updateExisting = false) {
    const existing = await this.translationRepo.find({ where: { pageId: page.id } });
    const existingMap = new Map(existing.map((item) => [item.lang, item]));
    const inputMap = new Map(incoming.map((item) => [item.lang, item]));
    const seed = this.getDefaultContent({
      translations: incoming,
      title: page.title,
      urlName: page.urlName,
      subtitle: page.subtitle,
      keywords: page.keywords,
      description: page.description,
      content: page.content,
    });

    const rows = NEWS_LANGUAGES.map(({ code }) => {
      const input = inputMap.get(code);
      const current = existingMap.get(code);
      if (current) {
        const next = {
          ...current,
          title: input?.title ?? current.title,
          urlName: input?.urlName ?? current.urlName,
          subtitle: input?.subtitle ?? current.subtitle,
          keywords: input?.keywords ?? current.keywords,
          description: input?.description ?? current.description,
          content: this.compactHtmlForStorage(input?.content ?? current.content),
        };
        next.urlName = String(next.urlName || '').trim() || buildLanguageSeoUrlName(code, seed.urlName, next.title);
        next.keywords = String(next.keywords || '').trim() || String(next.title || '').trim();
        const unchanged = next.urlName === current.urlName && next.keywords === current.keywords;
        if (!updateExisting && !input && unchanged) return null;
        return next;
      }
      const title = input?.title ?? seed.title;
      return this.translationRepo.create({
        pageId: page.id,
        lang: code,
        title,
        urlName: String(input?.urlName || '').trim() || buildLanguageSeoUrlName(code, seed.urlName, title),
        subtitle: input?.subtitle ?? seed.subtitle,
        keywords: String(input?.keywords || seed.keywords || '').trim() || String(title || '').trim(),
        description: input?.description ?? seed.description,
        content: this.compactHtmlForStorage(input?.content ?? seed.content),
      });
    }).filter(Boolean) as PageTranslation[];

    if (rows.length) await this.translationRepo.save(rows);
  }

  private assertTranslationSeoReady(translation: PageTranslation | undefined, lang: string): asserts translation is PageTranslation {
    const labels: Record<string, string> = {
      title: '标题',
      urlName: 'URL 名称',
      keywords: '关键词',
      description: '描述',
      content: '正文',
    };
    const missing = (Object.keys(labels) as Array<keyof typeof labels>).filter(
      (field) => !String(translation?.[field] || '').trim(),
    );
    if (missing.length) {
      const languageName = NEWS_LANGUAGES.find((item) => item.code === lang)?.name || lang;
      throw new BadRequestException(`${languageName} 的单页 SEO 信息不完整：缺少${missing.map((field) => labels[field]).join('、')}`);
    }
  }

  private mergeTranslation(page: Page, translation?: PageTranslation, lang = DEFAULT_NEWS_LANG, translations?: PageTranslation[]) {
    return {
      ...page,
      lang,
      title: translation?.title || page.title,
      urlName: translation?.urlName ?? page.urlName,
      subtitle: translation?.subtitle ?? page.subtitle,
      keywords: translation?.keywords ?? page.keywords,
      description: translation?.description ?? page.description,
      content: this.decodeHtmlEntities(translation?.content ?? page.content),
      translations: translations?.map((item) => ({ ...item, content: this.decodeHtmlEntities(item.content) })),
    };
  }

  private upsertPbootSinglePage(db: any, page: Page, translation: PageTranslation, menu: Menu) {
    const pbootKey = this.parsePbootMenuCode(menu.code);
    if (!pbootKey) throw new BadRequestException(`栏目 ${menu.name} 不是 PbootCMS 同步栏目`);
    const now = this.formatPbootDate(new Date());
    const filename = String(translation.urlName || menu.urlName || '').trim();
    const values = {
      acode: pbootKey.acode,
      scode: pbootKey.scode,
      title: translation.title || menu.name || '',
      subtitle: translation.subtitle || '',
      filename,
      date: now,
      ico: this.normalizeIconValue(menu.icon),
      content: this.compactHtmlForStorage(translation.content || ''),
      keywords: translation.keywords || '',
      description: translation.description || '',
      sorting: Number(page.orderNum || menu.orderNum || 0),
      status: page.show ? '1' : '0',
      update_user: 'admin',
      update_time: now,
    };
    const existing = this.queryOne<{ id: number }>(db, 'select id from ay_content where acode=? and scode=? limit 1', [pbootKey.acode, pbootKey.scode]);
    const fields = Object.keys(values);

    if (existing?.id) {
      this.runSql(db, `update ay_content set ${fields.map((field) => `${field}=?`).join(',')} where id=?`, [
        ...fields.map((field) => values[field]),
        existing.id,
      ]);
      return { lang: translation.lang, acode: pbootKey.acode, scode: pbootKey.scode, pbootId: Number(existing.id), title: values.title, action: 'updated' };
    }

    this.runSql(db, `insert into ay_content (${fields.join(',')}) values (${fields.map(() => '?').join(',')})`, fields.map((field) => values[field]));
    const inserted = this.queryOne<{ id: number }>(db, 'select id from ay_content where acode=? and scode=? order by id desc limit 1', [
      pbootKey.acode,
      pbootKey.scode,
    ]);
    return { lang: translation.lang, acode: pbootKey.acode, scode: pbootKey.scode, pbootId: Number(inserted?.id || 0), title: values.title, action: 'created' };
  }

  private readPbootSingleRows(db: any) {
    return queryPbootRows<PbootSingleRow>(
      db,
      `select c.*, s.name as sort_name, s.filename as sort_filename
       from ay_content c
       join ay_content_sort s on s.acode = c.acode and s.scode = c.scode
       where s.mcode = '1'
       order by c.acode, cast(c.scode as integer), c.id`,
    );
  }

  private groupPbootRows(rows: PbootSingleRow[]) {
    const groups = new Map<string, { slug: string; rows: PbootSingleRow[] }>();
    for (const row of rows) {
      const slug = this.normalizeMenuSlug(row.sort_filename || row.sort_name || row.title || row.scode);
      if (!groups.has(slug)) groups.set(slug, { slug, rows: [] });
      groups.get(slug).rows.push(row);
    }
    return [...groups.values()];
  }

  private chooseBaseRow(rows: PbootSingleRow[]) {
    return rows.find((row) => row.acode === 'cn') || rows.find((row) => row.acode === 'en') || rows[0];
  }

  private findCnMenuForGroup(menus: Menu[], slug: string, base: PbootSingleRow) {
    return (
      menus.find((menu) => String(menu.code || '') === `pboot:cn:${base.scode}`) ||
      menus.find((menu) => String(menu.model || '') === '1' && this.getMenuLang(menu) === 'cn' && this.normalizeMenuSlug(menu.urlName || menu.href || menu.name) === slug)
    );
  }

  private async findEquivalentMenu(menuId: number, lang: string) {
    const menus = await this.menusRepo.find();
    const source = menus.find((item) => Number(item.id) === Number(menuId));
    if (!source) return null;
    const targetLang = lang === DEFAULT_NEWS_LANG ? 'cn' : lang;
    const slug = this.normalizeMenuSlug(source.urlName || source.href || source.name);
    return (
      menus.find((item) => Number(item.id) === Number(menuId) && this.getMenuLang(item) === targetLang) ||
      menus.find((item) => String(item.model || '') === '1' && this.getMenuLang(item) === targetLang && this.normalizeMenuSlug(item.urlName || item.href || item.name) === slug)
    );
  }

  private async filterByEquivalentMenu(pages: Page[], menuId: number) {
    const menus = await this.menusRepo.find();
    const selected = menus.find((item) => Number(item.id) === Number(menuId));
    if (!selected) return pages;
    const slug = this.normalizeMenuSlug(selected.urlName || selected.href || selected.name);
    return pages.filter((page) => {
      const menu = menus.find((item) => Number(item.id) === Number(page.menuId));
      return menu && this.normalizeMenuSlug(menu.urlName || menu.href || menu.name) === slug;
    });
  }

  private getDefaultContent(body: Partial<SavePageDto>, fallback?: Page) {
    const defaultTranslation = body.translations?.find((item) => item.lang === DEFAULT_NEWS_LANG);
    return {
      title: defaultTranslation?.title ?? body.title ?? fallback?.title ?? '',
      urlName: defaultTranslation?.urlName ?? body.urlName ?? fallback?.urlName ?? '',
      subtitle: defaultTranslation?.subtitle ?? body.subtitle ?? fallback?.subtitle ?? '',
      keywords: defaultTranslation?.keywords ?? body.keywords ?? fallback?.keywords ?? '',
      description: defaultTranslation?.description ?? body.description ?? fallback?.description ?? '',
      content: this.compactHtmlForStorage(defaultTranslation?.content ?? body.content ?? fallback?.content ?? ''),
    };
  }

  private async findPageEntity(id: number) {
    const page = await this.pageRepo.findOneBy({ id });
    if (!page) throw new NotFoundException('没有找到该单页内容');
    return page;
  }

  private normalizeMenuSlug(value: string) {
    return String(value || '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/^(cn|es|fr|ru|ar|pt)-/i, '')
      .replace(/^en[-_/]+/i, '')
      .toLowerCase();
  }

  private getMenuLang(menu: Pick<Menu, 'code'>) {
    return String(menu.code || '').match(/^pboot:([^:]+):/)?.[1] || '';
  }

  private parsePbootMenuCode(code: string) {
    const match = String(code || '').match(/^pboot:([^:]+):(.+)$/);
    return match ? { acode: match[1], scode: match[2] } : null;
  }

  private normalizeIconValue(value: string[] | string) {
    const rows = Array.isArray(value) ? value : String(value || '').split(',');
    return rows.map((item) => normalizePbootImage(item)).filter(Boolean).join(',');
  }

  private getPbootDbPath() {
    const configured = this.config.get<string>('PBOOT_DB_PATH');
    if (!configured) {
      throw new BadRequestException('PbootCMS database is not configured. Run 01-config.cmd first.');
    }
    return configured;
  }

  private backupPbootDatabase(dbPath: string) {
    const ext = path.extname(dbPath);
    const base = dbPath.slice(0, -ext.length);
    const backupPath = `${base}.before_page_sync_${this.formatCompactDate(new Date())}${ext}`;
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
  }

  private backupLocalDatabase(reason: string) {
    const configured = this.config.get<string>('DB_SQLJS_LOCATION', 'dev.sqlite');
    const dbPath = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured || 'dev.sqlite');
    if (!fs.existsSync(dbPath)) return '';
    const parsed = path.parse(dbPath);
    const backupPath = path.join(parsed.dir, `${parsed.name}.before_${reason}_${this.formatCompactDate(new Date())}${parsed.ext}`);
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
  }

  private compactHtmlForStorage(content: string) {
    return this.decodeHtmlEntities(content || '').trim().replace(/\r\n?/g, '\n').replace(/>\s+</g, '><').replace(/\n+/g, ' ').replace(/[ \t]{2,}/g, ' ');
  }

  private decodeHtmlEntities(content: string) {
    return (content || '').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&apos;/gi, "'").replace(/&amp;/gi, '&');
  }

  private formatPbootDate(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private formatCompactDate(date: Date) {
    return this.formatPbootDate(date).replace(/[-: ]/g, '');
  }

  private queryOne<T>(db: any, sql: string, params: any[] = []) {
    return queryPbootRows<T>(db, sql, params)[0] || null;
  }

  private runSql(db: any, sql: string, params: any[] = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.run(params);
    } finally {
      stmt.free();
    }
  }
}
