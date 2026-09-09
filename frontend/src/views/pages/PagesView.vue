<template>
  <section class="page">
    <div class="page-bar">
      <div>
        <h2>单页管理</h2>
        <p>同步和维护关于我们、联系我们等单页栏目内容，可按语言查看并写回 PbootCMS。</p>
      </div>
      <div class="page-actions">
        <el-button type="warning" plain :loading="importing" @click="handleImportFromPboot">一键同步PB数据</el-button>
        <el-button type="success" plain :loading="syncingAll" @click="handleSyncAll">同步全部单页</el-button>
        <el-button type="primary" @click="router.push('/pages/create')">
          <el-icon><Plus /></el-icon>
          添加单页
        </el-button>
      </div>
    </div>

    <div class="filter-row">
      <el-select v-model="filterMenuId" clearable placeholder="按栏目筛选" class="filter-select" @change="loadPages">
        <el-option v-for="item in menuOptions" :key="item.id" :label="item.optionLabel" :value="Number(item.id)" />
      </el-select>
      <el-select v-model="currentLang" placeholder="显示语言" class="lang-select" @change="handleLangChange">
        <el-option v-for="item in availableLanguages" :key="item.code" :label="item.name" :value="item.code" />
      </el-select>
      <el-button @click="loadPages">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="pageList" border stripe class="data-table">
      <el-table-column prop="id" label="ID" width="90" align="center" />
      <el-table-column type="index" label="序号" width="70" align="center" />
      <el-table-column prop="title" label="页面标题" min-width="260" />
      <el-table-column label="内容栏目" min-width="180">
        <template #default="{ row }">{{ getMenuName(row.menuId) }}</template>
      </el-table-column>
      <el-table-column label="语言" width="100" align="center">
        <template #default="{ row }">{{ getLanguageName(row.lang || currentLang) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.show ? 'success' : 'info'">{{ row.show ? "显示" : "隐藏" }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="orderNum" label="排序" width="80" align="center" />
      <el-table-column prop="updateTime" label="更新时间" min-width="180" />
      <el-table-column label="操作" fixed="right" width="290" align="center">
        <template #default="{ row }">
          <el-button type="info" link @click="router.push({ name: 'pageDetail', params: { id: row.id }, query: { lang: currentLang } })">查看</el-button>
          <el-button type="primary" link @click="router.push({ name: 'editPage', params: { id: row.id } })">编辑</el-button>
          <el-button type="success" link :loading="syncingId === row.id" @click="handleSync(row.id)">同步网站</el-button>
          <el-button type="danger" link @click="handleDelete(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus } from "@element-plus/icons-vue";
import { getAll, type MenuItem } from "@/api/menus";
import { DEFAULT_NEWS_LANG, NEWS_LANGUAGES, getPageList, importPagesFromPboot, removePage, syncAllPagesToPboot, syncPageToPboot, type PageItem } from "@/api/pages";
import { getErrorMessage } from "@/utils/request";
import { filterMenusByContentLangAndModel, findEquivalentMenuForLang, formatMenuPathForLang } from "@/utils/menuLanguage";
import { useAvailableLanguages } from "@/composables/useAvailableLanguages";

const router = useRouter();
const availableLanguages = useAvailableLanguages();
const loading = ref(false);
const importing = ref(false);
const syncingAll = ref(false);
const syncingId = ref<number | null>(null);
const pageList = ref<PageItem[]>([]);
const menus = ref<MenuItem[]>([]);
const filterMenuId = ref<number | undefined>();
const currentLang = ref(DEFAULT_NEWS_LANG);

const currentMenus = computed(() => filterMenusByContentLangAndModel(menus.value, currentLang.value, "1"));
const menuOptions = computed(() => currentMenus.value.map((item) => ({ ...item, optionLabel: `单页栏目 / ${item.name}` })));

const getMenuName = (menuId: number) => formatMenuPathForLang(menus.value, menuId, currentLang.value, "1");
const getLanguageName = (lang: string) => NEWS_LANGUAGES.find((item) => item.code === lang)?.name || lang;

const loadMenus = async () => {
  const res = await getAll();
  menus.value = res.data;
};

const loadPages = async () => {
  loading.value = true;
  try {
    const res = await getPageList(filterMenuId.value, currentLang.value);
    pageList.value = res.data;
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取单页列表失败"));
  } finally {
    loading.value = false;
  }
};

const handleLangChange = async () => {
  if (filterMenuId.value) {
    const nextMenu = findEquivalentMenuForLang(menus.value, filterMenuId.value, currentLang.value, "1");
    filterMenuId.value = nextMenu ? Number(nextMenu.id) : undefined;
  }
  await loadPages();
};

const handleImportFromPboot = async () => {
  const confirmed = await ElMessageBox.confirm("确认从 PbootCMS 覆盖同步单页内容吗？会先备份本地数据库。", "同步 PB 单页", {
    confirmButtonText: "开始同步",
    cancelButtonText: "取消",
    type: "warning",
  }).catch(() => false);
  if (!confirmed) return;

  importing.value = true;
  try {
    const res = await importPagesFromPboot();
    ElMessage.success(`单页同步完成：导入 ${res.data.imported} 个，语言版本 ${res.data.importedTranslations} 条`);
    filterMenuId.value = undefined;
    currentLang.value = DEFAULT_NEWS_LANG;
    await loadPages();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "从 PB 同步单页失败"));
  } finally {
    importing.value = false;
  }
};

const handleSync = async (id: number) => {
  syncingId.value = id;
  try {
    await syncPageToPboot(id, { lang: currentLang.value });
    ElMessage.success("已同步当前语言到网站");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步到网站失败"));
  } finally {
    syncingId.value = null;
  }
};

const handleSyncAll = async () => {
  syncingAll.value = true;
  try {
    const res = await syncAllPagesToPboot();
    ElMessage.success(`已同步 ${res.data.syncedCount || 0} 条单页语言内容到网站`);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步全部单页失败"));
  } finally {
    syncingAll.value = false;
  }
};

const handleDelete = async (id: number) => {
  const confirmed = await ElMessageBox.confirm("确认删除该单页吗？这里只删除本地后台记录，不会删除 PB 栏目。", "删除提醒", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  }).catch(() => false);
  if (!confirmed) return;

  try {
    await removePage(id);
    ElMessage.success("删除单页成功");
    await loadPages();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "删除单页失败"));
  }
};

onMounted(async () => {
  await loadMenus();
  await loadPages();
});
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-bar,
.filter-row,
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

.filter-select {
  width: 280px;
}

.lang-select {
  width: 160px;
}
</style>
