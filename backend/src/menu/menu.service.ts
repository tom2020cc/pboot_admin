import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { TranslateMenuDto } from './dto/translate-menu.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Menu } from './entities/menu.entity';
import * as fs from 'fs';
import * as path from 'path';
import { SyncGuardService } from '../common/sync-guard.service';
import { fetchWithAiRetry, formatAiErrorMessage } from '../common/ai-retry';
import { buildTranslationModelCatalog } from '../common/translation-model-catalog';

const initSqlJs = require('sql.js');

const MENU_SOURCE_ACODE = 'cn';
const MENU_TARGET_ACODES = ['en', 'es', 'fr', 'ru', 'ar', 'pt'] as const;

type PbootSortRow = {
  acode: string;
  pcode: string;
  scode: string;
  name: string;
  mcode: string;
  status: string;
  outlink: string;
  ico: string;
  pic: string;
  filename: string;
  sorting: number;
  create_user: string;
};

type PbootMenuSyncAction = 'created' | 'updated';

@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(Menu) private readonly menusRepo: Repository<Menu>,
    private readonly config: ConfigService,
    private readonly syncGuard: SyncGuardService,
  ) {}

  async create(postObj: CreateMenuDto) {
    const menu = await this.menusRepo.create(postObj);
    const resByName = await this.findOneBy(postObj.name);
    if (resByName) {
      throw new NotFoundException('栏目名称重复');
    }
    return await this.menusRepo.save(menu);
  }

  async findAll() {
    return await this.menusRepo.find();
  }

  findTranslationModels() {
    return buildTranslationModelCatalog({
      openai: Boolean(this.getAiProviderKey('openai')),
      zhipu: Boolean(this.getAiProviderKey('zhipu')),
      deepseek: Boolean(this.getAiProviderKey('deepseek')),
      qwen: Boolean(this.getAiProviderKey('qwen')),
    });
  }

  async translateAllFromChinese(postObj: TranslateMenuDto = {}) {
    const modelValue = postObj.model || 'google-free';
    const model = this.findTranslationModels().find((item) => item.value === modelValue);
    if (!model) throw new BadRequestException('不支持该翻译模型');
    if (!model.available) {
      const envName = this.getAiProviderEnvName(model.provider as 'zhipu' | 'openai' | 'deepseek' | 'qwen');
      throw new BadRequestException(`未配置 ${envName}，暂时不能调用该翻译模型`);
    }

    const localBackupPath = this.backupLocalSqljsDatabase('before_menu_translate');
    const menus = await this.menusRepo.find();
    const sourceMenus = menus
      .filter((menu) => this.parsePbootMenuCode(menu.code)?.acode === MENU_SOURCE_ACODE)
      .sort((a, b) => Number(this.parsePbootMenuCode(a.code)?.scode || 0) - Number(this.parsePbootMenuCode(b.code)?.scode || 0));
    if (!sourceMenus.length) throw new BadRequestException('请先从 PbootCMS 获取中文栏目');

    const menuByCode = new Map(menus.map((menu) => [String(menu.code || ''), menu]));
    const scodeOffsets = this.resolveMenuScodeOffsets(menus);
    const results: Array<{ acode: string; translated: number; skipped: number }> = [];

    for (const acode of MENU_TARGET_ACODES) {
      const pairs = sourceMenus
        .map((source) => {
          const sourceKey = this.parsePbootMenuCode(source.code);
          const targetScode = this.resolveTargetScodeFromSource(sourceKey?.scode || '', acode, scodeOffsets);
          const target = menuByCode.get(`pboot:${acode}:${targetScode}`);
          return target ? { source, target } : null;
        })
        .filter(Boolean) as Array<{ source: Menu; target: Menu }>;

      const translatedNames = await this.translateMenuNameList(
        pairs.map((pair) => pair.source.name || ''),
        acode,
        modelValue,
        model.provider,
      );

      let translated = 0;
      for (let index = 0; index < pairs.length; index += 1) {
        const nextName = String(translatedNames[index] || '').trim();
        if (!nextName) continue;
        pairs[index].target.name = nextName;
        await this.menusRepo.save(pairs[index].target);
        translated += 1;
      }

      results.push({ acode, translated, skipped: sourceMenus.length - pairs.length });
    }

    return {
      msg: 'Menu names translated from Chinese',
      model: modelValue,
      source: MENU_SOURCE_ACODE,
      sourceCount: sourceMenus.length,
      localBackupPath,
      note: 'Only menu names are translated. URL names, paths, models, list templates, detail templates and icons are not changed.',
      results,
    };
  }

  private getAiProviderEnvName(provider: 'zhipu' | 'openai' | 'deepseek' | 'qwen') {
    if (provider === 'zhipu') return 'ZHIPU_API_KEY';
    if (provider === 'deepseek') return 'DEEPSEEK_API_KEY';
    if (provider === 'qwen') return 'DASHSCOPE_API_KEY';
    return 'OPENAI_API_KEY';
  }

  private getAiProviderConfigKey(provider: 'zhipu' | 'openai' | 'deepseek' | 'qwen') {
    if (provider === 'zhipu') return 'zhipuApiKey';
    if (provider === 'deepseek') return 'deepseekApiKey';
    if (provider === 'qwen') return 'dashscopeApiKey';
    return 'openaiApiKey';
  }

  private getAiProviderKey(provider: 'zhipu' | 'openai' | 'deepseek' | 'qwen') {
    const configured = String(this.config.get<string>(this.getAiProviderEnvName(provider)) || '').trim();
    if (configured) return configured;

    const candidates = [
      path.resolve(process.cwd(), '../tools/seo_publish_tool/ai.config.json'),
      path.resolve(process.cwd(), 'tools/seo_publish_tool/ai.config.json'),
    ];
    for (const configPath of candidates) {
      try {
        const localConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const key = String(localConfig?.[this.getAiProviderConfigKey(provider)] || '').trim();
        if (key) return key;
      } catch {
        // The menu service can run without the standalone SEO tool config file.
      }
    }
    return '';
  }

  async syncFromPboot() {
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) {
      throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);
    }

    const guard = await this.syncGuard.protectBeforeDangerousSync('menu_import_from_pboot');
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    try {
      const rows = this.queryAll<PbootSortRow>(
        db,
        `select acode,pcode,scode,name,mcode,status,outlink,ico,pic,filename,sorting,create_user
         from ay_content_sort
         order by acode, cast(pcode as integer), sorting, cast(scode as integer), id`,
      ).map((row) => this.normalizePbootSortRow(row));

      const localBackupPath = guard.backupPath;
      const sourceCodes = new Set(rows.map((row) => this.createPbootMenuCode(row)));
      const existingMenus = await this.menusRepo.find();
      const existingPbootMenus = existingMenus.filter((menu) => this.parsePbootMenuCode(menu.code));
      const stalePbootMenus = existingPbootMenus.filter((menu) => !sourceCodes.has(String(menu.code || '')));
      const removed = 0;
      const existingByCode = new Map<string, Menu>(existingPbootMenus.map((menu) => [String(menu.code || ''), menu]));
      const localIdByPbootKey = new Map<string, number>(
        existingPbootMenus.map((menu) => [String(menu.code || ''), Number(menu.id)]),
      );

      const pending = [...rows];
      const synced: Array<{
        acode: string;
        scode: string;
        name: string;
        parentId: number;
        action: PbootMenuSyncAction;
      }> = [];
      let created = 0;
      let updated = 0;

      while (pending.length) {
        let progress = false;

        for (let index = pending.length - 1; index >= 0; index -= 1) {
          const row = pending[index];
          const syncCode = this.createPbootMenuCode(row);
          const parentCode = this.createPbootMenuParentCode(row);
          const parentId = parentCode ? localIdByPbootKey.get(parentCode) : 0;

          if (parentCode && parentId === undefined) continue;

          const result = await this.upsertPbootMenu(row, parentId || 0, existingByCode.get(syncCode));
          created += result.action === 'created' ? 1 : 0;
          updated += result.action === 'updated' ? 1 : 0;
          existingByCode.set(syncCode, result.menu);
          localIdByPbootKey.set(syncCode, Number(result.menu.id));
          synced.push({
            acode: row.acode,
            scode: row.scode,
            name: row.name,
            parentId: Number(result.menu.parentId || 0),
            action: result.action,
          });
          pending.splice(index, 1);
          progress = true;
        }

        if (!progress) {
          for (const row of pending.splice(0)) {
            const syncCode = this.createPbootMenuCode(row);
            const result = await this.upsertPbootMenu(row, 0, existingByCode.get(syncCode));
            created += result.action === 'created' ? 1 : 0;
            updated += result.action === 'updated' ? 1 : 0;
            existingByCode.set(syncCode, result.menu);
            localIdByPbootKey.set(syncCode, Number(result.menu.id));
            synced.push({
              acode: row.acode,
              scode: row.scode,
              name: row.name,
              parentId: 0,
              action: result.action,
            });
          }
        }
      }

      return {
        msg: 'PbootCMS menu sync completed',
        total: synced.length,
        created,
        updated,
        removed,
        stale: stalePbootMenus.length,
        note: 'Menus are now updated by pboot code in place, so existing local IDs used by news/products/pages/videos are preserved.',
        localBackupPath,
        skippedFields: ['mcode', 'listtpl', 'contenttpl', 'gtype', 'gid', 'gnote', 'def1', 'def2', 'def3'],
        synced,
      };
    } finally {
      db.close();
    }
  }

  async repairLocalModelsFromPboot() {
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) {
      throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);
    }

    const localBackupPath = this.backupLocalSqljsDatabase('before_menu_model_repair');
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    try {
      const rows = this.queryAll<Pick<PbootSortRow, 'acode' | 'scode' | 'name' | 'mcode'>>(
        db,
        `select acode,scode,name,mcode
         from ay_content_sort
         order by acode, cast(scode as integer), id`,
      );
      const repaired: Array<{ code: string; name: string; before: string; after: string }> = [];
      let missing = 0;
      let unchanged = 0;

      for (const raw of rows) {
        const acode = String(raw.acode || '').trim();
        const scode = String(raw.scode || '').trim();
        if (!acode || !scode) continue;

        const code = `pboot:${acode}:${scode}`;
        const menu = await this.menusRepo.findOne({ where: { code } });
        if (!menu) {
          missing += 1;
          continue;
        }

        const before = String(menu.model || '').trim();
        const after = String(raw.mcode || '').trim();
        if (before === after) {
          unchanged += 1;
          continue;
        }

        menu.model = after;
        await this.menusRepo.save(menu);
        repaired.push({ code, name: menu.name || String(raw.name || ''), before, after });
      }

      return {
        msg: 'Local menu models repaired from PbootCMS',
        localBackupPath,
        scanned: rows.length,
        repaired: repaired.length,
        missing,
        unchanged,
        repairedItems: repaired.slice(0, 30),
      };
    } finally {
      db.close();
    }
  }

  async syncOneToPboot(id: string) {
    const menu = await this.findOneById(id);
    const pbootKey = this.parsePbootMenuCode(menu.code);
    if (!pbootKey) {
      throw new BadRequestException('只有从 PbootCMS 同步过来的栏目才能写回网站数据库');
    }

    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) {
      throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);
    }

    await this.syncGuard.protectBeforeDangerousSync('menu_push_one', 'menu');
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const backupPath = this.backupPbootDatabase(dbPath);

    try {
      const existing = this.queryOne<{ id: number }>(
        db,
        'select id from ay_content_sort where acode=? and scode=? limit 1',
        [pbootKey.acode, pbootKey.scode],
      );
      if (!existing) {
        throw new NotFoundException(`网站数据库里没有找到栏目 ${menu.code}`);
      }

      const parentPcode = await this.resolvePbootParentScode(menu, pbootKey.acode);
      const href = String(menu.href || '').trim();
      const isExternal = /^https?:\/\//i.test(href);
      const filename = isExternal ? String(menu.urlName || '').trim() : this.hrefToFilename(href || menu.urlName || '');
      const icon = this.normalizeIconValue(menu.icon);
      const now = this.formatPbootDate(new Date());
      this.writeMenuToPboot(db, menu, pbootKey, { parentPcode, isExternal, filename, icon, now });
      fs.writeFileSync(dbPath, Buffer.from(db.export()));
      this.clearPbootCache();

      return {
        msg: 'PbootCMS menu updated',
        backupPath,
        acode: pbootKey.acode,
        scode: pbootKey.scode,
        name: menu.name || pbootKey.scode,
        skippedFields: ['mcode', 'listtpl', 'contenttpl', 'gtype', 'gid', 'gnote', 'def1', 'def2', 'def3'],
      };
    } finally {
      db.close();
    }
  }

  async syncAllToPboot() {
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) {
      throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);
    }

    await this.syncGuard.protectBeforeDangerousSync('menu_push_all', 'menu');
    const menus = await this.menusRepo.find();
    const pbootMenus = menus.filter((menu) => this.parsePbootMenuCode(menu.code));
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const backupPath = this.backupPbootDatabase(dbPath, 'before_menu_push_all');

    try {
      let updated = 0;
      let skipped = 0;
      const now = this.formatPbootDate(new Date());

      for (const menu of pbootMenus) {
        const pbootKey = this.parsePbootMenuCode(menu.code);
        if (!pbootKey) {
          skipped += 1;
          continue;
        }
        const existing = this.queryOne<{ id: number }>(
          db,
          'select id from ay_content_sort where acode=? and scode=? limit 1',
          [pbootKey.acode, pbootKey.scode],
        );
        if (!existing) {
          skipped += 1;
          continue;
        }

        const parentPcode = await this.resolvePbootParentScode(menu, pbootKey.acode);
        const href = String(menu.href || '').trim();
        const isExternal = /^https?:\/\//i.test(href);
        const filename = isExternal ? String(menu.urlName || '').trim() : this.hrefToFilename(href || menu.urlName || '');
        const icon = this.normalizeIconValue(menu.icon);
        this.writeMenuToPboot(db, menu, pbootKey, { parentPcode, isExternal, filename, icon, now });
        updated += 1;
      }

      fs.writeFileSync(dbPath, Buffer.from(db.export()));
      this.clearPbootCache();
      return {
        msg: 'PbootCMS all menus updated',
        backupPath,
        total: pbootMenus.length,
        updated,
        skipped,
        skippedFields: ['mcode', 'listtpl', 'contenttpl', 'gtype', 'gid', 'gnote', 'def1', 'def2', 'def3'],
      };
    } finally {
      db.close();
    }
  }

  async findOneById(id: string) {
    if (!id) {
      return null;
    }
    const res = await this.menusRepo.findOneBy({ id });
    if (!res) {
      throw new NotFoundException('没有找到该栏目');
    }
    return res;
  }

  async update(id: string, postObj: UpdateMenuDto) {
    const menu = await this.findOneById(id);
    const resByName = postObj.name ? await this.findOneBy(postObj.name) : null;
    if (resByName && String(resByName.id) !== String(id)) {
      throw new NotFoundException('栏目名称重复');
    }
    const newObj = { ...menu, ...postObj };
    return await this.menusRepo.save(newObj);
  }

  async remove(id: string) {
    const menu = await this.findOneById(id);
    const res = await this.menusRepo.remove(menu);
    return { msg: '删除成功', res };
  }

  async findOneBy(name: string) {
    return await this.menusRepo.findOne({ where: { name } });
  }

  private async upsertPbootMenu(row: PbootSortRow, parentId: number, existing?: Menu) {
    const action: PbootMenuSyncAction = existing ? 'updated' : 'created';
    const menu = this.menusRepo.create({
      ...(existing || {}),
      name: row.name || row.scode,
      parentId,
      publisher: row.create_user || 'pboot',
      href: this.resolvePbootHref(row),
      code: this.createPbootMenuCode(row),
      urlName: row.filename || row.scode,
      model: row.mcode || '',
      listTemplate: '',
      detailTemplate: '',
      icon: this.resolvePbootIcons(row),
      show: String(row.status) !== '0',
      orderNum: Number(row.sorting || 0),
    });

    return { action, menu: await this.menusRepo.save(menu) };
  }

  private normalizePbootSortRow(row: PbootSortRow): PbootSortRow {
    return {
      ...row,
      acode: String(row.acode || '').trim(),
      pcode: String(row.pcode || '0').trim(),
      scode: String(row.scode || '').trim(),
      name: String(row.name || '').trim(),
      mcode: String(row.mcode || '').trim(),
      status: String(row.status ?? '1').trim(),
      outlink: String(row.outlink || '').trim(),
      ico: String(row.ico || '').trim(),
      pic: String(row.pic || '').trim(),
      filename: String(row.filename || '').trim(),
      sorting: Number(row.sorting || 0),
      create_user: String(row.create_user || '').trim(),
    };
  }

  private createPbootMenuCode(row: Pick<PbootSortRow, 'acode' | 'scode'>) {
    return `pboot:${row.acode}:${row.scode}`;
  }

  private createPbootMenuParentCode(row: Pick<PbootSortRow, 'acode' | 'pcode'>) {
    const pcode = String(row.pcode || '0');
    if (!pcode || pcode === '0') return '';
    return `pboot:${row.acode}:${pcode}`;
  }

  private parsePbootMenuCode(code: string) {
    const match = String(code || '').match(/^pboot:([^:]+):(.+)$/);
    if (!match) return null;
    return { acode: match[1], scode: match[2] };
  }

  private async resolvePbootParentScode(menu: Menu, acode: string) {
    if (!menu.parentId || Number(menu.parentId) === 0) return '0';
    const parent = await this.menusRepo.findOneBy({ id: String(menu.parentId) });
    const parentKey = this.parsePbootMenuCode(parent?.code || '');
    if (!parentKey || parentKey.acode !== acode) return '0';
    return parentKey.scode || '0';
  }

  private writeMenuToPboot(
    db: any,
    menu: Menu,
    pbootKey: { acode: string; scode: string },
    options: { parentPcode: string; isExternal: boolean; filename: string; icon: string; now: string },
  ) {
    const fields = ['name', 'pcode', 'status', 'outlink', 'ico', 'pic', 'filename', 'sorting', 'update_user', 'update_time'] as const;
    const values: Record<(typeof fields)[number], string | number> = {
      name: menu.name || pbootKey.scode,
      pcode: options.parentPcode,
      status: menu.show ? '1' : '0',
      outlink: options.isExternal ? String(menu.href || '').trim() : '',
      ico: options.icon,
      pic: options.icon,
      filename: options.filename,
      sorting: Number(menu.orderNum || 0),
      update_user: 'admin',
      update_time: options.now,
    };

    this.runSql(
      db,
      `update ay_content_sort set ${fields.map((field) => `${field}=?`).join(',')} where acode=? and scode=?`,
      [...fields.map((field) => values[field]), pbootKey.acode, pbootKey.scode],
    );
  }

  private hrefToFilename(value: string) {
    return String(value || '').replace(/^\/+/, '').trim();
  }

  private normalizeIconValue(value: string[] | string) {
    const rows = Array.isArray(value) ? value : String(value || '').split(',');
    return rows
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(',');
  }

  private resolvePbootHref(row: PbootSortRow) {
    if (row.outlink) return row.outlink;
    if (row.filename) return `/${row.filename.replace(/^\/+/, '')}`;
    return `/${row.acode}/${row.scode}`;
  }

  private resolvePbootIcons(row: PbootSortRow) {
    const raw = row.ico || row.pic || '';
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private resolveMenuScodeOffsets(menus: Menu[]) {
    const rootByAcode = new Map<string, number>();
    for (const menu of menus) {
      const key = this.parsePbootMenuCode(menu.code);
      if (!key || Number(menu.parentId || 0) !== 0) continue;
      const scode = Number(key.scode);
      if (!Number.isFinite(scode)) continue;
      const current = rootByAcode.get(key.acode);
      if (current === undefined || scode < current) rootByAcode.set(key.acode, scode);
    }

    const sourceRoot = rootByAcode.get(MENU_SOURCE_ACODE) || 0;
    return Object.fromEntries(MENU_TARGET_ACODES.map((acode) => [acode, (rootByAcode.get(acode) || sourceRoot) - sourceRoot]));
  }

  private resolveTargetScodeFromSource(sourceScode: string, acode: string, offsets: Record<string, number>) {
    const numeric = Number(sourceScode);
    if (!Number.isFinite(numeric)) return sourceScode;
    return String(numeric + (offsets[acode] || 0));
  }

  private async translateMenuNameList(names: string[], targetAcode: string, model: string, provider: string) {
    if (!names.length) return [];
    if (provider === 'google') {
      try {
        return await this.translateListWithGoogle(names, targetAcode);
      } catch {
        return await this.translateListWithMyMemory(names, targetAcode);
      }
    }
    if (provider === 'mymemory') return await this.translateListWithMyMemory(names, targetAcode);
    if (provider === 'zhipu') return await this.translateListWithZhipu(names, targetAcode, model);
    if (provider === 'deepseek') return await this.translateListWithDeepSeek(names, targetAcode, model);
    if (provider === 'qwen' && model === 'qwen-mt-lite') return await this.translateListWithQwenMtLite(names, targetAcode);
    if (provider === 'qwen') return await this.translateListWithQwen(names, targetAcode, model);
    return await this.translateListWithOpenAI(names, targetAcode, model);
  }

  private async translateListWithGoogle(names: string[], targetAcode: string) {
    const marker = '\n';
    const text = names.join(marker);
    const translated = await this.googleTranslateText(text, targetAcode);
    const rows = translated.split(/\r?\n/).map((item) => item.trim());
    if (rows.length === names.length) return rows;

    const fallback: string[] = [];
    for (const name of names) {
      fallback.push(await this.googleTranslateText(name, targetAcode));
    }
    return fallback;
  }

  private async translateListWithMyMemory(names: string[], targetAcode: string) {
    const rows: string[] = [];
    for (const name of names) {
      rows.push(await this.myMemoryTranslateText(name, targetAcode));
    }
    return rows;
  }

  private async translateListWithZhipu(names: string[], targetAcode: string, model: string) {
    const apiKey = this.getAiProviderKey('zhipu');
    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: this.buildMenuTranslationPrompt(names, targetAcode) }],
            temperature: 0.2,
          }),
        },
        { attempts: 4, baseDelayMs: 8000, maxDelayMs: 45000 },
      );
    } catch (error) {
      throw new BadRequestException(`Zhipu menu translation failed after retries: ${formatAiErrorMessage(error)}`);
    }
    if (!response.ok) throw new BadRequestException(`Zhipu menu translation failed: ${(await response.text()).slice(0, 500)}`);
    const data = await response.json();
    return this.parseStringArray(data?.choices?.[0]?.message?.content || '', names);
  }

  private async translateListWithDeepSeek(names: string[], targetAcode: string, model: string) {
    const apiKey = this.getAiProviderKey('deepseek');
    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://api.deepseek.com/chat/completions',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: this.buildMenuTranslationPrompt(names, targetAcode) }],
            temperature: 0.2,
          }),
        },
        { attempts: 4, baseDelayMs: 8000, maxDelayMs: 45000 },
      );
    } catch (error) {
      throw new BadRequestException(`DeepSeek menu translation failed after retries: ${formatAiErrorMessage(error)}`);
    }
    if (!response.ok) throw new BadRequestException(`DeepSeek menu translation failed: ${(await response.text()).slice(0, 500)}`);
    const data = await response.json();
    return this.parseStringArray(data?.choices?.[0]?.message?.content || '', names);
  }

  private async translateListWithQwen(names: string[], targetAcode: string, model: string) {
    const apiKey = this.getAiProviderKey('qwen');
    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: this.buildMenuTranslationPrompt(names, targetAcode) }],
            temperature: 0.2,
            enable_thinking: false,
          }),
        },
        { attempts: 4, baseDelayMs: 8000, maxDelayMs: 45000 },
      );
    } catch (error) {
      throw new BadRequestException(`Qwen menu translation failed after retries: ${formatAiErrorMessage(error)}`);
    }
    if (!response.ok) throw new BadRequestException(`Qwen menu translation failed: ${(await response.text()).slice(0, 500)}`);
    const data = await response.json();
    return this.parseStringArray(data?.choices?.[0]?.message?.content || '', names);
  }

  private async translateListWithOpenAI(names: string[], targetAcode: string, model: string) {
    const apiKey = this.getAiProviderKey('openai');
    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: this.buildMenuTranslationPrompt(names, targetAcode) }],
            temperature: 0.2,
          }),
        },
        { attempts: 4, baseDelayMs: 8000, maxDelayMs: 45000 },
      );
    } catch (error) {
      throw new BadRequestException(`OpenAI menu translation failed after retries: ${formatAiErrorMessage(error)}`);
    }
    if (!response.ok) throw new BadRequestException(`OpenAI menu translation failed: ${(await response.text()).slice(0, 500)}`);
    const data = await response.json();
    return this.parseStringArray(data?.choices?.[0]?.message?.content || '', names);
  }

  private async translateListWithQwenMtLite(names: string[], targetAcode: string) {
    const translated: string[] = [];
    for (const name of names) {
      translated.push(await this.qwenMtTranslateText(name, targetAcode));
    }
    return translated;
  }

  private async qwenMtTranslateText(text: string, targetAcode: string) {
    if (!text?.trim()) return '';
    const apiKey = this.getAiProviderKey('qwen');
    let response: Response;
    try {
      response = await fetchWithAiRetry(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen-mt-lite',
            messages: [{ role: 'user', content: text }],
            translation_options: {
              source_lang: 'Chinese',
              target_lang: this.getTargetLanguageName(targetAcode),
              domains: 'Construction machinery website navigation. Keep brand names and model numbers unchanged.',
            },
          }),
        },
        { attempts: 4, baseDelayMs: 5000, maxDelayMs: 30000 },
      );
    } catch (error) {
      throw new BadRequestException(`Qwen MT menu translation failed after retries: ${formatAiErrorMessage(error)}`);
    }
    if (!response.ok) throw new BadRequestException(`Qwen MT menu translation failed: ${(await response.text()).slice(0, 500)}`);
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || '').trim();
  }

  private buildMenuTranslationPrompt(names: string[], targetAcode: string) {
    return [
      `Translate these PbootCMS menu names from Chinese to ${this.getTargetLanguageName(targetAcode)}.`,
      'Keep brand names, model numbers, product names like SD32, SH220, SL24 unchanged.',
      'Return only a JSON string array with the same length and same order. Do not translate URL slugs.',
      JSON.stringify(names),
    ].join('\n');
  }

  private parseStringArray(rawText: string, fallback: string[]) {
    const cleaned = String(rawText || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length === fallback.length) {
        return parsed.map((item) => String(item || '').trim());
      }
    } catch {}
    return fallback;
  }

  private async googleTranslateText(text: string, targetAcode: string) {
    if (!text?.trim()) return '';
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'zh-CN',
      tl: this.getGoogleTargetLang(targetAcode),
      dt: 't',
      q: text,
    });
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) throw new BadRequestException(`Google menu translation failed: ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.[0]) ? data[0].map((item) => item?.[0] || '').join('') : '';
  }

  private async myMemoryTranslateText(text: string, targetAcode: string) {
    if (!text?.trim()) return '';
    const params = new URLSearchParams({
      q: text,
      langpair: `zh-CN|${this.getMyMemoryTargetLang(targetAcode)}`,
    });
    const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) throw new BadRequestException(`MyMemory menu translation failed: ${response.status}`);
    const data = await response.json();
    return data?.responseData?.translatedText || '';
  }

  private getTargetLanguageName(acode: string) {
    const map: Record<string, string> = {
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      ru: 'Russian',
      ar: 'Arabic',
      pt: 'Portuguese',
    };
    return map[acode] || acode;
  }

  private getGoogleTargetLang(acode: string) {
    return acode === 'pt' ? 'pt' : acode;
  }

  private getMyMemoryTargetLang(acode: string) {
    const map: Record<string, string> = { en: 'en-US', pt: 'pt-PT' };
    return map[acode] || acode;
  }

  private getPbootDbPath() {
    const configured = this.config.get<string>('PBOOT_DB_PATH');
    if (!configured) {
      throw new BadRequestException('PbootCMS database is not configured. Run 01-config.cmd first.');
    }
    return configured;
  }

  private backupLocalSqljsDatabase(reason = 'before_menu_full_sync') {
    const configured = this.config.get<string>('DB_SQLJS_LOCATION', 'dev.sqlite');
    if (!configured) return '';

    const dbPath = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
    if (!fs.existsSync(dbPath)) return '';

    const parsed = path.parse(dbPath);
    const backupPath = path.join(parsed.dir, `${parsed.name}.${reason}_${this.formatCompactDate(new Date())}${parsed.ext}`);
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
  }

  private backupPbootDatabase(dbPath: string, reason = 'before_menu_push') {
    const parsed = path.parse(dbPath);
    const backupPath = path.join(parsed.dir, `${parsed.name}.${reason}_${this.formatCompactDate(new Date())}${parsed.ext}`);
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
  }

  private clearPbootCache() {
    const root = path.resolve(
      this.config.get<string>('PBOOT_SITE_ROOT') || path.resolve(process.cwd(), '..', '..'),
    );
    for (const relative of ['runtime/cache', 'runtime/complile']) {
      const dir = path.resolve(root, relative);
      if (!dir.startsWith(root + path.sep) || !fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      }
    }
  }

  private formatPbootDate(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
      date.getMinutes(),
    )}:${pad(date.getSeconds())}`;
  }

  private formatCompactDate(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(
      date.getMinutes(),
    )}${pad(date.getSeconds())}`;
  }

  private queryAll<T>(db: any, sql: string, params: any[] = []) {
    const stmt = db.prepare(sql);
    const rows: T[] = [];

    try {
      stmt.bind(params);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private queryOne<T>(db: any, sql: string, params: any[] = []) {
    return this.queryAll<T>(db, sql, params)[0] || null;
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
