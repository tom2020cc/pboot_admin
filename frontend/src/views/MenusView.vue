<template>
  <section class="page">
    <div class="page-bar">
      <div>
        <h2>菜单管理</h2>
        <p>中文栏目与各语言的关联、翻译和 PB 同步状态。</p>
      </div>
      <div class="actions">
        <el-select v-model="translateModel" :disabled="translating" class="model-select" placeholder="翻译模型">
          <el-option
            v-for="item in selectableTranslationModels"
            :key="item.value"
            :label="item.displayLabel || item.label"
            :value="item.value"
          />
        </el-select>
        <el-button type="primary" plain :disabled="menuBusy" @click="openTranslationDialog">一键翻译栏目</el-button>
        <el-button type="success" :loading="syncing" :disabled="menuBusy" @click="syncMenusFromPboot">一键获取PB栏目</el-button>
        <el-button type="warning" plain :loading="pushingAll" :disabled="menuBusy" @click="syncAllMenusToWebsite">同步全部到网站</el-button>
        <el-button @click="toggleAll(true)">全部展开</el-button>
        <el-button @click="toggleAll(false)">全部收起</el-button>
        <el-button type="primary" :disabled="menuBusy" @click="router.push('/menus/create')">
          <el-icon><Plus /></el-icon>
          添加菜单
        </el-button>
      </div>
    </div>

    <div class="summary-row">
      <el-radio-group v-model="selectedLang" class="language-tabs">
        <el-radio-button v-for="item in languageOptions" :key="item.code" :value="item.code">
          {{ item.label }} {{ item.count }}
        </el-radio-button>
      </el-radio-group>
      <el-tag type="success">一级栏目 {{ firstLevelCount }}</el-tag>
      <el-tag type="primary">子栏目 {{ secondLevelCount }}</el-tag>
      <el-tag v-if="orphanCount" type="warning">归属异常 {{ orphanCount }}</el-tag>
    </div>

    <TranslationModelInfo :model="selectedTranslationModel" />

    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="menuTree"
      row-key="id"
      border
      stripe
      default-expand-all
      class="data-table"
      :tree-props="{ children: 'children' }"
      :row-class-name="getRowClassName"
    >
      <el-table-column prop="name" label="菜单名称" min-width="220">
        <template #default="{ row }">
          <div class="menu-name">
            <el-tag :type="row.level === 1 ? 'success' : row.isOrphan ? 'warning' : 'primary'" effect="light">
              {{ row.levelLabel }}
            </el-tag>
            <span>{{ row.name }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="归属栏目" min-width="160">
        <template #default="{ row }">
          <el-text v-if="row.level === 1" type="info">顶级栏目</el-text>
          <el-tag v-else-if="row.isOrphan" type="warning">父级 #{{ row.parentId }} 不存在</el-tag>
          <span v-else>{{ row.parentName }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="href" label="路径" min-width="140" />
      <el-table-column label="图标" min-width="160">
        <template #default="{ row }">
          <div class="thumbs">
            <el-image v-for="filename in row.icon" :key="filename" :src="getUploadUrl(filename)" fit="cover" class="thumb" />
            <el-text v-if="!row.icon?.length" type="info">未上传</el-text>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="显示" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.show ? 'success' : 'info'">{{ row.show ? "显示" : "隐藏" }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="orderNum" label="排序" width="80" align="center" />
      <el-table-column label="关联状态" min-width="150">
        <template #default="{ row }">
          <el-tag v-if="row.pendingDelete" type="danger">待删除</el-tag>
          <el-tag v-else-if="!row.code" type="warning">未绑定，请编辑保存</el-tag>
          <el-tag v-else-if="row.pbootSyncPending" type="warning">新增待同步</el-tag>
          <el-tag v-else-if="row.translationNeedsUpdate" type="warning">待重新翻译</el-tag>
          <el-tag v-else-if="getMenuLang(row) === 'cn'" type="info">中文主栏目</el-tag>
          <el-tag v-else :type="row.sourceMenuId ? 'success' : 'warning'">{{ row.sourceMenuId ? '已关联中文' : '待确认中文来源' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" fixed="right" width="250" align="center">
        <template #default="{ row }">
          <el-button type="success" link :disabled="menuBusy" :loading="syncingMenuId === row.id" @click="syncMenuToWebsite(row)">同步网站</el-button>
          <el-button v-if="!row.pendingDelete" type="primary" link :disabled="menuBusy" @click="router.push({ name: 'editMenus', params: { id: row.id } })">编辑</el-button>
          <el-button v-if="getMenuLang(row) === 'cn' && !row.pendingDelete" type="danger" link :disabled="menuBusy" @click="deleteMenu(row)">删除</el-button>
          <el-button v-if="getMenuLang(row) === 'cn' && row.pendingDelete" type="primary" link :disabled="menuBusy" @click="undoDelete(row)">撤销删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="translationDialog" title="从中文翻译栏目" width="680px" class="menu-translation-dialog"
      :close-on-click-modal="false" :close-on-press-escape="!translating" :show-close="!translating">
      <el-checkbox-group v-model="translationTargets" :disabled="translating" class="translation-languages">
        <el-checkbox v-for="item in targetLanguageOptions" :key="item.code" :value="item.code">{{ item.label }}</el-checkbox>
      </el-checkbox-group>
      <div class="translation-choices">
        <el-button link type="primary" :disabled="translating" @click="translationTargets = targetLanguageOptions.map(item => item.code)">全选</el-button>
        <el-button link :disabled="translating" @click="translationTargets = []">清空</el-button>
      </div>
      <el-progress v-if="translationRuns.length" :percentage="translationProgress" />
      <el-table v-if="translationRuns.length" :data="translationRuns" class="translation-results" max-height="320">
        <el-table-column prop="label" label="语言" width="150" />
        <el-table-column label="结果" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : row.status === 'failed' ? 'danger' : 'info'">
              {{ runStatusLabels[row.status as TranslationRun['status']] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="详情" min-width="200" />
      </el-table>
      <template #footer>
        <el-button :disabled="translating" @click="translationDialog = false">关闭</el-button>
        <el-button v-if="failedTranslationTargets.length" :disabled="translating" @click="runTranslations(failedTranslationTargets)">重试失败语言</el-button>
        <el-button type="primary" :loading="translating" :disabled="!translationTargets.length" @click="runTranslations(translationTargets)">开始翻译</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { ElMessage, ElMessageBox, type TableInstance } from "element-plus";
import { Plus } from "@element-plus/icons-vue";
import { useRouter } from "vue-router";
import useMenus from "@/hooks/useMenus";
import { getUploadUrl } from "@/api/uploads";
import TranslationModelInfo from "@/components/TranslationModelInfo.vue";
import type { MenuItem, MenuTranslationModel } from "@/api/menus";
import {
  getMenuTranslationModels,
  restoreMenu,
  syncAllMenusToPboot,
  syncMenuToPboot,
  syncPbootMenus,
  translateMenusFromChinese,
} from "@/api/menus";
import { getErrorMessage } from "@/utils/request";
import { getMenuLang } from "@/utils/menuLanguage";
import { useSitesStore } from "@/stores/sites";
import { resolvePreferredTranslationModel, savePreferredTranslationModel } from "@/utils/translationModelPreference";

type MenuTreeItem = MenuItem & {
  children?: MenuTreeItem[];
  parentName: string;
  level: number;
  levelLabel: string;
  isOrphan: boolean;
};

const router = useRouter();
const sitesStore = useSitesStore();
const { siteLanguages, languagesLoaded } = storeToRefs(sitesStore);
if (!languagesLoaded.value) sitesStore.refreshLanguages().catch(() => undefined);
const tableRef = ref<TableInstance>();
const syncing = ref(false);
const translating = ref(false);
const pushingAll = ref(false);
const syncingMenuId = ref<string | number | null>(null);
const menuBusy = computed(() => translating.value || syncing.value || pushingAll.value || syncingMenuId.value !== null);
type TranslationRun = { code: string; label: string; status: 'waiting' | 'running' | 'success' | 'failed'; message: string };
const runStatusLabels = { waiting: '等待中', running: '翻译中', success: '已保存', failed: '失败' };
const translationDialog = ref(false);
const translationTargets = ref<string[]>([]);
const translationRuns = ref<TranslationRun[]>([]);
const translationProgress = computed(() => translationRuns.value.length
  ? Math.round(translationRuns.value.filter(row => ['success', 'failed'].includes(row.status)).length / translationRuns.value.length * 100) : 0);
const failedTranslationTargets = computed(() => translationRuns.value.filter(row => row.status === 'failed').map(row => row.code));
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
const selectedLang = ref("cn");
const translateModel = ref("");
const translationModels = ref<MenuTranslationModel[]>([]);
const selectableTranslationModels = computed(() =>
  translationModels.value.filter((item) => item.available && item.operational !== false),
);
const { allMenus, loading, handleDelete, getAllMenus } = useMenus();

const selectedTranslationModel = computed(() =>
  translationModels.value.find((item) => item.value === translateModel.value) || null,
);

const languageOptions = computed(() => {
  const counts = new Map<string, number>();
  allMenus.value.forEach((item) => {
    const lang = getMenuLang(item);
    if (lang) counts.set(lang, (counts.get(lang) || 0) + 1);
  });

  const configured = languagesLoaded.value && siteLanguages.value.length
    ? siteLanguages.value
    : [{ acode: "cn", code: "zh-CN", name: "中文" }];
  return configured.map((language) => ({
    code: language.acode,
    label: language.name || language.acode.toUpperCase(),
    count: counts.get(language.acode) || 0,
  }));
});

watch(languageOptions, (options) => {
  if (!options.some((item) => item.code === selectedLang.value)) selectedLang.value = options[0]?.code || "cn";
}, { immediate: true });

const visibleMenus = computed(() => allMenus.value.filter((item) => getMenuLang(item) === selectedLang.value));
const targetLanguageOptions = computed(() => languageOptions.value.filter(item => item.code !== 'cn'));

const sortedMenus = computed(() => {
  return [...visibleMenus.value].sort((a, b) => {
    const orderDiff = Number(a.orderNum) - Number(b.orderNum);
    if (orderDiff !== 0) return orderDiff;
    return Number(a.id) - Number(b.id);
  });
});

const menuTree = computed<MenuTreeItem[]>(() => {
  const nodeMap = new Map<string, MenuTreeItem>();
  const roots: MenuTreeItem[] = [];
  const orphans: MenuTreeItem[] = [];

  sortedMenus.value.forEach((item) => {
    nodeMap.set(String(item.id), {
      ...item,
      children: [],
      parentName: "",
      level: 1,
      levelLabel: "一级",
      isOrphan: false,
    });
  });

  nodeMap.forEach((node) => {
    const parentId = Number(node.parentId);
    if (parentId === 0) {
      roots.push(node);
      return;
    }

    const parent = nodeMap.get(String(parentId));
    const ancestors = new Set<string>([String(node.id)]);
    let cursor = parent;
    while (cursor && !ancestors.has(String(cursor.id))) {
      ancestors.add(String(cursor.id));
      cursor = nodeMap.get(String(cursor.parentId));
    }
    if (!parent || cursor) {
      node.isOrphan = true;
      node.parentName = "";
      node.level = 2;
      node.levelLabel = "异常";
      orphans.push(node);
      return;
    }

    node.parentName = parent.name;
    node.level = parent.level + 1;
    node.levelLabel = node.level === 2 ? "二级" : `${node.level}级`;
    parent.children?.push(node);
  });

  nodeMap.forEach((node) => {
    if (node.children && node.children.length === 0) delete node.children;
  });

  const setLevels = (nodes: MenuTreeItem[], level: number) => nodes.forEach(node => {
    node.level = level;
    node.levelLabel = node.isOrphan ? '异常' : level === 1 ? '一级' : level === 2 ? '二级' : `${level}级`;
    if (node.children) setLevels(node.children, level + 1);
  });
  setLevels(roots, 1);
  setLevels(orphans, 2);

  return [...roots, ...orphans];
});

const firstLevelCount = computed(() => visibleMenus.value.filter((item) => Number(item.parentId) === 0).length);
const secondLevelCount = computed(() => visibleMenus.value.filter((item) => Number(item.parentId) !== 0).length);
const orphanCount = computed(() => {
  const ids = new Set(visibleMenus.value.map((item) => String(item.id)));
  return visibleMenus.value.filter((item) => Number(item.parentId) !== 0 && !ids.has(String(item.parentId))).length;
});

const toggleAll = async (expanded: boolean) => {
  await nextTick();
  menuTree.value.forEach((row) => {
    if (row.children?.length) tableRef.value?.toggleRowExpansion(row, expanded);
  });
};

const getRowClassName = ({ row }: { row: MenuTreeItem }) => {
  if (row.isOrphan) return "orphan-row";
  return row.level > 1 ? "child-row" : "";
};

const loadTranslationModels = async () => {
  try {
    const res = await getMenuTranslationModels();
    translationModels.value = [...res.data];
    translateModel.value = resolvePreferredTranslationModel(translationModels.value, translateModel.value);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取翻译模型失败"));
  }
};

watch(translateModel, (value) => savePreferredTranslationModel(value));

const syncMenusFromPboot = async () => {
  const confirmed = await ElMessageBox.confirm(
    "将以 PB 网站栏目为准，更新本地栏目基础信息、SEO、缩略图和大图；保留本地栏目 ID，不改网站模型和模板。确认继续吗？",
    "一键获取 PB 栏目",
    { confirmButtonText: "开始获取", cancelButtonText: "取消", type: "warning" },
  ).catch(() => false);
  if (!confirmed) return;

  syncing.value = true;
  try {
    const res = await syncPbootMenus();
    ElMessage.success(`栏目获取完成：新增 ${res.data.created} 个，更新 ${res.data.updated} 个`);
    await getAllMenus();
    selectedLang.value = "cn";
    await nextTick();
    await toggleAll(true);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取 PB 栏目失败"));
  } finally {
    syncing.value = false;
  }
};

const openTranslationDialog = () => {
  if (menuBusy.value) return;
  translationTargets.value = selectedLang.value === 'cn'
    ? targetLanguageOptions.value.map(item => item.code) : [selectedLang.value];
  translationRuns.value = [];
  translationDialog.value = true;
};

const runTranslations = async (targets: string[]) => {
  if (translating.value || !targets.length) return;
  const codes = [...new Set(targets)];
  const labels = codes.map(code => languageOptions.value.find(item => item.code === code)?.label || code);
  const siteId = sitesStore.activeSiteId;
  const model = translateModel.value;
  const confirmed = await ElMessageBox.confirm(
    `将从中文重新翻译 ${labels.join('、')} 的栏目名称和 SEO，图片沿用中文。只更新所选语言，保留已有栏目 ID 和 URL，不自动同步到 PB 网站。确认继续吗？`,
    "确认翻译范围",
    { confirmButtonText: "开始翻译", cancelButtonText: "取消", type: "warning" },
  ).catch(() => false);
  if (!confirmed || disposed || siteId !== sitesStore.activeSiteId || translating.value) return;

  translating.value = true;
  translationRuns.value = codes.map((code, index) => ({ code, label: labels[index]!, status: 'waiting', message: '' }));
  try {
    for (const row of translationRuns.value) {
      if (disposed || siteId !== sitesStore.activeSiteId) break;
      row.status = 'running';
      try {
        const { data } = await translateMenusFromChinese(model, [row.code]);
        const failed = data.failures?.find(item => item.acode === row.code);
        const saved = data.results.find(item => item.acode === row.code);
        if (failed || !saved || saved.skipped || !saved.translated) {
          throw new Error(failed?.message || '该语言未完整保存，请检查后重试');
        }
        row.status = 'success';
        row.message = `新增 ${saved.created} 个，更新 ${saved.updated} 个`;
      } catch (e) {
        row.status = 'failed';
        row.message = getErrorMessage(e, '栏目翻译失败');
      }
      if (!disposed && siteId === sitesStore.activeSiteId) await getAllMenus();
    }
  } finally {
    translating.value = false;
  }
};

const syncAllMenusToWebsite = async () => {
  const confirmed = await ElMessageBox.confirm(
    "将新增或更新所有已绑定栏目，并正式删除标记待删除的中文栏目及关联语言栏目。已有模型和模板不改动。确认继续吗？",
    "同步全部栏目到网站",
    { confirmButtonText: "开始同步", cancelButtonText: "取消", type: "warning" },
  ).catch(() => false);
  if (!confirmed) return;

  pushingAll.value = true;
  try {
    const res = await syncAllMenusToPboot();
    ElMessage.success(`同步完成：新增 ${res.data.created} 个，更新 ${res.data.updated} 个，删除 ${res.data.deleted} 个，跳过 ${res.data.skipped} 个`);
    await getAllMenus();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步全部栏目失败"));
  } finally {
    pushingAll.value = false;
  }
};

const syncMenuToWebsite = async (row: MenuTreeItem) => {
  const confirmed = await ElMessageBox.confirm(
    `将同步「${row.name}」所在中文栏目及其关联语言栏目，新增或更新到 PB；标记待删除的栏目会正式删除。确认继续吗？`,
    "同步栏目到网站",
    { confirmButtonText: "开始同步", cancelButtonText: "取消", type: "warning" },
  ).catch(() => false);
  if (!confirmed) return;

  syncingMenuId.value = row.id;
  try {
    const res = await syncMenuToPboot(row.id);
    ElMessage.success(`栏目已同步到网站：${res.data.acode}/${res.data.scode}`);
    await getAllMenus();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "栏目同步到网站失败"));
  } finally {
    syncingMenuId.value = null;
  }
};

const deleteMenu = (row: MenuTreeItem) => {
  if (row.children?.length) {
    ElMessage.warning("请先删除或调整该栏目下的子栏目");
    return;
  }
  handleDelete(row.id);
};

const undoDelete = async (row: MenuTreeItem) => {
  try { await restoreMenu(row.id); await getAllMenus(); ElMessage.success('已撤销删除'); }
  catch (error) { ElMessage.error(getErrorMessage(error, '撤销失败')); }
};

onMounted(loadTranslationModels);
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
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

.actions,
.summary-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.model-select {
  width: min(430px, 42vw);
}

.language-tabs {
  margin-right: 8px;
}

.data-table {
  width: 100%;
}

.menu-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.translation-languages {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.translation-languages :deep(.el-checkbox) { margin-right: 0; }
.translation-languages :deep(.el-checkbox__label) { white-space: normal; overflow-wrap: anywhere; }
.translation-choices { margin: 8px 0 16px; }
.translation-results { margin-top: 12px; }
.translation-results :deep(.cell) { overflow-wrap: anywhere; }
:global(.menu-translation-dialog) { max-width: calc(100vw - 32px); }
@media (max-width: 640px) {
  .page-bar { flex-direction: column; align-items: stretch; }
  .model-select { width: 100%; }
  .translation-languages { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.thumbs {
  display: flex;
  min-height: 34px;
  align-items: center;
  gap: 6px;
}

.thumb {
  width: 34px;
  height: 34px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
}

:deep(.child-row) {
  background: #fbfdff;
}

:deep(.child-row .el-table__cell:first-child) {
  position: relative;
}

:deep(.child-row .el-table__cell:first-child::before) {
  position: absolute;
  left: 22px;
  top: 0;
  bottom: 0;
  width: 2px;
  content: "";
  background: #d9ecff;
}

:deep(.orphan-row) {
  background: #fff8e6;
}
</style>
