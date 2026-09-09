<template>
  <el-header class="header">
    <div class="left">
      <el-button text class="collapse-btn" @click="isCollapse = !isCollapse">
        <el-icon>
          <Expand v-show="isCollapse" />
          <Fold v-show="!isCollapse" />
        </el-icon>
      </el-button>
      <el-breadcrumb separator="/">
        <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
        <el-breadcrumb-item>{{ route.meta.title || "页面" }}</el-breadcrumb-item>
      </el-breadcrumb>
      <div class="site-switcher">
        <el-icon><Monitor /></el-icon>
        <el-select
          v-model="activeSiteId"
          size="small"
          filterable
          :loading="sitesLoading"
          placeholder="选择站点"
          @change="handleSiteChange"
        >
          <el-option v-for="site in enabledSites" :key="site.id" :label="site.name" :value="site.id">
            <span>{{ site.name }}</span>
            <small>{{ site.code }}</small>
          </el-option>
        </el-select>
        <el-tooltip content="站点管理" placement="bottom">
          <el-button text class="site-settings" :icon="Setting" aria-label="站点管理" @click="router.push('/sites')" />
        </el-tooltip>
      </div>
    </div>

    <el-dropdown>
      <span class="user-trigger">
        <el-avatar :size="36">{{ avatarText }}</el-avatar>
        <span>{{ userInfo.email || "未登录" }}</span>
        <el-icon><ArrowDown /></el-icon>
      </span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item disabled>{{ userInfo.email }}</el-dropdown-item>
          <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </el-header>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive } from "vue";
import { storeToRefs } from "pinia";
import { isCollapse } from "@/components/layout/isCollapse";
import { useMyTokenStore } from "@/stores/myToken";
import { getInfo } from "@/api/users";
import { ElMessageBox, ElMessage } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import { ArrowDown, Expand, Fold, Monitor, Setting } from "@element-plus/icons-vue";
import { useSitesStore } from "@/stores/sites";

const router = useRouter();
const route = useRoute();
const userInfo = reactive({ email: "" });
const tokenStore = useMyTokenStore();
const sitesStore = useSitesStore();
const { activeSiteId, enabledSites, loading: sitesLoading } = storeToRefs(sitesStore);

const avatarText = computed(() => (userInfo.email ? userInfo.email.slice(0, 1).toUpperCase() : "U"));

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm("确定要退出登录吗？", "退出确认", {
      confirmButtonText: "确认",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    ElMessage.info("退出操作已取消");
    return;
  }
  tokenStore.saveToken("");
  ElMessage.success("已退出登录");
  router.push({ path: "/login" });
};

async function getUser() {
  const res = await getInfo();
  userInfo.email = res?.data?.email || "";
}

const handleSiteChange = (siteId: number) => sitesStore.selectSite(siteId);

getUser();
onMounted(() => sitesStore.refresh().catch(() => undefined));
</script>

<style lang="scss" scoped>
.header {
  display: flex;
  height: 64px;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
}

.left,
.user-trigger {
  display: flex;
  align-items: center;
  gap: 12px;
}

.site-switcher {
  display: flex;
  height: 38px;
  align-items: center;
  gap: 8px;
  margin-left: 10px;
  padding-left: 16px;
  border-left: 1px solid var(--el-border-color-light);

  :deep(.el-select) { width: 190px; }
  :deep(.el-select-dropdown__item) { display: flex; justify-content: space-between; gap: 16px; }
  small { color: var(--el-text-color-secondary); }
}

.site-settings { width: 30px; height: 30px; }

.collapse-btn {
  width: 32px;
  height: 32px;
}

.user-trigger {
  margin-right: 12px;
  color: var(--el-text-color-primary);
  font-size: 13px;
  cursor: pointer;
}

@media (max-width: 640px) {
  .header { padding: 0 8px; }
  .header :deep(.el-breadcrumb) { display: none; }
  .left, .user-trigger { gap: 6px; }
  .user-trigger { margin-right: 0; }
  .user-trigger > span { display: none; }
  .site-switcher { margin-left: 0; padding-left: 0; border-left: 0; }
  .site-switcher > .el-icon { display: none; }
  .site-switcher :deep(.el-select) { width: 138px; }
  .site-settings { display: none; }
}
</style>
