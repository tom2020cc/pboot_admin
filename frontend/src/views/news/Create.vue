<template>
  <section class="page">
    <div class="page-title">
      <div>
        <h2>添加新闻</h2>
        <p>填写栏目、缩略图和当前网站已配置语言的新闻内容。</p>
      </div>
      <div class="page-actions">
        <el-button :icon="FolderOpened" :disabled="loading" @click="openFolderImport">文件夹批量导入</el-button>
        <el-button plain :loading="translatingCurrent" :disabled="loading || translatingAll" @click="translateCurrentLanguage">
          只翻译当前语言
        </el-button>
        <el-button type="primary" plain :loading="translatingAll" :disabled="loading || translatingCurrent" @click="translateAllLanguages">
          {{ translatingAll ? "正在顺序翻译..." : "一键翻译" }}
        </el-button>
      </div>
    </div>
    <NewsForm ref="newsFormRef" v-model="form" :menus="menus" submit-text="新建新闻" :loading="loading" @submit="submit" @reset="reset" />

    <el-dialog v-model="folderDialogVisible" title="文件夹批量导入新闻" width="min(900px, 94vw)" destroy-on-close>
      <el-form label-position="top" class="folder-import-form">
        <el-form-item label="新闻资料目录">
          <el-input
            v-model="folderImportForm.sourceDirectory"
            clearable
            placeholder="例如：E:\新闻资料\待导入"
            @input="clearFolderScan"
          />
        </el-form-item>
        <el-form-item label="导入到中文新闻栏目">
          <el-select
            v-model="folderImportForm.menuId"
            filterable
            placeholder="请选择中文新闻栏目"
            style="width: 100%"
            @change="clearFolderScan"
          >
            <el-option
              v-for="item in chineseNewsMenus"
              :key="item.id"
              :label="formatMenuPath(item)"
              :value="Number(item.id)"
            />
          </el-select>
        </el-form-item>
      </el-form>

      <div class="folder-rule">
        <span><strong>标题：</strong>文件夹名称</span>
        <span><strong>缩略图：</strong>0.jpg，缺少时由 1.jpg 生成 500 × 400 图片</span>
        <span><strong>正文：</strong>*_index.html</span>
        <span><strong>正文图片：</strong>01.jpg 起，随机插入 H 标题前</span>
      </div>

      <div class="folder-toolbar">
        <el-button type="primary" :loading="folderScanning" :disabled="folderImporting" @click="scanFolderImport">
          扫描资料目录
        </el-button>
        <template v-if="folderScanResult">
          <el-tag effect="plain">发现 {{ folderScanResult.total }} 篇新闻</el-tag>
          <el-tag type="success" effect="plain">可导入 {{ folderScanResult.importable }} 篇</el-tag>
          <el-tag v-if="folderScanResult.duplicates" type="warning" effect="plain">
            重名跳过 {{ folderScanResult.duplicates }} 篇
          </el-tag>
        </template>
      </div>

      <el-table
        v-if="folderScanResult"
        :data="folderScanResult.items"
        border
        stripe
        height="420"
        empty-text="没有找到符合命名规则的新闻文件夹"
      >
        <el-table-column prop="title" label="新闻文件夹 / 标题" min-width="220" show-overflow-tooltip>
          <template #default="scope">
            <div class="title-cell">
              <strong>{{ scope.row.title }}</strong>
              <small>{{ scope.row.relativePath }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="thumbnailImage" label="缩略图" width="100">
          <template #default="scope">
            {{ scope.row.thumbnailImage || "-" }}
            <el-tag v-if="scope.row.thumbnailWillGenerate" type="info" size="small">待生成</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="detailHtml" label="正文 HTML" min-width="170" show-overflow-tooltip>
          <template #default="scope">{{ scope.row.detailHtml || "-" }}</template>
        </el-table-column>
        <el-table-column label="正文图片" width="96" align="center">
          <template #default="scope">{{ scope.row.detailImages.length }} 张</template>
        </el-table-column>
        <el-table-column label="状态" width="130" align="center">
          <template #default="scope">
            <el-tag v-if="scope.row.duplicate" type="warning">已存在，跳过</el-tag>
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
          导入 {{ folderScanResult?.importable || 0 }} 篇新闻
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
import NewsForm from "@/components/NewsForm.vue";
import { getAll, type MenuItem } from "@/api/menus";
import {
  createEmptyNewsForm,
  createNews,
  importNewsFolders,
  scanNewsFolderImport,
  type NewsFolderScanResult,
  type NewsForm as NewsFormType,
} from "@/api/news";
import { getErrorMessage } from "@/utils/request";
import { filterMenusByContentLangAndModel } from "@/utils/menuLanguage";

const router = useRouter();
const loading = ref(false);
const translatingAll = ref(false);
const translatingCurrent = ref(false);
const menus = ref<MenuItem[]>([]);
const newsFormRef = ref<InstanceType<typeof NewsForm> | null>(null);
const form = ref<NewsFormType>(createEmptyNewsForm());
const folderDialogVisible = ref(false);
const folderScanning = ref(false);
const folderImporting = ref(false);
const folderScanResult = ref<NewsFolderScanResult | null>(null);
const folderImportForm = ref({ sourceDirectory: "", menuId: 0 });
const chineseNewsMenus = computed(() => filterMenusByContentLangAndModel(menus.value, "zh-CN", "2"));

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
  form.value = createEmptyNewsForm();
};

const translateAllLanguages = async () => {
  translatingAll.value = true;
  try {
    await newsFormRef.value?.generateAllTranslations();
  } finally {
    translatingAll.value = false;
  }
};

const translateCurrentLanguage = async () => {
  translatingCurrent.value = true;
  try {
    await newsFormRef.value?.generateCurrentTranslation();
  } finally {
    translatingCurrent.value = false;
  }
};

const clearFolderScan = () => {
  folderScanResult.value = null;
};

const openFolderImport = () => {
  const selectedMenuId = Number(form.value.menuId || 0);
  const selectedIsValid = chineseNewsMenus.value.some((item) => Number(item.id) === selectedMenuId);
  folderImportForm.value.menuId = selectedIsValid ? selectedMenuId : Number(chineseNewsMenus.value[0]?.id || 0);
  folderScanResult.value = null;
  folderDialogVisible.value = true;
};

const validateFolderImport = () => {
  if (!folderImportForm.value.sourceDirectory.trim()) {
    ElMessage.warning("请填写新闻资料目录");
    return false;
  }
  if (!folderImportForm.value.menuId) {
    ElMessage.warning("请选择中文新闻栏目");
    return false;
  }
  return true;
};

const scanFolderImport = async () => {
  if (!validateFolderImport()) return;
  folderScanning.value = true;
  try {
    const res = await scanNewsFolderImport({
      sourceDirectory: folderImportForm.value.sourceDirectory.trim(),
      menuId: Number(folderImportForm.value.menuId),
    });
    folderScanResult.value = res.data;
    if (!res.data.total) ElMessage.warning("没有找到符合命名规则的新闻文件夹");
  } catch (e) {
    folderScanResult.value = null;
    ElMessage.error(getErrorMessage(e, "扫描新闻资料目录失败"));
  } finally {
    folderScanning.value = false;
  }
};

const confirmFolderImport = async () => {
  if (!validateFolderImport() || !folderScanResult.value?.importable) return;
  try {
    await ElMessageBox.confirm(
      `将在“${folderScanResult.value.menuName}”新增 ${folderScanResult.value.importable} 篇中文新闻，确认继续吗？`,
      "确认批量导入",
      { confirmButtonText: "确认导入", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }

  folderImporting.value = true;
  try {
    const res = await importNewsFolders({
      sourceDirectory: folderImportForm.value.sourceDirectory.trim(),
      menuId: Number(folderImportForm.value.menuId),
    });
    const result = res.data;
    if (result.failedCount) {
      const details = result.failed.slice(0, 5).map((item) => `${item.title}：${item.reason}`).join("\n");
      await ElMessageBox.alert(
        `成功 ${result.createdCount} 篇，跳过 ${result.skippedCount} 篇，失败 ${result.failedCount} 篇。\n${details}`,
        "批量导入完成",
        { type: "warning", confirmButtonText: "知道了" },
      );
    } else {
      ElMessage.success(`导入完成：新增 ${result.createdCount} 篇，跳过 ${result.skippedCount} 篇`);
    }
    if (result.createdCount) {
      folderDialogVisible.value = false;
      await router.push("/news");
    } else {
      await scanFolderImport();
    }
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "批量导入新闻失败"));
  } finally {
    folderImporting.value = false;
  }
};

const submit = async () => {
  loading.value = true;
  try {
    await createNews({ ...form.value, author: "", source: "" });
    ElMessage.success("新增新闻成功");
    router.push("/news");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "新增新闻失败"));
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
  width: 100%;
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

.folder-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.title-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.title-cell small {
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
