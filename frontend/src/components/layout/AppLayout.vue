<template>
  <div class="common-layout">
    <el-container class="layout-shell">
      <AppAside />
      <el-container class="content-shell">
        <AppHeader />
        <ToolNav />
        <el-main>
          <RouterView />
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import AppAside from "./AppAside.vue";
import AppHeader from "./AppHeader.vue";
import ToolNav from "./ToolNav.vue";
</script>

<style lang="scss" scoped>
.layout-shell {
  min-height: 100vh;
}

.content-shell {
  min-width: 0;
  flex-direction: column;
}

.el-main {
  min-width: 0;
  padding: var(--space-page);
  background: var(--el-bg-color-page);
}
</style>
