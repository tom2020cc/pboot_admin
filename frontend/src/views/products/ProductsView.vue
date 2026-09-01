<template>
  <section class="page">
    <div class="page-bar">
      <div>
        <h2>产品管理</h2>
        <p>维护产品栏目、标题、缩略图、轮播多图、多语言内容、状态和排序。</p>
      </div>
      <div class="page-actions">
        <el-button type="warning" plain :loading="importing" @click="handleImportFromPboot">
          {{ importing ? "正在重建..." : "全站从 PB 重建" }}
        </el-button>
        <el-button type="primary" @click="router.push('/products/create')">
          <el-icon><Plus /></el-icon>
          添加产品
        </el-button>
      </div>
    </div>

    <div class="filter-row">
      <el-select v-model="filterMenuId" clearable placeholder="按栏目筛选" class="filter-select" @change="loadProducts">
        <el-option v-for="item in menuOptions" :key="item.id" :label="item.optionLabel" :value="Number(item.id)" />
      </el-select>
      <el-select v-model="currentLang" class="lang-select" @change="handleLangChange">
        <el-option v-for="item in PRODUCT_LANGUAGES" :key="item.code" :label="item.name" :value="item.code" />
      </el-select>
      <el-button @click="loadProducts">刷新</el-button>
    </div>

    <div class="scope-sync-panel">
      <div class="scope-sync-copy">
        <strong>当前范围同步</strong>
        <span v-if="filterMenuId">{{ selectedScopeLabel }}，包含其子栏目；不会改动其他栏目或语言。</span>
        <span v-else>先选择具体栏目，再获取或覆盖该栏目及其子栏目。</span>
      </div>
      <div class="scope-sync-actions">
        <el-button :disabled="!filterMenuId" :loading="pullingScope" @click="handlePullScope">
          从 PB 获取当前范围
        </el-button>
        <el-button type="success" plain :disabled="!filterMenuId" :loading="pushingScope" @click="handlePushScope">
          覆盖 PB 当前范围
        </el-button>
      </div>
    </div>

    <div class="translation-panel">
      <div class="translation-controls">
        <el-select v-model="translationModel" placeholder="选择翻译模型" class="model-select">
          <el-option
            v-for="item in translationModels"
            :key="item.value"
            :label="item.displayLabel || item.label"
            :value="item.value"
            :disabled="!item.available"
          />
        </el-select>
        <el-button
          type="primary"
          :loading="isTranslationRunning"
          :disabled="!canTranslateCurrentMenu"
          @click="handleTranslateCurrentMenu"
        >
          翻译当前栏目为 {{ getLanguageName(currentLang) }}
        </el-button>
        <el-button
          v-if="isTranslationRunning"
          type="danger"
          plain
          :loading="stoppingTranslation"
          @click="handleStopTranslation"
        >
          停止
        </el-button>
        <span class="translation-hint">{{ translationHint }}</span>
      </div>
      <TranslationModelInfo :model="selectedTranslationModel" />
      <div v-if="translationJob" class="translation-progress">
        <div class="progress-heading">
          <strong>{{ translationJob.message || "正在处理当前栏目" }}</strong>
          <span>{{ translationJob.processed }}/{{ translationJob.total }}，成功 {{ translationJob.succeeded }}，失败 {{ translationJob.failed }}</span>
        </div>
        <el-progress :percentage="translationProgress" :status="translationProgressStatus" />
        <p v-if="translationJob.currentTitle" class="current-title">当前：{{ translationJob.currentTitle }}</p>
        <p v-if="translationJob.errors?.length" class="translation-errors">{{ translationJob.errors.slice(0, 3).join("；") }}</p>
        <div v-if="canRetryFailedTranslation" class="retry-failed-box">
          <div class="retry-failed-head">
            <span>可重试失败 {{ translationJob?.failedItems?.length || 0 }} 条，使用上方选择的模型重新翻译。</span>
            <el-button type="warning" size="small" :loading="retryingFailed" @click="handleRetryFailedTranslation">
              只重试失败项
            </el-button>
          </div>
          <div class="retry-failed-list">
            <el-tag v-for="item in failedPreview" :key="item.id" type="danger" effect="plain">
              #{{ item.id }} {{ item.title }}
            </el-tag>
          </div>
        </div>
      </div>
    </div>

    <div class="stats-row">
      <el-tag type="primary" effect="plain">当前语言：{{ getLanguageName(currentLang) }}</el-tag>
      <el-tag type="success" effect="plain">本地当前：{{ localCount }} 条</el-tag>
      <el-tag type="warning" effect="plain">PB同步源：{{ syncCount }} 条</el-tag>
      <el-tag :type="countDiff === 0 ? 'info' : countDiff > 0 ? 'danger' : 'success'" effect="plain">
        差异：{{ countDiff > 0 ? "+" : "" }}{{ countDiff }} 条
      </el-tag>
    </div>

    <el-table v-loading="loading" :data="productList" border stripe class="data-table">
      <el-table-column prop="id" label="ID" width="90" align="center" />
      <el-table-column type="index" label="序号" width="70" align="center" />
      <el-table-column label="缩略图" width="120" align="center">
        <template #default="{ row }">
          <el-image v-if="row.thumbnail" :src="getUploadUrl(row.thumbnail)" fit="cover" class="thumb" />
          <el-text v-else type="info">未上传</el-text>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="产品标题" min-width="240" />
      <el-table-column label="内容栏目" min-width="180">
        <template #default="{ row }">{{ getMenuName(row.menuId) }}</template>
      </el-table-column>
      <el-table-column label="语言" width="90" align="center">
        <template #default="{ row }">{{ getLanguageName(row.lang || currentLang) }}</template>
      </el-table-column>
      <el-table-column label="轮播图" width="100" align="center">
        <template #default="{ row }">{{ row.carouselImages?.length || 0 }} 张</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.show ? 'success' : 'info'">{{ row.show ? "显示" : "隐藏" }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="orderNum" label="排序" width="80" align="center" />
      <el-table-column label="操作" fixed="right" width="280" align="center">
        <template #default="{ row }">
          <el-button type="info" link @click="router.push({ name: 'productDetail', params: { id: row.id }, query: { lang: currentLang } })">查看</el-button>
          <el-button type="success" link :loading="syncingId === row.id" @click="handleSync(row.id)">同步网站</el-button>
          <el-button type="primary" link @click="router.push({ name: 'editProduct', params: { id: row.id } })">编辑</el-button>
          <el-button type="danger" link @click="handleDelete(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus } from "@element-plus/icons-vue";
import { getAll, type MenuItem } from "@/api/menus";
import {
  DEFAULT_PRODUCT_LANG,
  PRODUCT_LANGUAGES,
  cancelProductMenuTranslation,
  getProductList,
  getProductMenuTranslationJob,
  getProductPbootStats,
  getProductTranslationModels,
  importProductsFromPboot,
  pullProductPbootScope,
  pushProductPbootScope,
  removeProduct,
  retryProductMenuTranslationFailures,
  startProductMenuTranslation,
  syncProductToPboot,
  type PbootProductStats,
  type ProductItem,
} from "@/api/products";
import type { MenuTranslationJob, TranslationModel } from "@/api/news";
import { getUploadUrl } from "@/api/uploads";
import TranslationModelInfo from "@/components/TranslationModelInfo.vue";
import { getErrorMessage } from "@/utils/request";
import { filterMenusByContentLang, filterMenusByContentLangAndModel, findEquivalentMenuForLang, formatMenuPathForLang } from "@/utils/menuLanguage";

const router = useRouter();
const loading = ref(false);
const importing = ref(false);
const pullingScope = ref(false);
const pushingScope = ref(false);
const syncingId = ref<number | null>(null);
const productList = ref<ProductItem[]>([]);
const menus = ref<MenuItem[]>([]);
const filterMenuId = ref<number | undefined>();
const currentLang = ref(DEFAULT_PRODUCT_LANG);
const stats = ref<PbootProductStats | null>(null);
const translationModels = ref<TranslationModel[]>([]);
const translationModel = ref("");
const translationJob = ref<MenuTranslationJob | null>(null);
const retryingFailed = ref(false);
const stoppingTranslation = ref(false);
const translationJobKey = "product-menu-translation-job";
let translationPollTimer: ReturnType<typeof setTimeout> | undefined;

const selectedTranslationModel = computed(() =>
  translationModels.value.find((item) => item.value === translationModel.value) || null,
);
const currentLangMenus = computed(() => filterMenusByContentLang(menus.value, currentLang.value));
const currentMenus = computed(() => filterMenusByContentLangAndModel(menus.value, currentLang.value, "3"));
const localCount = computed(() => stats.value?.localCount ?? productList.value.length);
const syncCount = computed(() => stats.value?.syncCount ?? 0);
const countDiff = computed(() => stats.value?.diff ?? syncCount.value - localCount.value);
const selectedTargetMenu = computed(() => menus.value.find((item) => Number(item.id) === Number(filterMenuId.value)));
const selectedScopeLabel = computed(() => {
  if (!filterMenuId.value) return "";
  const path = formatMenuPathForLang(menus.value, filterMenuId.value, currentLang.value, "3");
  return `${getLanguageName(currentLang.value)} / ${path}`;
});
const sourceChineseMenu = computed(() =>
  filterMenuId.value ? findEquivalentMenuForLang(menus.value, filterMenuId.value, DEFAULT_PRODUCT_LANG, "3") : undefined,
);
const isTranslationRunning = computed(() => ["pending", "running"].includes(translationJob.value?.status || ""));
const canRetryFailedTranslation = computed(
  () =>
    Boolean(translationJob.value?.id) &&
    !isTranslationRunning.value &&
    Number(translationJob.value?.failedItems?.length || 0) > 0 &&
    Boolean(translationModel.value),
);
const failedPreview = computed(() => (translationJob.value?.failedItems || []).slice(0, 8));
const canTranslateCurrentMenu = computed(
  () =>
    currentLang.value !== DEFAULT_PRODUCT_LANG &&
    Boolean(filterMenuId.value) &&
    Boolean(sourceChineseMenu.value) &&
    Boolean(translationModel.value) &&
    !isTranslationRunning.value,
);
const translationProgress = computed(() => {
  const total = Number(translationJob.value?.total || 0);
  if (!total) return translationJob.value?.status === "completed" ? 100 : 0;
  return Math.min(100, Math.round((Number(translationJob.value?.processed || 0) / total) * 100));
});
const translationProgressStatus = computed(() => {
  if (translationJob.value?.status === "failed") return "exception";
  if (translationJob.value?.status === "completed") return "success";
  if (translationJob.value?.status === "cancelled") return "warning";
  return undefined;
});
const translationHint = computed(() => {
  if (currentLang.value === DEFAULT_PRODUCT_LANG) return "请选择需要修复的目标语言。";
  if (!filterMenuId.value) return "请选择具体栏目，只翻译该栏目及其子栏目。";
  if (!sourceChineseMenu.value) return "未找到对应的中文源栏目，请先检查栏目结构。";
  return `中文源栏目：${formatMenuPathForLang(menus.value, sourceChineseMenu.value.id, DEFAULT_PRODUCT_LANG, "3")}`;
});

const menuOptions = computed(() => {
  const map = new Map(currentLangMenus.value.map((item) => [String(item.id), item]));
  return currentMenus.value.map((item) => ({
    ...item,
    optionLabel: Number(item.parentId) === 0 ? `一级栏目 / ${item.name}` : `${map.get(String(item.parentId))?.name || "未知栏目"} / ${item.name}`,
  }));
});

const getMenuName = (menuId: number) => {
  return formatMenuPathForLang(menus.value, menuId, currentLang.value, "3");
};

const getLanguageName = (lang: string) => {
  return PRODUCT_LANGUAGES.find((item) => item.code === lang)?.name || lang;
};

const loadMenus = async () => {
  const res = await getAll();
  menus.value = res.data;
};

const loadTranslationModels = async () => {
  const res = await getProductTranslationModels();
  translationModels.value = [...res.data];
  const preferred = translationModels.value.find((item) => item.available);
  translationModel.value = preferred?.value || "";
};

const loadProducts = async () => {
  loading.value = true;
  try {
    const [res, statsRes] = await Promise.all([
      getProductList(filterMenuId.value, currentLang.value),
      getProductPbootStats(filterMenuId.value, currentLang.value),
    ]);
    productList.value = res.data;
    stats.value = statsRes.data;
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取产品列表失败"));
  } finally {
    loading.value = false;
  }
};

const handleLangChange = async () => {
  if (filterMenuId.value) {
    const nextMenu = findEquivalentMenuForLang(menus.value, filterMenuId.value, currentLang.value, "3");
    filterMenuId.value = nextMenu ? Number(nextMenu.id) : undefined;
  }
  await loadProducts();
};

const stopTranslationPolling = () => {
  if (translationPollTimer) clearTimeout(translationPollTimer);
  translationPollTimer = undefined;
};

const pollTranslationJob = async (jobId: string) => {
  stopTranslationPolling();
  try {
    const res = await getProductMenuTranslationJob(jobId);
    translationJob.value = res.data;
    if (["pending", "running"].includes(res.data.status)) {
      translationPollTimer = setTimeout(() => pollTranslationJob(jobId), 1500);
      return;
    }

    sessionStorage.removeItem(translationJobKey);
    if (res.data.status === "cancelled") {
      ElMessage.warning(res.data.message || "翻译任务已停止");
      await loadProducts();
      return;
    }
    if (res.data.status === "completed") {
      const suffix = res.data.failed ? `，失败 ${res.data.failed} 条` : "";
      ElMessage.success(`栏目翻译完成：成功 ${res.data.succeeded} 条${suffix}`);
    } else {
      ElMessage.error(res.data.message || "栏目翻译失败");
    }
    await loadProducts();
  } catch (e) {
    sessionStorage.removeItem(translationJobKey);
    ElMessage.error(getErrorMessage(e, "读取栏目翻译进度失败"));
  }
};

const handleTranslateCurrentMenu = async () => {
  if (!canTranslateCurrentMenu.value || !filterMenuId.value || !selectedTargetMenu.value || !sourceChineseMenu.value) return;
  const targetPath = formatMenuPathForLang(menus.value, filterMenuId.value, currentLang.value, "3");
  const sourcePath = formatMenuPathForLang(menus.value, sourceChineseMenu.value.id, DEFAULT_PRODUCT_LANG, "3");
  const confirmed = await ElMessageBox.confirm(
    `将以中文栏目“${sourcePath}”为源，翻译到 ${getLanguageName(currentLang.value)} 栏目“${targetPath}”。只处理该栏目及其子栏目，并覆盖已有目标语言文字；产品图片、视频和轮播图保持不变，不会自动同步 PB 网站。`,
    "翻译当前产品栏目",
    {
      confirmButtonText: "开始翻译",
      cancelButtonText: "取消",
      type: "warning",
    },
  ).catch(() => false);
  if (!confirmed) return;

  try {
    const res = await startProductMenuTranslation({
      menuId: Number(filterMenuId.value),
      targetLang: currentLang.value,
      model: translationModel.value,
    });
    translationJob.value = res.data;
    sessionStorage.setItem(translationJobKey, res.data.id);
    ElMessage.success("翻译任务已启动，可在当前页面查看进度");
    await pollTranslationJob(res.data.id);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "启动当前栏目翻译失败"));
  }
};

const handleStopTranslation = async () => {
  if (!translationJob.value?.id) return;
  const confirmed = await ElMessageBox.confirm(
    "停止后不会继续翻译剩余内容，已经成功写入的数据会保留。确定停止吗？",
    "停止翻译任务",
    {
      confirmButtonText: "停止",
      cancelButtonText: "继续翻译",
      type: "warning",
    },
  ).catch(() => false);
  if (!confirmed || !translationJob.value?.id) return;

  stoppingTranslation.value = true;
  try {
    const res = await cancelProductMenuTranslation(translationJob.value.id);
    translationJob.value = res.data;
    stopTranslationPolling();
    sessionStorage.removeItem(translationJobKey);
    ElMessage.warning(res.data.message || "翻译任务已停止");
    await loadProducts();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "停止翻译任务失败"));
  } finally {
    stoppingTranslation.value = false;
  }
};

const handleRetryFailedTranslation = async () => {
  if (!translationJob.value?.id || !translationModel.value) return;
  retryingFailed.value = true;
  try {
    const res = await retryProductMenuTranslationFailures(translationJob.value.id, translationModel.value);
    translationJob.value = res.data;
    sessionStorage.setItem(translationJobKey, res.data.id);
    ElMessage.success(`失败项重试已启动：${res.data.total} 条`);
    await pollTranslationJob(res.data.id);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "启动失败项重试失败"));
  } finally {
    retryingFailed.value = false;
  }
};

const handleSync = async (id: number) => {
  syncingId.value = id;
  try {
    const res = await syncProductToPboot(id, { lang: currentLang.value });
    const first = res.data.synced[0];
    ElMessage.success(first?.url ? `同步成功：${first.url}` : "同步成功");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步产品到网站失败"));
  } finally {
    syncingId.value = null;
  }
};

const handlePullScope = async () => {
  if (!filterMenuId.value) return;
  const confirmed = await ElMessageBox.confirm(
    `将使用 PB 本地网站的“${selectedScopeLabel.value}”覆盖后台当前范围，并自动备份后台数据库。其他栏目和语言不会改变。`,
    "从 PB 获取当前范围",
    {
      confirmButtonText: "获取并覆盖后台",
      cancelButtonText: "取消",
      type: "warning",
    },
  ).catch(() => false);
  if (!confirmed || !filterMenuId.value) return;

  pullingScope.value = true;
  try {
    const res = await pullProductPbootScope({ menuId: filterMenuId.value, lang: currentLang.value });
    ElMessage.success(`获取完成：新增 ${res.data.created || 0}，更新 ${res.data.updated || 0}，清理 ${res.data.deleted || 0} 条`);
    await loadProducts();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "从 PB 获取当前产品范围失败"));
  } finally {
    pullingScope.value = false;
  }
};

const handlePushScope = async () => {
  if (!filterMenuId.value) return;
  const confirmed = await ElMessageBox.confirm(
    `将使用后台数据覆盖 PB 本地网站的“${selectedScopeLabel.value}”，并自动备份 PB 数据库。当前范围内 PB 原数据会被替换。`,
    "覆盖 PB 当前范围",
    {
      confirmButtonText: "备份并覆盖 PB",
      cancelButtonText: "取消",
      type: "warning",
    },
  ).catch(() => false);
  if (!confirmed || !filterMenuId.value) return;

  pushingScope.value = true;
  try {
    const res = await pushProductPbootScope({ menuId: filterMenuId.value, lang: currentLang.value });
    ElMessage.success(`覆盖完成：写入 ${res.data.syncedCount || res.data.synced?.length || 0}，清理原数据 ${res.data.deleted || 0} 条`);
    await loadProducts();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "覆盖 PB 当前产品范围失败"));
  } finally {
    pushingScope.value = false;
  }
};

const handleImportFromPboot = async () => {
  const confirmed = await ElMessageBox.confirm(
    "这是整站重建：会先备份后台数据库，再删除后台全部产品并使用 PB 网站全部产品重新导入。只想处理一个栏目时，请使用下方“当前范围同步”。",
    "全站从 PB 重建产品",
    {
      confirmButtonText: "开始同步",
      cancelButtonText: "取消",
      type: "warning",
    },
  ).catch(() => false);
  if (!confirmed) return;

  importing.value = true;
  try {
    const res = await importProductsFromPboot();
    ElMessage.success(`产品同步完成：导入 ${res.data.imported} 个，语言版本 ${res.data.importedTranslations} 条`);
    filterMenuId.value = undefined;
    currentLang.value = DEFAULT_PRODUCT_LANG;
    await loadMenus();
    await loadProducts();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "从 PB 网站同步产品失败"));
  } finally {
    importing.value = false;
  }
};

const handleDelete = async (id: number) => {
  await ElMessageBox.confirm("确认要删除该产品吗？", "删除提醒", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  }).catch(() => {
    ElMessage.info("删除操作已取消");
    return new Promise(() => {});
  });

  try {
    const res = await removeProduct(id);
    const deleted = Number(res.data?.pbootDelete?.deleted || 0);
    ElMessage.success(`删除产品成功，PB网站同步删除 ${deleted} 条`);
    loadProducts();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "删除产品失败"));
  }
};

onMounted(async () => {
  try {
    await Promise.all([loadMenus(), loadTranslationModels()]);
    await loadProducts();
    const savedJobId = sessionStorage.getItem(translationJobKey);
    if (savedJobId) await pollTranslationJob(savedJobId);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "加载产品管理失败"));
  }
});

onBeforeUnmount(stopTranslationPolling);
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-bar,
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.page-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-bar h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 22px;
  font-weight: 700;
}

.page-bar p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}

.filter-row {
  justify-content: flex-start;
  padding: 12px 14px;
  background: #ffffff;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

.scope-sync-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: var(--radius-card);
}

.scope-sync-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.scope-sync-copy strong {
  color: var(--el-text-color-primary);
  font-size: 14px;
}

.scope-sync-copy span {
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.scope-sync-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 10px;
}

.stats-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

.translation-panel {
  padding: 12px 14px;
  background: #ffffff;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

.translation-controls,
.progress-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}

.translation-hint,
.progress-heading span,
.current-title {
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.model-select {
  width: min(430px, 42vw);
}

.translation-progress {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.progress-heading {
  justify-content: space-between;
  margin-bottom: 8px;
}

.current-title,
.translation-errors {
  margin: 8px 0 0;
}

.translation-errors {
  color: var(--el-color-danger);
  font-size: 13px;
}

.retry-failed-box {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--el-color-warning-light-9);
  border: 1px solid var(--el-color-warning-light-8);
  border-radius: 6px;
}

.retry-failed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-warning);
  font-size: 13px;
}

.retry-failed-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.filter-select {
  width: 280px;
}

.lang-select {
  width: 150px;
}

.thumb {
  width: 72px;
  height: 46px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
}

@media (max-width: 900px) {
  .scope-sync-panel {
    align-items: stretch;
    flex-direction: column;
  }

  .scope-sync-actions {
    flex-wrap: wrap;
  }
}
</style>
