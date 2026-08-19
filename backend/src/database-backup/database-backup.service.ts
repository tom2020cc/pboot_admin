import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const initSqlJs = require('sql.js');

type DatabaseCounts = Record<string, number>;

const IMPORTANT_TABLES = ['menu', 'news', 'news_translations', 'product', 'product_translations', 'page', 'page_translations', 'video'];

@Injectable()
export class DatabaseBackupService {
  constructor(private readonly config: ConfigService) {}

  async createBackup() {
    const sourcePath = this.getLocalDbPath();
    if (!fs.existsSync(sourcePath)) {
      throw new BadRequestException(`Backend database not found: ${sourcePath}`);
    }

    const backupDir = this.getBackupDir();
    fs.mkdirSync(backupDir, { recursive: true });

    const parsed = path.parse(sourcePath);
    const backupPath = path.join(backupDir, `${parsed.name}.backend_backup_${this.timestamp()}${parsed.ext || '.sqlite'}`);
    fs.copyFileSync(sourcePath, backupPath);

    const summary = await this.inspectDatabase(backupPath);
    const fileStats = fs.statSync(backupPath);
    const result = {
      msg: 'Backend database backup created',
      sourcePath,
      backupPath,
      fileName: path.basename(backupPath),
      size: fileStats.size,
      createdAt: fileStats.mtime.toISOString(),
      sha256: this.hashFile(backupPath),
      counts: summary.counts,
      healthy: summary.healthy,
      warnings: summary.warnings,
    };

    fs.writeFileSync(`${backupPath}.json`, JSON.stringify(result, null, 2), 'utf8');
    return result;
  }

  async listBackups() {
    const backupDir = this.getBackupDir();
    if (!fs.existsSync(backupDir)) return [];

    const files = fs
      .readdirSync(backupDir)
      .filter((file) => /\.sqlite$/i.test(file) || /\.db$/i.test(file))
      .map((file) => path.join(backupDir, file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, 30);

    const backups = [];
    for (const filePath of files) {
      const stat = fs.statSync(filePath);
      const metaPath = `${filePath}.json`;
      const meta = fs.existsSync(metaPath) ? this.safeReadJson(metaPath) : null;
      backups.push({
        fileName: path.basename(filePath),
        backupPath: filePath,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
        sha256: meta?.sha256 || '',
        counts: meta?.counts || {},
        healthy: meta?.healthy ?? null,
        warnings: meta?.warnings || [],
      });
    }
    return backups;
  }

  async getCurrentDatabaseInfo() {
    const sourcePath = this.getLocalDbPath();
    if (!fs.existsSync(sourcePath)) {
      throw new BadRequestException(`Backend database not found: ${sourcePath}`);
    }
    const stat = fs.statSync(sourcePath);
    const summary = await this.inspectDatabase(sourcePath);
    return {
      sourcePath,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      counts: summary.counts,
      healthy: summary.healthy,
      warnings: summary.warnings,
    };
  }

  private async inspectDatabase(dbPath: string) {
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const counts: DatabaseCounts = {};
    const warnings: string[] = [];

    try {
      for (const table of IMPORTANT_TABLES) {
        counts[table] = this.countTable(db, table);
      }
    } finally {
      db.close();
    }

    if ((counts.menu || 0) <= 0) warnings.push('menu table is empty');
    if ((counts.news || 0) <= 0 && (counts.product || 0) <= 0 && (counts.page || 0) <= 0 && (counts.video || 0) <= 0) {
      warnings.push('all content tables are empty');
    }

    return {
      counts,
      healthy: warnings.length === 0,
      warnings,
    };
  }

  private countTable(db: any, table: string) {
    const exists = this.queryOne<{ count: number }>(db, `select count(*) as count from sqlite_master where type='table' and name=?`, [table]);
    if (!Number(exists?.count || 0)) return 0;
    return Number(this.queryOne<{ count: number }>(db, `select count(*) as count from "${table}"`)?.count || 0);
  }

  private queryOne<T>(db: any, sql: string, params: any[] = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      return stmt.step() ? (stmt.getAsObject() as T) : null;
    } finally {
      stmt.free();
    }
  }

  private safeReadJson(filePath: string) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  private hashFile(filePath: string) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }

  private getLocalDbPath() {
    const configured = this.config.get<string>('DB_SQLJS_LOCATION', 'dev.sqlite');
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }

  private getBackupDir() {
    return path.resolve(
      this.config.get<string>('BACKEND_DB_BACKUP_DIR') || path.resolve(process.cwd(), '..', 'backups', 'backend_database'),
    );
  }

  private timestamp() {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }
}
