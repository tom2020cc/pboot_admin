import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import initSqlJs from 'sql.js';
import { SitesService } from '../sites/sites.service';
import { CreateAreaDto, UpdateAreaDto } from './dto/area.dto';
import { assertDomainAvailable, boundHosts, primaryDomain } from '../common/pboot-domain-link';
import { replaceBatchDatabase } from '../product/product-batch-file';

export interface Area {
  id: number;
  acode: string;
  name: string;
  domain: string;
  is_default: string;
  create_user: string;
  update_user: string;
  create_time: string;
  update_time: string;
}

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

@Injectable()
export class AreaService {
  private readonly snapshots = new WeakMap<object, { file: string; original: Buffer }>();
  constructor(private readonly sitesService: SitesService) {}

  private async openDatabase() {
    const dbPath = this.sitesService.getPbootDbPath();
    if (!dbPath || !fs.existsSync(dbPath)) {
      throw new BadRequestException('当前站点的 PbootCMS 数据库不存在');
    }
    const SQL = await initSqlJs();
    const original = fs.readFileSync(dbPath);
    const db = new SQL.Database(new Uint8Array(original));
    this.snapshots.set(db, { file: dbPath, original });
    return db;
  }

  private saveDatabase(db: any) {
    const snapshot = this.snapshots.get(db);
    if (!snapshot) throw new BadRequestException('数据库读取状态无效');
    for (const suffix of ['-wal', '-journal']) if (fs.existsSync(snapshot.file + suffix) && fs.statSync(snapshot.file + suffix).size) throw new BadRequestException('PB 数据库正在写入，请稍后重试');
    replaceBatchDatabase(snapshot.file, snapshot.original, Buffer.from(db.export()));
  }

  private linkSiteDomain(db: any, language: string, binding: string) {
    const rows = this.rows(db, 'select domain from ay_site where acode=?', [language]);
    if (rows.length > 1) throw new BadRequestException('该语言存在重复站点资料，请先检查');
    if (rows.length) this.run(db, 'update ay_site set domain=? where acode=?', [primaryDomain(binding, String(rows[0].domain || '')), language]);
  }

  private rows(db: any, sql: string, params: any[] = []): Record<string, any>[] {
    const statement = db.prepare(sql);
    try {
      statement.bind(params);
      const result: Record<string, any>[] = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally {
      statement.free();
    }
  }

  private run(db: any, sql: string, params: any[] = []) {
    const statement = db.prepare(sql);
    try {
      statement.run(params);
    } finally {
      statement.free();
    }
  }

  async findAll(search?: string, page = 1, limit = 20) {
    const db = await this.openDatabase();
    try {
      const params: any[] = [];
      let sql = "select * from ay_area where coalesce(pcode,'0')='0'";
      if (search) {
        sql += ' and (name like ? or acode like ? or domain like ?)';
        const like = `%${search}%`;
        params.push(like, like, like);
      }
      sql += ' order by cast(is_default as integer) desc, id asc';

      const areas = this.rows(db, sql, params) as Area[];
      const currentPage = Number(page) > 0 ? Number(page) : 1;
      const pageSize = Number(limit) > 0 ? Number(limit) : 20;
      const offset = (currentPage - 1) * pageSize;

      return {
        data: areas.slice(offset, offset + pageSize),
        total: areas.length,
        page: currentPage,
        limit: pageSize,
      };
    } finally {
      db.close();
    }
  }

  async findOne(id: number) {
    const db = await this.openDatabase();
    try {
      const [area] = this.rows(db, 'select * from ay_area where id=?', [id]);
      if (!area) throw new BadRequestException('区域不存在');
      return area as Area;
    } finally {
      db.close();
    }
  }

  async create(dto: CreateAreaDto) {
    const db = await this.openDatabase();
    try {
      const [existing] = this.rows(db, 'select id from ay_area where acode=?', [dto.acode]);
      if (existing) throw new BadRequestException(`区域编码 ${dto.acode} 已存在`);
      const domain = boundHosts(dto.domain || '').join(',');
      assertDomainAvailable(db, dto.acode, domain);

      const timestamp = now();
      this.run(
        db,
        `insert into ay_area (acode, pcode, name, domain, is_default, create_user, update_user, create_time, update_time)
         values (?,?,?,?,?,?,?,?,?)`,
        [dto.acode, '0', dto.name, domain, '0', 'admin', 'admin', timestamp, timestamp],
      );
      this.linkSiteDomain(db, dto.acode, domain);
      this.saveDatabase(db);

      const [created] = this.rows(db, 'select * from ay_area where acode=?', [dto.acode]);
      return created as Area;
    } finally {
      db.close();
    }
  }

  async update(id: number, dto: UpdateAreaDto) {
    const db = await this.openDatabase();
    try {
      const [existing] = this.rows(db, 'select * from ay_area where id=?', [id]);
      if (!existing) throw new BadRequestException('区域不存在');

      const updates: string[] = [];
      const params: any[] = [];
      if (dto.name !== undefined) {
        updates.push('name=?');
        params.push(dto.name);
      }
      if (dto.domain !== undefined) {
        const domain = boundHosts(dto.domain).join(',');
        assertDomainAvailable(db, existing.acode, domain);
        updates.push('domain=?');
        params.push(domain);
        this.linkSiteDomain(db, existing.acode, domain);
      }
      if (!updates.length) throw new BadRequestException('没有需要更新的字段');

      updates.push('update_user=?', 'update_time=?');
      params.push('admin', now(), id);

      this.run(db, `update ay_area set ${updates.join(', ')} where id=?`, params);
      this.saveDatabase(db);

      const [updated] = this.rows(db, 'select * from ay_area where id=?', [id]);
      return updated as Area;
    } finally {
      db.close();
    }
  }

  async remove(id: number) {
    const db = await this.openDatabase();
    try {
      const [existing] = this.rows(db, 'select * from ay_area where id=?', [id]);
      if (!existing) throw new BadRequestException('区域不存在');
      if (String(existing.is_default) === '1') {
        throw new BadRequestException('默认区域不能删除，请先把其他区域设为默认');
      }

      this.run(db, 'delete from ay_area where id=?', [id]);
      this.saveDatabase(db);
      return { message: '删除成功' };
    } finally {
      db.close();
    }
  }

  async batchDelete(ids: number[]) {
    if (!ids?.length) throw new BadRequestException('请先选择要删除的区域');
    const db = await this.openDatabase();
    try {
      const placeholders = ids.map(() => '?').join(',');
      const targets = this.rows(db, `select id, acode, is_default from ay_area where id in (${placeholders})`, ids);
      const protectedArea = targets.find((row) => String(row.is_default) === '1');
      if (protectedArea) {
        throw new BadRequestException(`默认区域 ${protectedArea.acode} 不能删除，请取消勾选后重试`);
      }

      this.run(db, `delete from ay_area where id in (${placeholders})`, ids);
      this.saveDatabase(db);
      return { message: `成功删除 ${targets.length} 个区域` };
    } finally {
      db.close();
    }
  }

  async setDefault(id: number) {
    const db = await this.openDatabase();
    try {
      const [target] = this.rows(db, 'select * from ay_area where id=?', [id]);
      if (!target) throw new BadRequestException('区域不存在');

      this.run(db, "update ay_area set is_default='0' where coalesce(pcode,'0')='0'");
      this.run(db, "update ay_area set is_default='1', update_user=?, update_time=? where id=?", ['admin', now(), id]);
      this.saveDatabase(db);

      return { message: `已将 ${target.name} 设为默认区域` };
    } finally {
      db.close();
    }
  }
}
