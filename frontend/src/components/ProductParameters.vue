<template>
  <section class="product-parameters">
    <div class="parameters-heading">
      <h3>产品参数</h3>
      <el-tag size="small" type="info">全语言共用</el-tag>
    </div>

    <el-alert v-if="error" :title="error" type="error" :closable="false">
      <el-button link type="primary" @click="loadFields">重试</el-button>
    </el-alert>
    <div v-loading="loading" class="parameter-grid">
      <el-form-item v-for="field in enabledFields" :key="field.name" :label="field.label">
        <el-input :model-value="fieldValue(field)" :aria-label="field.label" :type="field.key === 'depthM' ? 'number' : 'text'" min="0" step="any" maxlength="200" :placeholder="placeholders[field.key || ''] || ''" @update:model-value="setField(field, $event)">
          <template v-if="field.unit" #append>{{ field.unit }}</template>
        </el-input>
      </el-form-item>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { emptyProductParameters, productCoreCapacity, productEngine, type ProductSharedParameters } from '@/utils/productParameters';
import { getProductFields, type ProductField } from '@/api/productFields';
import { getErrorMessage } from '@/utils/request';
import { useSitesStore } from '@/stores/sites';

const model = defineModel<ProductSharedParameters | null | undefined>();
const parameters = computed(() => model.value || emptyProductParameters());
const sites = useSitesStore();
const fields = ref<ProductField[]>([]);
const loading = ref(false);
const error = ref('');
const enabledFields = computed(() => fields.value.filter((field) => field.enabled && !field.locked));
const defaultCoreCapacity = 'BQ 1000 / NQ 800 / HQ 500';
const placeholders: Record<string, string> = { depthM: '例如 800', coreCapacity: '例如 BQ 1000 / NQ 800 / HQ 500', diameterMm: '例如 140-400', engine: '例如 玉柴 110 kW' };
watch([() => model.value, () => enabledFields.value.some((field) => field.key === 'coreCapacity')], ([value, enabled]) => {
  if (!enabled || value?.coreCapacity != null) return;
  const current = value || emptyProductParameters();
  if (!productCoreCapacity(current).trim()) model.value = { ...current, coreCapacity: defaultCoreCapacity };
}, { immediate: true });
let sequence = 0;
const loadFields = async () => {
  const current = ++sequence;
  loading.value = true;
  error.value = '';
  fields.value = [];
  try {
    const result = await getProductFields();
    if (current === sequence) fields.value = result.data.fields;
  } catch (cause) { if (current === sequence) error.value = getErrorMessage(cause, '产品字段加载失败'); }
  finally { if (current === sequence) loading.value = false; }
};
watch(() => sites.activeSiteId, loadFields, { immediate: true });
const fieldValue = (field: ProductField) => {
  if (field.key === 'coreCapacity') return productCoreCapacity(parameters.value);
  if (field.key === 'engine') return parameters.value.engine ?? parameters.value.fieldValues?.[field.name] ?? productEngine(parameters.value);
  if (field.key) return parameters.value[field.key] || '';
  const legacy = parameters.value.custom.find((item) => item.fieldName === field.name);
  return parameters.value.fieldValues?.[field.name] ?? (legacy?.value ? `${legacy.value}${legacy.unit ? ` ${legacy.unit}` : ''}` : '');
};
const setField = (field: ProductField, value: string) => {
  model.value = field.key ? { ...parameters.value, [field.key]: value }
    : { ...parameters.value, fieldValues: { ...parameters.value.fieldValues, [field.name]: value } };
};
</script>

<style scoped>
.product-parameters { padding: 24px 0 8px; border-top: 1px solid var(--el-border-color-lighter); }
.parameters-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; padding-left: 12px; border-left: 4px solid var(--el-color-primary); }
.parameters-heading h3 { margin: 0; font-size: 16px; line-height: 24px; }
.parameter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
.parameter-grid :deep(.el-form-item__content) { min-width: 0; }
.parameter-grid :deep(.el-form-item__label) { height: auto; overflow-wrap: anywhere; line-height: 24px; padding-top: 4px; }
.parameter-grid :deep(.el-input-group__append) { min-width: 48px; padding: 0 12px; box-sizing: border-box; }
@media (max-width: 760px) {
  .parameter-grid { grid-template-columns: minmax(0, 1fr); }
  .parameter-grid :deep(.el-form-item) { display: block; }
  .parameter-grid :deep(.el-form-item__label) { width: auto !important; height: auto; line-height: 24px; padding-bottom: 6px; }
  .parameter-grid :deep(.el-form-item__content) { margin-left: 0 !important; }
}
</style>
