import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { SitesService } from './sites.service';
import { replaceBatchDatabase } from '../product/product-batch-file';

type Environment = 'phpstudy' | 'baota';
type Profile = { domains: string[]; codes: string; phone: string };
type State = { version: 1; siteId: number; profiles: Partial<Record<Environment, Profile>> };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function normalizeLicenseProfile(domains: string[], codes: string, phone: string): Profile {
  const hosts = domains.map(value => {
    try {
      const url = new URL(value.includes('://') ? value : `http://${value}`);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      return url.hostname.toLowerCase();
    } catch { throw new BadRequestException('域名格式不正确，请填写纯域名或网站首页网址'); }
  });
  const normalized = codes.replace(/[，\s]+/g, ',').split(',').filter(Boolean);
  if (normalized.some(value => !/^[a-zA-Z0-9_-]+$/.test(value))) throw new BadRequestException('授权码只能包含字母、数字、下划线或连字符，多条请用逗号分隔');
  if (!/^[+\d ()-]*$/.test(phone)) throw new BadRequestException('授权码手机格式不正确');
  return { domains: [...new Set(hosts)], codes: [...new Set(normalized)].join(','), phone: phone.trim() };
}

@Injectable()
export class SiteLicenseService {
  private readonly busy = new Set<number>();
  constructor(private readonly sites: SitesService) {}

  private rows(db: any, sql: string, args: any[] = []) {
    const stmt = db.prepare(sql);
    try { stmt.bind(args); const rows: Record<string, any>[] = []; while (stmt.step()) rows.push(stmt.getAsObject()); return rows; }
    finally { stmt.free(); }
  }

  private noJournal(file: string) {
    for (const suffix of ['-wal', '-journal']) if (fs.existsSync(file + suffix) && fs.statSync(file + suffix).size) throw new ConflictException('PB 正在写入，请稍后重试');
  }

  private async open() {
    const site = this.sites.getCurrentSite();
    const root = fs.realpathSync(site.rootPath);
    const database = fs.realpathSync(site.dbPath);
    const relative = path.relative(path.join(root, 'data'), database);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.lstatSync(site.dbPath).isFile()) throw new BadRequestException('PB 数据库必须位于当前站点的 data 目录');
    this.noJournal(database);
    const file = path.join(this.sites.getCurrentSiteStorageDir('state'), 'system-license.json');
    let state: State = { version: 1, siteId: site.id, profiles: {} };
    if (fs.existsSync(file)) {
      if (!fs.lstatSync(file).isFile()) throw new BadRequestException('授权配置文件不是普通文件');
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (state.version !== 1 || state.siteId !== site.id || !state.profiles || typeof state.profiles !== 'object' || Array.isArray(state.profiles)) throw new BadRequestException('授权配置与当前站点不匹配');
      for (const profile of Object.values(state.profiles)) {
        if (!profile || !Array.isArray(profile.domains) || profile.domains.some(domain => typeof domain !== 'string') || typeof profile.codes !== 'string' || typeof profile.phone !== 'string') throw new BadRequestException('授权配置格式不正确');
      }
    }
    const SQL = await initSqlJs();
    const original = fs.readFileSync(database);
    // sql.js can mutate its input buffer; retain an untouched snapshot for optimistic replacement.
    const db = new SQL.Database(new Uint8Array(original));
    try {
      const config = Object.fromEntries(this.rows(db, "SELECT name,value FROM ay_config WHERE name IN ('sn','sn_user','licensecode')").map(row => [row.name, String(row.value || '')]));
      const domains = this.rows(db, "SELECT domain FROM ay_area WHERE domain<>''").map(row => String(row.domain));
      const active: Environment | null = site.environment === 'phpstudy' || site.environment === 'baota' ? site.environment : null;
      const publicDomain = site.publicBaseUrl ? normalizeLicenseProfile([site.publicBaseUrl], '', '').domains[0] : '';
      const live = { codes: config.sn || '', phone: config.sn_user || '' };
      const profiles: Record<Environment, Profile> = {
        phpstudy: state.profiles.phpstudy || { domains: active === 'phpstudy' && publicDomain ? [publicDomain] : [], codes: active === 'phpstudy' ? live.codes : '', phone: active === 'phpstudy' ? live.phone : '' },
        baota: state.profiles.baota || { domains: [...new Set([...(active === 'baota' && publicDomain ? [publicDomain] : []), ...domains.filter(domain => domain !== publicDomain)])], codes: active === 'baota' ? live.codes : '', phone: active === 'baota' ? live.phone : '' },
      };
      const revision = digest({ siteId: site.id, environment: site.environment, root, database, publicDomain, state, config });
      return { site, root, database, original, db, file, state, config, response: { siteId: site.id, siteName: site.name, activeEnvironment: active, publicDomain, profiles, live, revision,
        canSyncRemote: process.env.APP_ENVIRONMENT === 'local' && active === 'phpstudy' } };
    } catch (error) { db.close(); throw error; }
  }

  async read() {
    const context = await this.open();
    try { return context.response; } finally { context.db.close(); }
  }

  async save(dto: { siteId: number; environment: Environment; domains: string[]; codes: string; phone: string; revision: string; apply: boolean; syncRemote?: boolean }) {
    const siteId = this.sites.getCurrentSiteId();
    if (siteId !== dto.siteId) throw new BadRequestException('站点已切换，请重新读取授权配置');
    if (this.busy.has(siteId)) throw new ConflictException('授权配置正在保存，请稍后重试');
    this.busy.add(siteId);
    try {
      const context = await this.open();
      try {
        if (dto.revision !== context.response.revision) throw new ConflictException('授权配置已变化，请重新读取后保存');
        const profile = normalizeLicenseProfile(dto.domains, dto.codes, dto.phone);
        if (dto.syncRemote && (dto.apply || dto.environment !== 'baota' || !context.response.canSyncRemote)) throw new BadRequestException('线上同步仅用于从本地更新当前网站的宝塔授权');
        if (dto.syncRemote && (!profile.codes || !profile.domains.length)) throw new BadRequestException('请填写线上域名及官方授权码');
        if (dto.apply) {
          if (dto.environment !== context.response.activeEnvironment) throw new BadRequestException('只能写入当前站点运行环境的授权码，不能跨环境写入');
          if (!profile.codes || !profile.domains.length) throw new BadRequestException('写入前请填写对应域名和官方授权码');
          if (context.response.publicDomain && !profile.domains.includes(context.response.publicDomain)) throw new BadRequestException('域名列表必须包含当前站点访问域名');
          // Match PB ConfigController storage format; this does not generate or verify a license.
          const values = { sn: profile.codes, sn_user: profile.phone, licensecode: Buffer.from(`${profile.codes}/${profile.phone}`).toString('base64') + profile.codes.slice(1, 2) };
          for (const [key, value] of Object.entries(values)) {
            if (!Object.prototype.hasOwnProperty.call(context.config, key)) throw new BadRequestException('当前 PB 缺少授权配置项，请先在 PB 配置参数中保存一次');
            context.db.run('UPDATE ay_config SET value=? WHERE name=?', [value, key]);
          }
          this.noJournal(context.database);
          try { replaceBatchDatabase(context.database, context.original, Buffer.from(context.db.export())); }
          catch (error) { throw new ConflictException(`PB 授权写入失败：${error instanceof Error ? error.message : '请重新读取后重试'}`); }
        }
        context.state.profiles[dto.environment] = profile;
        const warnings: string[] = [];
        const temporary = `${context.file}.${randomUUID()}.tmp`;
        try { fs.writeFileSync(temporary, JSON.stringify(context.state, null, 2), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, context.file); }
        catch (error) {
          if (!dto.apply) throw error;
          warnings.push('授权码已写入 PB，但环境配置文件保存失败，请重新读取后重试保存配置');
        }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        if (dto.apply) {
          // Only generated PHP configuration caches; never templates, uploads or business data.
          try {
            const cache = path.join(context.root, 'runtime', 'config');
            if (fs.existsSync(cache)) {
              const rel = path.relative(context.root, fs.realpathSync(cache));
              if (rel.startsWith('..') || path.isAbsolute(rel) || fs.lstatSync(cache).isSymbolicLink()) throw new Error();
              for (const entry of fs.readdirSync(cache, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.php')) fs.unlinkSync(path.join(cache, entry.name));
            }
          } catch { warnings.push('授权码已写入，请在 PB 后台手动清理配置缓存'); }
        }
        let onlineSync: { ok: boolean; message: string; verifiedAt?: string } | undefined;
        if (dto.syncRemote) {
          try {
            const configPath = path.join(this.sites.getCurrentSiteStorageDir('ftp'), 'ftp.config.json');
            if (!fs.existsSync(configPath) || !fs.lstatSync(configPath).isFile()) throw new Error('请先在网站发布中保存当前网站的 FTPS 连接');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const { syncLicense } = require(path.resolve(__dirname, '../../../tools/ftp_publish_tool/license-sync.js'));
            const result = await syncLicense(config, profile);
            warnings.push(...result.warnings);
            onlineSync = { ok: true, message: '线上授权码已同步并回读校验通过', verifiedAt: new Date().toISOString() };
          } catch (error) {
            onlineSync = { ok: false, message: `配置已保存在本地，线上同步未确认成功：${error instanceof Error ? error.message : '连接失败，请重试'}` };
          }
        }
        return { ...(await this.read()), warnings, onlineSync };
      } finally { context.db.close(); }
    } finally { this.busy.delete(siteId); }
  }
}
