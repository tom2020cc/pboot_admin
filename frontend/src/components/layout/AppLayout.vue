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
import { onBeforeUnmount, onMounted } from "vue";
import AppAside from "./AppAside.vue";
import AppHeader from "./AppHeader.vue";
import ToolNav from "./ToolNav.vue";
import { isCollapse } from "./isCollapse";

let narrowScreen: MediaQueryList | undefined;

const collapseSidebarOnNarrowScreen = (event: MediaQueryList | MediaQueryListEvent) => {
  if (event.matches) isCollapse.value = true;
};

onMounted(() => {
  narrowScreen = window.matchMedia("(max-width: 760px)");
  collapseSidebarOnNarrowScreen(narrowScreen);
  narrowScreen.addEventListener("change", collapseSidebarOnNarrowScreen);
});

onBeforeUnmount(() => narrowScreen?.removeEventListener("change", collapseSidebarOnNarrowScreen));
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
  overflow: visible;
  padding: var(--space-page);
  background: var(--el-bg-color-page);
}
</style>
