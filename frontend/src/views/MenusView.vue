<template>
  <section class="page">
    <div class="page-bar">
      <div>
        <h2>菜单管理</h2>
        <p>按语言查看网站栏目；中文作为翻译母版，模型、列表模板、详情模板不在这里维护。</p>
      </div>
      <div class="actions">
        <el-select v-model="translateModel" class="model-select" placeholder="翻译模型">
          <el-option
            v-for="item in translationModels"
            :key="item.value"
            :label="item.available ? (item.displayLabel || item.label) : `${item.displayLabel || item.label}（未配置）`"
            :value="item.value"
            :disabled="!item.available"
          />
        </el-select>
        <el-button type="primary" plain :loading="translating" @click="translateMenus">一键翻译栏目</el-button>
        <el-button type="success" :loading="syncing" @click="syncMenusFromPboot">一键获取PB栏目</el-button>
        <el-button type="warning" plain :loading="pushingAll" @click="syncAllMenusToWebsite">同步全部到网站</el-button>
        <el-button @click="toggleAll(true)">全部展开</el-button>
        <el-button @click="toggleAll(false)">全部收起</el-button>
        <el-button type="primary" @click="router.push('/menus/create')">
          <el-icon><Plus /></el-icon>
          添加菜单
        </el-button>
      </div>
    </div>

    <div class="summary-row">
      <el-radio-group v-model="selectedLang" class="language-tabs">
        <el-radio-button v-for="item in languageOptions" :key="item.code" :label="item.code">
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
      <el-table-column label="操作" fixed="right" width="250" align="center">
        <template #default="{ row }">
          <el-button type="success" link :loading="syncingMenuId === row.id" @click="syncMenuToWebsite(row)">同步网站</el-button>
          <el-button type="primary" link @click="router.push({ name: 'editMenus', params: { id: row.id } })">编辑</el-button>
          <el-button type="danger" link @click="deleteMenu(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox, type TableInstance } from "element-plus";
import { Plus } from "@element-plus/icons-vue";
import { useRouter } from "vue-router";
import useMenus from "@/hooks/useMenus";
import { getUploadUrl } from "@/api/uploads";
import TranslationModelInfo from "@/components/TranslationModelInfo.vue";
import type { MenuItem, MenuTranslationModel } from "@/api/menus";
import {
  getMenuTranslationModels,
  syncAllMenusToPboot,
  syncMenuToPboot,
  syncPbootMenus,
  translateMenusFromChinese,
} from "@/api/menus";
import { getErrorMessage } from "@/utils/request";

type MenuTreeItem = MenuItem & {
  children?: MenuTreeItem[];
  parentName: string;
  level: number;
  levelLabel: string;
  isOrphan: boolean;
};

const router = useRouter();
const tableRef = ref<TableInstance>();
const syncing = ref(false);
const translating = ref(false);
const pushingAll = ref(false);
const syncingMenuId = ref<string | number | null>(null);
const selectedLang = ref("cn");
const translateModel = ref("google-free");
const translationModels = ref<MenuTranslationModel[]>([]);
const { allMenus, loading, handleDelete, getAllMenus } = useMenus();

const selectedTranslationModel = computed(() =>
  translationModels.value.find((item) => item.value === translateModel.value) || null,
);

const languageLabels: Record<string, string> = {
  cn: "中文",
  en: "English",
  es: "Español",
  fr: "Français",
  ru: "Русский",
  ar: "العربية",
  pt: "Português",
};

const languageOrder = ["cn", "en", "es", "fr", "ru", "ar", "pt"];

const getMenuLang = (item: Pick<MenuItem, "code">) => {
  const match = String(item.code || "").match(/^pboot:([^:]+):/);
  return match?.[1] || "";
};

const languageOptions = computed(() => {
  const counts = new Map<string, number>();
  allMenus.value.forEach((item) => {
    const lang = getMenuLang(item);
    if (lang) counts.set(lang, (counts.get(lang) || 0) + 1);
  });

  return languageOrder
    .filter((code) => counts.has(code))
    .map((code) => ({
      code,
      label: languageLabels[code] || code,
      count: counts.get(code) || 0,
    }));
});

const visibleMenus = computed(() => allMenus.value.filter((item) => getMenuLang(item) === selectedLang.value));

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
    if (!parent) {
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
    translationModels.value = [...res.data].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
    const preferred = translationModels.value.find((item) => item.available);
    if (preferred && !translationModels.value.some((item) => item.value === translateModel.value && item.available)) {
      translateModel.value = preferred.value;
    }
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取翻译模型失败"));
  }
};

const syncMenusFromPboot = async () => {
  const confirmed = await ElMessageBox.confirm(
    "将以 PB 网站栏目为准，覆盖当前后台菜单栏目；只同步栏目基础信息，不同步模型、列表模板、详情模板。确认继续吗？",
    "一键获取 PB 栏目",
    { confirmButtonText: "开始获取", cancelButtonText: "取消", type: "warning" },
  ).catch(() => false);
  if (!confirmed) return;

  syncing.value = true;
  try {
    const res = await syncPbootMenus();
    ElMessage.success(`栏目获取完成：删除旧栏目 ${res.data.removed} 个，导入 ${res.data.created} 个`);
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

const translateMenus = async () => {
  const confirmed = await ElMessageBox.confirm(
    "将以中文栏目名称为母版，翻译其他 6 种语言的栏目名称；不会修改 URL、路径、模型、列表模板、详情模板。确认继续吗？",
    "一键翻译栏目",
    { confirmButtonText: "开始翻译", cancelButtonText: "取消", type: "warning" },
  ).catch(() => false);
  if (!confirmed) return;

  translating.value = true;
  try {
    const res = await translateMenusFromChinese(translateModel.value);
    const count = res.data.results.reduce((sum, item) => sum + item.translated, 0);
    ElMessage.success(`栏目翻译完成：共更新 ${count} 个栏目名称`);
    await getAllMenus();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "栏目翻译失败"));
  } finally {
    translating.value = false;
  }
};

const syncAllMenusToWebsite = async () => {
  const confirmed = await ElMessageBox.confirm(
    "将把当前后台所有栏目名称、归属、路径、图标、显示状态和排序写回 PB 网站数据库；模型和模板不会修改。确认继续吗？",
    "同步全部栏目到网站",
    { confirmButtonText: "开始同步", cancelButtonText: "取消", type: "warning" },
  ).catch(() => false);
  if (!confirmed) return;

  pushingAll.value = true;
  try {
    const res = await syncAllMenusToPboot();
    ElMessage.success(`同步完成：更新 ${res.data.updated} 个，跳过 ${res.data.skipped} 个`);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步全部栏目失败"));
  } finally {
    pushingAll.value = false;
  }
};

const syncMenuToWebsite = async (row: MenuTreeItem) => {
  const confirmed = await ElMessageBox.confirm(
    `确认把栏目「${row.name}」的名称、归属、路径、图标、显示状态和排序同步到网站数据库吗？模型和模板不会修改。`,
    "同步栏目到网站",
    { confirmButtonText: "开始同步", cancelButtonText: "取消", type: "warning" },
  ).catch(() => false);
  if (!confirmed) return;

  syncingMenuId.value = row.id;
  try {
    const res = await syncMenuToPboot(row.id);
    ElMessage.success(`栏目已同步到网站：${res.data.acode}/${res.data.scode}`);
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
