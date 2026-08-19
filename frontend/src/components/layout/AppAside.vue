<template>
  <el-aside>
    <el-scrollbar>
      <el-menu router unique-opened :collapse="isCollapse" :default-active="route.path">
        <RouterLink to="/" class="logo">
          <img src="@/assets/logo.svg" alt="logo" />
          <h1>PbootCMS 管理后台</h1>
        </RouterLink>

        <el-menu-item index="/">
          <el-icon><House /></el-icon>
          <span>后台概览</span>
        </el-menu-item>

        <el-sub-menu index="system">
          <template #title>
            <el-icon><Setting /></el-icon>
            <span>系统管理</span>
          </template>
          <el-menu-item index="/menus">
            <el-icon><Menu /></el-icon>
            <span>菜单管理</span>
          </el-menu-item>
          <el-menu-item index="/users">
            <el-icon><User /></el-icon>
            <span>用户管理</span>
          </el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="content">
          <template #title>
            <el-icon><Document /></el-icon>
            <span>内容管理</span>
          </template>
          <el-menu-item index="/news">
            <el-icon><Tickets /></el-icon>
            <span>新闻管理</span>
          </el-menu-item>
          <el-menu-item index="/pages">
            <el-icon><Document /></el-icon>
            <span>单页管理</span>
          </el-menu-item>
          <el-menu-item index="/videos">
            <el-icon><VideoCamera /></el-icon>
            <span>视频管理</span>
          </el-menu-item>
          <el-menu-item index="/products">
            <el-icon><Goods /></el-icon>
            <span>产品管理</span>
          </el-menu-item>
        </el-sub-menu>

        <el-menu-item index="/uploads">
          <el-icon><Picture /></el-icon>
          <span>图片上传</span>
        </el-menu-item>
      </el-menu>
    </el-scrollbar>
  </el-aside>
</template>

<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";
import { isCollapse } from "@/components/layout/isCollapse";

const route = useRoute();
</script>

<style lang="scss" scoped>
.el-aside {
  height: 100vh;
  width: auto;
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color-light);

  .logo {
    display: flex;
    height: 64px;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
    color: var(--el-text-color-primary);
    text-decoration: none;
    border-bottom: 1px solid var(--el-border-color-lighter);

    img {
      width: 30px;
      height: 30px;
    }

    h1 {
      overflow: hidden;
      font-size: 16px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}

.el-menu {
  width: 208px;
  border-right: none;

  :deep(.el-menu-item) {
    &:hover {
      background: var(--el-fill-color-light);
    }

    &.is-active {
      position: relative;
      background: var(--el-color-primary-light-9);

      &::before {
        position: absolute;
        top: 8px;
        bottom: 8px;
        left: 0;
        width: 3px;
        border-radius: 2px;
        background: var(--el-color-primary);
        content: "";
      }
    }
  }

  &.el-menu--collapse {
    width: 64px;

    h1 {
      display: none;
    }
  }
}
</style>
