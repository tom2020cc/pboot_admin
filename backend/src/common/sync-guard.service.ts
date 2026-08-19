import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

type GuardedTable = 'menu' | 'news' | 'product' | 'video' | 'page';

type LocalHealth = {
  dbPath: string;
  counts: Record<'menu' | 'news' | 'product' | 'video' | 'page' | 'user', number>;
};

@Injectable()
export class SyncGuardService {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async protectBeforeDangerousSync(action: string, requiredTable?: GuardedTable) {
    this.assertProjectIsolation();
    const backupPath = this.backupLocalSqljsDatabase(action);
    const health = await this.readLocalHealth();
    this.assertHealthy(action, health, backupPath, requiredTable);
    return { backupPath, health };
  }

  private assertProjectIsolation() {
    const siteRootValue = this.config.get<string>('PBOOT_SITE_ROOT', '');
    const pbootDbValue = this.config.get<string>('PBOOT_DB_PATH', '');
    const packageRoot = path.resolve(__dirname, '..', '..', '..');
    const siteRoot = path.resolve(siteRootValue || '.');
    const pbootDbPath = path.resolve(pbootDbValue || '.');
    const siteDataDir = path.join(siteRoot, 'data');

    if (!siteRootValue || !fs.existsSync(siteRoot) || !fs.statSync(siteRoot).isDirectory()) {
      throw new BadRequestException('项目隔离保护：当前网站根目录无效，请先运行“打开配置向导”。');
    }
    if (!this.isPathInside(siteRoot, packageRoot)) {
      throw new BadRequestException('项目隔离保护：当前 pboot_admin 不在所配置的网站根目录内，已禁止跨网站操作。');
    }
    if (!pbootDbValue || !fs.existsSync(pbootDbPath) || !fs.statSync(pbootDbPath).isFile()) {
      throw new BadRequestException('项目隔离保护：当前网站数据库不存在，请在配置向导中重新选择 data 目录下的 .db 文件。');
    }
    if (!this.isPathInside(siteDataDir, pbootDbPath)) {
      throw new BadRequestException('项目隔离保护：所选数据库不属于当前网站，已禁止跨网站读取或写入。');
    }
  }

  private isPathInside(parent: string, child: string) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  private backupLocalSqljsDatabase(action: string) {
    if (this.config.get('DB_TYPE', 'sqljs') !== 'sqljs') return '';

    const dbPath = this.resolveLocalSqljsPath();
    if (!fs.existsSync(dbPath)) {
      throw new BadRequestException(`同步保护：没有找到本地数据库 ${dbPath}`);
    }

    const parsed = path.parse(dbPath);
    const safeAction = String(action || 'dangerous_sync').replace(/[^\w-]+/g, '_');
    const backupPath = path.join(parsed.dir, `${parsed.name}.before_${safeAction}_${this.timestamp()}${parsed.ext}`);
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
  }

  private async readLocalHealth(): Promise<LocalHealth> {
    const counts = {
      menu: await this.countTable('menu'),
      news: await this.countTable('news'),
      product: await this.countTable('product'),
      video: await this.countTable('video'),
      page: await this.countTable('page'),
      user: await this.countTable('user'),
    };

    return {
      dbPath: this.resolveLocalSqljsPath(),
      counts,
    };
  }

  private assertHealthy(
    action: string,
    health: LocalHealth,
    backupPath: string,
    requiredTable?: GuardedTable,
  ) {
    const importingFromPboot = /_import_from_pboot$/.test(action);
    const minMenus = Number(this.config.get('SYNC_GUARD_MIN_MENUS', 1));
    const minUsers = Number(this.config.get('SYNC_GUARD_MIN_USERS', 1));
    const problems: string[] = [];

    if (health.counts.user < minUsers) problems.push(`user=${health.counts.user}`);

    // Pulling data from PbootCMS is the recovery/bootstrap path, so an empty
    // local database must be allowed. Content imports still need local menus
    // because imported rows are mapped to those menu records.
    if (importingFromPboot) {
      const importingMenus = action === 'menu_import_from_pboot';
      if (!importingMenus && health.counts.menu < 1) {
        problems.push('menu=0 (请先执行“一键同步栏目”)');
      }
    } else {
      if (health.counts.menu < minMenus) problems.push(`menu=${health.counts.menu}`);

      if (requiredTable && health.counts[requiredTable] <= 0) {
        problems.push(`${requiredTable}=0`);
      }
    }

    if (problems.length) {
      const nextStep = importingFromPboot
        ? '请先到“菜单管理”执行“一键同步栏目”，再返回同步当前内容。'
        : '这是向网站写入数据的操作，请先确认本地数据完整，再重新执行同步。';
      throw new BadRequestException(
        [
          '同步保护已拦截：本地数据库看起来不正常，暂时不能继续同步。',
          `异常数据：${problems.join(', ')}`,
          `已先备份当前库：${backupPath || '无'}`,
          nextStep,
        ].join(' '),
      );
    }
  }

  private async countTable(tableName: string) {
    try {
      const rows = await this.dataSource.query(`select count(*) as count from "${tableName}"`);
      return Number(rows?.[0]?.count ?? rows?.[0]?.COUNT ?? 0);
    } catch {
      return 0;
    }
  }

  private resolveLocalSqljsPath() {
    const location = this.config.get('DB_SQLJS_LOCATION', 'dev.sqlite');
    return path.isAbsolute(location) ? location : path.resolve(process.cwd(), location);
  }

  private timestamp() {
    const pad = (value: number) => String(value).padStart(2, '0');
    const now = new Date();
    return [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      '_',
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join('');
  }
}
