<template>
  <section class="page bindings-page">
    <header class="binding-header">
      <div><h2>模板栏目绑定</h2><p>{{ siteStore.activeSite?.name || '当前网站' }} <span v-if="data">· {{ data.fileCount }} 个模板文件</span></p></div>
      <div class="binding-actions">
        <el-button :icon="Refresh" :loading="operation === 'load'" :disabled="busy" @click="reload">重新读取</el-button>
        <el-button :icon="FolderChecked" :disabled="busy || !data" :loading="operation === 'save'" @click="save">保存绑定</el-button>
        <el-button type="primary" :icon="View" :disabled="busy || !data" :loading="operation === 'preview'" @click="preview">预览更新</el-button>
      </div>
    </header>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="binding-alert" />
    <el-alert v-if="result" :title="result.message" type="success" show-icon :closable="false" class="binding-alert">
      <p v-if="result.backupPath" class="backup-path">备份：{{ result.backupPath }}</p>
    </el-alert>
    <div class="binding-toolbar">
      <el-input v-model="keyword" :prefix-icon="Search" clearable placeholder="搜索栏目或模板文件" aria-label="搜索栏目或模板文件" />
      <span>{{ visibleGroups.length }} 组 <el-tag v-if="dirty" type="warning" size="small">未保存</el-tag></span>
    </div>
    <el-table :data="visibleGroups" v-loading="operation === 'load'" row-key="id" class="binding-table">
      <el-table-column type="expand" width="40">
        <template #default="{ row }"><ul class="binding-references"><li v-for="(item, index) in references(row)" :key="index"><code>{{ item.file }}:{{ item.line }}</code><span>{{ item.tag }} · {{ item.attribute }}={{ item.scode }}</span></li></ul></template>
      </el-table-column>
      <el-table-column prop="label" label="模板栏目" min-width="180" />
      <el-table-column v-for="lang in languages" :key="lang.value" :label="lang.label" min-width="310">
        <template #default="{ row }">
          <div v-if="row[lang.value]" class="binding-cell">
            <span class="source-code">原编码 {{ row[lang.value].sourceScode }}</span>
            <el-select v-model="selected[row.id][lang.key]" filterable clearable :disabled="busy" :aria-label="`${row.label} ${lang.label}`" placeholder="保持原编码" @change="invalidatePreview">
              <el-option v-for="menu in menuOptions(lang.value)" :key="menu.id" :label="menuLabel(menu)" :value="menu.id" />
            </el-select>
            <span v-if="row[lang.value].issue && selected[row.id][lang.key] === row[lang.value].menuId" class="binding-issue">{{ row[lang.value].issue }}</span>
          </div>
          <span v-else class="muted">无固定编码引用</span>
        </template>
      </el-table-column>
      <template #empty>{{ error ? '读取失败' : '未发现固定栏目编码' }}</template>
    </el-table>
    <details v-if="data?.warnings.length" class="binding-warnings"><summary>检查提示（{{ data.warnings.length }}）</summary><ul><li v-for="warning in data.warnings" :key="warning">{{ warning }}</li></ul></details>
    <el-dialog v-model="previewOpen" title="确认模板更新" width="860px" class="binding-preview" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy">
      <template v-if="changes">
        <p class="preview-summary">{{ changes.siteName }} · {{ changes.changedFiles }} 个文件 · {{ changes.changedReferences }} 处栏目引用</p>
        <el-empty v-if="!changes.changedFiles" description="栏目编码已一致，无需修改模板" :image-size="60" />
        <div v-for="file in changes.files" :key="file.file" class="preview-file"><h3>{{ file.file }}</h3><div v-for="(change, index) in file.changes" :key="index" class="preview-change"><span>第 {{ change.line }} 行 · {{ change.tag }}</span><code>{{ change.attribute }}={{ change.before }}</code><el-icon><Right /></el-icon><code class="new-code">{{ change.attribute }}={{ change.after }}</code></div></div>
      </template>
      <template #footer><el-button :disabled="busy" @click="previewOpen = false">取消</el-button><el-button type="primary" :icon="Upload" :loading="operation === 'apply'" :disabled="busy || !changes" @click="apply">{{ changes?.changedFiles ? '备份并更新模板' : '保存绑定' }}</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { FolderChecked, Refresh, Right, Search, Upload, View } from '@element-plus/icons-vue';
import { applyTemplateBindings, getTemplateBindings, previewTemplateBindings, saveTemplateBindings, type BindingGroup, type BindingLanguage, type BindingMenu, type BindingPayload, type BindingPreview, type BindingRow, type TemplateBindings } from '@/api/templateBindings';
import { useSitesStore } from '@/stores/sites';

const siteStore = useSitesStore();
const data = ref<TemplateBindings>();
const selected = ref<Record<string, BindingRow>>({});
const keyword = ref('');
const operation = ref('');
const error = ref('');
const result = ref<{ backupPath: string; message: string }>();
const changes = ref<BindingPreview>();
const previewOpen = ref(false);
const savedSelection = ref('');
let generation = 0;
const busy = computed(() => !!operation.value);
const languages = [{ value: 'cn', key: 'cnMenuId', label: '中文 CN' }, { value: 'en', key: 'enMenuId', label: '英文 EN' }] as const;
const dirty = computed(() => !!data.value && savedSelection.value !== JSON.stringify(selected.value));
const references = (group: BindingGroup) => [...(group.cn?.references || []), ...(group.en?.references || [])];
const visibleGroups = computed(() => (data.value?.groups || []).filter(group => `${group.label} ${references(group).map(ref => ref.file + ' ' + ref.scode).join(' ')}`.toLowerCase().includes(keyword.value.toLowerCase())));
const menuOptions = (lang: BindingLanguage) => data.value?.menus.filter(menu => menu.lang === lang) || [];
function menuLabel(menu: BindingMenu) {
  const names = [menu.name]; const seen = new Set<number>([menu.id]); let parentId = Number(menu.parentId);
  while (parentId && !seen.has(parentId)) {
    const parent = data.value?.menus.find(item => item.id === parentId && item.lang === menu.lang);
    if (!parent) break;
    names.unshift(parent.name); seen.add(parentId); parentId = Number(parent.parentId);
  }
  return `${names.join(' / ')} [${menu.scode}]`;
}
function accept(value: TemplateBindings) {
  data.value = value;
  selected.value = Object.fromEntries(value.groups.map(group => [group.id, { id: group.id, cnMenuId: group.cn?.menuId || null, enMenuId: group.en?.menuId || null }]));
  savedSelection.value = JSON.stringify(selected.value);
}
const payload = (): BindingPayload => ({ revision: data.value!.revision, templateVersion: data.value!.templateVersion, bindings: Object.values(selected.value).map(row => ({ ...row, cnMenuId: row.cnMenuId || null, enMenuId: row.enMenuId || null })) });
function invalidatePreview() { changes.value = undefined; previewOpen.value = false; result.value = undefined; }
async function run(name: string, work: (isCurrent: () => boolean) => Promise<void>) {
  const current = generation; operation.value = name; error.value = '';
  const isCurrent = () => current === generation;
  try { await work(isCurrent); }
  catch (err: any) { if (isCurrent()) { error.value = err?.response?.data?.message || err?.message || '操作失败'; previewOpen.value = false; } }
  finally { if (isCurrent()) operation.value = ''; }
}
async function discard() {
  if (!dirty.value) return true;
  try { await ElMessageBox.confirm('有尚未保存的栏目绑定，确定放弃？', '未保存的绑定', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning' }); return true; }
  catch { return false; }
}
async function reload() {
  if (busy.value || !await discard()) return;
  invalidatePreview();
  await run('load', async current => { const response = await getTemplateBindings(); if (current()) accept(response.data); });
}
async function save() {
  invalidatePreview();
  await run('save', async current => { const response = await saveTemplateBindings(payload()); if (current()) { accept(response.data); ElMessage.success('绑定已保存，模板文件未修改'); } });
}
async function preview() {
  invalidatePreview();
  await run('preview', async current => { const response = await previewTemplateBindings(payload()); if (current()) { changes.value = response.data; previewOpen.value = true; } });
}
async function apply() {
  if (!changes.value) return;
  const id = changes.value.previewId;
  await run('apply', async current => {
    const response = await applyTemplateBindings(id);
    if (!current()) return;
    result.value = response.data; previewOpen.value = false; changes.value = undefined;
    const refreshed = await getTemplateBindings(); if (current()) accept(refreshed.data);
  });
}
watch(() => siteStore.activeSiteId, () => {
  generation++; operation.value = ''; data.value = undefined; selected.value = {}; savedSelection.value = ''; error.value = ''; invalidatePreview(); void reload();
}, { immediate: true });
onBeforeRouteLeave(async () => !busy.value && await discard());
</script>

<style scoped>
.bindings-page { min-width: 0; }
.binding-header, .binding-actions, .binding-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.binding-header { justify-content: space-between; padding-bottom: 24px; border-bottom: 1px solid #e1e5ed; }
.binding-header h2 { font-size: 22px; margin: 0 0 8px; }
.binding-header p, .muted { color: #768292; font-size: 13px; margin: 0; }
.binding-actions .el-button + .el-button { margin: 0; }
.binding-toolbar { padding: 20px 0; }
.binding-toolbar .el-input { max-width: 100%; width: 320px; }
.binding-toolbar > span { display: flex; align-items: center; gap: 12px; color: #768292; font-size: 13px; }
.binding-cell { display: grid; gap: 6px; padding: 7px 0; }
.source-code { font-size: 12px; color: #7a8593; }
.binding-issue { color: #ba6420; font-size: 12px; }
.binding-alert { margin-top: 16px; overflow-wrap: anywhere; }
.binding-references { margin: 8px 24px; padding-left: 16px; }
.binding-references li { padding: 5px 0; display: flex; flex-wrap: wrap; gap: 16px; overflow-wrap: anywhere; }
.binding-warnings { font-size: 13px; color: #6b7686; margin-top: 20px; line-height: 1.8; }
.binding-warnings summary { cursor: pointer; }
.backup-path { overflow-wrap: anywhere; }
:global(.binding-preview) { max-width: calc(100vw - 28px); }
.preview-summary { margin: 0 0 20px; }
.preview-file { border-top: 1px solid #e1e5ed; padding: 10px 0; }
.preview-file h3 { font-size: 14px; margin: 0 0 10px; overflow-wrap: anywhere; }
.preview-change { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 5px 0; font-size: 13px; }
.new-code { color: #178050; }
@media (max-width: 600px) { .binding-actions { gap: 8px; } .binding-header { align-items: flex-start; } .binding-toolbar .el-input { width: 100%; } }
</style>
