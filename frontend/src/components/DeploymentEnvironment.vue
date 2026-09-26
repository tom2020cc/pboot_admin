<template>
  <el-popover placement="bottom-end" :width="280" trigger="hover" popper-class="environment-popper">
    <template #reference>
      <button type="button" ref="pill" class="environment-pill" :class="environment" aria-label="当前运行环境">
        <span class="pill-dot" aria-hidden="true" />
        <span class="pill-label">{{ label }}</span>
        <el-icon class="pill-caret" aria-hidden="true"><ArrowDown /></el-icon>
      </button>
    </template>
    <div class="environment-detail">
      <div class="detail-row" role="status">
        <el-icon><Monitor v-if="environment === 'local'" /><Cloudy v-else-if="environment === 'baota'" /><Warning v-else /></el-icon>
        <strong>{{ label }}</strong>
        <span v-if="remoteConnection" class="remote-connection">本地页面 · 连接线上接口</span>
      </div>
      <div class="detail-row detail-address" :title="`管理接口：${apiBase}`">接口 {{ apiOrigin }}</div>
      <div class="detail-actions">
        <el-button v-if="!loading && environment === 'unknown'" size="small" :icon="Refresh" aria-label="重新确认运行环境" @click="refresh">重新确认</el-button>
        <RouterLink to="/environment-guide"><el-icon><Reading /></el-icon><span>配置差异与部署</span></RouterLink>
      </div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowDown, Cloudy, Monitor, Reading, Refresh, Warning } from '@element-plus/icons-vue';
import { useDeploymentEnvironment } from '@/composables/useDeploymentEnvironment';
const { environment, label, loading, apiOrigin, apiBase, remoteConnection, refresh } = useDeploymentEnvironment();
const route = useRoute();
watch([label, () => route.meta.title, () => route.name], () => {
  document.title = `[${label.value}] ${route.meta.title || (route.name === 'login' ? '登录' : '管理中心')} · PbootCMS`;
}, { immediate: true });
onMounted(() => {
  refresh();
  window.addEventListener('focus', refresh);
});
onBeforeUnmount(() => { window.removeEventListener('focus', refresh); });
</script>

<style scoped>
.environment-pill{position:fixed;top:10px;right:16px;z-index:90;display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 11px;border-radius:999px;border:1px solid #efd7a1;background:#fef3d8;color:#785219;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 1px 4px rgba(20,27,38,.16)}
.environment-pill.local{background:#e8f6f3;color:#126653;border-color:#b7e4da}
.environment-pill.baota{background:#fff0ef;color:#a32d32;border-color:#f3c6c3}
.pill-dot{width:8px;height:8px;border-radius:50%;background:#d9a53c;box-shadow:0 0 0 3px rgba(217,165,60,.18)}
.environment-pill.local .pill-dot{background:#14856b;box-shadow:0 0 0 3px rgba(20,133,107,.16)}
.environment-pill.baota .pill-dot{background:#c94646;box-shadow:0 0 0 3px rgba(201,70,70,.16)}
.pill-caret{font-size:11px;opacity:.7}
.environment-pill:hover{filter:brightness(.97)}
.detail-row{display:flex;align-items:center;gap:8px;font-size:13px}
.detail-row strong{font-size:14px}
.remote-connection{font-weight:600}
.detail-address{margin-top:6px;color:var(--el-text-color-secondary);overflow-wrap:anywhere}
.detail-actions{display:flex;align-items:center;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid var(--el-border-color-lighter)}
.detail-actions a{display:inline-flex;align-items:center;gap:6px;color:var(--el-color-primary);text-decoration:none;font-weight:600}
.detail-actions a:hover{text-decoration:underline}
@media print{.environment-pill{display:none}}
</style>
