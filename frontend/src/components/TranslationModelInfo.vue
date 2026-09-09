<template>
  <div v-if="model" class="model-info">
    <div class="model-summary">
      <el-tag type="primary" effect="plain">优先级 #{{ model.priority ?? "-" }}</el-tag>
      <el-tag v-if="model.recommended" type="success" effect="plain">推荐</el-tag>
      <strong>{{ model.label }}</strong>
      <el-tag :type="healthTagType" effect="light">{{ healthStatusText }}</el-tag>
      <span class="model-purpose">{{ model.purpose || "翻译模型" }}</span>
    </div>
    <div class="quota-summary">
      <span class="quota-label">额度状态</span>
      <el-tag :type="quotaTagType" effect="light">{{ quotaStatusText }}</el-tag>
      <span>{{ quotaDisplay }}</span>
      <el-link v-if="model.quotaUrl" :href="model.quotaUrl" target="_blank" type="primary">
        查看实时余量
      </el-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

type TranslationModelInfo = {
  label: string;
  available: boolean;
  operational?: boolean;
  healthStatus?: "ok" | "failed" | "untested";
  healthElapsedMs?: number | null;
  healthMessage?: string;
  priority?: number;
  recommended?: boolean;
  purpose?: string;
  quotaStatus?: "public-free" | "check-console" | "unconfigured";
  quotaText?: string;
  quotaUrl?: string;
  remainingQuota?: number | null;
};

const props = defineProps<{ model?: TranslationModelInfo | null }>();

const healthStatusText = computed(() => {
  if (!props.model?.available) return "未配置";
  if (props.model.healthStatus === "ok") {
    return `绿灯可用${props.model.healthElapsedMs ? ` ${props.model.healthElapsedMs}ms` : ""}`;
  }
  if (props.model.healthStatus === "failed" || props.model.operational === false) return "红灯不可用";
  return "未测速";
});

const healthTagType = computed(() => {
  if (!props.model?.available || props.model.healthStatus === "failed" || props.model.operational === false) return "danger";
  if (props.model.healthStatus === "ok") return "success";
  return "info";
});

const quotaStatusText = computed(() => {
  if (!props.model?.available || props.model?.quotaStatus === "unconfigured") return "未配置";
  if (props.model?.quotaStatus === "public-free") return "公共免费";
  return "已配置";
});

const quotaTagType = computed(() => {
  if (!props.model?.available || props.model?.quotaStatus === "unconfigured") return "danger";
  if (props.model?.quotaStatus === "public-free") return "info";
  return "success";
});

const quotaDisplay = computed(() => {
  if (typeof props.model?.remainingQuota === "number") {
    return `剩余 ${props.model.remainingQuota.toLocaleString()}`;
  }
  return props.model?.quotaText || "平台未提供可直接读取的实时余量接口";
});
</script>

<style scoped>
.model-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 18px;
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid #d9e5f5;
  border-radius: 6px;
  background: #f7faff;
  color: #334155;
  font-size: 13px;
}

.model-summary,
.quota-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.model-purpose {
  color: #64748b;
}

.quota-label {
  color: #64748b;
}

@media (max-width: 760px) {
  .model-info {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
