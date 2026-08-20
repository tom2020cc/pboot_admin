<template>
  <nav class="tool-nav" aria-label="项目工具导航">
    <a
      v-for="item in items"
      :key="item.id"
      :class="{ active: item.id === 'admin' }"
      :href="item.url"
      :target="item.id === 'admin' ? undefined : '_blank'"
      :rel="item.id === 'admin' ? undefined : 'noopener'"
    >
      {{ item.label }}
    </a>
  </nav>
</template>

<script setup lang="ts">
const numberEnv = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const frontendPort = numberEnv(import.meta.env.VITE_FRONTEND_PORT, 5173);
const backendPort = numberEnv(import.meta.env.VITE_BACKEND_PORT, 5000);
const configPort = numberEnv(import.meta.env.VITE_CONFIG_WIZARD_PORT, 5190);
const seoPort = numberEnv(import.meta.env.VITE_SEO_TOOL_PORT, 5188);
const ftpPort = numberEnv(import.meta.env.VITE_FTP_TOOL_PORT, 5189);

const items = [
  { id: "admin", label: "🖥️ 管理后台", url: `http://localhost:${frontendPort}/#/` },
  { id: "backend", label: "🔌 后端接口", url: `http://localhost:${backendPort}/api-docs` },
  { id: "config", label: "⚙️ 项目配置", url: `http://localhost:${configPort}` },
  { id: "seo", label: "📊 SEO 检查", url: `http://localhost:${seoPort}` },
  { id: "models", label: "🧠 模型总览", url: `http://localhost:${seoPort}/models.html` },
  { id: "models-config", label: "🔑 模型配置", url: `http://localhost:${seoPort}/models-config.html` },
  { id: "ftp", label: "📤 FTP 发布", url: `http://localhost:${ftpPort}` },
];
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
