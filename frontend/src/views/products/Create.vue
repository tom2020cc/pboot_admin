<template>
  <section class="page">
    <div class="page-title">
      <div>
        <h2>添加产品</h2>
        <p>填写产品所属栏目、标题、缩略图和轮播多图。</p>
      </div>
      <div class="page-actions">
        <el-button :icon="FolderOpened" :disabled="loading" @click="openFolderImport">文件夹批量导入</el-button>
        <el-button plain :loading="translatingCurrent" :disabled="loading || translatingAll" @click="translateCurrentLanguage">
          只翻译当前语言
        </el-button>
        <el-button type="primary" plain :loading="translatingAll" :disabled="loading || translatingCurrent" @click="translateAllLanguages">
          {{ translatingAll ? (translationProgress || "正在顺序翻译...") : "一键翻译" }}
        </el-button>
      </div>
    </div>
    <ProductForm ref="productFormRef" v-model="form" :menus="menus" submit-text="新建产品" :loading="loading" @submit="submit" @reset="reset" />

    <el-dialog v-model="folderDialogVisible" title="文件夹批量导入产品" class="folder-import-dialog" top="5vh" width="min(1240px, 94vw)" :close-on-click-modal="!folderImporting" :close-on-press-escape="!folderImporting" :show-close="!folderImporting" destroy-on-close>
      <el-form label-position="top" class="folder-import-form" :disabled="folderScanning || folderImporting">
        <div class="import-source" aria-label="资料来源环境">
          <span class="source-location"><el-icon><Monitor v-if="importSource.local" /><Connection v-else /></el-icon><strong>{{ importSource.label }}</strong></span>
          <span class="source-host">{{ importSource.host }}</span>
          <span class="source-site">当前网站：<b>{{ directoryListing?.siteName || sitesStore.activeSite?.name || '未选择' }}</b></span>
          <span class="source-mode">读取后台磁盘 · 非本机文件上传</span>
        </div>
        <el-form-item label="产品资料目录">
          <div class="directory-input">
            <el-input v-model="folderImportForm.sourceDirectory" aria-label="产品资料目录" :disabled="directoryLoading" clearable placeholder="服务器上的产品资料目录" @input="onDirectoryInput" />
            <el-tooltip content="使用当前网站根目录">
              <el-button :icon="HomeFilled" aria-label="使用当前网站根目录" :loading="directoryLoading" @click="loadDirectory('', true)" />
            </el-tooltip>
            <el-tooltip content="选择服务器子目录">
              <el-button :icon="FolderOpened" aria-label="选择服务器子目录" :disabled="directoryLoading" @click="openDirectoryBrowser" />
            </el-tooltip>
          </div>
          <DirectoryPath :path="folderImportForm.sourceDirectory" :root-path="directoryListing?.rootPath" label="当前导入目录" />
        </el-form-item>
        <el-form-item label="导入到中文产品栏目">
          <el-select
            v-model="folderImportForm.menuId"
            filterable
            placeholder="请选择中文产品栏目"
            style="width: 100%"
            @change="clearFolderScan"
          >
            <el-option
              v-for="item in chineseProductMenus"
              :key="item.id"
              :label="formatMenuPath(item)"
              :value="Number(item.id)"
            />
          </el-select>
          <div class="import-target" aria-label="目标网站栏目">
            <div><strong>导入目标</strong><span>中文 CN</span></div>
            <b>{{ directoryListing?.siteName || sitesStore.activeSite?.name || '未选择网站' }}</b>
            <span>{{ selectedMenuPath || '尚未选择栏目' }}</span>
          </div>
        </el-form-item>
        <el-form-item label="参数类型" class="parameter-type">
          <el-radio-group v-model="folderImportForm.parameterType" @change="clearFolderScan">
            <el-radio-button value="auto">按型号资料</el-radio-button>
            <el-radio-button value="core">岩芯钻机</el-radio-button>
            <el-radio-button value="water-well">水井钻机</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <div v-if="directoryError" class="directory-error"><el-alert :title="directoryError" type="error" :closable="false" /></div>
        <section v-if="directoryBrowserVisible" class="server-directory" aria-label="服务器目录选择">
          <div class="directory-toolbar">
            <el-tooltip content="网站根目录"><el-button :icon="HomeFilled" aria-label="浏览网站根目录" :disabled="directoryLoading" @click="loadDirectory()" /></el-tooltip>
            <el-tooltip content="上一级"><el-button :icon="ArrowUp" aria-label="上一级目录" :disabled="directoryLoading || !directoryListing?.parentPath" @click="loadDirectory(directoryListing?.parentPath || '')" /></el-tooltip>
            <strong>正在浏览目录</strong>
            <el-tag v-if="browsingDifferent" type="warning" effect="plain">浏览中，未选用</el-tag>
            <el-button :icon="Check" type="primary" plain :disabled="directoryLoading || !directoryListing || !!directoryError" @click="useDirectory">使用此目录</el-button>
          </div>
          <DirectoryPath :path="directoryListing?.currentPath || ''" :root-path="directoryListing?.rootPath" label="浏览位置" browsing />
          <div class="directory-folders">
            <button v-for="directory in directoryListing?.directories || []" :key="directory.path" type="button" class="directory-entry" :disabled="directoryLoading || folderScanning || folderImporting" @click="loadDirectory(directory.path)">
              <el-icon><FolderOpened /></el-icon><span>{{ directory.name }}</span><el-icon><ArrowRight /></el-icon>
            </button>
          </div>
          <div v-if="directoryListing && !directoryListing.directories.length && !directoryError" class="directory-empty">此目录没有子目录</div>
        </section>
        <el-form-item label="缺少 0.jpg 时生成的缩略图" class="thumbnail-settings">
          <div class="thumbnail-dimensions">
            <div class="thumbnail-dimension">
            <label for="folder-thumbnail-width">宽度（px）</label>
            <el-input-number id="folder-thumbnail-width" v-model="folderImportForm.thumbnailWidth" aria-label="缩略图宽度" :min="64" :max="4096" :precision="0" controls-position="right" @change="clearFolderScan" />
            </div>
            <div class="thumbnail-dimension">
            <label for="folder-thumbnail-height">高度（px）</label>
            <el-input-number id="folder-thumbnail-height" v-model="folderImportForm.thumbnailHeight" aria-label="缩略图高度" :min="64" :max="4096" :precision="0" controls-position="right" @change="clearFolderScan" />
            </div>
            <el-tag type="info" effect="plain">已有 0.jpg 保持不变</el-tag>
          </div>
        </el-form-item>
      </el-form>

      <div class="folder-rule">
        <span><strong>型号：</strong>文件夹名称</span>
        <span><strong>缩略图：</strong>优先使用现有 0.jpg；缺少时由 1.jpg 生成 {{ folderImportForm.thumbnailWidth || 500 }} × {{ folderImportForm.thumbnailHeight || 400 }} 图片</span>
        <span><strong>大图：</strong>00.jpg</span>
        <span><strong>轮播：</strong>1.jpg 至 4.jpg</span>
        <span><strong>详情：</strong>型号对应的 HTML、01.jpg 起</span>
        <span><strong>参数：</strong>型号对应的 TXT</span>
      </div>

      <div class="folder-toolbar">
        <el-button type="primary" :loading="folderScanning" :disabled="folderImporting || directoryLoading" @click="scanFolderImport">
          扫描资料目录
        </el-button>
        <template v-if="folderScanResult">
          <el-tag effect="plain">发现 {{ folderScanResult.total }} 个型号</el-tag>
          <el-tag type="success" effect="plain">可导入 {{ folderScanResult.importable }} 个</el-tag>
          <el-tag v-if="folderScanResult.blocked" type="danger" effect="plain">需核对 {{ folderScanResult.blocked }} 个</el-tag>
          <el-tag v-if="folderScanResult.duplicates" type="warning" effect="plain">
            重名跳过 {{ folderScanResult.duplicates }} 个
          </el-tag>
        </template>
      </div>

      <el-table
        v-if="folderScanResult"
        :data="folderScanResult.items"
        border
        stripe
        height="420"
        empty-text="没有找到符合命名规则的型号文件夹"
      >
        <el-table-column prop="modelName" label="型号文件夹" min-width="160" show-overflow-tooltip>
          <template #default="scope">
            <div class="model-cell">
              <strong>{{ scope.row.modelName }}</strong>
              <small>{{ scope.row.relativePath }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="本型号参数 / 对应字段" min-width="325">
          <template #default="{ row }">
            <div class="parameter-preview">
              <strong>{{ parameterTypeLabel(row.parameterType) }}</strong>
              <small v-for="file in row.parameterFiles" :key="file">{{ file }}</small>
              <div v-for="parameter in row.parameters" :key="parameter.key" class="parameter-value">
                <span>{{ parameter.label }}<template v-if="parameter.unit"> ({{ parameter.unit }})</template></span>
                <b>{{ parameter.value || '未填写' }}</b>
                <small v-if="parameter.fieldName">{{ parameter.create ? '将新建独立字段并同步 PB：' : '复用同名同单位字段：' }}{{ parameter.fieldLabel }} · {{ parameter.fieldName }}</small>
              </div>
              <el-alert v-for="error in row.errors" :key="error" :title="error" type="error" :closable="false" />
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="thumbnailImage" label="缩略图" width="96">
          <template #default="scope">
            {{ scope.row.thumbnailImage || "-" }}
            <el-tag v-if="scope.row.thumbnailWillGenerate" type="info" size="small">待生成</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="largeImage" label="产品大图" width="96">
          <template #default="scope">{{ scope.row.largeImage || "-" }}</template>
        </el-table-column>
        <el-table-column label="轮播图" width="88" align="center">
          <template #default="scope">{{ scope.row.carouselImages.length }} 张</template>
        </el-table-column>
        <el-table-column prop="detailHtml" label="详情 HTML" min-width="150" show-overflow-tooltip>
          <template #default="scope">{{ scope.row.detailHtml || "-" }}</template>
        </el-table-column>
        <el-table-column label="详情图" width="88" align="center">
          <template #default="scope">{{ scope.row.detailImages.length }} 张</template>
        </el-table-column>
        <el-table-column label="状态" width="130" align="center">
          <template #default="scope">
            <el-tag v-if="scope.row.duplicate" type="warning">已存在，跳过</el-tag>
            <el-tag v-else-if="scope.row.errors?.length" type="danger">参数需核对</el-tag>
            <el-tooltip v-else-if="scope.row.warnings.length" :content="scope.row.warnings.join('；')" placement="top">
              <el-tag type="warning" effect="plain">可导入，有缺项</el-tag>
            </el-tooltip>
            <el-tag v-else type="success">资料完整</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button :disabled="folderScanning || folderImporting" @click="folderDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="folderImporting"
          :disabled="!folderScanResult?.importable || folderScanning || directoryLoading"
          @click="confirmFolderImport"
        >
          导入 {{ folderScanResult?.importable || 0 }} 个产品
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowRight, ArrowUp, Check, Connection, FolderOpened, HomeFilled, Monitor } from "@element-plus/icons-vue";
import ProductForm from "@/components/ProductForm.vue";
import DirectoryPath from "@/components/DirectoryPath.vue";
import { getAll, type MenuItem } from "@/api/menus";
import {
  createEmptyProductForm,
  createProduct,
  browseProductDirectory,
  importProductFolders,
  scanProductFolderImport,
  type ProductFolderScanResult,
  type ProductDirectoryListing,
  type ProductForm as ProductFormType,
} from "@/api/products";
import { filterMenusByContentLangAndModel } from "@/utils/menuLanguage";
import { API_BASE_URL, getErrorMessage } from "@/utils/request";
import { describeImportDirectory, describeImportSource } from "@/utils/import-directory";
import { useSitesStore } from "@/stores/sites";

const router = useRouter();
const sitesStore = useSitesStore();
const loading = ref(false);
const translatingAll = ref(false);
const translatingCurrent = ref(false);
const menus = ref<MenuItem[]>([]);
const productFormRef = ref<InstanceType<typeof ProductForm> | null>(null);
const translationProgress = computed(() => productFormRef.value?.translationStatus || "");
const folderDialogVisible = ref(false);
const folderScanning = ref(false);
const folderImporting = ref(false);
const folderScanResult = ref<ProductFolderScanResult | null>(null);
const folderImportForm = ref({ sourceDirectory: "", menuId: 0, parameterType: 'auto' as 'auto' | 'core' | 'water-well', thumbnailWidth: 500, thumbnailHeight: 400 });
const directoryLoading = ref(false);
const directoryBrowserVisible = ref(false);
const directoryListing = ref<ProductDirectoryListing | null>(null);
const directoryError = ref('');
const importSource = describeImportSource(API_BASE_URL, window.location.href);
const browsingDifferent = computed(() => describeImportDirectory(directoryListing.value?.currentPath || '').normalized !== describeImportDirectory(folderImportForm.value.sourceDirectory).normalized);
let directoryRequest = 0;
let active = true;
const inSite = (siteId: number) => active && siteId === sitesStore.activeSiteId;
const parameterTypeLabel = (type: string) => type === 'core' ? '岩芯钻机' : type === 'water-well' ? '水井钻机' : type === 'custom' ? '自定义三参数' : '未识别类型';

const form = ref<ProductFormType>(createEmptyProductForm());
const chineseProductMenus = computed(() => filterMenusByContentLangAndModel(menus.value, "zh-CN", "3"));

const formatMenuPath = (menu: MenuItem) => {
  const names: string[] = [];
  const visited = new Set<number>();
  let current: MenuItem | undefined = menu;
  while (current && !visited.has(Number(current.id))) {
    visited.add(Number(current.id));
    names.unshift(current.name);
    current = menus.value.find((item) => Number(item.id) === Number(current?.parentId || 0));
  }
  return names.join(" / ");
};
const selectedMenuPath = computed(() => {
  const menu = chineseProductMenus.value.find(item => Number(item.id) === Number(folderImportForm.value.menuId));
  return menu ? formatMenuPath(menu) : '';
});

const reset = () => {
  form.value = createEmptyProductForm();
};

const translateCurrentLanguage = async () => {
  translatingCurrent.value = true;
  try {
    await productFormRef.value?.generateCurrentTranslation();
  } finally {
    translatingCurrent.value = false;
  }
};

const translateAllLanguages = async () => {
  translatingAll.value = true;
  try {
    await productFormRef.value?.generateAllTranslations();
  } finally {
    translatingAll.value = false;
  }
};

const clearFolderScan = () => {
  folderScanResult.value = null;
};

const onDirectoryInput = () => {
  clearFolderScan();
  directoryBrowserVisible.value = false;
  directoryError.value = '';
};

const loadDirectory = async (directory = '', apply = false) => {
  const siteId = sitesStore.activeSiteId;
  if (!siteId) { directoryError.value = '请先在站点管理中选择一个网站'; return; }
  const requestId = ++directoryRequest;
  directoryLoading.value = true;
  directoryError.value = '';
  try {
    const { data } = await browseProductDirectory(siteId, directory || undefined);
    if (!inSite(siteId) || requestId !== directoryRequest || !folderDialogVisible.value) return;
    if (data.siteId !== siteId) throw new Error('目录不属于当前网站，请重新读取');
    directoryListing.value = data;
    if (apply) {
      folderImportForm.value.sourceDirectory = data.currentPath;
      clearFolderScan();
    }
  } catch (error) {
    if (inSite(siteId) && requestId === directoryRequest) directoryError.value = getErrorMessage(error, '读取服务器目录失败');
  } finally {
    if (requestId === directoryRequest) directoryLoading.value = false;
  }
};

const openDirectoryBrowser = () => {
  directoryBrowserVisible.value = true;
  void loadDirectory(folderImportForm.value.sourceDirectory.trim());
};

const useDirectory = () => {
  if (!directoryListing.value || directoryLoading.value || directoryError.value) return;
  folderImportForm.value.sourceDirectory = directoryListing.value.currentPath;
  directoryBrowserVisible.value = false;
  clearFolderScan();
};

const openFolderImport = () => {
  const selectedMenuId = Number(form.value.menuId || 0);
  const selectedIsValid = chineseProductMenus.value.some((item) => Number(item.id) === selectedMenuId);
  folderImportForm.value.menuId = selectedIsValid ? selectedMenuId : Number(chineseProductMenus.value[0]?.id || 0);
  folderScanResult.value = null;
  folderDialogVisible.value = true;
  directoryBrowserVisible.value = false;
  void loadDirectory('', !folderImportForm.value.sourceDirectory.trim());
};

const validateFolderImport = () => {
  if (!sitesStore.activeSiteId) { ElMessage.warning('请先选择网站'); return false; }
  if (![folderImportForm.value.thumbnailWidth, folderImportForm.value.thumbnailHeight].every(value => Number.isInteger(value) && value >= 64 && value <= 4096)) {
    ElMessage.warning('缩略图宽高必须为 64 到 4096 之间的整数像素');
    return false;
  }
  if (!folderImportForm.value.sourceDirectory.trim()) {
    ElMessage.warning("请填写产品资料目录");
    return false;
  }
  if (!folderImportForm.value.menuId) {
    ElMessage.warning("请选择中文产品栏目");
    return false;
  }
  return true;
};

const scanFolderImport = async () => {
  if (folderScanning.value || folderImporting.value || directoryLoading.value || !validateFolderImport()) return;
  const siteId = sitesStore.activeSiteId;
  folderScanning.value = true;
  try {
    const res = await scanProductFolderImport({
      sourceDirectory: folderImportForm.value.sourceDirectory.trim(),
      menuId: Number(folderImportForm.value.menuId),
      parameterType: folderImportForm.value.parameterType,
      thumbnailWidth: folderImportForm.value.thumbnailWidth,
      thumbnailHeight: folderImportForm.value.thumbnailHeight,
    }, siteId);
    if (!inSite(siteId) || !folderDialogVisible.value) return;
    folderScanResult.value = res.data;
    if (!res.data.total) ElMessage.warning("没有找到符合命名规则的型号文件夹");
  } catch (e) {
    if (!inSite(siteId)) return;
    folderScanResult.value = null;
    ElMessage.error(getErrorMessage(e, "扫描产品资料目录失败"));
  } finally {
    folderScanning.value = false;
  }
};

const confirmFolderImport = async () => {
  if (folderScanning.value || folderImporting.value || directoryLoading.value || !validateFolderImport() || !folderScanResult.value?.importable) return;
  const siteId = sitesStore.activeSiteId;
  const payload = { ...folderImportForm.value, sourceDirectory: folderImportForm.value.sourceDirectory.trim() };
  try {
    await ElMessageBox.confirm(
      `资料来源：${importSource.label}（${importSource.host}）\n导入目录：${payload.sourceDirectory}\n目标网站：${directoryListing.value?.siteName || sitesStore.activeSite?.name || siteId}\n目标中文栏目：${selectedMenuPath.value || folderScanResult.value.menuName}\n\n将新增 ${folderScanResult.value.importable} 个中文产品。已有 0.jpg 保持不变，缺少时生成 ${payload.thumbnailWidth} × ${payload.thumbnailHeight} 缩略图；缺少的参数字段会创建并同步 PB 字段。重复型号和参数有错误的型号跳过，不发布 PB 产品。确认继续吗？`,
      "确认批量导入",
      { confirmButtonText: "确认导入", cancelButtonText: "取消", type: "warning", customClass: 'folder-import-confirm' },
    );
  } catch {
    return;
  }

  if (!inSite(siteId) || !folderDialogVisible.value) return;
  folderImporting.value = true;
  try {
    const res = await importProductFolders(payload, siteId);
    if (!inSite(siteId)) return;
    const result = res.data;
    if (result.failedCount) {
      const details = result.failed.slice(0, 5).map((item) => `${item.modelName}：${item.reason}`).join("\n");
      await ElMessageBox.alert(
        `成功 ${result.createdCount} 个，跳过 ${result.skippedCount} 个，失败 ${result.failedCount} 个。\n${details}`,
        "批量导入完成",
        { type: "warning", confirmButtonText: "知道了" },
      );
    } else {
      ElMessage.success(`导入完成：新增 ${result.createdCount} 个，跳过 ${result.skippedCount} 个`);
    }
    if (result.createdCount) {
      folderDialogVisible.value = false;
      await router.push("/products");
    } else {
      folderScanResult.value = null;
    }
  } catch (e) {
    if (!inSite(siteId)) return;
    ElMessage.error(getErrorMessage(e, "批量导入产品失败"));
  } finally {
    folderImporting.value = false;
  }
};

const submit = async () => {
  loading.value = true;
  try {
    await createProduct({ ...form.value, author: "", source: "", menuId: Number(form.value.menuId), orderNum: Number(form.value.orderNum || 0) });
    ElMessage.success("新增产品成功");
    router.push("/products");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "新增产品失败"));
  } finally {
    loading.value = false;
  }
};

watch(() => sitesStore.activeSiteId, () => {
  ++directoryRequest;
  directoryLoading.value = false;
  directoryListing.value = null;
  directoryError.value = '';
  folderDialogVisible.value = false;
  folderImportForm.value.sourceDirectory = '';
  folderScanResult.value = null;
});
onBeforeUnmount(() => { active = false; ++directoryRequest; });

onMounted(async () => {
  try {
    const res = await getAll();
    menus.value = res.data;
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取栏目失败"));
  }
});
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-title h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.page-title p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}

.page-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 4px;
}

.folder-import-form {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr);
  gap: 14px;
}

.directory-input { display: flex; width: 100%; gap: 6px; min-width: 0; }
.directory-input .el-input { flex: 1; min-width: 0; }
.directory-input .el-button + .el-button { margin-left: 0; }
.import-source { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding-block: 2px 12px; border-bottom: 1px solid var(--el-border-color-light); font-size: 13px; }
.source-location { display: inline-flex; align-items: center; gap: 7px; color: var(--el-color-primary); font-size: 15px; }
.source-host { overflow-wrap: anywhere; color: var(--el-text-color-regular); }
.source-mode { color: var(--el-text-color-secondary); margin-left: auto; font-size: 12px; }
.directory-input + .directory-path { margin-top: 10px; }
.import-target { margin-top: 10px; width: 100%; min-width: 0; border-left: 3px solid var(--el-color-primary); padding: 10px 12px; background: var(--el-color-primary-light-9); display: flex; flex-direction: column; gap: 5px; line-height: 1.65; overflow-wrap: anywhere; box-sizing: border-box; }
.import-target > div { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
.import-target > b { font-size: 15px; }
.import-target > span { font-weight: 600; }
.folder-import-form > .el-form-item { min-width: 0; margin-bottom: 6px; }
:global(.folder-import-confirm .el-message-box__message p) { white-space: pre-line; overflow-wrap: anywhere; }
.directory-error, .server-directory, .thumbnail-settings { grid-column: 1 / -1; min-width: 0; }
.server-directory { border-block: 1px solid var(--el-border-color-light); padding: 12px 0; }
.directory-toolbar { display: flex; align-items: center; gap: 8px; }
.directory-toolbar .el-button + .el-button { margin-left: 0; }
.directory-toolbar strong { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.directory-toolbar + .directory-path { margin-top: 10px; }
.directory-folders { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); max-height: 220px; overflow-y: auto; gap: 0 16px; margin-top: 10px; }
.directory-entry { display: flex; align-items: center; gap: 8px; min-height: 38px; min-width: 0; border: 0; border-bottom: 1px solid var(--el-border-color-lighter); background: transparent; color: var(--el-text-color-primary); cursor: pointer; text-align: start; }
.directory-entry span { flex: 1; overflow-wrap: anywhere; }
.directory-entry:hover:not(:disabled) { background: var(--el-fill-color-light); }
.directory-entry:disabled { cursor: wait; opacity: .55; }
.directory-empty { padding: 16px; text-align: center; color: var(--el-text-color-secondary); }
.thumbnail-dimensions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.thumbnail-dimension { display: flex; gap: 10px; align-items: center; }
.thumbnail-dimensions .el-input-number { width: 130px; }

.folder-rule {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.parameter-type { grid-column: 1 / -1; }
:global(.folder-import-dialog) { display: flex; flex-direction: column; max-height: 90vh; }
:global(.folder-import-dialog .el-dialog__body) { min-height: 0; overflow-y: auto; }
:global(.folder-import-dialog .el-dialog__header),
:global(.folder-import-dialog .el-dialog__footer) { flex-shrink: 0; }
.parameter-preview { display: flex; flex-direction: column; gap: 6px; padding: 6px 0; }
.parameter-preview small { color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
.parameter-value { display: grid; grid-template-columns: 1fr; gap: 2px; padding: 5px 0; border-top: 1px solid var(--el-border-color-lighter); }
.parameter-value b { font-weight: 600; overflow-wrap: anywhere; }

.folder-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.model-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.model-cell small {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .page-title,
  .page-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .folder-import-form {
    grid-template-columns: 1fr;
  }
  .directory-folders { grid-template-columns: 1fr; }
  .directory-toolbar { flex-wrap: wrap; }
  .directory-toolbar strong { flex-basis: calc(100% - 110px); }
  .source-mode { margin-left: 0; flex-basis: 100%; }
}
</style>
