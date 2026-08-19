<template>
  <section class="page">
    <div class="page-bar">
      <div>
        <h2>视频管理</h2>
        <p>视频分类 = 油管频道播放列表。点「推送视频清单」把视频写入站点 static/videos.js，模板纯前端渲染（不进数据库）。</p>
      </div>
      <div class="page-actions">
        <el-button type="primary" plain :loading="syncing" @click="handleSync">
          {{ syncing ? "正在同步..." : "同步油管分类" }}
        </el-button>
        <el-button type="success" plain :loading="pushingList" @click="handlePushList">
          {{ pushingList ? "正在推送..." : "推送视频清单" }}
        </el-button>
        <el-button type="warning" plain :loading="cleaning" @click="handleCleanup">
          {{ cleaning ? "正在清理..." : "清理 PB 视频数据" }}
        </el-button>
      </div>
    </div>

    <div class="stats-row">
      <el-tag type="info" effect="plain">本地分类：{{ stats?.localCount ?? playlists.length }} 个</el-tag>
      <el-tag type="success" effect="plain">可发布：{{ stats?.publishableCount ?? "-" }} 个</el-tag>
      <el-tag type="warning" effect="plain">视频外壳栏目：{{ stats?.shellSortExists === false ? "缺失" : stats?.shellSortExists ? "已保留" : "-" }}</el-tag>
      <el-tag type="primary" effect="plain">站内视频：{{ stats?.shownVideoCount ?? "-" }} / {{ stats?.videoCount ?? "-" }} 条</el-tag>
      <el-tag effect="plain">数据来源：YouTube 播放列表</el-tag>
    </div>

    <el-table
      v-loading="loading"
      :data="playlists"
      border
      stripe
      row-key="id"
      class="data-table"
      @expand-change="handleExpand"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="expand-box">
            <div class="expand-toolbar">
              <el-input
                v-model="videoSearch[row.id]"
                placeholder="按标题 / 视频 ID 搜索"
                clearable
                size="small"
                class="expand-search"
              >
                <template #prefix>
                  <el-icon><Search /></el-icon>
                </template>
              </el-input>
              <span class="expand-count">共 {{ (videosByPlaylist[row.id] || []).length }} 条，显示 {{ filteredVideos(row.id).length }} 条</span>
            </div>

            <el-table
              v-loading="expandLoading[row.id]"
              :data="filteredVideos(row.id)"
              size="small"
              border
              :empty-text="expandLoaded[row.id] ? '该分类暂无视频（先点上方「同步油管分类」）' : '正在加载...'"
            >
              <el-table-column prop="videoId" label="视频ID" width="140" align="center" />
              <el-table-column label="封面" width="130">
                <template #default="{ row: video }">
                  <a href="javascript:;" @click="openPreview(video)">
                    <el-image :src="video.coverUrl" fit="cover" class="thumb">
                      <template #error>
                        <div class="thumb thumb-error">无封面</div>
                      </template>
                    </el-image>
                  </a>
                </template>
              </el-table-column>
              <el-table-column prop="title" label="标题（英文原文）" min-width="240" show-overflow-tooltip />
              <el-table-column prop="publishedAt" label="发布时间" width="160" align="center">
                <template #default="{ row: video }">{{ formatTime(video.publishedAt) }}</template>
              </el-table-column>
              <el-table-column label="顺序" width="140" align="center">
                <template #default="{ row: video }">
                  <el-input-number
                    :model-value="video.position"
                    :min="0"
                    :step="1"
                    size="small"
                    controls-position="right"
                    @change="(value: number | undefined) => handleVideoUpdate(row, video, { position: value ?? 0 })"
                  />
                </template>
              </el-table-column>
              <el-table-column label="发布" width="80" align="center">
                <template #default="{ row: video }">
                  <el-switch
                    :model-value="video.show"
                    @change="(value: string | number | boolean) => handleVideoUpdate(row, video, { show: Boolean(value) })"
                  />
                </template>
              </el-table-column>
              <el-table-column label="预览" width="80" align="center">
                <template #default="{ row: video }">
                  <el-button type="primary" link @click="openPreview(video)">预览</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="id" label="ID" width="70" align="center" />
      <el-table-column label="封面" width="140">
        <template #default="{ row }">
          <a :href="`https://www.youtube.com/playlist?list=${row.playlistId}`" target="_blank" rel="noopener">
            <el-image
              :src="row.thumbUrl"
              fit="cover"
              class="thumb"
              :preview-src-list="row.thumbUrl ? [row.thumbUrl] : []"
              preview-teleported
            >
              <template #error>
                <div class="thumb thumb-error">无封面</div>
              </template>
            </el-image>
          </a>
        </template>
      </el-table-column>
      <el-table-column label="播放列表" min-width="280">
        <template #default="{ row }">
          <el-link :href="`https://www.youtube.com/playlist?list=${row.playlistId}`" target="_blank" type="primary">
            {{ row.title || row.playlistId }}
          </el-link>
        </template>
      </el-table-column>
      <el-table-column label="视频数" width="120" align="center">
        <template #default="{ row }">
          {{ row.shownVideoCount ?? 0 }} / {{ row.videoCount ?? row.itemCount }}
        </template>
      </el-table-column>
      <el-table-column label="排序" width="150" align="center">
        <template #default="{ row }">
          <el-input-number
            :model-value="row.orderNum"
            :min="0"
            :step="1"
            size="small"
            controls-position="right"
            @change="(value: number | undefined) => handleUpdate(row, { orderNum: value ?? 0 })"
          />
        </template>
      </el-table-column>
      <el-table-column label="发布" width="80" align="center">
        <template #default="{ row }">
          <el-switch :model-value="row.show" @change="(value: string | number | boolean) => handleUpdate(row, { show: Boolean(value) })" />
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="previewVisible"
      :title="previewTitle"
      width="720px"
      append-to-body
      destroy-on-close
      class="preview-dialog"
    >
      <div v-if="previewVideoId" class="preview-wrap">
        <iframe
          class="preview-iframe"
          :src="embedUrl(previewVideoId, true)"
          title="YouTube video player"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
        ></iframe>
      </div>
      <template #footer>
        <a
          v-if="previewVideoId"
          class="preview-external"
          :href="youtubeWatchUrl(previewVideoId)"
          target="_blank"
          rel="noopener"
        >
          在 YouTube 打开
        </a>
        <el-button @click="previewVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Search } from "@element-plus/icons-vue";
import {
  getPlaylists,
  getPlaylistStats,
  getPlaylistVideos,
  cleanupPboot,
  pushVideoList,
  syncPlaylistsFromYoutube,
  updatePlaylist,
  updateVideoItem,
  type PlaylistStats,
  type VideoItem,
  type VideoPlaylist,
} from "@/api/videos";
import { getErrorMessage } from "@/utils/request";

const loading = ref(false);
const syncing = ref(false);
const cleaning = ref(false);
const pushingList = ref(false);
const playlists = ref<VideoPlaylist[]>([]);
const stats = ref<PlaylistStats | null>(null);

const expandLoading = reactive<Record<number, boolean>>({});
const expandLoaded = reactive<Record<number, boolean>>({});
const videosByPlaylist = reactive<Record<number, VideoItem[]>>({});
const videoSearch = reactive<Record<number, string>>({});

const previewVisible = ref(false);
const previewVideoId = ref("");
const previewTitle = ref("");

const youtubeWatchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;
const embedUrl = (videoId: string, autoplay = false) =>
  `https://www.youtube.com/embed/${videoId}${autoplay ? "?autoplay=1" : ""}`;

const formatTime = (value: string) => {
  if (!value) return "-";
  return value.replace("T", " ").replace(/Z$/, "").slice(0, 16);
};

const filteredVideos = (playlistId: number) => {
  const list = videosByPlaylist[playlistId] || [];
  const keyword = (videoSearch[playlistId] || "").trim().toLowerCase();
  if (!keyword) return list;
  return list.filter(
    (item) =>
      (item.title || "").toLowerCase().includes(keyword) ||
      (item.videoId || "").toLowerCase().includes(keyword),
  );
};

const openPreview = (video: VideoItem) => {
  previewVideoId.value = video.videoId;
  previewTitle.value = video.title || video.videoId;
  previewVisible.value = true;
};

const loadAll = async () => {
  loading.value = true;
  try {
    const [res, statsRes] = await Promise.all([getPlaylists(), getPlaylistStats()]);
    playlists.value = res.data;
    stats.value = statsRes.data;
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取视频分类失败"));
  } finally {
    loading.value = false;
  }
};

const refreshStats = async () => {
  try {
    const res = await getPlaylistStats();
    stats.value = res.data;
  } catch {
    /* 统计刷新失败不影响主流程 */
  }
};

const handleExpand = async (row: VideoPlaylist, expandedRows: VideoPlaylist[]) => {
  if (!expandedRows.includes(row) || expandLoaded[row.id]) return;
  expandLoading[row.id] = true;
  try {
    const res = await getPlaylistVideos(row.playlistId);
    videosByPlaylist[row.id] = res.data;
    expandLoaded[row.id] = true;
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取视频列表失败"));
  } finally {
    expandLoading[row.id] = false;
  }
};

const handleSync = async () => {
  syncing.value = true;
  try {
    const res = await syncPlaylistsFromYoutube();
    ElMessage.success(
      `同步完成：播放列表 ${res.data.total} 个（新增 ${res.data.created}、更新 ${res.data.updated}、移除 ${res.data.removed}）；视频 ${res.data.videoTotal} 条（新增 ${res.data.videosCreated}、更新 ${res.data.videosUpdated}、移除 ${res.data.videosRemoved}）`,
    );
    Object.keys(expandLoaded).forEach((key) => delete expandLoaded[Number(key)]);
    Object.keys(videosByPlaylist).forEach((key) => delete videosByPlaylist[Number(key)]);
    Object.keys(videoSearch).forEach((key) => delete videoSearch[Number(key)]);
    await loadAll();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步油管分类失败"));
  } finally {
    syncing.value = false;
  }
};

const handleCleanup = async () => {
  const confirmed = await ElMessageBox.confirm(
    "确认清理 PbootCMS 里的旧视频数据吗？会先自动备份数据库，然后删除所有播放列表子栏目和视频内容，只保留「视频」根栏目（scode 303）作为页面外壳。视频数据本身仍保存在本系统（NestJS）里，通过「推送视频清单」导出到网站。",
    "清理 PB 视频数据",
    {
      confirmButtonText: "开始清理",
      cancelButtonText: "取消",
      type: "warning",
    },
  ).catch(() => false);
  if (!confirmed) return;

  cleaning.value = true;
  try {
    const res = await cleanupPboot();
    ElMessage.success(
      `清理完成：删除视频内容 ${res.data.contentsDeleted} 条、播放列表子栏目 ${res.data.sortsDeleted} 个、残留栏目镜像 ${res.data.menusRemoved} 个${res.data.shellSortExists ? "" : "（注意：视频根栏目 scode 303 不存在，请在 PB 后台创建）"}`,
    );
    await loadAll();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "清理 PB 视频数据失败"));
  } finally {
    cleaning.value = false;
  }
};

const handlePushList = async () => {
  pushingList.value = true;
  try {
    const res = await pushVideoList();
    ElMessage.success(`已推送 ${res.data.count} 条视频到网站清单（static/videos.js）`);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "推送视频清单失败"));
  } finally {
    pushingList.value = false;
  }
};

const handleUpdate = async (row: VideoPlaylist, body: { orderNum?: number; show?: boolean }) => {
  try {
    const res = await updatePlaylist(row.id, body);
    Object.assign(row, res.data);
    refreshStats();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "保存失败"));
    await loadAll();
  }
};

const handleVideoUpdate = async (
  playlist: VideoPlaylist,
  video: VideoItem,
  body: { show?: boolean; position?: number },
) => {
  try {
    const res = await updateVideoItem(video.id, body);
    Object.assign(video, res.data);
    const list = videosByPlaylist[playlist.id] || [];
    playlist.shownVideoCount = list.filter((item) => item.show).length;
    refreshStats();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "保存失败"));
  }
};

onMounted(loadAll);
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-bar,
.stats-row,
.page-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-bar {
  justify-content: space-between;
}

.page-bar h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.page-bar p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}

.thumb {
  display: block;
  width: 120px;
  height: 68px;
  border-radius: 6px;
}

.thumb-error {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.data-table {
  width: 100%;
}

.expand-box {
  padding: 8px 16px 12px;
}

.expand-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.expand-search {
  width: 280px;
}

.expand-count {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.preview-wrap {
  position: relative;
  width: 100%;
  padding-top: 56.25%;
  overflow: hidden;
  border-radius: 8px;
  background: #000;
}

.preview-iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.preview-external {
  margin-right: auto;
  color: var(--el-color-primary);
  font-size: 13px;
  text-decoration: none;
}

.preview-external:hover {
  text-decoration: underline;
}
</style>
