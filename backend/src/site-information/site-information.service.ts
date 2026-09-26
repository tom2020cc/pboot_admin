import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import initSqlJs from 'sql.js';
import { SitesService } from '../sites/sites.service';
import { SiteRequestContextService } from '../sites/site-request-context.service';
import { replaceBatchDatabase } from '../product/product-batch-file';
import { copyUploadedImageToPboot } from '../common/pboot-uploaded-images';
import { SiteInformationDraft } from './site-information.entity';
import { INFORMATION_FIELDS, InformationData, normalizeInformation, translationFields } from './site-information.fields';
import { InformationRevisionDto, RemoteInformationDto, SaveInformationDto, SetupInformationDto, SyncInformationDto, TranslateInformationDto } from './site-information.dto';
import { informationOnlineTarget, prepareInformationOnline, InformationAsset } from './site-information-online';
import { SiteInformationTranslator } from './site-information-translator.service';
import { assertDomainAvailable, primaryDomain, replacePrimaryDomain } from '../common/pboot-domain-link';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const inside = (root: string, target: string) => target.startsWith(root + path.sep);
const languageNames = { cn: '中文', en: 'English', es: 'Español', fr: 'Français', ar: 'العربية', pt: 'Português', ru: 'Русский', id: 'Bahasa Indonesia', tr: 'Türkçe', vi: 'Tiếng Việt' };

@Injectable()
export class SiteInformationService {
  private readonly busy = new Set<number>();
  constructor(
    @InjectRepository(SiteInformationDraft) private readonly drafts: Repository<SiteInformationDraft>,
    private readonly sites: SitesService,
    private readonly requestContext: SiteRequestContextService,
    private readonly translator: SiteInformationTranslator,
  ) {}

  private site() {
    const site = this.sites.getCurrentSite();
    const requested = this.requestContext.getSiteId();
    if (!site.id || !site.enabled || (requested && requested !== site.id)) throw new BadRequestException('请选择有效的当前网站');
    if (!path.isAbsolute(site.rootPath) || !fs.existsSync(site.rootPath) || fs.lstatSync(site.rootPath).isSymbolicLink()) throw new BadRequestException('网站目录无效');
    return { ...site, rootPath: path.resolve(site.rootPath) };
  }

  private async locked<T>(work: () => Promise<T>) {
    const id = this.site().id;
    if (this.busy.has(id)) throw new ConflictException('当前网站的资料正在保存或翻译，请稍后重试');
    this.busy.add(id);
    try { return await work(); } finally { this.busy.delete(id); }
  }

  private safePath(root: string, relative: string) {
    const target = path.resolve(root, relative);
    if (!inside(root, target)) throw new BadRequestException('操作路径不属于当前网站');
    let cursor = root;
    for (const part of path.relative(root, target).split(path.sep)) {
      cursor = path.join(cursor, part);
      if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new BadRequestException('网站路径含符号链接，已停止操作');
    }
    return target;
  }

  private async open() {
    const site = this.site();
    const dataRoot = this.safePath(site.rootPath, 'data');
    if (!path.isAbsolute(site.dbPath) || !inside(dataRoot, path.resolve(site.dbPath))) throw new BadRequestException('数据库必须位于当前网站 data 目录');
    this.safePath(site.rootPath, path.relative(site.rootPath, site.dbPath));
    if (!fs.existsSync(site.dbPath) || !fs.statSync(site.dbPath).isFile() || fs.statSync(site.dbPath).size > 256 * 1024 * 1024) throw new BadRequestException('PB 数据库不存在或过大');
    if (!inside(fs.realpathSync(dataRoot), fs.realpathSync(site.dbPath))) throw new BadRequestException('数据库实际路径不属于当前网站');
    this.assertNoJournal(site.dbPath);
    const SQL = await initSqlJs();
    const original = fs.readFileSync(site.dbPath);
    const db = new SQL.Database(new Uint8Array(original));
    try {
      const languages = this.rows(db, "select acode,name from ay_area where coalesce(pcode,'0')='0' order by id")
        .map(row => ({ code: String(row.acode), name: languageNames[String(row.acode)] || String(row.name) }));
      if (!languages.length || new Set(languages.map(item => item.code)).size !== languages.length) throw new BadRequestException('PB 语言区域配置无效');
      const stored = await this.drafts.findBy({ siteId: site.id });
      const templateDir = this.safePath(site.rootPath, 'template');
      const themes = fs.existsSync(templateDir) ? fs.readdirSync(templateDir, { withFileTypes: true })
        .filter(item => item.isDirectory() && !item.isSymbolicLink()).map(item => item.name) : [];
      return { site, original, db, languages, stored, themes };
    } catch (error) { db.close(); throw error; }
  }

  private assertNoJournal(file: string) {
    for (const suffix of ['-wal', '-journal']) if (fs.existsSync(file + suffix) && fs.statSync(file + suffix).size) throw new ConflictException('PB 数据库正在写入，请稍后重试');
  }

  private rows(db: any, sql: string, params: any[] = []): Record<string, any>[] {
    const statement = db.prepare(sql);
    try {
      statement.bind(params);
      const result: Record<string, any>[] = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally { statement.free(); }
  }

  private profile(context: Awaited<ReturnType<SiteInformationService['open']>>, language: string) {
    if (!context.languages.some(item => item.code === language)) throw new BadRequestException('该语言不属于当前网站');
    const siteRows = this.rows(context.db, 'select * from ay_site where acode=?', [language]);
    const companyRows = this.rows(context.db, 'select * from ay_company where acode=?', [language]);
    if (siteRows.length > 1 || companyRows.length > 1) throw new ConflictException('PB 同一语言存在重复的站点或公司资料，请先检查');
    const pb: InformationData = { site: {}, company: {} };
    for (const field of INFORMATION_FIELDS) pb[field.section][field.key] = String((field.section === 'site' ? siteRows : companyRows)[0]?.[field.key] ?? '');
    const binding = String(this.rows(context.db, 'select domain from ay_area where acode=?', [language])[0]?.domain || '');
    if (!siteRows.length) pb.site.domain = primaryDomain(binding);
    const baseRevision = hash([siteRows, companyRows]);
    const draft = context.stored.find(item => item.language === language);
    const data = draft ? clone(draft.data) : clone(pb);
    if (!draft && !siteRows.length && context.themes.includes(language)) data.site.theme = language;
    return { language, data, pb, baseRevision, draft, revision: `${draft?.revision || `pb:${baseRevision}`}:${hash(binding)}`,
      exists: { site: !!siteRows.length, company: !!companyRows.length } };
  }

  private response(context: Awaited<ReturnType<SiteInformationService['open']>>) {
    const source = context.languages.some(item => item.code === 'cn') ? this.profile(context, 'cn') : undefined;
    const canSyncOnline = process.env.APP_ENVIRONMENT === 'local' && context.site.environment === 'phpstudy';
    let onlineTarget = '', onlineTargetRevision = '';
    if (canSyncOnline) {
      try { const target = informationOnlineTarget(this.sites); onlineTarget = target.url; onlineTargetRevision = target.revision; } catch { /* Configuration is optional until remote sync is requested. */ }
    }
    return { siteId: context.site.id, siteName: context.site.name, publicBaseUrl: context.site.publicBaseUrl,
      environment: context.site.environment, canSyncOnline, onlineTarget, onlineTargetRevision,
      fields: INFORMATION_FIELDS, themes: context.themes,
      languages: [...context.languages].sort((a, b) => a.code === 'cn' ? -1 : b.code === 'cn' ? 1 : 0),
      profiles: context.languages.map(language => {
        const item = this.profile(context, language.code);
        return { language: item.language, data: item.data, revision: item.revision, exists: item.exists,
          hasDraft: !!item.draft, pending: !!item.draft && (hash(item.data) !== hash(item.pb) || !item.exists.site || !item.exists.company),
          pbChanged: !!item.draft && item.draft.baseRevision !== item.baseRevision,
          sourceChanged: !!(item.draft?.sourceHash && source && item.draft.sourceHash !== hash(translationFields(source.data))),
          translatedModel: item.draft?.translatedModel || '', translatedAt: item.draft?.translatedAt || '' };
      }) };
  }

  async read() { const context = await this.open(); try { return this.response(context); } finally { context.db.close(); } }
  models() { return this.translator.models(); }

  private usableTheme(context: Awaited<ReturnType<SiteInformationService['open']>>, theme: string) {
    if (!theme || !/^[\p{L}\p{N}_-]+$/u.test(theme) || !context.themes.includes(theme)) return false;
    const index = this.safePath(context.site.rootPath, `template/${theme}/html/index.html`);
    return fs.existsSync(index) && fs.statSync(index).isFile();
  }

  private setupPlan(context: Awaited<ReturnType<SiteInformationService['open']>>) {
    const source = this.profile(context, 'cn');
    const sourcePending = !!source.draft && hash(source.data) !== hash(source.pb);
    const bindings = this.rows(context.db, 'select acode,domain from ay_area');
    const profiles = context.languages.map(language => this.profile(context, language.code));
    const items = profiles.map(current => {
      const data = clone(current.pb);
      const problems: string[] = [];
      const changes: { field: string; label: string; before: string; after: string }[] = [];
      if (!source.exists.site || !source.pb.site.title.trim()) problems.push('CN 站点标题尚未配置');
      if (sourcePending) problems.push('CN 有待同步草稿，请先同步或重新读取');
      if (current.draft && (hash(current.data) !== hash(current.pb) || current.draft.baseRevision !== current.baseRevision)) problems.push('该语言有待处理草稿或 PB 冲突');
      const set = (section: 'site' | 'company', key: string, value: string) => {
        if (data[section][key] === value) return;
        const field = INFORMATION_FIELDS.find(item => item.section === section && item.key === key)!;
        changes.push({ field: `${section}.${key}`, label: field.label, before: data[section][key], after: value });
        data[section][key] = value;
      };
      if (current.language !== 'cn') for (const field of INFORMATION_FIELDS) {
        if (field.section === 'site' && ['domain', 'theme', 'statistical'].includes(field.key)) continue;
        if (!data[field.section][field.key].trim() && source.pb[field.section][field.key].trim()) set(field.section, field.key, source.pb[field.section][field.key]);
      }
      if (!this.usableTheme(context, data.site.theme)) {
        if (this.usableTheme(context, current.language)) set('site', 'theme', current.language);
        else problems.push(`缺少 template/${current.language}/html/index.html，需先上传模板`);
      }
      const binding = String(bindings.find(row => row.acode === current.language)?.domain || '').trim();
      if (!data.site.domain.trim() && binding) {
        // PB area domains are host names; do not infer production subdomains from a local URL.
        try { set('site', 'domain', primaryDomain(binding)); }
        catch { problems.push('数据区域域名格式需人工核对'); }
      }
      return { language: current.language, name: context.languages.find(item => item.code === current.language)!.name,
        theme: data.site.theme, domain: data.site.domain, boundDomain: binding, changes, problems,
        createSite: !current.exists.site, createCompany: !current.exists.company,
        needsChange: changes.length > 0 || !current.exists.site || !current.exists.company, data };
    });
    const token = hash({ site: context.site.id, root: context.site.rootPath, db: context.site.dbPath,
      profiles: profiles.map(item => [item.language, item.baseRevision, item.revision]), items });
    return { token, siteId: context.site.id, siteName: context.site.name, items };
  }

  async previewSetup() {
    const context = await this.open();
    try { const plan = this.setupPlan(context); return { ...plan, items: plan.items.map(({ data, ...item }) => item) }; }
    finally { context.db.close(); }
  }

  async setup(dto: SetupInformationDto) {
    return this.locked(async () => {
      const context = await this.open();
      try {
        const plan = this.setupPlan(context);
        if (dto.token !== plan.token) throw new ConflictException('配置预览已变化，请重新检查后确认');
        if (!dto.languages?.length || new Set(dto.languages).size !== dto.languages.length) throw new BadRequestException('请选择不重复的配置语言');
        const selected = dto.languages.map(language => {
          const item = plan.items.find(row => row.language === language);
          if (!item) throw new BadRequestException('该语言不属于当前网站');
          if (item.problems.length) throw new BadRequestException(`${language}: ${item.problems.join('；')}`);
          return { ...this.profile(context, language), data: normalizeInformation(item.data) };
        });
        if (!plan.items.some(item => dto.languages.includes(item.language) && item.needsChange)) return this.response(context);
        return await this.publish(context, selected);
      } finally { context.db.close(); }
    });
  }

  private checkRevision(profile: { revision: string }, revision: string) {
    if (profile.revision !== revision) throw new ConflictException('资料已被其它窗口修改，请刷新后重试。当前编辑内容未被覆盖');
  }

  async save(dto: SaveInformationDto) {
    return this.locked(async () => {
      const context = await this.open();
      try {
        const current = this.profile(context, dto.language);
        this.checkRevision(current, dto.revision);
        const data = normalizeInformation(dto.data);
        if (data.site.theme !== current.data.site.theme && data.site.theme && !context.themes.includes(data.site.theme)) throw new BadRequestException('模板目录不存在');
        const draft = this.drafts.create({ ...current.draft, siteId: context.site.id, language: dto.language, data,
          revision: randomUUID(), baseRevision: current.draft?.baseRevision || current.baseRevision });
        const saved = await this.drafts.save(draft);
        context.stored = [...context.stored.filter(item => item.language !== dto.language), saved];
        return this.response(context);
      } finally { context.db.close(); }
    });
  }

  async import(dto: InformationRevisionDto) {
    return this.locked(async () => {
      const context = await this.open();
      try {
        this.checkRevision(this.profile(context, dto.language), dto.revision);
        await this.drafts.delete({ siteId: context.site.id, language: dto.language });
        context.stored = context.stored.filter(item => item.language !== dto.language);
        return this.response(context);
      } finally { context.db.close(); }
    });
  }

  async translate(dto: TranslateInformationDto) {
    return this.locked(async () => {
      if (dto.language === 'cn') throw new BadRequestException('CN 是基础资料，不作为翻译目标');
      const context = await this.open();
      let source: ReturnType<SiteInformationService['profile']>;
      let target: ReturnType<SiteInformationService['profile']>;
      try {
        source = this.profile(context, 'cn'); target = this.profile(context, dto.language);
        this.checkRevision(source, dto.sourceRevision); this.checkRevision(target, dto.revision);
      } finally { context.db.close(); }
      const result = await this.translator.translate(translationFields(source.data), dto.language, dto.model);
      const latest = await this.open();
      try {
        if (latest.site.dbPath !== context.site.dbPath || latest.site.id !== context.site.id) throw new ConflictException('网站配置已变化，请刷新');
        const current = this.profile(latest, dto.language);
        this.checkRevision(current, dto.revision); this.checkRevision(this.profile(latest, 'cn'), dto.sourceRevision);
        const data = clone(current.data);
        // Apply only the fixed translatable keys. Domain, template and contact numbers remain untouched.
        for (const [key, value] of Object.entries(result.fields)) {
          const field = INFORMATION_FIELDS.find(item => `${item.section}.${item.key}` === key && 'translate' in item && item.translate);
          if (field) data[field.section][field.key] = value;
        }
        const saved = await this.drafts.save(this.drafts.create({ ...current.draft, siteId: latest.site.id, language: dto.language,
          data: normalizeInformation(data), revision: randomUUID(), baseRevision: current.draft?.baseRevision || current.baseRevision,
          sourceHash: hash(translationFields(source.data)), translatedAt: new Date().toISOString(), translatedModel: result.model }));
        latest.stored = [...latest.stored.filter(item => item.language !== dto.language), saved];
        return { ...this.response(latest), usedModel: result.model, fallbackUsed: result.fallbackUsed };
      } finally { latest.db.close(); }
    });
  }

  async sync(dto: SyncInformationDto) {
    return this.locked(async () => {
      if (!dto.items?.length || new Set(dto.items.map(item => item.language)).size !== dto.items.length) throw new BadRequestException('请选择不重复的同步语言');
      const context = await this.open();
      try {
        const selected = dto.items.map(item => {
          const current = this.profile(context, item.language);
          this.checkRevision(current, item.revision);
          if (!current.draft) throw new BadRequestException('请先保存需要同步的语言资料');
          if (current.draft.baseRevision !== current.baseRevision && hash(current.data) !== hash(current.pb)) throw new ConflictException(`${item.language} 的 PB 资料已被修改，请先从 PB 重新读取后再编辑`);
          if (!current.data.site.theme || !context.themes.includes(current.data.site.theme)) throw new BadRequestException(`${item.language} 的站点模板不存在，请先选择有效模板`);
          normalizeInformation(current.data);
          return current;
        });
        return await this.publish(context, selected);
      } finally { context.db.close(); }
    });
  }

  protected async sendOnline(config: any, payload: any, assets: InformationAsset[]) {
    const { syncSiteInformation } = require(path.resolve(__dirname, '../../../tools/ftp_publish_tool/license-sync.js'));
    return syncSiteInformation(config, payload, assets);
  }

  async syncOnline(dto: RemoteInformationDto) {
    if (process.env.APP_ENVIRONMENT !== 'local' || this.site().environment !== 'phpstudy') throw new BadRequestException('线上环境无需远程同步，请使用同步到 PB');
    if (this.site().id !== dto.siteId || this.requestContext.getSiteId() !== dto.siteId) throw new BadRequestException('当前网站已变化，请刷新后重试');
    return this.locked(async () => {
      const context = await this.open();
      try {
        if (!dto.items?.length || new Set(dto.items.map(item => item.language)).size !== dto.items.length) throw new BadRequestException('请选择不重复的同步语言');
        const target = informationOnlineTarget(this.sites);
        if (target.revision !== dto.targetRevision) throw new ConflictException('线上连接已变化，请重新加载后核对目标');
        const selected = dto.items.map(item => {
          const current = this.profile(context, item.language);
          this.checkRevision(current, item.revision);
          if (!current.draft) throw new BadRequestException('请先保存需要同步的语言资料');
          if (current.draft.baseRevision !== current.baseRevision && hash(current.data) !== hash(current.pb)) throw new ConflictException(`${item.language} 的本地 PB 资料已变化，请先核对`);
          return { language: item.language, data: normalizeInformation(current.data) };
        });
        const prepared = prepareInformationOnline(this.sites, selected, target.domains);
        const result = await this.sendOnline(target.config, { domains: target.domains, items: prepared.items,
          assets: prepared.assets.map(({ path, hash }) => ({ path, hash })) }, prepared.assets);
        return { siteId: context.site.id, target: target.url, languages: selected.map(item => item.language),
          imageCount: prepared.assets.length, verifiedAt: new Date().toISOString(), warnings: result.warnings || [] };
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
        throw new BadRequestException(`线上同步未确认完成，可重试相同资料：${error instanceof Error ? error.message : '连接失败'}`);
      } finally { context.db.close(); }
    });
  }

  private async publish(context: Awaited<ReturnType<SiteInformationService['open']>>, selected: ReturnType<SiteInformationService['profile']>[]) {
        const cacheDirs = ['runtime/config', 'runtime/cache', 'runtime/complile'].map(relative => this.safePath(context.site.rootPath, relative));
        this.safePath(context.site.rootPath, `static/codex/site-information/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
        context.db.run('BEGIN TRANSACTION');
        for (const item of selected) {
          const area = this.rows(context.db, 'select domain from ay_area where acode=?', [item.language])[0];
          const binding = replacePrimaryDomain(String(area?.domain || ''), item.data.site.domain);
          assertDomainAvailable(context.db, item.language, binding);
          context.db.run('UPDATE ay_area SET domain=? WHERE acode=?', [binding, item.language]);
          for (const [section, key] of [['site', 'logo'], ['company', 'weixin']] as const) {
            item.data[section][key] = copyUploadedImageToPboot(item.data[section][key], this.sites,
              context.site.rootPath, new Date().toISOString(), 'site-information');
          }
          for (const section of ['site', 'company'] as const) {
            const table = section === 'site' ? 'ay_site' : 'ay_company';
            const keys = INFORMATION_FIELDS.filter(field => field.section === section).map(field => field.key);
            const values = keys.map(key => item.data[section][key]);
            if (item.exists[section]) context.db.run(`UPDATE ${table} SET ${keys.map(key => `${key}=?`).join(',')} WHERE acode=?`, [...values, item.language]);
            else context.db.run(`INSERT INTO ${table} (acode,${keys.join(',')}) VALUES (${['?', ...keys.map(() => '?')].join(',')})`, [item.language, ...values]);
          }
        }
        context.db.run('COMMIT');
        this.assertNoJournal(context.site.dbPath);
        try { replaceBatchDatabase(context.site.dbPath, context.original, Buffer.from(context.db.export())); }
        catch { throw new ConflictException('PB 数据或文件权限在同步时发生变化，未覆盖数据库。请刷新后重试'); }
        const warnings: string[] = [];
        // Only generated PB caches are removed, never content, templates or uploaded media.
        for (const dir of cacheDirs) {
          try { this.clearCache(context.site.rootPath, dir); }
          catch { warnings.push('资料已写入 PB，部分缓存未能清理，请在 PB 后台清理缓存'); }
        }
        for (const item of selected) {
          const revision = this.profile(context, item.language).baseRevision;
          const saved = await this.drafts.save(this.drafts.create({ ...item.draft, siteId: context.site.id, language: item.language,
            data: item.data, revision: randomUUID(), baseRevision: revision }));
          context.stored = [...context.stored.filter(row => row.language !== item.language), saved];
        }
        return { ...this.response(context), warnings: [...new Set(warnings)] };
  }

  private clearCache(root: string, dir: string) {
    this.safePath(root, path.relative(root, dir));
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = this.safePath(root, path.relative(root, path.join(dir, entry.name)));
      if (entry.isDirectory()) this.clearCache(root, file);
      else if (entry.isFile()) fs.unlinkSync(file);
    }
  }
}
