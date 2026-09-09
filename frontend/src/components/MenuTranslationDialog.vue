<template>
  <el-dialog v-model="visible" :title="`翻译当前栏目：${name}`" width="680px" class="single-menu-translation-dialog"
    :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy">
    <el-select v-model="model" class="model-control" placeholder="选择翻译模型" :disabled="busy || loading" :loading="loading" aria-label="栏目翻译模型">
      <el-option v-for="item in availableModels" :key="item.value" :label="item.displayLabel || item.label" :value="item.value" />
    </el-select>
    <el-checkbox-group v-model="targets" :disabled="busy" class="language-grid">
      <el-checkbox v-for="item in languages" :key="item.acode" :value="item.acode">{{ item.name }}</el-checkbox>
    </el-checkbox-group>
    <div class="selection-actions">
      <el-button link type="primary" :disabled="busy" @click="targets = languages.map(item => item.acode)">全选</el-button>
      <el-button link :disabled="busy" @click="targets = []">清空</el-button>
    </div>
    <el-progress v-if="runs.length" :percentage="progress" />
    <div v-if="runs.length" class="results">
      <table aria-label="当前栏目翻译结果">
        <thead><tr><th>语言</th><th>状态</th><th>结果</th></tr></thead>
        <tbody><tr v-for="row in runs" :key="row.code">
          <td>{{ row.label }}</td>
          <td><el-tag :type="row.status === 'success' ? 'success' : row.status === 'failed' ? 'danger' : 'info'">{{ statuses[row.status] }}</el-tag></td>
          <td class="result-message">{{ row.message }}</td>
        </tr></tbody>
      </table>
    </div>
    <template #footer>
      <el-button :disabled="busy" @click="visible = false">关闭</el-button>
      <el-button v-if="failedTargets.length" :disabled="busy || !model" @click="translate(failedTargets)">重试失败语言</el-button>
      <el-button type="primary" :loading="busy" :disabled="loading || !model || !targets.length" @click="translate(targets)">开始翻译</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getMenuTranslationModels, translateMenuFromChinese, type MenuTranslationModel } from '@/api/menus';
import { useSitesStore } from '@/stores/sites';
import { getErrorMessage } from '@/utils/request';
import { resolvePreferredTranslationModel, savePreferredTranslationModel } from '@/utils/translationModelPreference';

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{ menuId: string; name: string }>();
const emit = defineEmits<{ busy: [value: boolean]; translated: [] }>();
const sites = useSitesStore();
const models = ref<MenuTranslationModel[]>([]);
const availableModels = computed(() => models.value.filter(item => item.available && item.operational !== false));
const languages = computed(() => sites.siteLanguages.filter(item => item.acode !== 'cn'));
const model = ref('');
const targets = ref<string[]>([]);
const busy = ref(false);
const loading = ref(false);
type Run = { code: string; label: string; status: 'waiting' | 'running' | 'success' | 'failed'; message: string };
const statuses = { waiting: '等待中', running: '翻译中', success: '已保存', failed: '失败' };
const runs = ref<Run[]>([]);
const failedTargets = computed(() => runs.value.filter(row => row.status === 'failed').map(row => row.code));
const progress = computed(() => runs.value.length ? Math.round(runs.value.filter(row => ['success', 'failed'].includes(row.status)).length * 100 / runs.value.length) : 0);
let disposed = false;
let loadVersion = 0;
onBeforeUnmount(() => { disposed = true; loadVersion++; });
watch(() => [props.menuId, sites.activeSiteId], () => { loadVersion++; visible.value = false; });
watch(visible, async open => {
  if (!open) return;
  const version = ++loadVersion;
  runs.value = []; targets.value = []; models.value = []; model.value = ''; loading.value = true;
  try {
    if (!sites.languagesLoaded) await sites.refreshLanguages();
    const result = await getMenuTranslationModels();
    if (disposed || version !== loadVersion) return;
    models.value = result.data;
    model.value = resolvePreferredTranslationModel(availableModels.value);
    targets.value = languages.value.map(item => item.acode);
  } catch (error) { if (!disposed && version === loadVersion) ElMessage.error(getErrorMessage(error, '获取翻译配置失败')); }
  finally { if (version === loadVersion) loading.value = false; }
});

const translate = async (selection: string[]) => {
  if (busy.value || !selection.length || !model.value) return;
  const id = props.menuId, siteId = sites.activeSiteId, selectedModel = model.value;
  const codes = [...new Set(selection)];
  const confirmed = await ElMessageBox.confirm(
    `将从中文翻译「${props.name}」的名称和 SEO 到 ${codes.length} 种语言，图片沿用中文。只处理当前栏目，不包含子栏目，不自动同步 PB。已有对应译文将更新。`,
    '确认单个栏目翻译', { type: 'warning', confirmButtonText: '确认翻译', cancelButtonText: '取消' },
  ).catch(() => false);
  if (!confirmed || disposed || props.menuId !== id || sites.activeSiteId !== siteId || busy.value) return;
  savePreferredTranslationModel(selectedModel);
  busy.value = true; emit('busy', true);
  const pending = codes.map(code => ({ code, label: languages.value.find(item => item.acode === code)?.name || code,
    status: 'waiting' as Run['status'], message: '' }));
  // Keep successful languages visible when retrying just the failed ones.
  runs.value = [...runs.value.filter(row => !codes.includes(row.code)), ...pending];
  let saved = false;
  try {
    for (const code of codes) {
      if (disposed || props.menuId !== id || sites.activeSiteId !== siteId) break;
      const row = runs.value.find(item => item.code === code)!;
      row.status = 'running';
      try {
        const { data } = await translateMenuFromChinese(id, selectedModel, [code]);
        const failed = data.failures.find(item => item.acode === code);
        const result = data.results.find(item => item.acode === code);
        if (failed || !result || result.translated !== 1 || result.skipped) throw new Error(failed?.message || '当前栏目未完整保存，请重试');
        row.status = 'success'; row.message = result.created ? '已创建关联栏目，尚未同步 PB' : '当前栏目的译文已更新，尚未同步 PB'; saved = true;
      } catch (error) { row.status = 'failed'; row.message = getErrorMessage(error, '翻译失败'); }
    }
  } finally {
    busy.value = false; emit('busy', false);
    if (saved && !disposed && props.menuId === id && sites.activeSiteId === siteId) emit('translated');
  }
};
</script>

<style scoped>
.model-control { width: 100%; }
.language-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 18px; }
.language-grid :deep(.el-checkbox) { margin-right: 0; }
.language-grid :deep(.el-checkbox__label) { white-space: normal; overflow-wrap: anywhere; }
.selection-actions { margin: 8px 0 16px; }
.results { margin-top: 12px; max-height: 320px; overflow-y: auto; }
.results table { width: 100%; border-collapse: collapse; table-layout: fixed; text-align: left; }
.results th { background: var(--el-fill-color-light); font-weight: 600; }
.results th, .results td { padding: 10px 12px; border-bottom: 1px solid var(--el-border-color-lighter); overflow-wrap: anywhere; }
.results th:first-child { width: 140px; }
.results th:nth-child(2) { width: 90px; }
:global(.single-menu-translation-dialog) { max-width: calc(100vw - 32px); }
:global(.single-menu-translation-dialog .el-dialog__title) { overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .language-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .results thead { display: none; }
  .results tbody { display: block; }
  .results tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; border-bottom: 1px solid var(--el-border-color-lighter); }
  .results td { border: 0; padding: 8px 4px; }
  .results .result-message { grid-column: 1 / -1; padding-top: 0; }
}
</style>
