import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { Repository } from 'typeorm';
import { DiscoverManagedSitesDto, SaveManagedSiteDto, SaveSharedSiteSettingsDto, UpdateManagedSiteDto } from './dto/site.dto';
import { ManagedSite, ManagedSiteEnvironment } from './entities/managed-site.entity';
import { SiteRequestContextService } from './site-request-context.service';

@Injectable()
export class SitesService implements OnModuleInit {
  private readonly cache = new Map<number, ManagedSite>();
  private youtubeApiKeyOverride = '';

  constructor(
    @InjectRepository(ManagedSite) private readonly sitesRepo: Repository<ManagedSite>,
    private readonly config: ConfigService,
    private readonly requestContext: SiteRequestContextService,
  ) {}

  async onModuleInit() {
    this.ensureManagedSitesRoot();
    if ((await this.sitesRepo.count()) === 0) {
      const imported = await this.importSitesFromFiles();
      if (!imported) {
        const initial = this.siteFromEnvironment();
        if (initial.rootPath && initial.dbPath) {
          await this.sitesRepo.save(this.sitesRepo.create(initial));
        }
      }
    }
    await this.migrateLegacyYoutubeChannel();
    await this.refreshCache();
    await this.migrateLegacySiteData();
    await this.syncSiteConfigFiles();
  }

  async findAll() {
    const sites = await this.sitesRepo.find({ order: { isDefault: 'DESC', name: 'ASC' } });
    return sites.map((site) => ({ ...site, configPath: this.getSiteConfigPath(site.code) }));
  }

  getCurrentSite() {
    const requestedId = this.requestContext.getSiteId();
    const requested = requestedId ? this.cache.get(requestedId) : undefined;
    if (requested?.enabled) return requested;

    const sites = [...this.cache.values()];
    const fallback = sites.find((site) => site.isDefault && site.enabled) || sites.find((site) => site.enabled);
    if (fallback) return fallback;

    const environmentSite = this.siteFromEnvironment();
    if (!environmentSite.rootPath || !environmentSite.dbPath) {
      throw new BadRequestException('还没有配置可用站点，请先进入“站点管理”添加 PbootCMS 网站。');
    }
    return { id: 0, createTime: new Date(), updateTime: new Date(), ...environmentSite } as ManagedSite;
  }

  getPbootDbPath() {
    return this.getCurrentSite().dbPath;
  }

  getPbootSiteRoot() {
    return this.getCurrentSite().rootPath;
  }

  getPbootPublicBaseUrl() {
    return (this.getCurrentSite().publicBaseUrl || 'http://localhost').replace(/\/$/, '');
  }

  getCurrentSiteId() {
    return Number(this.getCurrentSite().id || 0);
  }

  async getCurrentSiteLanguages() {
    const dbPath = this.getPbootDbPath();
    const labels: Record<string, { code: string; name: string }> = {
      cn: { code: 'zh-CN', name: '中文' },
      en: { code: 'en', name: 'English' },
      es: { code: 'es', name: 'Español' },
      fr: { code: 'fr', name: 'Français' },
      ru: { code: 'ru', name: 'Русский' },
      ar: { code: 'ar', name: 'العربية' },
      pt: { code: 'pt', name: 'Português' },
      id: { code: 'id', name: 'Bahasa Indonesia' },
      tr: { code: 'tr', name: 'Türkçe' },
      vi: { code: 'vi', name: 'Tiếng Việt' },
    };
    if (!dbPath || !fs.existsSync(dbPath)) return [{ acode: 'cn', ...labels.cn }];

    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    try {
      let acodes: string[] = [];
      try {
        const result = db.exec(
          `select acode from ay_area where coalesce(pcode, '0') = '0' order by cast(is_default as integer) desc, id asc`,
        );
        acodes = (result[0]?.values || []).map((row) => String(row[0] || '').trim().toLowerCase());
      } catch {
        const result = db.exec('select distinct acode from ay_content_sort order by acode');
        acodes = (result[0]?.values || []).map((row) => String(row[0] || '').trim().toLowerCase());
      }
      const unique = [...new Set(acodes)].filter(Boolean);
      return (unique.length ? unique : ['cn']).map((acode) => ({
        acode,
        ...(labels[acode] || { code: acode, name: acode.toUpperCase() }),
      }));
    } finally {
      db.close();
    }
  }

  async getCurrentSiteProfile() {
    const site = this.getCurrentSite();
    const publicBaseUrl = String(site.publicBaseUrl || '').trim().replace(/\/+$/, '');
    const fallback = {
      siteId: Number(site.id || 0),
      siteName: site.name,
      publicBaseUrl,
      companyName: site.name,
      companySubtitle: '',
      logoUrl: '',
      website: publicBaseUrl,
      assetBaseUrl: publicBaseUrl,
      contactName: '',
      phone: '',
      whatsapp: '',
      wechat: '',
      email: '',
    };
    if (!site.dbPath || !fs.existsSync(site.dbPath)) return fallback;

    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(site.dbPath));
    try {
      const siteRow = this.readPbootProfileRow(db, 'ay_site');
      const companyRow = this.readPbootProfileRow(db, 'ay_company');
      const mobile = this.rowText(companyRow, 'mobile');
      const phone = mobile || this.rowText(companyRow, 'phone');
      return {
        ...fallback,
        companyName: this.rowText(companyRow, 'name') || this.rowText(siteRow, 'title') || fallback.companyName,
        companySubtitle: this.rowText(siteRow, 'subtitle') || this.rowText(siteRow, 'description'),
        logoUrl: this.toPublicAssetUrl(this.rowText(siteRow, 'logo'), publicBaseUrl),
        contactName: this.rowText(companyRow, 'contact'),
        phone,
        whatsapp: mobile || phone,
        wechat: this.rowText(companyRow, 'weixin'),
        email: this.rowText(companyRow, 'email'),
      };
    } catch {
      return fallback;
    } finally {
      db.close();
    }
  }

  isDefaultSite(id: number) {
    const sites = [...this.cache.values()];
    const target = sites.find((site) => site.isDefault && site.enabled) || sites.find((site) => site.enabled);
    return Boolean(target && Number(target.id) === Number(id));
  }

  getYoutubeChannelId() {
    return String(this.getCurrentSite().youtubeChannelId || '').trim();
  }

  getYoutubeApiKey() {
    return this.youtubeApiKeyOverride || String(this.config.get<string>('YOUTUBE_API_KEY') || '').trim();
  }

  getSharedSettings() {
    const youtubeApiKey = this.getYoutubeApiKey();
    return {
      youtubeApiKeyConfigured: Boolean(youtubeApiKey),
      youtubeApiKeyMasked: youtubeApiKey ? `${youtubeApiKey.slice(0, 5)}...${youtubeApiKey.slice(-4)}` : '',
    };
  }

  saveSharedSettings(dto: SaveSharedSiteSettingsDto) {
    const youtubeApiKey = String(dto.youtubeApiKey || '').trim();
    if (youtubeApiKey) {
      this.writeBackendEnvValue('YOUTUBE_API_KEY', youtubeApiKey);
      this.youtubeApiKeyOverride = youtubeApiKey;
    }
    return this.getSharedSettings();
  }

  getCurrentSiteStorageDir(section?: 'api' | 'seo' | 'ftp' | 'google' | 'state' | 'backups') {
    const site = this.getCurrentSite();
    const directory = section ? path.join(this.getSiteDirectory(site.code), section) : this.getSiteDirectory(site.code);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  getSiteById(id: number) {
    const site = this.cache.get(id);
    if (!site?.enabled) throw new NotFoundException('没有找到可用站点。');
    return site;
  }

  resolveStaticFile(id: number, relativePath: string) {
    const site = this.getSiteById(id);
    const staticRoot = path.resolve(site.rootPath, 'static');
    const filePath = path.resolve(staticRoot, String(relativePath || '').replace(/^[/\\]+/, ''));
    if (!this.isPathInside(staticRoot, filePath)) throw new BadRequestException('静态文件路径无效。');
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new NotFoundException('静态文件不存在。');
    return filePath;
  }

  async create(dto: SaveManagedSiteDto) {
    const values = this.normalizeAndValidate(dto);
    await this.assertCodeAvailable(values.code);
    if (values.isDefault || (await this.sitesRepo.count()) === 0) {
      await this.clearDefault();
      values.isDefault = true;
    }
    const saved = await this.sitesRepo.save(this.sitesRepo.create(values));
    await this.refreshCache();
    await this.syncSiteConfigFiles();
    return saved;
  }

  async update(id: number, dto: UpdateManagedSiteDto) {
    const site = await this.requireSite(id);
    const previousCode = site.code;
    const values = this.normalizeAndValidate({ ...site, ...dto });
    await this.assertCodeAvailable(values.code, id);
    if (values.isDefault) await this.clearDefault(id);
    Object.assign(site, values);
    const saved = await this.sitesRepo.save(site);
    await this.ensureDefaultSite();
    await this.refreshCache();
    if (previousCode !== saved.code) this.archiveSiteDirectory(previousCode, 'renamed');
    await this.syncSiteConfigFiles();
    return saved;
  }

  async setDefault(id: number) {
    const site = await this.requireSite(id);
    if (!site.enabled) throw new BadRequestException('停用的站点不能设为默认站点。');
    await this.clearDefault(id);
    site.isDefault = true;
    const saved = await this.sitesRepo.save(site);
    await this.refreshCache();
    await this.syncSiteConfigFiles();
    return saved;
  }

  async remove(id: number) {
    const site = await this.requireSite(id);
    if (site.isDefault) throw new BadRequestException('默认站点不能直接删除，请先把其他站点设为默认。');
    this.archiveSiteDirectory(site.code, 'deleted');
    await this.sitesRepo.remove(site);
    await this.refreshCache();
    return { deleted: true, id };
  }

  async discover(dto: DiscoverManagedSitesDto) {
    const parentPath = path.resolve(String(dto.parentPath || '').trim());
    const environment = (dto.environment || (process.platform === 'win32' ? 'phpstudy' : 'baota')) as ManagedSiteEnvironment;
    if (!fs.existsSync(parentPath) || !fs.statSync(parentPath).isDirectory()) {
      throw new BadRequestException(`扫描目录不存在：${parentPath}`);
    }

    const existingSites = await this.sitesRepo.find();
    const existingByRoot = new Map(existingSites.map((site) => [this.normalizePathKey(site.rootPath), site]));
    const usedCodes = new Set(existingSites.map((site) => site.code));
    const directories = fs.readdirSync(parentPath, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
    const candidates = [];

    for (const directory of directories) {
      const rootPath = path.join(parentPath, directory.name);
      const dataPath = path.join(rootPath, 'data');
      if (!this.looksLikePbootSite(rootPath) || !fs.existsSync(dataPath) || !fs.statSync(dataPath).isDirectory()) continue;

      const databaseFiles = fs
        .readdirSync(dataPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(?:db|sqlite|sqlite3)$/i.test(entry.name))
        .map((entry) => {
          const dbPath = path.join(dataPath, entry.name);
          return { dbPath, stats: fs.statSync(dbPath) };
        })
        .filter((item) => item.stats.size > 0)
        .sort((left, right) => right.stats.size - left.stats.size || right.stats.mtimeMs - left.stats.mtimeMs);
      if (!databaseFiles.length) continue;

      const existing = existingByRoot.get(this.normalizePathKey(rootPath));
      const code = existing?.code || this.createUniqueCode(directory.name, usedCodes);
      usedCodes.add(code);
      candidates.push({
        name: existing?.name || directory.name,
        code,
        environment: existing?.environment || environment,
        rootPath,
        dbPath: databaseFiles[0].dbPath,
        publicBaseUrl: existing?.publicBaseUrl || this.inferPublicBaseUrl(directory.name, environment),
        youtubeChannelId: existing?.youtubeChannelId || '',
        enabled: existing?.enabled ?? true,
        isDefault: existing?.isDefault ?? false,
        notes: existing?.notes || '',
        existingSiteId: existing?.id || 0,
        databaseCount: databaseFiles.length,
      });
    }

    return {
      parentPath,
      scannedDirectories: directories.length,
      foundSites: candidates.length,
      newSites: candidates.filter((candidate) => !candidate.existingSiteId).length,
      candidates,
    };
  }

  async checkAll() {
    const sites = await this.sitesRepo.find({ order: { isDefault: 'DESC', name: 'ASC' } });
    const results = await Promise.all(sites.map((site) => this.inspectSite(site)));
    return {
      total: results.length,
      passed: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    };
  }

  async test(id: number) {
    const site = await this.requireSite(id);
    return this.inspectSite(site);
  }

  private inspectSite(site: ManagedSite) {
    const rootExists = fs.existsSync(site.rootPath) && fs.statSync(site.rootPath).isDirectory();
    const dbExists = fs.existsSync(site.dbPath) && fs.statSync(site.dbPath).isFile();
    const dbInsideData = rootExists && dbExists && this.isPathInside(path.join(site.rootPath, 'data'), site.dbPath);
    const configFileExists = fs.existsSync(this.getSiteConfigPath(site.code));
    return {
      ok: rootExists && dbExists && dbInsideData && configFileExists,
      siteId: site.id,
      name: site.name,
      checks: { rootExists, dbExists, dbInsideData, publicBaseUrl: Boolean(site.publicBaseUrl), configFileExists },
      configPath: this.getSiteConfigPath(site.code),
      message: rootExists && dbExists && dbInsideData && configFileExists
        ? '站点目录和 PbootCMS 数据库连接正常。'
        : '站点配置不完整，请检查网站目录、data 数据库路径和站点配置文件。',
    };
  }

  private normalizeAndValidate(dto: SaveManagedSiteDto) {
    const name = String(dto.name || '').trim();
    const code = String(dto.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    const environment = (dto.environment || 'phpstudy') as ManagedSiteEnvironment;
    const rootPath = path.resolve(String(dto.rootPath || '').trim());
    const dbPath = path.resolve(String(dto.dbPath || '').trim());
    const publicBaseUrl = String(dto.publicBaseUrl || '').trim().replace(/\/$/, '');
    const youtubeChannelId = String(dto.youtubeChannelId || '').trim();

    if (!name) throw new BadRequestException('请填写站点名称。');
    if (!code) throw new BadRequestException('请填写站点标识，只能使用字母、数字、横线或下划线。');
    if (!['phpstudy', 'baota', 'remote'].includes(environment)) throw new BadRequestException('站点运行环境无效。');
    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
      throw new BadRequestException(`网站根目录不存在：${rootPath}`);
    }
    if (!fs.existsSync(dbPath) || !fs.statSync(dbPath).isFile()) {
      throw new BadRequestException(`PbootCMS 数据库不存在：${dbPath}`);
    }
    if (!this.isPathInside(path.join(rootPath, 'data'), dbPath)) {
      throw new BadRequestException('PbootCMS 数据库必须位于当前网站的 data 目录内。');
    }
    if (publicBaseUrl && !/^https?:\/\/[^\s]+$/i.test(publicBaseUrl)) {
      throw new BadRequestException('线上网址必须以 http:// 或 https:// 开头。');
    }
    if (youtubeChannelId && !/^(?:UC[\w-]{20,}|@[\w.-]{3,})$/.test(youtubeChannelId)) {
      throw new BadRequestException('YouTube 频道请填写 UC 开头的频道 ID；也可以暂时留空。');
    }

    return {
      name,
      code,
      environment,
      rootPath,
      dbPath,
      publicBaseUrl,
      youtubeChannelId,
      enabled: dto.enabled !== false,
      isDefault: Boolean(dto.isDefault),
      notes: String(dto.notes || '').trim(),
    };
  }

  private siteFromEnvironment(): Omit<ManagedSite, 'id' | 'createTime' | 'updateTime'> {
    const rootPath = String(this.config.get<string>('PBOOT_SITE_ROOT') || '').trim();
    const dbPath = String(this.config.get<string>('PBOOT_DB_PATH') || '').trim();
    const publicBaseUrl = String(this.config.get<string>('PBOOT_PUBLIC_BASE_URL') || '').trim().replace(/\/$/, '');
    return {
      name: path.basename(rootPath) || '默认 PbootCMS 站点',
      code: 'default-site',
      environment: process.platform === 'win32' ? 'phpstudy' : 'baota',
      rootPath: rootPath ? path.resolve(rootPath) : '',
      dbPath: dbPath ? path.resolve(dbPath) : '',
      publicBaseUrl,
      youtubeChannelId: String(this.config.get<string>('YOUTUBE_CHANNEL_ID') || '').trim(),
      enabled: true,
      isDefault: true,
      notes: '由 backend/.env 自动导入的默认站点',
    };
  }

  private async refreshCache() {
    const sites = await this.sitesRepo.find();
    this.cache.clear();
    sites.forEach((site) => this.cache.set(site.id, site));
  }

  private readPbootProfileRow(db: initSqlJs.Database, table: 'ay_site' | 'ay_company') {
    let result: initSqlJs.QueryExecResult[] = [];
    try {
      result = db.exec(`select * from ${table} where lower(coalesce(acode, '')) = 'cn' order by id asc limit 1`);
    } catch {
      return {} as Record<string, unknown>;
    }
    if (!result[0]?.values?.length) result = db.exec(`select * from ${table} order by id asc limit 1`);
    const columns = result[0]?.columns || [];
    const values = result[0]?.values?.[0] || [];
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  }

  private rowText(row: Record<string, unknown>, field: string) {
    return String(row?.[field] ?? '').trim();
  }

  private toPublicAssetUrl(value: string, publicBaseUrl: string) {
    const source = String(value || '').trim();
    if (!source || /^(?:https?:)?\/\//i.test(source) || /^data:/i.test(source)) return source;
    if (!publicBaseUrl) return source;
    return `${publicBaseUrl}/${source.replace(/^\/+/, '')}`;
  }

  private async requireSite(id: number) {
    const site = await this.sitesRepo.findOneBy({ id });
    if (!site) throw new NotFoundException('没有找到该站点。');
    return site;
  }

  private async assertCodeAvailable(code: string, exceptId?: number) {
    const existing = await this.sitesRepo.findOneBy({ code });
    if (existing && existing.id !== exceptId) throw new BadRequestException('站点标识已存在，请更换。');
  }

  private async clearDefault(exceptId?: number) {
    const defaults = await this.sitesRepo.findBy({ isDefault: true });
    for (const site of defaults) {
      if (site.id === exceptId) continue;
      site.isDefault = false;
      await this.sitesRepo.save(site);
    }
  }

  private async ensureDefaultSite() {
    const defaultSite = await this.sitesRepo.findOneBy({ isDefault: true });
    if (defaultSite?.enabled) return;
    const next = await this.sitesRepo.findOne({ where: { enabled: true }, order: { id: 'ASC' } });
    if (next) {
      await this.clearDefault(next.id);
      next.isDefault = true;
      await this.sitesRepo.save(next);
    }
  }

  private looksLikePbootSite(rootPath: string) {
    const hasEntry = fs.existsSync(path.join(rootPath, 'index.php')) || fs.existsSync(path.join(rootPath, 'admin.php'));
    const hasFramework = fs.existsSync(path.join(rootPath, 'apps')) && fs.existsSync(path.join(rootPath, 'core'));
    return hasEntry && hasFramework;
  }

  private inferPublicBaseUrl(directoryName: string, environment: ManagedSiteEnvironment) {
    if (!directoryName.includes('.') || /\s/.test(directoryName)) return '';
    return `${environment === 'phpstudy' ? 'http' : 'https'}://${directoryName}`;
  }

  private createUniqueCode(value: string, usedCodes: Set<string>) {
    const base = String(value || 'site').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
    let code = base;
    let suffix = 2;
    while (usedCodes.has(code)) code = `${base}-${suffix++}`;
    return code;
  }

  private normalizePathKey(value: string) {
    const normalized = path.resolve(String(value || ''));
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  private getManagedSitesRoot() {
    const configured = String(this.config.get<string>('MANAGED_SITES_DIR') || '').trim();
    return configured
      ? (path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured))
      : path.resolve(process.cwd(), '..', 'managed-sites');
  }

  private ensureManagedSitesRoot() {
    const root = this.getManagedSitesRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(root, '_archive'), { recursive: true });
    return root;
  }

  private getSiteDirectory(code: string) {
    const safeCode = String(code || '').replace(/[^a-z0-9_-]/gi, '');
    if (!safeCode) throw new BadRequestException('站点标识无效，无法创建配置目录。');
    return path.join(this.ensureManagedSitesRoot(), safeCode);
  }

  private getSiteConfigPath(code: string) {
    return path.join(this.getSiteDirectory(code), 'site.json');
  }

  private async syncSiteConfigFiles() {
    const sites = await this.sitesRepo.find();
    sites.forEach((site) => this.writeSiteConfigFile(site));
  }

  private writeSiteConfigFile(site: ManagedSite) {
    const directory = this.getSiteDirectory(site.code);
    for (const section of ['api', 'seo', 'ftp', 'google', 'state', 'backups']) {
      fs.mkdirSync(path.join(directory, section), { recursive: true });
    }
    fs.mkdirSync(path.join(directory, 'api', 'uploads'), { recursive: true });
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      site: {
        id: site.id,
        name: site.name,
        code: site.code,
        environment: site.environment,
        rootPath: site.rootPath,
        dbPath: site.dbPath,
        publicBaseUrl: site.publicBaseUrl,
        youtubeChannelId: site.youtubeChannelId || '',
        enabled: site.enabled,
        isDefault: site.isDefault,
        notes: site.notes || '',
      },
      storage: {
        api: 'api',
        uploads: 'api/uploads',
        seo: 'seo',
        ftp: 'ftp',
        google: 'google',
        state: 'state',
        backups: 'backups',
      },
      sharedConfiguration: {
        modelApiKeys: 'global',
        youtubeApiKey: 'global',
      },
    };
    fs.writeFileSync(path.join(directory, 'site.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  private async importSitesFromFiles() {
    const root = this.ensureManagedSitesRoot();
    const directories = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== '_archive');
    let imported = 0;
    let defaultAssigned = false;
    for (const directory of directories) {
      const configPath = path.join(root, directory.name, 'site.json');
      if (!fs.existsSync(configPath)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const source = parsed?.site || parsed;
        const values = this.normalizeAndValidate({ ...source, code: source.code || directory.name });
        values.isDefault = Boolean(values.isDefault && !defaultAssigned);
        if (values.isDefault) defaultAssigned = true;
        await this.sitesRepo.save(this.sitesRepo.create(values));
        imported += 1;
      } catch (error) {
        console.warn(`Skipped managed site config ${configPath}: ${(error as Error).message}`);
      }
    }
    if (imported && !defaultAssigned) {
      const first = await this.sitesRepo.findOne({ order: { id: 'ASC' } });
      if (first) {
        first.isDefault = true;
        await this.sitesRepo.save(first);
      }
    }
    return imported;
  }

  private async migrateLegacyYoutubeChannel() {
    const legacyChannelId = String(this.config.get<string>('YOUTUBE_CHANNEL_ID') || '').trim();
    if (!legacyChannelId) return;
    const configured = await this.sitesRepo.countBy({ youtubeChannelId: legacyChannelId });
    if (configured) return;
    const target =
      (await this.sitesRepo.findOneBy({ isDefault: true })) ||
      (await this.sitesRepo.findOne({ order: { id: 'ASC' } }));
    if (!target || target.youtubeChannelId) return;
    target.youtubeChannelId = legacyChannelId;
    await this.sitesRepo.save(target);
  }

  private async migrateLegacySiteData() {
    const target = [...this.cache.values()].find((site) => site.isDefault && site.enabled)
      || [...this.cache.values()].find((site) => site.enabled);
    if (!target?.id) return;

    for (const table of ['menu', 'news', 'product', 'page', 'quotations', 'video_item', 'video_playlist']) {
      try {
        await this.sitesRepo.manager
          .createQueryBuilder()
          .update(table)
          .set({ siteId: target.id })
          .where('siteId = :legacySiteId', { legacySiteId: 0 })
          .execute();
      } catch {
        // Older installations may not have every optional module table yet.
      }
    }
  }

  private writeBackendEnvValue(key: string, value: string) {
    const envPath = path.resolve(process.cwd(), '.env');
    const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const lines = current.split(/\r?\n/);
    let replaced = false;
    const next = lines.map((line) => {
      if (!new RegExp(`^\\s*${key}\\s*=`).test(line)) return line;
      replaced = true;
      return `${key}=${value}`;
    });
    if (!replaced) next.push(`${key}=${value}`);
    fs.writeFileSync(envPath, `${next.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  }

  private archiveSiteDirectory(code: string, reason: string) {
    const source = this.getSiteDirectory(code);
    if (!fs.existsSync(source)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(this.ensureManagedSitesRoot(), '_archive', `${code}-${reason}-${stamp}`);
    fs.renameSync(source, target);
  }

  private isPathInside(parent: string, child: string) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }
}
