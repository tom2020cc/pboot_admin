<template>
  <div class="directory-path" :class="{ browsing, outside: !!path && !info.withinRoot }" :aria-label="label">
    <div class="path-heading"><strong>{{ label }}</strong><span>{{ info.scope }}</span></div>
    <ol v-if="info.parts.length" class="path-segments">
      <li v-for="(part, index) in info.parts" :key="index" :class="{ ancestor: index < info.rootDepth - 1, root: index === info.rootDepth - 1, leaf: index === info.parts.length - 1 }">
        <el-icon v-if="index" aria-hidden="true"><ArrowRight /></el-icon>
        <span :aria-current="index === info.parts.length - 1 ? 'location' : undefined">{{ part }}</span>
      </li>
    </ol>
    <span v-else class="path-empty">{{ info.leaf || '尚未选择' }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight } from '@element-plus/icons-vue';
import { describeImportDirectory } from '@/utils/import-directory';
const props = defineProps<{ path: string; rootPath?: string; label: string; browsing?: boolean }>();
const info = computed(() => describeImportDirectory(props.path, props.rootPath));
</script>

<style scoped>
.directory-path { width: 100%; min-width: 0; border-left: 3px solid var(--el-color-success); background: var(--el-color-success-light-9); padding: 10px 12px; box-sizing: border-box; line-height: 1.65; }
.directory-path.browsing { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.directory-path.outside { border-color: var(--el-color-warning); background: var(--el-color-warning-light-9); }
.path-heading { display: flex; gap: 8px 16px; justify-content: space-between; flex-wrap: wrap; font-size: 12px; }
.path-heading span, .path-empty { color: var(--el-text-color-regular); }
.path-segments { display: flex; flex-wrap: wrap; gap: 3px 0; padding: 0; margin: 5px 0 0; list-style: none; }
.path-segments li { display: inline-flex; align-items: baseline; min-width: 0; max-width: 100%; font-size: 14px; }
.path-segments .el-icon { margin: 0 6px; font-size: 11px; flex-shrink: 0; color: var(--el-text-color-secondary); }
.path-segments span { min-width: 0; overflow-wrap: anywhere; }
.path-segments .ancestor { color: var(--el-text-color-secondary); font-size: 12px; }
.path-segments .root { text-decoration: underline; text-decoration-color: var(--el-border-color); text-underline-offset: 4px; }
.path-segments .leaf { color: var(--el-text-color-primary); font-weight: 700; font-size: 16px; }
</style>
