<template>
  <nav class="tool-nav" aria-label="项目工具导航">
    <a
      v-for="item in items"
      :key="item.id"
      :class="{ active: item.id === activeId }"
      :href="item.url"
      :target="isLocalTool(item.id) ? undefined : '_blank'"
      :rel="isLocalTool(item.id) ? undefined : 'noopener'"
    >
      <el-icon class="tool-nav-icon" aria-hidden="true"><component :is="item.icon" /></el-icon>
      <span>{{ item.label }}</span>
    </a>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { Connection, Cpu, Document, House, Monitor, Search, Setting, Tickets, Upload } from "@element-plus/icons-vue";
import { useSitesStore } from "@/stores/sites";
import { buildToolUrls } from "@/utils/toolUrls";
import { API_BASE_URL } from "@/utils/request";

withDefaults(defineProps<{ activeId?: string }>(), { activeId: "admin" });
const { activeSiteId } = storeToRefs(useSitesStore());

const urls = buildToolUrls(window.location.origin, import.meta.env, API_BASE_URL);

const withSite = (url: string) => {
  if (!activeSiteId.value) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("siteId", String(activeSiteId.value));
  return parsed.toString();
};

const items = computed(() => [
  { id: "admin", label: "管理后台", icon: House, url: urls.admin },
  { id: "backend", label: "后端接口", icon: Connection, url: urls.backend },
  { id: "sites", label: "站点管理", icon: Monitor, url: urls.sites },
  { id: "quotation", label: "报价单生成", icon: Tickets, url: urls.quotation },
  { id: "brochure", label: "产品介绍", icon: Document, url: withSite(urls.brochure) },
  { id: "seo", label: "SEO 检查", icon: Search, url: withSite(urls.seo) },
  { id: "models", label: "模型总览", icon: Cpu, url: withSite(urls.models) },
  { id: "models-config", label: "模型配置", icon: Setting, url: withSite(urls.modelsConfig) },
  { id: "ftp", label: "FTP 发布", icon: Upload, url: withSite(urls.ftp) },
]);

const isLocalTool = (id: string) => id === "admin" || id === "sites" || id === "quotation" || id === "brochure";
</script>

<style scoped>
.tool-nav {
  display: flex;
  min-height: 48px;
  align-items: center;
  gap: 6px;
  padding: 6px 20px;
  overflow-x: auto;
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.03);
}

.tool-nav a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 7px 14px;
  border-radius: 999px;
  color: var(--el-text-color-regular);
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.tool-nav-icon {
  flex: 0 0 auto;
  font-size: 15px;
}

.tool-nav a:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.tool-nav a.active {
  color: #fff;
  background: var(--el-color-primary);
  box-shadow: 0 2px 6px rgba(22, 119, 255, 0.28);
}
</style>
