import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Menu } from '../menu/entities/menu.entity';
import { SyncGuardService } from '../common/sync-guard.service';
import { UpdatePlaylistDto, UpdateVideoItemDto } from './dto/video.dto';
import { VideoItem } from './entities/video-item.entity';
import { VideoPlaylist } from './entities/video-playlist.entity';

const initSqlJs = require('sql.js');

const DEFAULT_YOUTUBE_CHANNEL_ID = 'UCa10M55g3tNru5VTCqI4hww';
const VIDEO_ROOT_SCODE = '303';

@Injectable()
export class VideoService {
  constructor(
    @InjectRepository(VideoPlaylist) private readonly playlistRepo: Repository<VideoPlaylist>,
    @InjectRepository(VideoItem) private readonly itemRepo: Repository<VideoItem>,
    @InjectRepository(Menu) private readonly menusRepo: Repository<Menu>,
    private readonly config: ConfigService,
    private readonly syncGuard: SyncGuardService,
  ) {}

  /** 拉取油管频道全部播放列表，按 playlistId 增量同步到辅助库 */
  async syncFromYoutube() {
    const apiKey = this.config.get<string>('YOUTUBE_API_KEY');
    if (!apiKey) {
      throw new BadRequestException('未配置 YouTube API Key：请在 backend/.env 里添加 YOUTUBE_API_KEY=你的Key，然后重启后端。');
    }
    const channelId = this.config.get<string>('YOUTUBE_CHANNEL_ID') || DEFAULT_YOUTUBE_CHANNEL_ID;

    const remote: { playlistId: string; title: string; thumbUrl: string; itemCount: number }[] = [];
    let pageToken = '';
    do {
      const data = await this.youtubeApiGet(
        'playlists',
        {
          part: 'snippet,contentDetails',
          channelId,
          maxResults: '50',
          ...(pageToken ? { pageToken } : {}),
        },
        apiKey,
      );
      for (const item of data?.items || []) {
        const playlistId = String(item?.id || '').trim();
        if (!playlistId) continue;
        remote.push({
          playlistId,
          title: String(item?.snippet?.title || '').trim(),
          thumbUrl: this.pickYoutubeThumb(item?.snippet?.thumbnails),
          itemCount: Number(item?.contentDetails?.itemCount || 0),
        });
      }
      pageToken = String(data?.nextPageToken || '');
    } while (pageToken);
    if (!remote.length) throw new BadRequestException('该油管频道没有播放列表，请确认频道 ID。');

    const remoteIds = new Set(remote.map((item) => item.playlistId));
    const existing = await this.playlistRepo.find();
    const existingById = new Map(existing.map((row) => [row.playlistId, row]));
    let maxOrder = existing.reduce((max, row) => Math.max(max, Number(row.orderNum || 0)), 0);

    let created = 0;
    let updated = 0;
    for (const item of remote) {
      const current = existingById.get(item.playlistId);
      if (!current) {
        maxOrder += 1;
        await this.playlistRepo.save(
          this.playlistRepo.create({
            playlistId: item.playlistId,
            title: item.title,
            thumbUrl: item.thumbUrl,
            itemCount: item.itemCount,
            show: true,
            orderNum: maxOrder,
          }),
        );
        created += 1;
      } else if (
        current.title !== item.title ||
        current.thumbUrl !== item.thumbUrl ||
        current.itemCount !== item.itemCount
      ) {
        await this.playlistRepo.save({ ...current, title: item.title, thumbUrl: item.thumbUrl, itemCount: item.itemCount });
        updated += 1;
      }
    }

    const stale = existing.filter((row) => !remoteIds.has(row.playlistId));
    if (stale.length) await this.playlistRepo.remove(stale);

    const items = await this.syncPlaylistItems(remote, apiKey);

    return { msg: '油管播放列表同步完成', total: remote.length, created, updated, removed: stale.length, ...items };
  }

  /** 拉取每个播放列表的视频条目（playlistItems），按 (playlistId, videoId) 增量同步 */
  private async syncPlaylistItems(
    playlists: { playlistId: string }[],
    apiKey: string,
  ): Promise<{ videoTotal: number; videosCreated: number; videosUpdated: number; videosRemoved: number }> {
    const existingItems = await this.itemRepo.find();
    const existingByKey = new Map(existingItems.map((row) => [`${row.playlistId}|${row.videoId}`, row]));
    const remoteKeys = new Set<string>();

    let created = 0;
    let updated = 0;
    for (const playlist of playlists) {
      let pageToken = '';
      do {
        const data = await this.youtubeApiGet(
          'playlistItems',
          {
            part: 'snippet,contentDetails',
            playlistId: playlist.playlistId,
            maxResults: '50',
            ...(pageToken ? { pageToken } : {}),
          },
          apiKey,
        );
        for (const item of data?.items || []) {
          const snippet = item?.snippet || {};
          const rawTitle = String(snippet.title || '').trim();
          if (rawTitle === 'Private video' || rawTitle === 'Deleted video') continue;
          const videoId = String(item?.contentDetails?.videoId || snippet?.resourceId?.videoId || '').trim();
          if (!videoId) continue;

          const key = `${playlist.playlistId}|${videoId}`;
          // 同一播放列表可能重复包含同一视频（油管允许），循环内先按 key 去重避免撞唯一索引
          if (remoteKeys.has(key)) continue;
          remoteKeys.add(key);
          const title = rawTitle.slice(0, 180);
          const coverUrl = this.pickYoutubeThumb(snippet.thumbnails);
          const position = Number(snippet.position || 0);
          const publishedAt = String(snippet.publishedAt || '');

          const current = existingByKey.get(key);
          if (!current) {
            await this.itemRepo.save(
              this.itemRepo.create({ playlistId: playlist.playlistId, videoId, title, coverUrl, position, publishedAt, show: true }),
            );
            created += 1;
          } else if (
            current.title !== title ||
            current.coverUrl !== coverUrl ||
            Number(current.position || 0) !== position ||
            current.publishedAt !== publishedAt
          ) {
            await this.itemRepo.save({ ...current, title, coverUrl, position, publishedAt });
            updated += 1;
          }
        }
        pageToken = String(data?.nextPageToken || '');
      } while (pageToken);
    }

    const staleItems = existingItems.filter((row) => !remoteKeys.has(`${row.playlistId}|${row.videoId}`));
    if (staleItems.length) await this.itemRepo.remove(staleItems);

    return {
      videoTotal: remoteKeys.size,
      videosCreated: created,
      videosUpdated: updated,
      videosRemoved: staleItems.length,
    };
  }

  async findAll() {
    const playlists = await this.playlistRepo.find({ order: { orderNum: 'ASC', id: 'ASC' } });
    const counts = await this.itemRepo
      .createQueryBuilder('item')
      .select('item.playlistId', 'playlistId')
      .addSelect('count(*)', 'total')
      .addSelect('sum(case when item.show = 1 then 1 else 0 end)', 'shown')
      .groupBy('item.playlistId')
      .getRawMany();
    const byPlaylist = new Map(counts.map((row) => [String(row.playlistId), row]));
    return playlists.map((playlist) => ({
      ...playlist,
      videoCount: Number(byPlaylist.get(playlist.playlistId)?.total || 0),
      shownVideoCount: Number(byPlaylist.get(playlist.playlistId)?.shown || 0),
    }));
  }

  async getStats() {
    const all = await this.playlistRepo.find();
    const videos = await this.itemRepo.find();
    return {
      localCount: all.length,
      publishableCount: all.filter((row) => row.show).length,
      shellSortExists: await this.videoShellSortExists(),
      videoCount: videos.length,
      shownVideoCount: videos.filter((row) => row.show).length,
    };
  }

  findItems(playlistId?: string) {
    if (playlistId) {
      return this.itemRepo.find({ where: { playlistId }, order: { position: 'ASC', id: 'ASC' } });
    }
    return this.itemRepo.find({ order: { playlistId: 'ASC', position: 'ASC', id: 'ASC' } });
  }

  async updateItem(id: number, body: UpdateVideoItemDto) {
    const item = await this.itemRepo.findOneBy({ id });
    if (!item) throw new NotFoundException('没有找到该视频');
    return this.itemRepo.save({
      ...item,
      ...(body.position !== undefined ? { position: Number(body.position) } : {}),
      ...(body.show !== undefined ? { show: Boolean(body.show) } : {}),
    });
  }

  async update(id: number, body: UpdatePlaylistDto) {
    const playlist = await this.playlistRepo.findOneBy({ id });
    if (!playlist) throw new NotFoundException('没有找到该播放列表');
    const saved = await this.playlistRepo.save({
      ...playlist,
      ...(body.orderNum !== undefined ? { orderNum: Number(body.orderNum) } : {}),
      ...(body.show !== undefined ? { show: Boolean(body.show) } : {}),
    });
    return saved;
  }

  /**
   * 纯前端「方法三」清单推送：把当前 show=true 的视频（含所属播放列表名）写进站点 static/videos.js，
   * 供模板直接读取渲染，不写 PbootCMS 数据库内容。
   */
  async pushVideoList() {
    const playlists = await this.playlistRepo.find({ where: { show: true }, order: { orderNum: 'ASC', id: 'ASC' } });
    const shownIds = new Set(playlists.map((p) => p.playlistId));
    const titleById = new Map(playlists.map((p) => [p.playlistId, p.title || p.playlistId]));
    const orderById = new Map(playlists.map((p) => [p.playlistId, Number(p.orderNum || 0)]));
    const items = await this.itemRepo.find({ where: { show: true } });

    const videos = items
      .filter((item) => shownIds.has(item.playlistId))
      .map((item) => ({
        title: item.title || item.videoId,
        id: item.videoId,
        playlist: titleById.get(item.playlistId) || '',
        position: Number(item.position || 0),
        playlistOrder: orderById.get(item.playlistId) || 0,
      }))
      .sort((a, b) => a.playlistOrder - b.playlistOrder || a.position - b.position);

    const siteRoot = this.config.get<string>('PBOOT_SITE_ROOT') || path.resolve(process.cwd(), '..', '..');
    const outPath = path.join(siteRoot, 'static', 'videos.js');
    const payload = videos.map(({ title, id, playlist }) => ({ title, id, playlist }));
    // 防标题里出现 </script> 破坏脚本标签
    const json = JSON.stringify(payload).replace(/<\//g, '<\\/');
    const content = `/* 由「视频管理 → 推送视频清单」自动生成，请勿手动编辑 */\nwindow.SHANBO_VIDEOS = ${json};\n`;
    fs.writeFileSync(outPath, content, 'utf8');

    return { msg: '视频清单已推送到网站', count: videos.length, path: outPath.replace(/\\/g, '/') };
  }

  /**
   * 清理 PbootCMS 里的旧视频数据（一次性迁移）：
   * 只保留 cn 的「视频」根栏目（scode 303）作为页面外壳；删除所有播放列表子栏目、视频内容行、扩展行。
   * 同时清理辅助后台 menus 表里残留的播放列表栏目，避免「同步全部栏目到 PbootCMS」把它们再写回 PB。
   * 视频数据本体仍只存在 NestJS dev.sqlite，由「推送视频清单」导出 static/videos.js 供模板渲染。
   */
  async cleanupPboot() {
    const dbPath = this.getPbootDbPath();
    if (!fs.existsSync(dbPath)) throw new BadRequestException(`PbootCMS database not found: ${dbPath}`);

    await this.syncGuard.protectBeforeDangerousSync('video_cleanup_pboot');
    const backupPath = this.backupPbootDatabase(dbPath);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));

    let contentsDeleted = 0;
    let sortsDeleted = 0;
    let shellSortExists = false;
    try {
      // 1) 删除全部 mcode=4 视频内容（扩展行 + 内容行），不限语言
      contentsDeleted = Number(
        this.queryOne(
          db,
          `select count(*) as count from ay_content c
           join ay_content_sort s on s.acode=c.acode and s.scode=c.scode and s.mcode='4'`,
        )?.count || 0,
      );
      this.runSql(
        db,
        `delete from ay_content_ext where contentid in (
           select c.id from ay_content c
           join ay_content_sort s on s.acode=c.acode and s.scode=c.scode and s.mcode='4')`,
      );
      this.runSql(
        db,
        `delete from ay_content where id in (
           select c.id from ay_content c
           join ay_content_sort s on s.acode=c.acode and s.scode=c.scode and s.mcode='4')`,
      );

      // 2) 删除全部 mcode=4 栏目，只保留 cn 根栏目 303
      sortsDeleted = Number(
        this.queryOne(db, `select count(*) as count from ay_content_sort where mcode='4' and not (acode='cn' and scode='${VIDEO_ROOT_SCODE}')`)?.count || 0,
      );
      this.runSql(db, `delete from ay_content_sort where mcode='4' and not (acode='cn' and scode='${VIDEO_ROOT_SCODE}')`);

      shellSortExists = !!this.queryOne(db, `select scode from ay_content_sort where acode='cn' and scode='${VIDEO_ROOT_SCODE}' and mcode='4'`);

      fs.writeFileSync(dbPath, Buffer.from(db.export()));
    } finally {
      db.close();
    }

    // 3) 清理辅助后台 menus 表里残留的播放列表栏目（保留视频根栏目 pboot:cn:303）
    const menusRemoved = await this.menusRepo
      .createQueryBuilder()
      .delete()
      .from(Menu)
      .where("model = '4' and code like 'pboot:%' and code != 'pboot:cn:303'")
      .execute();

    this.clearPbootCache();

    return {
      msg: 'PbootCMS 视频数据已清理，仅保留「视频」根栏目外壳',
      backupPath,
      contentsDeleted,
      sortsDeleted,
      menusRemoved: Number(menusRemoved.affected || 0),
      shellSortExists,
    };
  }

  /** 判断 PB 中「视频」根栏目（cn scode 303）是否存在（页面外壳） */
  private async videoShellSortExists() {
    try {
      const dbPath = this.getPbootDbPath();
      if (!fs.existsSync(dbPath)) return false;
      const SQL = await initSqlJs();
      const db = new SQL.Database(fs.readFileSync(dbPath));
      try {
        return !!this.queryOne(db, `select scode from ay_content_sort where mcode='4' and acode='cn' and scode='${VIDEO_ROOT_SCODE}'`);
      } finally {
        db.close();
      }
    } catch {
      return false;
    }
  }

  private pickYoutubeThumb(thumbnails: any) {
    const pick = (key: string) => String(thumbnails?.[key]?.url || '').trim();
    return pick('maxres') || pick('standard') || pick('high') || pick('medium') || pick('default');
  }

  private async youtubeApiGet(resource: string, params: Record<string, string>, apiKey: string) {
    const query = new URLSearchParams({ ...params, key: apiKey });
    let response: Response;
    try {
      response = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${query.toString()}`, {
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      throw new BadRequestException(`请求 YouTube 接口失败（网络问题）：${(error as Error).message}`);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = data?.error?.message || `HTTP ${response.status}`;
      throw new BadRequestException(`YouTube 接口返回错误：${reason}`);
    }
    return data;
  }

  private queryOne(db: any, sql: string, params: any[] = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      if (!stmt.step()) return null;
      return stmt.getAsObject();
    } finally {
      stmt.free();
    }
  }

  private runSql(db: any, sql: string, params: any[] = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }
  }

  private getPbootDbPath() {
    const configured = this.config.get<string>('PBOOT_DB_PATH');
    if (!configured) {
      throw new BadRequestException('PbootCMS database is not configured. Run 01-config.cmd first.');
    }
    return configured;
  }

  private backupPbootDatabase(dbPath: string) {
    const ext = path.extname(dbPath);
    const target = dbPath.replace(new RegExp(`${ext}$`), `.before_video_cleanup_pboot_${this.timestamp()}${ext}`);
    fs.copyFileSync(dbPath, target);
    return target;
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

  private timestamp() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
}
