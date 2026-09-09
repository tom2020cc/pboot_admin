import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import initSqlJs from 'sql.js';
import { Menu } from '../menu/entities/menu.entity';
import { SitesService } from './sites.service';
import { inside } from './site-resource-scan';
import { readBoundTemplates, replaceTemplateReferences, templateHash, templatePath, TemplateLanguage } from './template-bindings';
import type { SaveTemplateBindingsDto } from './template-bindings.controller';

interface Target { menuId: number; code: string; slug: string; model: string; }
interface Binding { sourceScode: string; target?: Target; }
interface Group { id: string; label: string; cn?: Binding; en?: Binding; }
interface BindingState { version: 1; siteId: number; groups: Group[]; }
interface PbMenu { acode: string; scode: string; name: string; mcode: string; }
const LANGS = ['cn', 'en'] as const;
const keyOf = (menu: Menu) => /^pboot:(cn|en):(\d+)$/.exec(menu.code || '');
const slugOf = (menu: Menu) => String(menu.urlName || menu.href || '').replace(/^\/+/, '').replace(/^(cn|en)[-_\/]+/i, '').replace(/\/+$/, '').toLowerCase();
const targetOf = (menu: Menu): Target => ({ menuId: Number(menu.id), code: menu.code, slug: slugOf(menu), model: String(menu.model) });

@Injectable()
export class TemplateBindingsService {
  private readonly busy = new Set<number>();
  private readonly previews = new Map<string, { siteId: number; root: string; expires: number; dto: SaveTemplateBindingsDto; signature: string }>();
  constructor(private readonly sites: SitesService, private readonly dataSource: DataSource) {}

  private site() {
    const site = this.sites.getCurrentSite();
    if (!site.id || !site.enabled || !path.isAbsolute(site.rootPath) || !fs.existsSync(site.rootPath)
      || fs.lstatSync(site.rootPath).isSymbolicLink()) throw new BadRequestException('请先选择有效的网站项目目录');
    return { ...site, root: path.resolve(site.rootPath) };
  }
  private async locked<T>(work: () => Promise<T>) {
    const id = this.site().id;
    if (this.busy.has(id)) throw new BadRequestException('当前网站的模板绑定操作正在进行');
    this.busy.add(id);
    try { return await work(); }
    catch (error) { throw new BadRequestException((error as Error).message || '模板绑定操作失败'); }
    finally { this.busy.delete(id); }
  }
  private stateFile() { return path.join(this.sites.getCurrentSiteStorageDir('state'), 'template-bindings.json'); }
  private state(siteId: number) {
    const file = this.stateFile();
    if (!fs.existsSync(file)) return { revision: 'none', groups: [] as Group[], text: null as string | null };
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('绑定配置文件不合法');
    const text = fs.readFileSync(file, 'utf8');
    const state = JSON.parse(text) as BindingState;
    if (state.version !== 1 || state.siteId !== siteId || !Array.isArray(state.groups)) throw new Error('绑定配置与当前网站不一致');
    return { revision: templateHash(text), groups: state.groups, text };
  }
  private writeAtomic(file: string, text: string) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, text, { flag: 'wx', mode: fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600 });
      fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  private async readPb(root: string, dbPath: string) {
    const data = path.join(root, 'data');
    if (!path.isAbsolute(dbPath) || !inside(data, path.resolve(dbPath)) || !fs.existsSync(dbPath)
      || fs.lstatSync(data).isSymbolicLink() || fs.lstatSync(dbPath).isSymbolicLink()
      || !inside(fs.realpathSync(data), fs.realpathSync(dbPath))) throw new Error('PB 数据库必须位于当前网站真实的 data 目录');
    for (const suffix of ['-wal', '-journal']) if (fs.existsSync(dbPath + suffix) && fs.statSync(dbPath + suffix).size) throw new Error('PB 数据库有活动日志，请稍后检查栏目');
    if (fs.statSync(dbPath).size > 256 * 1024 * 1024) throw new Error('PB 数据库过大，无法安全检查栏目');
    const bytes = fs.readFileSync(dbPath);
    const SQL = await initSqlJs(); const db = new SQL.Database(bytes);
    try {
      const rows = db.exec("select acode,scode,name,mcode from ay_content_sort where acode in ('cn','en')")[0]?.values || [];
      return rows.map(row => ({ acode: String(row[0]), scode: String(row[1]), name: String(row[2]), mcode: String(row[3]) }));
    } finally { db.close(); }
  }
  private resolveTarget(target: Target | undefined, menus: Menu[], lang: TemplateLanguage) {
    if (!target) return undefined;
    const sameCode = menus.filter(menu => menu.code === target.code && keyOf(menu)?.[1] === lang);
    if (sameCode.length === 1) return sameCode[0];
    if (sameCode.length > 1) return undefined;
    const sameId = menus.filter(menu => Number(menu.id) === target.menuId && keyOf(menu)?.[1] === lang
      && String(menu.model) === target.model && !!target.slug && slugOf(menu) === target.slug);
    return sameId.length === 1 ? sameId[0] : undefined;
  }
  private async context() {
    const site = this.site();
    const state = this.state(site.id);
    const scan = readBoundTemplates(site.root);
    const menus = (await this.dataSource.getRepository(Menu).find({ where: { siteId: site.id }, order: { orderNum: 'ASC', id: 'ASC' } }))
      .filter(menu => !!keyOf(menu));
    const pb = await this.readPb(site.root, site.dbPath);
    const references = scan.files.flatMap(file => file.references);
    const sourceKeys = new Set(references.map(ref => `${ref.lang}:${ref.scode}`));
    const claimed = new Set<string>();
    const groups: Group[] = [];
    for (const saved of state.groups) {
      const group: Group = { id: saved.id, label: saved.label };
      for (const lang of LANGS) {
        const binding = saved[lang];
        if (!binding) continue;
        const key = `${lang}:${binding.sourceScode}`;
        if (!sourceKeys.has(key)) { scan.warnings.push(`${saved.label} / ${lang} 的原模板编码 ${binding.sourceScode} 已不存在，请重新确认绑定。`); continue; }
        if (claimed.has(key)) throw new Error('保存的模板绑定存在重复来源');
        claimed.add(key); group[lang] = binding;
      }
      if (group.cn || group.en) groups.push(group);
    }
    const uniqueMenu = (lang: string, scode: string) => {
      const matches = menus.filter(menu => menu.code === `pboot:${lang}:${scode}`);
      return matches.length === 1 ? matches[0] : undefined;
    };
    for (const lang of LANGS) {
      const codes = [...new Set(references.filter(ref => ref.lang === lang).map(ref => ref.scode))].sort((a, b) => Number(a) - Number(b));
      for (const scode of codes) {
        if (claimed.has(`${lang}:${scode}`)) continue;
        const menu = uniqueMenu(lang, scode);
        const group: Group = { id: `${lang}:${scode}`, label: menu?.name || pb.find(item => item.acode === lang && item.scode === scode)?.name || `${lang} 栏目 ${scode}`,
          [lang]: { sourceScode: scode, target: menu ? targetOf(menu) : undefined } };
        while (groups.some(item => item.id === group.id)) group.id += ':new';
        claimed.add(`${lang}:${scode}`);
        if (lang === 'cn' && menu && slugOf(menu)) {
          const counterparts = menus.filter(item => keyOf(item)?.[1] === 'en' && String(item.model) === String(menu.model) && slugOf(item) === slugOf(menu));
          if (counterparts.length === 1) {
            const english = counterparts[0]; const englishCode = keyOf(english)![2];
            if (sourceKeys.has(`en:${englishCode}`) && !claimed.has(`en:${englishCode}`)) {
              group.en = { sourceScode: englishCode, target: targetOf(english) }; claimed.add(`en:${englishCode}`);
            }
          }
        }
        groups.push(group);
      }
    }
    return { site, state, scan, menus, pb, references, groups };
  }
  async list() { return this.locked(async () => this.view(await this.context())); }
  private view(context: Awaited<ReturnType<TemplateBindingsService['context']>>) {
    const { site, state, scan, menus, pb, references, groups } = context;
    const bindingView = (group: Group, lang: TemplateLanguage) => {
      const binding = group[lang]; if (!binding) return null;
      const target = this.resolveTarget(binding.target, menus, lang);
      const targetCode = target ? keyOf(target)![2] : null;
      const pbMatches = pb.filter(row => row.acode === lang && row.scode === targetCode);
      return { sourceScode: binding.sourceScode, menuId: target ? Number(target.id) : null, targetScode: targetCode,
        issue: binding.target && !target ? '原绑定栏目已变更或不唯一，请重新选择' : target && (pbMatches.length !== 1 || pbMatches[0].mcode !== String(target.model)) ? 'PB 栏目不存在、重复或模型不一致，请先同步栏目' : '',
        references: references.filter(ref => ref.lang === lang && ref.scode === binding.sourceScode).map(({ start, end, ...ref }) => ref) };
    };
    return { siteId: site.id, siteName: site.name, revision: state.revision, templateVersion: scan.templateVersion,
      fileCount: scan.files.length, warnings: scan.warnings,
      groups: groups.map(group => ({ id: group.id, label: group.label, cn: bindingView(group, 'cn'), en: bindingView(group, 'en') })),
      menus: menus.map(menu => ({ id: Number(menu.id), name: menu.name, parentId: menu.parentId, lang: keyOf(menu)![1], scode: keyOf(menu)![2], model: menu.model })) };
  }
  private async plan(dto: SaveTemplateBindingsDto, requirePb: boolean) {
    const context = await this.context();
    if (dto.revision !== context.state.revision || dto.templateVersion !== context.scan.templateVersion) throw new Error('绑定配置或模板已变化，请重新读取后预览');
    if (dto.bindings.length !== context.groups.length || new Set(dto.bindings.map(row => row.id)).size !== dto.bindings.length) throw new Error('绑定行不完整或重复，请重新读取');
    const replacements = new Map<string, string>();
    const targets = new Set<string>();
    const groups = context.groups.map(original => {
      const row = dto.bindings.find(item => item.id === original.id);
      if (!row) throw new Error('绑定行与当前模板不一致');
      const group: Group = { id: original.id, label: original.label };
      for (const lang of LANGS) {
        const binding = original[lang]; const menuId = row[lang === 'cn' ? 'cnMenuId' : 'enMenuId'];
        if (!binding) { if (menuId) throw new Error('该语言没有对应模板位置'); continue; }
        const menu = menuId ? context.menus.find(item => Number(item.id) === menuId) : undefined;
        if (menuId && (!menu || keyOf(menu)?.[1] !== lang)) throw new Error('只能绑定当前网站、当前语言的栏目');
        const scode = menu ? keyOf(menu)![2] : binding.sourceScode;
        if (targets.has(`${lang}:${scode}`)) throw new Error(`多个模板位置将合并为 ${lang} 栏目 ${scode}，请分别选择，避免丢失绑定关系`);
        targets.add(`${lang}:${scode}`);
        if (menu && requirePb) {
          const matches = context.pb.filter(item => item.acode === lang && item.scode === scode);
          if (matches.length !== 1 || matches[0].mcode !== String(menu.model)) throw new Error(`${group.label} / ${lang}：PB 栏目缺失、重复或模型不一致，请先同步栏目`);
        }
        group[lang] = { sourceScode: binding.sourceScode, target: menu ? targetOf(menu) : undefined };
        if (menu) replacements.set(`${lang}:${binding.sourceScode}`, scode);
      }
      return group;
    });
    const files = context.scan.files.map(file => ({ ...file, ...replaceTemplateReferences(file, replacements) })).filter(file => file.changes.length);
    const signature = templateHash(JSON.stringify({ revision: context.state.revision, templateVersion: context.scan.templateVersion, groups, files: files.map(f => [f.file, templateHash(f.text)]) }));
    return { ...context, groups, files, replacements, signature };
  }
  async save(dto: SaveTemplateBindingsDto) {
    return this.locked(async () => {
      const plan = await this.plan(dto, false);
      this.writeAtomic(this.stateFile(), JSON.stringify({ version: 1, siteId: plan.site.id, groups: plan.groups }, null, 2));
      return this.view(await this.context());
    });
  }
  async preview(dto: SaveTemplateBindingsDto) {
    return this.locked(async () => {
      const plan = await this.plan(dto, true);
      for (const [key, value] of this.previews) if (value.siteId === plan.site.id || value.expires < Date.now()) this.previews.delete(key);
      const id = randomUUID();
      this.previews.set(id, { siteId: plan.site.id, root: plan.site.root, expires: Date.now() + 600000, dto, signature: plan.signature });
      return { previewId: id, siteName: plan.site.name, changedFiles: plan.files.length, changedReferences: plan.files.reduce((sum, file) => sum + file.changes.length, 0),
        files: plan.files.map(file => ({ file: file.file, changes: file.changes.map(({ start, end, ...change }) => change) })) };
    });
  }
  async apply(previewId: string) {
    return this.locked(async () => {
      const site = this.site(); const preview = this.previews.get(previewId);
      if (!preview || preview.siteId !== site.id || preview.root !== site.root || preview.expires < Date.now()) throw new Error('预览已过期或网站已切换，请重新预览');
      const plan = await this.plan(preview.dto, true);
      if (plan.signature !== preview.signature) throw new Error('栏目或模板已发生变化，请重新预览');
      this.previews.delete(previewId);
      const originalFiles = new Map(plan.scan.files.map(file => [file.file, file]));
      const updatedGroups = plan.groups.map(group => Object.fromEntries(Object.entries(group).map(([key, value]) => {
        if (!LANGS.includes(key as TemplateLanguage)) return [key, value];
        const binding = value as Binding;
        return [key, { ...binding, sourceScode: plan.replacements.get(`${key}:${binding.sourceScode}`) || binding.sourceScode }];
      })) as unknown as Group);
      const stateText = JSON.stringify({ version: 1, siteId: site.id, groups: updatedGroups }, null, 2);
      if (!plan.files.length) {
        this.writeAtomic(this.stateFile(), stateText);
        return { changedFiles: 0, changedReferences: 0, backupPath: '', message: '栏目编码已一致，已保存绑定' };
      }
      const backupPath = path.join(this.sites.getCurrentSiteStorageDir('backups'), 'template-bindings', randomUUID());
      if (inside(path.join(site.root, 'template'), backupPath)) throw new Error('备份目录不能位于模板目录内');
      fs.mkdirSync(backupPath, { recursive: true, mode: 0o700 });
      const manifest = { siteId: site.id, root: site.root, createdAt: new Date().toISOString(), status: 'prepared',
        bindingsBefore: plan.state.text, bindingsAfter: stateText,
        files: plan.files.map(file => ({ file: file.file, before: file.hash, after: templateHash(file.text) })) };
      for (const file of plan.files) {
        const backup = path.join(backupPath, file.file); fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.writeFileSync(backup, originalFiles.get(file.file)!.text, { flag: 'wx' });
      }
      this.writeAtomic(path.join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
      const written: typeof plan.files = [];
      try {
        if (readBoundTemplates(site.root).templateVersion !== plan.scan.templateVersion || this.state(site.id).revision !== plan.state.revision) throw new Error('模板或配置刚刚发生变化，本次停止');
        for (const file of plan.files) {
          const destination = templatePath(site.root, file.file);
          if (templateHash(fs.readFileSync(destination)) !== file.hash) throw new Error(`模板已变化：${file.file}`);
          this.writeAtomic(destination, file.text); written.push(file);
        }
        this.writeAtomic(this.stateFile(), stateText);
      } catch (error) {
        const recoveryErrors: string[] = [];
        for (const file of written.reverse()) {
          try {
            const destination = templatePath(site.root, file.file);
            if (templateHash(fs.readFileSync(destination)) !== templateHash(file.text)) throw new Error('文件被外部修改，未覆盖');
            this.writeAtomic(destination, originalFiles.get(file.file)!.text);
          } catch { recoveryErrors.push(file.file); }
        }
        manifest.status = recoveryErrors.length ? 'recovery-needed' : 'rolled-back';
        this.writeAtomic(path.join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
        throw new Error(`${(error as Error).message}；已停止更新${recoveryErrors.length ? '，部分文件需人工恢复' : '并回退本次文件修改'}。备份：${backupPath}`);
      }
      manifest.status = 'applied';
      let warning = '';
      try { this.writeAtomic(path.join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2)); }
      catch { warning = '模板已更新，备份清单状态未能更新，请保留备份。'; }
      return { changedFiles: written.length, changedReferences: plan.files.reduce((sum, file) => sum + file.changes.length, 0), backupPath, message: warning || '模板栏目已更新；如网站开启模板缓存，请在 PB 后台清理缓存。' };
    });
  }
}
