<template>
  <section class="dashboard">
    <div class="page-title">
      <h2>后台概览</h2>
      <p>当前前端已连接 NestJS 后端服务。</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <span>用户数量</span>
        <strong>{{ users.length }}</strong>
      </div>
      <div class="stat-card">
        <span>菜单数量</span>
        <strong>{{ menus.length }}</strong>
      </div>
      <div class="stat-card">
        <span>新闻数量</span>
        <strong>{{ newsList.length }}</strong>
      </div>
      <div class="stat-card">
        <span>产品数量</span>
        <strong>{{ productList.length }}</strong>
      </div>
      <div class="stat-card">
        <span>当前账号</span>
        <strong>{{ profileEmail || "未获取" }}</strong>
      </div>
    </div>

    <div class="backup-panel">
      <div class="backup-head">
        <div>
          <h3>后端数据库备份</h3>
          <p>备份当前接口数据库，作为以后同步回 PB 网站库的干净母库。</p>
        </div>
        <el-button type="primary" :loading="backupLoading" @click="handleCreateDatabaseBackup">备份当前数据库</el-button>
      </div>
      <div class="backup-meta">
        <el-tag :type="currentDbInfo?.healthy === false ? 'danger' : 'success'" effect="plain">
          {{ currentDbInfo?.healthy === false ? "当前库有警告" : "当前库正常" }}
        </el-tag>
        <el-tag effect="plain">菜单 {{ currentDbInfo?.counts?.menu ?? "-" }}</el-tag>
        <el-tag effect="plain">新闻 {{ currentDbInfo?.counts?.news ?? "-" }}</el-tag>
        <el-tag effect="plain">产品 {{ currentDbInfo?.counts?.product ?? "-" }}</el-tag>
        <el-tag effect="plain">单页 {{ currentDbInfo?.counts?.page ?? "-" }}</el-tag>
        <el-tag effect="plain">视频 {{ currentDbInfo?.counts?.video ?? "-" }}</el-tag>
        <span class="backup-path">{{ currentDbInfo?.sourcePath }}</span>
      </div>
      <el-table :data="databaseBackups.slice(0, 5)" border stripe>
        <el-table-column prop="fileName" label="最近备份" min-width="260" />
        <el-table-column label="大小" width="120">
          <template #default="{ row }">{{ formatFileSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.healthy === false ? 'danger' : 'success'">{{ row.healthy === false ? "有警告" : "正常" }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="新闻/产品/视频" width="150">
          <template #default="{ row }">{{ row.counts?.news || 0 }} / {{ row.counts?.product || 0 }} / {{ row.counts?.video || 0 }}</template>
        </el-table-column>
        <el-table-column label="备份时间" width="190">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="backupPath" label="路径" min-width="360" show-overflow-tooltip />
      </el-table>
    </div>

    <el-table :data="menus.slice(0, 5)" border stripe>
      <el-table-column prop="name" label="最近菜单" />
      <el-table-column prop="href" label="路径" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.show ? 'success' : 'info'">{{ row.show ? "显示" : "隐藏" }}</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <el-table :data="newsList.slice(0, 5)" border stripe>
      <el-table-column prop="title" label="最近新闻" />
      <el-table-column label="栏目" width="180">
        <template #default="{ row }">{{ getMenuName(row.menuId) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.show ? 'success' : 'info'">{{ row.show ? "显示" : "隐藏" }}</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <el-table :data="productList.slice(0, 5)" border stripe>
      <el-table-column prop="title" label="最近产品" />
      <el-table-column label="栏目" width="180">
        <template #default="{ row }">{{ getMenuName(row.menuId) }}</template>
      </el-table-column>
      <el-table-column label="轮播图" width="100">
        <template #default="{ row }">{{ row.carouselImages?.length || 0 }} 张</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.show ? 'success' : 'info'">{{ row.show ? "显示" : "隐藏" }}</el-tag>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { getAll, type MenuItem } from "@/api/menus";
import { getNewsList, type NewsItem } from "@/api/news";
import { getProductList, type ProductItem } from "@/api/products";
import { getInfo, getUsers, type UserInfo } from "@/api/users";
import { createDatabaseBackup, getCurrentDatabaseInfo, getDatabaseBackups, type DatabaseBackupInfo } from "@/api/databaseBackups";
import { getErrorMessage } from "@/utils/request";

const users = ref<UserInfo[]>([]);
const menus = ref<MenuItem[]>([]);
const newsList = ref<NewsItem[]>([]);
const productList = ref<ProductItem[]>([]);
const profileEmail = ref("");
const currentDbInfo = ref<DatabaseBackupInfo | null>(null);
const databaseBackups = ref<DatabaseBackupInfo[]>([]);
const backupLoading = ref(false);

const getMenuName = (menuId: number) => {
  const item = menus.value.find((menu) => Number(menu.id) === Number(menuId));
  const parent = item && Number(item.parentId) !== 0 ? menus.value.find((menu) => Number(menu.id) === Number(item.parentId)) : null;
  return item ? (parent ? `${parent.name} / ${item.name}` : item.name) : `栏目 #${menuId}`;
};

const formatFileSize = (size = 0) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
};

const formatDate = (value?: string) => {
  if (!value) return "-";
  return new Date(value).toLocaleString();
};

const loadDashboard = async () => {
  try {
    const [userRes, menuRes, newsRes, productRes, profileRes, dbInfoRes, backupRes] = await Promise.all([
      getUsers(),
      getAll(),
      getNewsList(),
      getProductList(),
      getInfo(),
      getCurrentDatabaseInfo(),
      getDatabaseBackups(),
    ]);
    users.value = userRes.data;
    menus.value = menuRes.data;
    newsList.value = newsRes.data;
    productList.value = productRes.data;
    profileEmail.value = profileRes.data?.email || "";
    currentDbInfo.value = dbInfoRes.data;
    databaseBackups.value = backupRes.data;
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "加载首页数据失败"));
  }
};

const handleCreateDatabaseBackup = async () => {
  backupLoading.value = true;
  try {
    const res = await createDatabaseBackup();
    currentDbInfo.value = res.data;
    const backupRes = await getDatabaseBackups();
    databaseBackups.value = backupRes.data;
    ElMessage.success(`数据库备份完成：${res.data.fileName}`);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "数据库备份失败"));
  } finally {
    backupLoading.value = false;
  }
};

onMounted(loadDashboard);
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
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

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.stat-card,
.backup-panel {
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.stat-card {
  display: flex;
  min-height: 92px;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 18px;
}

.stat-card span {
  color: var(--el-text-color-regular);
}

.stat-card strong {
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: 24px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.backup-panel {
  padding: 16px;
}

.backup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.backup-head h3 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 18px;
}

.backup-head p {
  margin: 4px 0 0;
  color: var(--el-text-color-regular);
}

.backup-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.backup-path {
  min-width: 0;
  color: var(--el-text-color-regular);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .backup-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
