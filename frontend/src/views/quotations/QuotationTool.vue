<template>
  <div class="quotation-tool">
    <header class="tool-header">
      <div class="tool-brand">
        <el-icon :size="26" color="#1677ff"><Document /></el-icon>
        <div>
          <h1>报价单生成</h1>
          <p>{{ sites.activeSite?.name }}</p>
        </div>
      </div>
      <el-tag>{{ sites.activeSite?.name || '当前网站' }}</el-tag>
    </header>
    <ToolNav active-id="quotation" />
    <main class="tool-main">
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
      <QuotationBuilder v-if="ready" :key="sites.activeSiteId" />
    </main>
  </div>
</template>

<script setup lang="ts">
import ToolNav from "@/components/layout/ToolNav.vue";
import QuotationBuilder from "./QuotationBuilder.vue";
import { Document } from '@element-plus/icons-vue';
import { onMounted, ref } from 'vue';
import { useSitesStore } from '@/stores/sites';
import { getErrorMessage } from '@/utils/request';
const sites = useSitesStore(), ready = ref(false), loadError = ref('');
onMounted(async () => { try { await sites.refresh(); ready.value = true; } catch(error) { loadError.value = getErrorMessage(error,'网站读取失败，请刷新'); } });
</script>

<style scoped>
.quotation-tool { min-height: 100vh; background: var(--el-bg-color-page); }
.tool-header { display: flex; min-height: 80px; align-items: center; justify-content: space-between; gap: 20px; padding: 12px 20px; border-bottom: 1px solid var(--el-border-color-light); background: var(--el-bg-color); }
.tool-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.tool-mark { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border-radius: 7px; color: #fff; background: var(--el-color-primary); font-size: 17px; font-weight: 800; }
.tool-brand h1 { margin: 0; font-size: 22px; font-weight: 750; }
.tool-brand p { margin: 3px 0 0; color: var(--el-text-color-secondary); font-size: 12px; }
.tool-state { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid var(--el-border-color-light); border-radius: 7px; color: var(--el-text-color-regular); background: var(--el-fill-color-extra-light); font-size: 12px; }
.tool-state span { width: 8px; height: 8px; border-radius: 50%; background: var(--el-color-success); }
.tool-main { min-width: 0; padding: 18px 20px 28px; }

@media (max-width: 760px) {
  .tool-header { min-height: 68px; padding: 10px 12px; }
  .tool-brand h1 { font-size: 17px; }
  .tool-state { display: none; }
  .tool-main { padding: 14px 12px 22px; }
}
</style>
