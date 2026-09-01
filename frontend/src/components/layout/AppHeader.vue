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
import { computed, reactive } from "vue";
import { isCollapse } from "@/components/layout/isCollapse";
import { useMyTokenStore } from "@/stores/myToken";
import { getInfo } from "@/api/users";
import { ElMessageBox, ElMessage } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import { ArrowDown, Expand, Fold } from "@element-plus/icons-vue";

const router = useRouter();
const route = useRoute();
const userInfo = reactive({ email: "" });
const tokenStore = useMyTokenStore();

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

getUser();
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
}
</style>
