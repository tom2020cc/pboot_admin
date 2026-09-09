import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import initSqlJs from 'sql.js';
import { SitesService } from './sites.service';
import { fingerprint, inside, ReferenceText, ResourceEntry, safeResourcePath, scanSiteResources } from './site-resource-scan';

interface ScanRecord { id: string; siteId: number; root: string; createdAt: string; entries: ResourceEntry[]; }
interface QuarantineEntry { path: string; kind: ResourceEntry['kind']; fingerprint: string; state: 'pending' | 'moved' | 'restored'; }
interface QuarantineBatch { id: string; siteId: number; root: string; createdAt: string; entries: QuarantineEntry[]; }

@Injectable()
export class SiteResourcesService {
  private readonly scans = new Map<string, ScanRecord>();
  private readonly busy = new Set<number>();

  constructor(private readonly sites: SitesService, private readonly dataSource: DataSource) {}

  private site() {
    const site = this.sites.getCurrentSite();
    if (!site.id || !site.enabled) throw new BadRequestException('请先选择已配置的网站项目');
    const root = path.resolve(site.rootPath);
    if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) throw new BadRequestException('网站目录不存在或为链接');
    const data = path.join(root, 'data');
    if (!path.isAbsolute(site.rootPath) || !path.isAbsolute(site.dbPath) || !inside(data, path.resolve(site.dbPath))
      || !fs.existsSync(data) || !fs.existsSync(site.dbPath) || fs.lstatSync(data).isSymbolicLink()
      || fs.lstatSync(site.dbPath).isSymbolicLink() || !inside(fs.realpathSync(data), fs.realpathSync(site.dbPath))) {
      throw new BadRequestException('PB 数据库必须位于当前网站真实的 data 目录内，不能跨站点或通过链接读取');
    }
    return { ...site, root };
  }

  private assertDatabaseIdle(dbPath: string) {
    for (const suffix of ['-wal', '-journal']) {
      const journal = `${dbPath}${suffix}`;
      if (fs.existsSync(journal) && fs.statSync(journal).size > 0) throw new Error('PB 数据库有未合并或活动日志，无法完整确认引用，请稍后再试');
    }
  }

  private async locked<T>(operation: () => Promise<T>) {
    const id = this.site().id;
    if (this.busy.has(id)) throw new BadRequestException('本站资源检测或清理正在进行，请稍后再试');
    this.busy.add(id);
    try { return await operation(); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '资源操作失败'); }
    finally { this.busy.delete(id); }
  }

  private async references(dbPath: string) {
    const references: ReferenceText[] = [];
    let bytes = 0;
    const add = (source: string, row: unknown) => {
      const text = JSON.stringify(row);
      bytes += Buffer.byteLength(text);
      if (bytes > 60 * 1024 * 1024) throw new Error('数据库引用数据过多，本次扫描停止');
      references.push({ source, text });
    };
    // All project tables deliberately over-protect cross-site/shared references and unsynced drafts.
    for (const metadata of this.dataSource.entityMetadatas) {
      const rows = await this.dataSource.getRepository(metadata.target).createQueryBuilder('resource_ref').limit(50001).getRawMany();
      if (rows.length > 50000) throw new Error('项目数据超出安全扫描上限');
      for (const row of rows) add(`项目数据 ${metadata.tableName}`, row);
    }
    if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size > 256 * 1024 * 1024) throw new Error('PB 数据库不存在或过大，不能确认引用');
    this.assertDatabaseIdle(dbPath);
    const original = fs.readFileSync(dbPath);
    const SQL = await initSqlJs();
    const db = new SQL.Database(original);
    try {
      const tables = db.exec("select name from sqlite_master where type='table' and name not like 'sqlite_%'")[0]?.values || [];
      if (!tables.some(row => row[0] === 'ay_content')) throw new Error('未找到 PB 内容表，停止扫描');
      for (const [table] of tables) {
        const name = String(table);
        const rows = db.exec(`select * from "${name.replace(/"/g, '""')}" limit 50001`)[0]?.values || [];
        if (rows.length > 50000) throw new Error(`PB 表 ${name} 超出安全扫描上限`);
        for (const row of rows) add(`PB 数据 ${name}`, row);
      }
    } finally { db.close(); }
    return { references, original };
  }

  async scan() {
    return this.locked(async () => {
      const site = this.site();
      const { references, original } = await this.references(site.dbPath);
      const result = scanSiteResources(site.root, references);
      this.assertDatabaseIdle(site.dbPath);
      if (!fs.readFileSync(site.dbPath).equals(original)) throw new Error('PB 数据库正在变化，请稍后重新扫描');
      const record = { id: randomUUID(), siteId: site.id, root: site.root, createdAt: new Date(Date.now()).toISOString(), entries: result.entries };
      // Keep one scan per site and expire old scans instead of retaining arbitrary file inventories.
      for (const [id, previous] of this.scans) if (previous.siteId === site.id || Date.now() - Date.parse(previous.createdAt) > 1800000) this.scans.delete(id);
      this.scans.set(record.id, record);
      return { ...record, siteName: site.name, referenceSources: result.referenceSources, graceDays: result.graceDays,
        entries: record.entries.map(({ fingerprint: ignored, ...entry }) => entry) };
    });
  }

  private quarantineRoot() {
    // Outside all HTTP roots; it must not become another public image directory.
    const configured = process.env.RESOURCE_QUARANTINE_ROOT?.trim();
    if (configured && !path.isAbsolute(configured)) throw new Error('RESOURCE_QUARANTINE_ROOT 必须为服务器上的绝对路径');
    return configured || path.join(os.homedir(), '.pboot-admin-resource-quarantine');
  }

  private async storage(siteId: number) {
    const base = path.resolve(this.quarantineRoot());
    let current = path.parse(base).root;
    for (const part of base.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('隔离目录不能包含链接');
    }
    for (const site of await this.sites.findAll()) if (inside(path.resolve(site.rootPath), base)) throw new Error('隔离目录不能位于网站目录内');
    const directory = path.join(base, String(siteId));
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('隔离目录不能为链接');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  private writeManifest(directory: string, batch: QuarantineBatch) {
    const temporary = path.join(directory, `manifest.${randomUUID()}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(batch, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, path.join(directory, 'manifest.json'));
  }

  private batch(directory: string, id: string, siteId: number, root: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('隔离批次不合法');
    const folder = path.join(directory, id);
    if (fs.lstatSync(folder).isSymbolicLink() || fs.lstatSync(path.join(folder, 'manifest.json')).isSymbolicLink()) throw new Error('隔离批次不能为链接');
    const batch = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')) as QuarantineBatch;
    if (batch.id !== id || batch.siteId !== siteId || batch.root !== root || !Array.isArray(batch.entries)) throw new Error('批次与当前网站目录不一致');
    for (const entry of batch.entries) safeResourcePath(root, entry.path, true);
    return { folder, batch };
  }

  private moveFile(source: string, destination: string, expected: string) {
    // Copy-and-verify also works when the website and quarantine are on different drives.
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    if (fingerprint(source) !== expected || !fs.readFileSync(source).equals(fs.readFileSync(destination))) throw new Error('文件已变更或隔离备份校验失败，源文件未删除');
    fs.unlinkSync(source);
  }

  async clean(scanId: string, paths: string[]) {
    return this.locked(async () => {
      const site = this.site();
      const record = this.scans.get(scanId);
      if (!record || record.siteId !== site.id || record.root !== site.root || Date.now() - Date.parse(record.createdAt) > 1800000) {
        throw new Error('扫描已失效或网站已切换，请重新扫描');
      }
      if (!paths.length || paths.length > 200 || new Set(paths).size !== paths.length) throw new Error('每次请选择 1 到 200 项，不能重复');
      const selected = paths.map(relative => {
        const entry = record.entries.find(item => item.path === relative);
        if (!entry || entry.status !== 'candidate') throw new Error('包含不可清理的项目');
        safeResourcePath(site.root, relative);
        return entry;
      });
      const storage = await this.storage(site.id);
      const { references, original } = await this.references(site.dbPath);
      const fresh = scanSiteResources(site.root, references);
      for (const entry of selected) {
        const latest = fresh.entries.find(item => item.path === entry.path);
        if (latest?.status !== 'candidate' || latest.fingerprint !== entry.fingerprint) throw new Error(`文件或引用已变化，请重新扫描：${entry.path}`);
      }
      this.assertDatabaseIdle(site.dbPath);
      if (!fs.readFileSync(site.dbPath).equals(original)) throw new Error('PB 数据库正在变化，请稍后重新扫描');
      const batch: QuarantineBatch = { id: randomUUID(), siteId: site.id, root: site.root, createdAt: new Date(Date.now()).toISOString(),
        entries: selected.map(entry => ({ path: entry.path, kind: entry.kind, fingerprint: entry.fingerprint, state: 'pending' })) };
      const directory = path.join(storage, batch.id);
      fs.mkdirSync(directory, { mode: 0o700 });
      this.writeManifest(directory, batch);
      const errors: string[] = [];
      for (const entry of batch.entries) {
        try {
          this.assertDatabaseIdle(site.dbPath);
          if (!fs.readFileSync(site.dbPath).equals(original)) throw new Error('PB 数据发生变化，剩余项目未清理');
          const source = safeResourcePath(site.root, entry.path);
          if (fingerprint(source) !== entry.fingerprint) throw new Error('文件已变化');
          const destination = path.join(directory, entry.path);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          if (entry.kind === 'directory') {
            fs.mkdirSync(destination, { recursive: true });
            fs.rmdirSync(source); // Empty directories only, never recursive.
          } else this.moveFile(source, destination, entry.fingerprint);
          entry.state = 'moved';
          this.writeManifest(directory, batch);
        } catch (error) { errors.push(`${entry.path}：${(error as Error).message}`); break; }
      }
      this.scans.delete(scanId);
      return { id: batch.id, moved: batch.entries.filter(e => e.state === 'moved').length, errors };
    });
  }

  async history() {
    const site = this.site();
    const storage = await this.storage(site.id);
    return fs.readdirSync(storage).filter(id => /^[0-9a-f-]{36}$/.test(id)).map(id => {
      try {
        const { batch, folder } = this.batch(storage, id, site.id, site.root);
        return { id, createdAt: batch.createdAt, entries: batch.entries.map(entry => ({ path: entry.path, state: entry.state,
          recoverable: entry.state !== 'restored' && fs.existsSync(path.join(folder, entry.path)) })) };
      } catch { return { id, createdAt: '', entries: [], error: '批次校验失败或网站目录已变更，需人工检查' }; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async restore(id: string) {
    return this.locked(async () => {
      const site = this.site();
      const storage = await this.storage(site.id);
      const { batch, folder } = this.batch(storage, id, site.id, site.root);
      const errors: string[] = [];
      let restored = 0;
      for (const entry of batch.entries) {
        if (entry.state === 'restored') continue;
        try {
          const destination = safeResourcePath(site.root, entry.path, true);
          const source = safeResourcePath(folder, entry.path, true);
          if (!fs.existsSync(source)) continue; // Operation had not reached this entry before interruption.
          if (fs.existsSync(destination)) throw new Error('原路径已存在，保留现有文件，不覆盖');
          if (entry.kind !== 'directory') {
            const expectedHash = entry.fingerprint.split(':').pop();
            if (fingerprint(source).split(':').pop() !== expectedHash) throw new Error('隔离文件校验不通过');
          }
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          if (entry.kind === 'directory') fs.mkdirSync(destination);
          else fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
          entry.state = 'restored';
          this.writeManifest(folder, batch);
          restored++;
        } catch (error) { errors.push(`${entry.path}：${(error as Error).message}`); }
      }
      return { restored, errors };
    });
  }
}
