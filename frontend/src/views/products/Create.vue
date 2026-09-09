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
        <el-form-item label="产品资料目录">
          <el-input
            v-model="folderImportForm.sourceDirectory"
            clearable
            placeholder="例如：E:\产品资料\待导入"
            @input="clearFolderScan"
          />
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
        </el-form-item>
        <el-form-item label="参数类型" class="parameter-type">
          <el-radio-group v-model="folderImportForm.parameterType" @change="clearFolderScan">
            <el-radio-button value="auto">自动识别</el-radio-button>
            <el-radio-button value="core">岩芯钻机</el-radio-button>
            <el-radio-button value="water-well">水井钻机</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>

      <div class="folder-rule">
        <span><strong>型号：</strong>文件夹名称</span>
        <span><strong>缩略图：</strong>0.jpg，缺少时由 1.jpg 生成 500 × 400 图片</span>
        <span><strong>大图：</strong>00.jpg</span>
        <span><strong>轮播：</strong>1.jpg 至 4.jpg</span>
        <span><strong>详情：</strong>型号对应的 HTML、01.jpg 起</span>
        <span><strong>参数：</strong>型号对应的 TXT</span>
      </div>

      <div class="folder-toolbar">
        <el-button type="primary" :loading="folderScanning" :disabled="folderImporting" @click="scanFolderImport">
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
        <el-table-column label="参数 / 对应字段" min-width="325">
          <template #default="{ row }">
            <div class="parameter-preview">
              <strong>{{ parameterTypeLabel(row.parameterType) }}</strong>
              <small v-for="file in row.parameterFiles" :key="file">{{ file }}</small>
              <div v-for="parameter in row.parameters" :key="parameter.key" class="parameter-value">
                <span>{{ parameter.label }} ({{ parameter.unit }})</span>
                <b>{{ parameter.value || '未填写' }}</b>
                <small v-if="parameter.fieldName">{{ parameter.create ? '将新增：' : '对应：' }}{{ parameter.fieldLabel }} · {{ parameter.fieldName }}</small>
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
          :disabled="!folderScanResult?.importable || folderScanning"
          @click="confirmFolderImport"
        >
          导入 {{ folderScanResult?.importable || 0 }} 个产品
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { FolderOpened } from "@element-plus/icons-vue";
import ProductForm from "@/components/ProductForm.vue";
import { getAll, type MenuItem } from "@/api/menus";
import {
  createEmptyProductForm,
  createProduct,
  importProductFolders,
  scanProductFolderImport,
  type ProductFolderScanResult,
  type ProductForm as ProductFormType,
} from "@/api/products";
import { filterMenusByContentLangAndModel } from "@/utils/menuLanguage";
import { getErrorMessage } from "@/utils/request";

const router = useRouter();
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
const folderImportForm = ref<{ sourceDirectory: string; menuId: number; parameterType: 'auto' | 'core' | 'water-well' }>({ sourceDirectory: "", menuId: 0, parameterType: 'auto' });
const parameterTypeLabel = (type: string) => type === 'core' ? '岩芯钻机' : type === 'water-well' ? '水井钻机' : '未识别类型';

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

const openFolderImport = () => {
  const selectedMenuId = Number(form.value.menuId || 0);
  const selectedIsValid = chineseProductMenus.value.some((item) => Number(item.id) === selectedMenuId);
  folderImportForm.value.menuId = selectedIsValid ? selectedMenuId : Number(chineseProductMenus.value[0]?.id || 0);
  folderScanResult.value = null;
  folderDialogVisible.value = true;
};

const validateFolderImport = () => {
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
  if (!validateFolderImport()) return;
  folderScanning.value = true;
  try {
    const res = await scanProductFolderImport({
      sourceDirectory: folderImportForm.value.sourceDirectory.trim(),
      menuId: Number(folderImportForm.value.menuId),
      parameterType: folderImportForm.value.parameterType,
    });
    folderScanResult.value = res.data;
    if (!res.data.total) ElMessage.warning("没有找到符合命名规则的型号文件夹");
  } catch (e) {
    folderScanResult.value = null;
    ElMessage.error(getErrorMessage(e, "扫描产品资料目录失败"));
  } finally {
    folderScanning.value = false;
  }
};

const confirmFolderImport = async () => {
  if (!validateFolderImport() || !folderScanResult.value?.importable) return;
  try {
    await ElMessageBox.confirm(
      `将在“${folderScanResult.value.menuName}”新增 ${folderScanResult.value.importable} 个中文产品，保存扫描出的参数；缺少的对应字段会在本项目创建。重复型号和参数有错误的型号跳过，不发布 PB 产品。确认继续吗？`,
      "确认批量导入",
      { confirmButtonText: "确认导入", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }

  folderImporting.value = true;
  try {
    const res = await importProductFolders({
      sourceDirectory: folderImportForm.value.sourceDirectory.trim(),
      menuId: Number(folderImportForm.value.menuId),
      parameterType: folderImportForm.value.parameterType,
    });
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
      await scanFolderImport();
    }
  } catch (e) {
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
}
</style>
