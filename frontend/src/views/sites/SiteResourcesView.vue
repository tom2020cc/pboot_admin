<template>
  <section class="page resources-page">
    <header class="resources-header">
      <div><h2>网站资源检测</h2><p>{{ siteStore.activeSite?.name || '当前网站' }}</p></div>
      <div class="resource-actions">
        <el-button :icon="Back" :disabled="busy" @click="$router.push('/sites')">站点管理</el-button>
        <el-button type="primary" :icon="Search" :loading="scanning" :disabled="busy && !scanning" @click="scan">{{ result ? '重新扫描' : '扫描资源' }}</el-button>
      </div>
    </header>
    <el-tabs v-model="tab" @tab-change="loadHistory">
      <el-tab-pane label="扫描结果" name="scan" />
      <el-tab-pane label="隔离记录" name="history" />
    </el-tabs>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="resource-alert" />
    <template v-if="tab === 'scan'">
      <div class="resource-notice">试用保护：最近 7 天变更、动态引用和程序文件不清理。所选资源只移入隔离区，不永久删除。</div>
      <div v-if="result" class="scan-meta"><span>{{ result.root }} / static</span><span>{{ formatDate(result.createdAt) }}</span></div>
      <div v-if="result" class="resource-counts">
        <div v-for="item in statusOptions.slice(1)" :key="item.value"><span>{{ item.label }}</span><strong>{{ result.entries.filter(entry => entry.status === item.value).length }}</strong></div>
      </div>
      <div class="resource-toolbar">
        <el-input v-model="keyword" :prefix-icon="Search" clearable placeholder="搜索文件路径" aria-label="搜索文件路径" />
        <el-select v-model="status" aria-label="资源状态"><el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
        <span class="selection-count">已选 {{ selected.length }} 项 · {{ formatSize(selectedSize) }}</span>
        <el-button type="warning" :icon="FolderRemove" :loading="cleaning" :disabled="!selected.length || busy" @click="clean">移入隔离区</el-button>
      </div>
      <el-table ref="table" v-loading="scanning" :data="paged" row-key="path" class="resource-table" @selection-change="onSelection">
        <el-table-column type="selection" width="46" :selectable="selectable" :reserve-selection="true" />
        <el-table-column label="文件路径" min-width="300"><template #default="{ row }"><div class="resource-file"><el-icon><Folder v-if="row.kind === 'directory'" /><Picture v-else-if="row.kind === 'image'" /><Document v-else /></el-icon><span>{{ row.path }}</span></div></template></el-table-column>
        <el-table-column label="大小" width="100"><template #default="{ row }">{{ formatSize(row.size) }}</template></el-table-column>
        <el-table-column label="状态" width="132"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ statusName(row.status) }}</el-tag></template></el-table-column>
        <el-table-column prop="reason" label="判断依据" min-width="270" />
        <el-table-column label="修改时间" width="170"><template #default="{ row }">{{ formatDate(row.modifiedAt) }}</template></el-table-column>
        <el-table-column label="查看" width="70" fixed="right"><template #default="{ row }"><el-tooltip content="预览图片"><el-button v-if="row.kind === 'image'" :icon="View" text circle aria-label="预览图片" @click="previewPath = row.path" /></el-tooltip></template></el-table-column>
        <template #empty>{{ result ? '当前条件下没有资源' : '尚未扫描' }}</template>
      </el-table>
      <el-pagination v-if="filtered.length" v-model:current-page="page" :page-size="50" :total="filtered.length" layout="prev, pager, next, total" class="resource-pagination" />
    </template>
    <template v-else>
      <div class="resource-toolbar"><span>隔离文件保留在网站目录外</span><el-tooltip content="刷新记录"><el-button :icon="Refresh" circle aria-label="刷新记录" :loading="loadingHistory" @click="loadHistory" /></el-tooltip></div>
      <el-table :data="history" v-loading="loadingHistory">
        <el-table-column type="expand"><template #default="{ row }"><ul class="batch-files"><li v-for="entry in row.entries" :key="entry.path"><span>{{ entry.path }}</span><el-tag :type="entry.state === 'restored' ? 'success' : 'info'">{{ entry.state === 'restored' ? '已恢复' : entry.recoverable ? '可恢复' : '未移入' }}</el-tag></li></ul><el-alert v-if="row.error" :title="row.error" type="error" :closable="false" /></template></el-table-column>
        <el-table-column label="隔离时间" min-width="170"><template #default="{ row }">{{ formatDate(row.createdAt) }}</template></el-table-column>
        <el-table-column label="可恢复" width="100"><template #default="{ row }">{{ row.entries.filter((entry: ResourceBatch['entries'][number]) => entry.recoverable).length }} 项</template></el-table-column>
        <el-table-column label="批次" min-width="260" prop="id" />
        <el-table-column label="操作" width="130" fixed="right"><template #default="{ row }"><el-button :icon="RefreshLeft" :disabled="busy || !row.entries.some((entry: ResourceBatch['entries'][number]) => entry.recoverable)" :loading="restoring === row.id" @click="restore(row)">恢复</el-button></template></el-table-column>
        <template #empty>暂无隔离记录</template>
      </el-table>
    </template>
    <el-dialog :model-value="!!previewPath" title="图片预览" width="760px" class="resource-preview" @close="previewPath = ''">
      <el-image v-if="previewPath" :src="previewUrl" fit="contain"><template #error>图片不可预览，文件仍保留</template></el-image><p>{{ previewPath }}</p>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Back, Document, Folder, FolderRemove, Picture, Refresh, RefreshLeft, Search, View } from '@element-plus/icons-vue';
import { cleanResources, getResourceHistory, restoreResources, scanResources, type ResourceBatch, type ResourceEntry, type ResourceStatus, type ResourceScan } from '@/api/siteResources';
import { useSitesStore } from '@/stores/sites';
import request from '@/utils/request';

const siteStore = useSitesStore();
const result = ref<ResourceScan>();
const selected = ref<ResourceEntry[]>([]);
const table = ref<{ clearSelection: () => void }>();
const tab = ref('scan');
const keyword = ref('');
const status = ref('candidate');
const page = ref(1);
const scanning = ref(false);
const cleaning = ref(false);
const restoring = ref('');
const loadingHistory = ref(false);
const error = ref('');
const history = ref<ResourceBatch[]>([]);
const previewPath = ref('');
const busy = computed(() => scanning.value || cleaning.value || !!restoring.value);
const statusOptions = [ { value: 'all', label: '全部资源' }, { value: 'candidate', label: '未发现引用' }, { value: 'referenced', label: '发现引用' }, { value: 'review', label: '待人工确认' }, { value: 'protected', label: '保护中' } ];
const statusName = (value: ResourceStatus) => statusOptions.find(item => item.value === value)?.label;
const statusType = (value: ResourceStatus) => ({ candidate: 'warning', referenced: 'success', review: 'danger', protected: 'info' })[value] as 'warning' | 'success' | 'danger' | 'info';
const filtered = computed(() => (result.value?.entries || []).filter(entry => (status.value === 'all' || entry.status === status.value) && entry.path.toLowerCase().includes(keyword.value.toLowerCase())));
const paged = computed(() => filtered.value.slice((page.value - 1) * 50, page.value * 50));
const selectedSize = computed(() => selected.value.reduce((sum, entry) => sum + entry.size, 0));
const selectable = (entry: ResourceEntry) => entry.status === 'candidate' && !busy.value;
const onSelection = (entries: ResourceEntry[]) => { selected.value = entries; };
const formatSize = (size: number) => size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
const formatDate = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const previewUrl = computed(() => `${request.defaults.baseURL}/sites/static-file?siteId=${result.value?.siteId || siteStore.activeSiteId}&path=${encodeURIComponent(previewPath.value.replace(/^static\//, ''))}`);
const message = (err: unknown) => (err as any)?.code === 'ECONNABORTED'
  ? '请求超时，结果尚未确认。清理或恢复时请先查看隔离记录，不要重复提交。'
  : (err as any)?.response?.data?.message || (err as Error)?.message || '操作失败';
watch([keyword, status], () => { page.value = 1; });
watch(() => siteStore.activeSiteId, () => { result.value = undefined; history.value = []; selected.value = []; table.value?.clearSelection(); });

async function scan() {
  scanning.value = true; error.value = ''; result.value = undefined; selected.value = []; table.value?.clearSelection(); tab.value = 'scan';
  try { result.value = (await scanResources()).data; page.value = 1; }
  catch (err) { error.value = message(err); }
  finally { scanning.value = false; }
}
async function clean() {
  if (!result.value || !selected.value.length) return;
  if (selected.value.length > 200) { ElMessage.warning('每批最多清理 200 项'); return; }
  try { await ElMessageBox.confirm(`将 ${siteStore.activeSite?.name || '当前网站'} 的 ${selected.value.length} 项资源（${formatSize(selectedSize.value)}）移入隔离区？“未发现引用”不等于确认无用，请先核对。可在隔离记录中恢复。`, '确认隔离所选资源', { type: 'warning', confirmButtonText: '移入隔离区', cancelButtonText: '取消' }); }
  catch { return; }
  cleaning.value = true; error.value = '';
  try {
    const response = (await cleanResources(result.value.id, selected.value.map(entry => entry.path))).data;
    result.value = undefined; selected.value = []; table.value?.clearSelection();
    ElMessage.success(`已移入隔离区 ${response.moved} 项`);
    error.value = response.errors.join('；'); tab.value = 'history'; await loadHistory();
  } catch (err) { error.value = message(err); }
  finally { cleaning.value = false; }
}
async function loadHistory() {
  if (tab.value !== 'history') return;
  loadingHistory.value = true;
  try { history.value = (await getResourceHistory()).data; }
  catch (err) { error.value = message(err); }
  finally { loadingHistory.value = false; }
}
async function restore(batch: ResourceBatch) {
  try { await ElMessageBox.confirm('恢复本批次资源到原位置？原位置已有文件时会跳过，不覆盖。', '恢复资源', { confirmButtonText: '恢复', cancelButtonText: '取消' }); }
  catch { return; }
  restoring.value = batch.id; error.value = '';
  try {
    const response = (await restoreResources(batch.id)).data;
    ElMessage.success(`已恢复 ${response.restored} 项`); error.value = response.errors.join('；'); result.value = undefined; selected.value = []; await loadHistory();
  } catch (err) { error.value = message(err); }
  finally { restoring.value = ''; }
}
</script>

<style scoped>
.resources-page { min-width: 0; }
.resources-header, .resource-actions, .resource-toolbar, .scan-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.resources-header { justify-content: space-between; margin-bottom: 20px; }
.resources-header h2 { margin: 0 0 6px; font-size: 22px; }
.resources-header p, .scan-meta { color: #737d8d; font-size: 13px; margin: 0; }
.resource-actions .el-button + .el-button { margin-left: 0; }
.resource-notice { padding: 12px 0; color: #69561b; font-size: 13px; border-bottom: 1px solid #e2e6ed; }
.scan-meta { justify-content: space-between; padding-top: 12px; overflow-wrap: anywhere; }
.resource-counts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #e2e6ed; margin-bottom: 12px; }
.resource-counts > div { display: flex; gap: 12px; align-items: center; padding: 18px 0; }
.resource-counts span { font-size: 13px; color: #647080; }
.resource-counts strong { font-size: 21px; }
.resource-toolbar { padding: 16px 0; }
.resource-toolbar .el-input { width: 300px; max-width: 100%; }
.resource-toolbar .el-select { width: 150px; }
.selection-count { margin-left: auto; font-size: 13px; color: #697687; }
.resource-file { display: flex; align-items: flex-start; gap: 8px; }
.resource-file .el-icon { flex-shrink: 0; margin-top: 5px; }
.resource-file span, .resource-alert { overflow-wrap: anywhere; }
.resource-pagination { padding: 18px 0; justify-content: flex-end; overflow: auto; }
.batch-files { margin: 0; padding: 16px 28px; }
.batch-files li { padding: 5px 0; display: flex; gap: 20px; justify-content: space-between; overflow-wrap: anywhere; }
.batch-files .el-tag { flex-shrink: 0; }
:global(.resource-preview) { max-width: calc(100vw - 32px); }
.resource-preview .el-image { display: block; max-height: 65vh; }
.resource-preview p { overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .resource-counts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .resource-toolbar .el-input { width: 100%; }
  .selection-count { margin-left: 0; }
  .resource-header { align-items: flex-start; }
}
</style>
