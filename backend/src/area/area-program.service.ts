import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SitesService } from '../sites/sites.service';

const repair = require(path.resolve(__dirname, '../../../tools/pboot-domain-repair.js'));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class AreaProgramService {
  private readonly busy = new Set<number>();
  constructor(private readonly sites: SitesService) {}

  private inspect(siteId: number) {
    const site = this.sites.getCurrentSite();
    if (process.env.APP_ENVIRONMENT !== 'local' || site.environment !== 'phpstudy') throw new BadRequestException('只能在本地项目修复 phpStudy 网站');
    if (!siteId || site.id !== siteId) throw new BadRequestException('当前网站已切换，请重新打开修复窗口');
    const local = repair.readLocal(site.rootPath);
    const configPath = path.join(this.sites.getCurrentSiteStorageDir('ftp'), 'ftp.config.json');
    let config: any = null;
    if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const canSync = Boolean(config?.host && config?.user && config?.password && config?.secure);
    const revision = hash({ siteId, root: site.rootPath, hash: local.hash, config });
    return { site, local, config, response: { siteId, siteName: site.name, revision,
      file: repair.FILE, localPath: local.file, needsRepair: local.changed, canSync,
      target: canSync ? `${config.host}:${config.port || 21} /${String(config.remoteRoot || '').replace(/^\/+/, '')}` : '',
    } };
  }

  preview(siteId: number) {
    try { return this.inspect(siteId).response; }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '无法读取本地 PB 程序'); }
  }

  async apply(dto: { siteId: number; revision: string; syncRemote: boolean }) {
    if (this.busy.has(dto.siteId)) throw new ConflictException('当前网站的程序修复正在执行，请等待结果');
    this.busy.add(dto.siteId);
    try {
      const context = this.inspect(dto.siteId);
      if (context.response.revision !== dto.revision) throw new ConflictException('程序或连接配置已变化，请重新打开修复窗口');
      if (dto.syncRemote && !context.response.canSync) throw new BadRequestException('请先在网站发布中保存当前网站的 FTPS 加密连接');
      const local = repair.repairLocal(context.site.rootPath, context.local.hash);
      let online: { ok: boolean; changed?: boolean; message: string } | undefined;
      if (dto.syncRemote) {
        try {
          // Patch the online file independently, preserving its unrelated customizations.
          const result = await repair.syncRemote(context.config);
          online = { ok: true, changed: result.changed, message: result.changed ? '线上程序已修复，文件回读校验通过' : '线上程序已包含此修复，回读检查通过，无需重复上传' };
        } catch (error) {
          online = { ok: false, message: `本地已就绪，线上同步未确认完成：${error instanceof Error ? error.message : '请检查连接后重试'}` };
        }
      }
      return { siteId: dto.siteId, localChanged: local.changed, online,
        message: local.changed ? '本地 PB 域名识别已修复' : '本地已包含此修复，无需重复修改',
        file: repair.FILE,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : '程序修复失败');
    } finally { this.busy.delete(dto.siteId); }
  }
}
