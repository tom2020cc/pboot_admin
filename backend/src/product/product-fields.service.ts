import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import initSqlJs from 'sql.js';
import { SitesService } from '../sites/sites.service';
import { Product } from './entities/product.entity';
import { queryPbootRows } from '../common/pboot-content-import';
import { SaveProductFieldDto } from './dto/product-field.dto';
import { ProductFieldDefinition, defaultProductFields, productFieldValue, protectedProductField, validProductFieldName } from './product-fields';
import { ensurePbootFieldDefinitions, ProductSharedParameters, sharedParameterRows } from './product-shared-parameters';
import { FolderParameters, mapFolderParameters, folderSharedParameters } from './product-folder-parameters';

type FieldConfig = { version: 1; siteId: number; fields: ProductFieldDefinition[]; removed: string[] };

@Injectable()
export class ProductFieldsService {
  constructor(private readonly sites: SitesService, @InjectRepository(Product) private readonly products: Repository<Product>) {}

  private configPath() { return path.join(this.sites.getCurrentSiteStorageDir('state'), 'product-fields.json'); }

  private readConfig(): FieldConfig {
    const file = this.configPath();
    if (!fs.existsSync(file)) return { version: 1, siteId: this.sites.getCurrentSiteId(), fields: [], removed: [] };
    try {
      const config = JSON.parse(fs.readFileSync(file, 'utf8')) as FieldConfig;
      if (config.version !== 1 || config.siteId !== this.sites.getCurrentSiteId() || !Array.isArray(config.fields) || !Array.isArray(config.removed)
        || config.fields.some((field) => !validProductFieldName(field.name))) throw new Error();
      return config;
    } catch { throw new BadRequestException('当前站点产品字段配置损坏或站点不匹配，请从备份恢复。'); }
  }

  private writeConfig(fields: ProductFieldDefinition[], removed = this.readConfig().removed) {
    const target = this.configPath();
    if (fs.existsSync(target)) {
      const directory = path.join(this.sites.getCurrentSiteStorageDir('backups'), 'product-fields');
      fs.mkdirSync(directory, { recursive: true });
      fs.copyFileSync(target, path.join(directory, `fields-${Date.now()}-${randomUUID()}.json`));
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, siteId: this.sites.getCurrentSiteId(), fields, removed }, null, 2));
    fs.renameSync(temporary, target);
  }

  private nativeFields(db: any) {
    return queryPbootRows<{ name: string; description: string; sorting: number; type: number; mcode: string }>(db,
      'select name,description,sorting,type,mcode from ay_extfield');
  }

  definitionsFor(db: any): ProductFieldDefinition[] {
    const config = this.readConfig();
    const native = this.nativeFields(db).filter((field) => String(field.mcode) === '3' && validProductFieldName(field.name));
    const savedEngine = config.fields.find((field) => field.key === 'engine');
    const engine = native.find((field) => field.name.toLowerCase() === 'ext_engine')
      || native.find((field) => /^(发动机|发动机参数|engine)$/i.test(field.description.trim()) && Number(field.type) === 1);
    const fields = new Map(defaultProductFields(savedEngine?.name || engine?.name).map((field) => [field.name.toLowerCase(), field]));
    for (const field of native) {
      const key = field.name.toLowerCase();
      const standard = fields.get(key);
      fields.set(key, standard ? { ...standard, name: field.name, type: Number(field.type) } : {
        name: field.name, label: field.description || field.name, unit: '', sort: Number(field.sorting) || 100,
        enabled: false, type: Number(field.type),
      });
    }
    for (const field of config.fields) {
      const nativeField = native.find((item) => item.name.toLowerCase() === field.name.toLowerCase());
      fields.set(field.name.toLowerCase(), { ...field, type: nativeField ? Number(nativeField.type) : field.type });
    }
    const removed = new Set(['ext_pullback', 'ext_pullback_unit', ...config.removed.map((name) => name.toLowerCase())]);
    return [...fields.values()].filter((field) => !removed.has(field.name.toLowerCase()))
      .map((field) => ({ ...field, enabled: !protectedProductField(field) && field.enabled }))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  }

  private dbPath() {
    const root = fs.realpathSync(this.sites.getPbootSiteRoot());
    const database = fs.realpathSync(this.sites.getPbootDbPath());
    const relative = path.relative(path.join(root, 'data'), database);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new BadRequestException('数据库不属于当前网站，已停止操作。');
    return database;
  }

  private async withDb<T>(action: (db: any) => T | Promise<T>): Promise<T> {
    const database = this.dbPath();
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(database));
    try { return await action(db); } finally { db.close(); }
  }

  async list() {
    return this.withDb(async (db) => {
      const products = await this.products.find({ where: { siteId: this.sites.getCurrentSiteId() } });
      const columns = new Set(queryPbootRows<{ name: string }>(db, 'pragma table_info(ay_content_ext)').map((row) => row.name.toLowerCase()));
      const native = this.nativeFields(db);
      const fields = this.definitionsFor(db).map((field) => {
        const localUsed = products.filter((product) => productFieldValue(product.sharedParameters, field).trim()).length;
        const pbUsed = columns.has(field.name.toLowerCase()) ? Number(queryPbootRows<{ total: number }>(db,
          `select count(*) as total from ay_content_ext where trim(coalesce("${field.name}",''))<>''`)[0]?.total || 0) : 0;
        return { ...field, localUsed, pbUsed, locked: protectedProductField(field),
          pbootExists: columns.has(field.name.toLowerCase()) && native.some((row) => row.name.toLowerCase() === field.name.toLowerCase()) };
      });
      return { siteId: this.sites.getCurrentSiteId(), siteName: this.sites.getCurrentSite().name, fields };
    });
  }

  private validate(dto: SaveProductFieldDto, previous?: ProductFieldDefinition): ProductFieldDefinition {
    const name = previous?.name || dto.name || `ext_param_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    if (!validProductFieldName(name) || (previous && dto.name && dto.name !== previous.name)) throw new BadRequestException('已有字段名不能修改。');
    const label = String(dto.label || '').trim();
    if (!label || label.length > 60 || String(dto.unit || '').length > 20) throw new BadRequestException('请填写有效的字段名称与单位。');
    const field = { ...previous, name, label, unit: previous?.key ? previous.unit : String(dto.unit || '').trim(),
      sort: dto.sort ?? previous?.sort ?? 100, enabled: dto.enabled ?? previous?.enabled ?? true, type: previous?.type ?? 1 };
    if (protectedProductField(field)) throw new BadRequestException('该字段由原有功能管理，不能作为产品参数修改。');
    if (!Number.isInteger(field.sort) || field.sort < 0 || field.sort > 9999 || typeof field.enabled !== 'boolean') throw new BadRequestException('字段排序或启用状态无效。');
    return field;
  }

  async create(dto: SaveProductFieldDto) {
    await this.withDb((db) => {
      const fields = this.definitionsFor(db);
      const field = this.validate(dto);
      if (fields.length >= 100) throw new BadRequestException('每个站点最多管理 100 个产品字段。');
      if (fields.some((item) => item.name.toLowerCase() === field.name.toLowerCase()) || this.nativeFields(db).some((item) => item.name.toLowerCase() === field.name.toLowerCase())) throw new BadRequestException('字段名已经存在，请编辑已有字段。');
      if (fields.some((item) => item.label === field.label)) throw new BadRequestException('字段名称已存在。');
      this.writeConfig([...fields, field], this.readConfig().removed.filter((name) => name !== field.name));
    });
    return this.list();
  }

  async update(name: string, dto: SaveProductFieldDto) {
    await this.withDb((db) => {
      const fields = this.definitionsFor(db);
      const previous = fields.find((field) => field.name === name);
      if (!previous) throw new NotFoundException('当前站点不存在这个字段。');
      const updated = this.validate(dto, previous);
      if (fields.some((item) => item.name !== name && item.label === updated.label)) throw new BadRequestException('字段名称已存在。');
      this.writeConfig(fields.map((field) => field.name === name ? updated : field));
    });
    return this.list();
  }

  async remove(name: string) {
    const list = await this.list();
    const field = list.fields.find((item) => item.name === name);
    if (!field) throw new NotFoundException('当前站点不存在这个字段。');
    if (field.key || field.locked) throw new BadRequestException('基础字段不能删除，可停用非保护字段。');
    if (field.localUsed || field.pbUsed) throw new BadRequestException('该字段已有产品数据，请改为停用。');
    await this.withDb((db) => this.writeConfig(this.definitionsFor(db).filter((item) => item.name !== name), [...this.readConfig().removed, name]));
    return this.list();
  }

  async importFromPboot() {
    await this.withDb((db) => this.writeConfig(this.definitionsFor(db)));
    return this.list();
  }

  async getImportDefinitions() {
    return this.withDb((db) => this.definitionsFor(db));
  }

  async prepareFolderParameters(parameters: FolderParameters) {
    return this.withDb((db) => {
      const fields = this.definitionsFor(db);
      const { mappings, errors } = mapFolderParameters(parameters, fields);
      if (errors.length) throw new BadRequestException(errors.join('；'));
      const created = mappings.filter((item) => item.create);
      for (const item of created) {
        if (this.nativeFields(db).some((field) => field.name.toLowerCase() === item.fieldName.toLowerCase()) || this.readConfig().removed.includes(item.fieldName)) {
          throw new BadRequestException(`${item.label}的字段已存在或被移除，请先在产品字段管理中处理`);
        }
        if (['depthM', 'coreCapacity', 'diameterMm'].includes(item.key)) throw new BadRequestException(`${item.label}基础字段已移除，请先恢复`);
        fields.push(this.validate({ name: item.fieldName, label: item.fieldLabel, unit: item.unit, sort: 110, enabled: true }));
      }
      if (fields.length > 100) throw new BadRequestException('产品字段数量超过 100 项');
      if (created.length) this.writeConfig(fields);
      return folderSharedParameters(parameters, mappings);
    });
  }

  parameterRows(value: ProductSharedParameters | null, language: string) {
    const rows = sharedParameterRows(value, language);
    if (!value) return rows;
    for (const field of this.readConfig().fields.filter((item) => !item.key && item.enabled && !protectedProductField(item))) {
      if (!Object.prototype.hasOwnProperty.call(value.fieldValues || {}, field.name)) continue;
      const legacy = value.custom?.find((item) => item.fieldName === field.name);
      if (legacy) {
        const index = rows.findIndex((row) => row.name === legacy.name || row.name === legacy.nameEn);
        if (index >= 0) rows.splice(index, 1);
      }
      const entry = productFieldValue(value, field);
      if (entry !== '') rows.push({ name: field.label, value: entry, unit: field.unit });
    }
    return rows;
  }

  writeProductValues(db: any, value: ProductSharedParameters) {
    const fields = this.definitionsFor(db).filter((field) => field.enabled && !protectedProductField(field));
    ensurePbootFieldDefinitions(db, Object.fromEntries(fields.map((field) => [field.name, field.label])));
    return Object.fromEntries(fields.map((field) => [field.name, productFieldValue(value, field)]));
  }

  async syncToPboot() {
    const database = this.dbPath();
    const SQL = await initSqlJs();
    const original = fs.readFileSync(database);
    const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
    const originalHash = hash(original);
    const db = new SQL.Database(Uint8Array.from(original));
    try {
      const fields = this.definitionsFor(db).filter((field) => field.enabled && !protectedProductField(field));
      ensurePbootFieldDefinitions(db, Object.fromEntries(fields.map((field) => [field.name, field.label])));
      for (const field of fields) db.run('update ay_extfield set description=?,sorting=? where name=? and mcode=?', [field.label, field.sort, field.name, '3']);
      if (db.exec('pragma integrity_check')[0]?.values[0]?.[0] !== 'ok') throw new BadRequestException('网站数据库检查失败，未写入。');
      if (hash(fs.readFileSync(database)) !== originalHash) throw new BadRequestException('网站数据刚刚发生变化，请重试。');
      const backupPath = path.join(this.sites.getCurrentSiteStorageDir('backups'), `before-product-fields-${Date.now()}-${randomUUID()}.db`);
      fs.writeFileSync(backupPath, original);
      const temporary = `${database}.fields-${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, Buffer.from(db.export()));
        if (hash(fs.readFileSync(database)) !== originalHash) throw new BadRequestException('网站数据刚刚发生变化，请重试。');
        fs.renameSync(temporary, database);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      return { synced: fields.length, backupPath, siteId: this.sites.getCurrentSiteId() };
    } finally { db.close(); }
  }
}
