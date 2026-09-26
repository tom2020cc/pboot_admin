<template>
  <section class="quotation-layout-settings">
    <el-collapse>
      <el-collapse-item title="报价单纸张与排版" name="layout">
        <el-form label-position="top">
          <div class="settings-grid">
            <el-form-item label="页面模式" class="page-mode">
              <el-radio-group :model-value="settings.pageMode" aria-label="报价单页面模式" @change="update('pageMode', $event)">
                <el-radio-button value="continuous">连续长页（高度自动）</el-radio-button>
                <el-radio-button value="paged">固定纸张分页</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="settings.pageMode === 'paged'" label="纸张规格">
              <el-select :model-value="paper" aria-label="报价单纸张规格" @change="setPaper">
                <el-option label="A4 竖向" value="portrait" /><el-option label="A4 横向" value="landscape" /><el-option label="自定义" value="custom" />
              </el-select>
            </el-form-item>
            <el-form-item label="字体">
              <el-select :model-value="settings.fontFamily" aria-label="报价单字体" @change="update('fontFamily', $event)">
                <el-option label="标准无衬线" value="sans" /><el-option label="思源黑体" value="cjk" /><el-option label="衬线字体" value="serif" />
              </el-select>
            </el-form-item>
            <el-form-item v-for="field in visibleFields" :key="field.key" :label="field.label">
              <el-input-number :model-value="settings[field.key]" :min="quotationLayoutRanges[field.key][0]" :max="quotationLayoutRanges[field.key][1]" :step="field.step || 1" :precision="field.key === 'lineHeight' ? 2 : field.step && field.step < 1 ? 1 : 0" controls-position="right" :aria-label="field.label" @change="update(field.key, $event)" />
            </el-form-item>
          </div>
        </el-form>
        <el-button type="primary" plain :icon="Document" @click="custom = false; emit('update:modelValue', { ...quotationClassicLayout })">旧版经典长页</el-button>
        <el-button :icon="RefreshLeft" @click="custom = false; emit('update:modelValue', { ...quotationLayoutDefaults })">恢复默认排版</el-button>
      </el-collapse-item>
    </el-collapse>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Document, RefreshLeft } from '@element-plus/icons-vue';
import { quotationLayout, quotationClassicLayout, quotationLayoutDefaults, quotationLayoutRanges, type QuotationLayout } from '@/utils/quotation-layout';
const props = defineProps<{ modelValue?: Partial<QuotationLayout> }>();
const emit = defineEmits<{ 'update:modelValue': [value: QuotationLayout] }>();
const settings = computed(() => quotationLayout(props.modelValue));
const custom = ref(false);
const paper = computed(() => custom.value ? 'custom' : settings.value.pageWidth === 210 && settings.value.pageHeight === 297 ? 'portrait' : settings.value.pageWidth === 297 && settings.value.pageHeight === 210 ? 'landscape' : 'custom');
function update(key: keyof QuotationLayout, value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return;
  if (key === 'pageWidth' || key === 'pageHeight') custom.value = true;
  emit('update:modelValue', quotationLayout({ ...settings.value, [key]: value }));
}
function setPaper(value: string) {
  custom.value = value === 'custom';
  if (value !== 'custom') emit('update:modelValue', { ...settings.value, pageWidth: value === 'landscape' ? 297 : 210, pageHeight: value === 'landscape' ? 210 : 297 });
}
const fields: { key: keyof typeof quotationLayoutRanges; label: string; step?: number }[] = [
  { key: 'pageWidth', label: '纸张宽度（mm）' }, { key: 'pageHeight', label: '纸张高度（mm）' },
  { key: 'margin', label: '页边距（mm）' }, { key: 'bodyFontSize', label: '正文字号（pt）', step: 0.5 },
  { key: 'titleFontSize', label: '主标题字号（pt）' }, { key: 'sectionFontSize', label: '产品标题字号（pt）' },
  { key: 'tableFontSize', label: '参数字号（pt）', step: 0.5 }, { key: 'priceFontSize', label: '金额字号（pt）' },
  { key: 'lineHeight', label: '行高（倍）', step: 0.1 }, { key: 'cellPadding', label: '单元格上下间距（mm）', step: 0.1 },
  { key: 'imageColumnWidth', label: '图片栏宽度（%）' }, { key: 'priceColumnWidth', label: '报价栏宽度（%）' },
];
const visibleFields = computed(() => fields.filter(field => settings.value.pageMode === 'paged' || field.key !== 'pageHeight'));
</script>

<style scoped>
.quotation-layout-settings { padding: 12px 24px; border-bottom: 1px solid var(--el-border-color-light); }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.settings-grid .el-form-item { min-width: 0; }
.page-mode { grid-column: 1 / -1; }
.page-mode :deep(.el-radio-group) { flex-wrap: wrap; }
.settings-grid .el-input-number { width: 100%; }
@media (max-width: 480px) { .settings-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
