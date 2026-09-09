<template>
  <section class="page fields-page">
    <header class="fields-header">
      <div><h2>产品字段管理</h2><span class="site-name">{{ siteName }}</span></div>
      <div class="field-actions">
        <el-button :icon="Download" :disabled="busy" @click="importFields">读取 PB 字段</el-button>
        <el-button :icon="Upload" :disabled="busy" @click="syncFields">同步字段到 PB</el-button>
        <el-button type="primary" :icon="Plus" :disabled="busy" @click="openEditor()">新增字段</el-button>
      </div>
    </header>
    <div class="field-toolbar">
      <el-input v-model="keyword" :prefix-icon="Search" placeholder="搜索名称或字段名" clearable />
      <el-select v-model="filter" aria-label="字段状态"><el-option label="全部字段" value="all" /><el-option label="已启用" value="enabled" /><el-option label="已停用" value="disabled" /></el-select>
      <span>{{ visibleFields.length }} 项</span>
      <el-tooltip content="刷新"><el-button :icon="Refresh" circle aria-label="刷新字段" :disabled="busy" @click="loadFields" /></el-tooltip>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-table v-loading="busy" :data="visibleFields" row-key="name" class="field-table">
      <el-table-column prop="label" label="字段名称" min-width="155" />
      <el-table-column prop="name" label="PB 字段名" min-width="230" />
      <el-table-column label="类型" width="110"><template #default="{ row }">{{ row.type === 1 ? '单行文本' : '其他类型' }}</template></el-table-column>
      <el-table-column label="单位" width="80"><template #default="{ row }">{{ row.unit || '-' }}</template></el-table-column>
      <el-table-column prop="sort" label="排序" width="75" />
      <el-table-column label="启用" width="100"><template #default="{ row }"><el-switch :model-value="row.enabled" :disabled="busy || row.locked" :aria-label="`启用${row.label}`" @change="toggleField(row, Boolean($event))" /></template></el-table-column>
      <el-table-column label="PB 状态" width="110"><template #default="{ row }"><el-tag size="small" :type="row.pbootExists ? 'success' : 'warning'">{{ row.pbootExists ? '已存在' : '待同步' }}</el-tag></template></el-table-column>
      <el-table-column label="使用情况" min-width="145"><template #default="{ row }">项目 {{ row.localUsed }} / PB {{ row.pbUsed }}</template></el-table-column>
      <el-table-column label="操作" width="130" fixed="right"><template #default="{ row }">
        <span v-if="row.locked" class="muted">原有功能管理</span>
        <template v-else>
          <el-tooltip content="编辑字段"><el-button :icon="Edit" link type="primary" :aria-label="`编辑${row.label}`" :disabled="busy" @click="openEditor(row)" /></el-tooltip>
          <el-tooltip :content="row.key ? '基础字段可停用' : row.localUsed || row.pbUsed ? '已有数据，请停用' : '删除项目字段'"><span><el-button :icon="Delete" link type="danger" :aria-label="`删除${row.label}`" :disabled="busy || Boolean(row.key) || row.localUsed > 0 || row.pbUsed > 0" @click="removeField(row)" /></span></el-tooltip>
        </template>
      </template></el-table-column>
    </el-table>
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑产品字段' : '新增产品字段'" width="min(500px, calc(100vw - 32px))" :close-on-click-modal="false">
      <el-form :model="form" label-position="top" @submit.prevent="saveField">
        <el-form-item label="字段名称" required><el-input v-model="form.label" maxlength="60" aria-label="字段名称" /></el-form-item>
        <el-form-item label="PB 字段名"><el-input v-model="form.name" :disabled="Boolean(editing)" placeholder="留空自动生成" maxlength="60" aria-label="PB 字段名" /></el-form-item>
        <div class="dialog-grid">
          <el-form-item label="单位"><el-input v-model="form.unit" :disabled="Boolean(editing?.key)" maxlength="20" aria-label="单位" /></el-form-item>
          <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" :max="9999" controls-position="right" aria-label="排序" /></el-form-item>
        </div>
        <el-form-item label="启用"><el-switch v-model="form.enabled" aria-label="启用字段" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="busy" @click="dialogVisible = false">取消</el-button><el-button type="primary" :icon="Check" :loading="busy" @click="saveField">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Check, Delete, Download, Edit, Plus, Refresh, Search, Upload } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { createProductField, deleteProductField, getProductFields, importProductFields, syncProductFields, updateProductField, type ProductField, type ProductFieldsResult } from '@/api/productFields';
import { getErrorMessage } from '@/utils/request';
import { useSitesStore } from '@/stores/sites';
const sites = useSitesStore();
const fields = ref<ProductField[]>([]);
const siteName = ref('');
const busy = ref(false);
const error = ref('');
const keyword = ref('');
const filter = ref('all');
const dialogVisible = ref(false);
const editing = ref<ProductField>();
const form = reactive({ label: '', name: '', unit: '', sort: 100, enabled: true });
const visibleFields = computed(() => fields.value.filter((field) => (filter.value === 'all' || field.enabled === (filter.value === 'enabled')) && `${field.label} ${field.name}`.toLowerCase().includes(keyword.value.trim().toLowerCase())));
const assign = (data: ProductFieldsResult) => { fields.value = data.fields; siteName.value = data.siteName; };
const run = async (action: () => Promise<void>) => {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try { await action(); } catch (cause) { error.value = getErrorMessage(cause); ElMessage.error(error.value); }
  finally { busy.value = false; }
};
const loadFields = () => run(async () => assign((await getProductFields()).data));
watch(() => sites.activeSiteId, () => { dialogVisible.value = false; void loadFields(); }, { immediate: true });
const openEditor = (field?: ProductField) => {
  editing.value = field;
  Object.assign(form, field ? { label: field.label, name: field.name, unit: field.unit, sort: field.sort, enabled: field.enabled } : { label: '', name: '', unit: '', sort: 100, enabled: true });
  dialogVisible.value = true;
};
const saveField = () => run(async () => {
  if (!form.label.trim()) throw new Error('请填写字段名称');
  const data = { ...form, label: form.label.trim(), name: form.name.trim() || undefined };
  assign((await (editing.value ? updateProductField(editing.value.name, data) : createProductField(data))).data);
  dialogVisible.value = false;
  ElMessage.success('字段已保存');
});
const toggleField = (field: ProductField, enabled: boolean) => run(async () => assign((await updateProductField(field.name, { ...field, enabled })).data));
const confirm = (message: string, title: string) => ElMessageBox.confirm(message, title, { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消', closeOnClickModal: false }).then(() => true).catch(() => false);
const removeField = async (field: ProductField) => {
  const siteId = sites.activeSiteId;
  if (!await confirm(`删除「${field.label}」的项目配置？PB 网站中的原字段保留。`, '删除产品字段')) return;
  if (siteId !== sites.activeSiteId) return;
  await run(async () => { assign((await deleteProductField(field.name)).data); ElMessage.success('项目字段已删除'); });
};
const importFields = () => run(async () => { assign((await importProductFields()).data); ElMessage.success('已读取 PB 字段'); });
const syncFields = async () => {
  const siteId = sites.activeSiteId;
  if (!await confirm(`将启用的字段同步到「${siteName.value}」？同步前自动备份网站数据库，不修改产品值和网站模板。`, '同步产品字段')) return;
  if (siteId !== sites.activeSiteId) return;
  await run(async () => { const result = await syncProductFields(); assign((await getProductFields()).data); ElMessage.success(`已同步 ${result.data.synced} 个字段`); });
};
</script>

<style scoped>
.fields-page { min-width: 0; }
.fields-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.fields-header h2 { margin: 0 0 8px; font-size: 22px; }
.site-name, .muted { color: var(--el-text-color-secondary); font-size: 13px; }
.field-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.field-actions .el-button { margin-left: 0; }
.field-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 16px 0; border-top: 1px solid var(--el-border-color-light); }
.field-toolbar .el-input { width: 300px; max-width: 100%; }
.field-toolbar .el-select { width: 130px; }
.field-toolbar > span { color: var(--el-text-color-secondary); font-size: 13px; margin-right: auto; }
.field-table { width: 100%; }
.field-table :deep(.cell) { overflow-wrap: anywhere; }
.dialog-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16px; }
.dialog-grid .el-input-number { width: 100%; }
@media (max-width: 600px) { .field-actions { width: 100%; } .dialog-grid { grid-template-columns: minmax(0,1fr); } }
</style>
