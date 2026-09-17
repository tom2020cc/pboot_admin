<template>
  <div class="brochure-tool">
    <header class="tool-header">
      <div class="heading"><el-icon><Document /></el-icon><h1>产品生成PDF</h1><span>{{ sites.activeSite?.name || profile?.siteName }}</span></div>
      <el-select :model-value="sites.activeSiteId || undefined" :disabled="busy || !sites.enabledSites.length" :placeholder="sites.enabledSites.length ? '选择网站' : '尚未添加网站'" aria-label="当前站点" class="site-select" @change="changeSite"><el-option v-for="site in sites.enabledSites" :key="site.id" :value="site.id" :label="site.name" /></el-select>
    </header>
    <ToolNav active-id="brochure" />
    <main v-loading="initializing" class="workspace">
      <div class="command-bar">
        <div class="commands"><el-button :icon="FolderOpened" :disabled="working" @click="openLibrary">已保存资料</el-button><el-button :icon="Plus" :disabled="working" @click="createNew">新建</el-button><el-tag :type="dirty ? 'warning' : 'success'">{{ dirty ? '未保存' : currentId ? '已保存' : '新资料' }}</el-tag></div>
        <div class="commands"><el-button :icon="DocumentCopy" :disabled="working || !draft.items.length" @click="save(true)">另存为</el-button><el-button :icon="Check" type="primary" :loading="saving" :disabled="working || !draft.items.length" @click="save(false)">保存资料</el-button><el-button :icon="View" :disabled="working || !draft.items.length" @click="output('web')">打开网页</el-button><el-button :icon="Download" :disabled="working || !draft.items.length" @click="output('html')">下载 HTML</el-button><el-button :icon="Download" type="success" :disabled="working || !draft.items.length" @click="output('pdf')">导出 PDF</el-button></div>
      </div>
      <el-alert v-if="!initializing && !sites.activeSite" title="尚未添加网站" type="info" :closable="false" show-icon><router-link to="/sites">添加网站</router-link></el-alert>
      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon @close="errorMessage = ''" />
      <el-collapse v-if="warnings.length" class="preflight"><el-collapse-item :title="`待核对 ${warnings.length} 项`" name="checks"><ul><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul></el-collapse-item></el-collapse>
      <div v-if="exporting" class="export-status" role="status"><el-icon class="is-loading"><Loading /></el-icon> 正在生成资料 {{ exportProgress }}</div>
      <div class="view-bar"><el-radio-group v-model="view" size="small"><el-radio-button value="split">编辑与预览</el-radio-button><el-radio-button value="edit">编辑</el-radio-button><el-radio-button value="preview">预览</el-radio-button></el-radio-group><span>{{ draft.items.length }} 个产品</span></div>
      <div :class="['work-grid', `view-${view}`]">
        <fieldset v-show="view !== 'preview'" class="editor" :disabled="working">
          <section class="editor-section">
            <h2>资料信息</h2>
            <el-form label-position="top" :disabled="working">
              <div class="two-columns"><el-form-item label="资料标题"><el-input v-model="draft.title" maxlength="200" aria-label="资料标题" /></el-form-item><el-form-item label="产品语言"><el-select :model-value="draft.language" aria-label="产品语言" @change="changeLanguage"><el-option v-for="language in availableLanguages" :key="language.code" :value="language.code" :label="language.name" /><el-option v-if="!availableLanguages.some(language => language.code === draft.language)" :value="draft.language" :label="brochureLanguageName(draft.language) + '（未启用）'" disabled /></el-select></el-form-item></div>
              <div class="two-columns"><el-form-item label="图片尺寸"><el-radio-group :model-value="draft.imageSize || 'large'" @update:model-value="draft.imageSize = $event === 'medium' ? 'medium' : 'large'"><el-radio-button value="large">大图</el-radio-button><el-radio-button value="medium">适中</el-radio-button></el-radio-group></el-form-item><el-form-item label="每个产品另起一页"><el-switch :model-value="draft.newProductPage !== false" @update:model-value="draft.newProductPage = Boolean($event)" /></el-form-item></div>
              <el-form-item label="资料副标题"><el-input v-model="draft.subtitle" maxlength="300" /></el-form-item>
              <el-collapse><el-collapse-item title="公司与联系方式" name="company">
                <div class="section-actions"><el-button :icon="Refresh" :disabled="!profile" @click="applyProfile">读取站点资料</el-button></div>
                <el-form-item label="公司名称"><el-input v-model="draft.companyName" maxlength="200" /></el-form-item>
                <el-form-item label="公司标志"><ThumbnailUpload v-model="draft.logoUrl" label="公司标志" /></el-form-item>
                <div class="two-columns"><el-form-item label="联系人"><el-input v-model="draft.contactName" maxlength="100" /></el-form-item><el-form-item label="联系电话"><el-input v-model="draft.phone" maxlength="100" /></el-form-item><el-form-item label="电子邮箱"><el-input v-model="draft.email" maxlength="200" /></el-form-item><el-form-item label="网站"><el-input v-model="draft.website" maxlength="500" /></el-form-item></div>
                <el-form-item label="页尾备注"><el-input v-model="draft.notes" type="textarea" :rows="3" maxlength="3000" /></el-form-item>
              </el-collapse-item></el-collapse>
            </el-form>
          </section>
          <section class="editor-section typography-section">
            <div class="section-title"><h2>PDF 页面</h2><el-tooltip content="恢复默认页面"><el-button :icon="Refresh" circle aria-label="恢复默认页面" :disabled="working" @click="Object.assign(draft, brochureLayoutDefaults)" /></el-tooltip></div>
            <el-form label-position="top" :disabled="working" :key="'page-' + working">
              <div class="two-columns">
                <el-form-item label="纸张预设"><el-select :model-value="pagePreset" aria-label="纸张预设" @update:model-value="setPagePreset"><el-option label="A4 纵向" value="a4" /><el-option label="A4 横向" value="landscape" /><el-option label="A5 纵向" value="a5" /><el-option label="自定义" value="custom" /></el-select></el-form-item>
                <el-form-item label="字体"><el-select v-model="draft.fontFamily" :placeholder="brochureFonts.sans.label" aria-label="字体"><el-option v-for="(font, key) in brochureFonts" :key="key" :value="key" :label="font.label" /></el-select></el-form-item>
                <el-form-item v-for="field in pageFields" :key="field.key" :label="field.label"><el-input-number :model-value="layout[field.key]" :min="brochureLayoutRanges[field.key][0]" :max="brochureLayoutRanges[field.key][1]" :step="1" :precision="1" :aria-label="field.label" controls-position="right" @update:model-value="setPageNumber(field.key, $event)" /></el-form-item>
              </div>
            </el-form>
            <div class="section-title"><h2>PDF 排版</h2><el-tooltip content="恢复默认排版"><el-button :icon="Refresh" circle aria-label="恢复默认排版" :disabled="working" @click="resetTypography" /></el-tooltip></div>
            <el-form label-position="top" :disabled="working" :key="'typography-' + working">
              <div class="two-columns">
                <el-form-item v-for="field in typographyFields" :key="field.key" :label="field.label"><el-input-number :model-value="typography[field.key]" :min="brochureTypographyRanges[field.key][0]" :max="brochureTypographyRanges[field.key][1]" :step="field.step" :precision="field.precision" :aria-label="field.label" controls-position="right" @update:model-value="setTypographyNumber(field.key, $event)" /></el-form-item>
                <el-form-item label="表格行间距"><el-select :model-value="typography.tableDensity" aria-label="表格行间距" @update:model-value="draft.tableDensity = $event"><el-option label="紧凑" value="compact" /><el-option label="标准" value="standard" /><el-option label="宽松" value="relaxed" /></el-select></el-form-item>
              </div>
              <el-form-item label="表格样式"><el-radio-group :model-value="typography.tableStyle" aria-label="表格样式" @update:model-value="draft.tableStyle = $event as typeof typography.tableStyle"><el-radio-button value="web">网页浅蓝</el-radio-button><el-radio-button value="minimal">简洁横线</el-radio-button><el-radio-button value="grid">清晰网格</el-radio-button></el-radio-group></el-form-item>
            </el-form>
          </section>
          <section class="editor-section">
            <div class="section-title"><h2>产品资料</h2><div class="commands"><el-button :icon="FolderAdd" :disabled="working || draft.items.length >= 20" @click="showImport">从产品库导入</el-button><el-button :icon="Plus" :disabled="working || draft.items.length >= 20" @click="addBlank">手动添加</el-button></div></div>
            <el-empty v-if="!draft.items.length" description="暂无产品" :image-size="70" />
            <div v-else class="product-tabs" role="tablist" aria-label="介绍中的产品"><button v-for="(item, index) in draft.items" :key="item.id" role="tab" :aria-selected="selectedId === item.id" :class="{ selected: selectedId === item.id }" @click="selectedId = item.id">{{ index + 1 }}. {{ item.title || '未命名产品' }}</button></div>
            <template v-if="active">
              <div class="product-actions"><span>{{ active.productId ? `来源产品 #${active.productId}` : '自定义产品' }}</span><div><el-button :icon="ArrowLeft" circle title="产品前移" aria-label="产品前移" :disabled="working || activeIndex === 0" @click="move(draft.items, activeIndex, -1)" /><el-button :icon="ArrowRight" circle title="产品后移" aria-label="产品后移" :disabled="working || activeIndex === draft.items.length - 1" @click="move(draft.items, activeIndex, 1)" /><el-button :icon="Delete" type="danger" plain circle title="移除产品" aria-label="移除产品" :disabled="working" @click="removeProduct" /></div></div>
              <el-form label-position="top" :disabled="working">
                <div class="two-columns"><el-form-item label="型号 / 名称"><el-input v-model="active.title" maxlength="200" aria-label="型号 / 名称" /></el-form-item><el-form-item label="产品分类"><el-input v-model="active.category" maxlength="200" /></el-form-item></div>
                <el-form-item label="产品副标题"><el-input v-model="active.subtitle" maxlength="300" /></el-form-item>
                <el-form-item label="产品简介"><el-input v-model="active.description" type="textarea" :rows="3" maxlength="12000" aria-label="产品简介" /></el-form-item>
                <el-form-item label="产品特点"><el-input v-model="active.highlights" type="textarea" :rows="3" maxlength="6000" aria-label="产品特点" /></el-form-item>
              </el-form>
              <div class="section-title"><h3>产品详情正文</h3><div class="commands"><el-switch :model-value="active.detailsEnabled !== false" active-text="加入文档" @update:model-value="active.detailsEnabled = Boolean($event)" /><el-button :icon="Refresh" :disabled="working || !active.productId" @click="readDetails">读取产品详情</el-button><el-button :icon="Delete" :disabled="working || !active.detailsHtml" type="danger" plain @click="clearDetails">清空正文</el-button></div></div>
              <BrochureDetailEditor :key="active.id" :model-value="active.detailsHtml || ''" :disabled="working" :site-base="profile?.publicBaseUrl || ''" :language="draft.language" @update:model-value="active.detailsHtml = $event" @busy="uploading = $event" />
              <el-collapse v-if="active.specs.length"><el-collapse-item title="旧资料参数" name="legacy-specs">
              <div class="section-title"><h3>已保存参数</h3><el-button :icon="Delete" link type="danger" :disabled="working" @click="clearLegacySpecs">移除参数表</el-button></div>
              <div class="spec-labels"><span>参数名称</span><span>参数值</span><span>单位</span><span></span></div>
              <div v-for="(spec, index) in active.specs" :key="index" class="spec-row">
                <el-input v-model="spec.name" maxlength="160" :aria-label="`参数名称 ${index + 1}`" /><el-input v-model="spec.value" type="textarea" autosize maxlength="3000" :aria-label="`参数值 ${index + 1}`" /><el-input v-model="spec.unit" maxlength="40" :aria-label="`参数单位 ${index + 1}`" />
                <div class="row-actions"><el-button :icon="ArrowUp" text title="参数上移" aria-label="参数上移" :disabled="working || index === 0" @click="move(active.specs, index, -1)" /><el-button :icon="ArrowDown" text title="参数下移" aria-label="参数下移" :disabled="working || index === active.specs.length - 1" @click="move(active.specs, index, 1)" /><el-button :icon="Delete" text type="danger" title="删除参数" aria-label="删除参数" @click="active.specs.splice(index, 1)" /></div>
              </div>
              </el-collapse-item></el-collapse>
              <div class="section-title media-title"><h3>产品图片</h3><el-button :icon="Upload" :loading="uploading" :disabled="working || active.images.length >= 12" @click="chooseUpload(-1)">添加图片</el-button></div>
              <div class="image-grid"><div v-for="(photo, index) in active.images" :key="`${active.id}-${index}`" class="image-item">
                <el-image :src="brochureImageUrl(photo.src, profile?.publicBaseUrl)" fit="contain"><template #error><span class="failed-image">图片加载失败</span></template></el-image>
                <div class="image-caption"><el-tag size="small" :type="index ? 'info' : 'success'">{{ index ? `图片 ${index + 1}` : '主图' }}</el-tag><el-button :icon="Upload" link title="替换图片" aria-label="替换图片" @click="chooseUpload(index)" /></div>
                <el-input v-model="photo.caption" maxlength="300" :aria-label="`图片说明 ${index + 1}`" placeholder="图片说明" />
                <div class="image-actions"><el-button :icon="ArrowLeft" text title="图片前移" aria-label="图片前移" :disabled="working || index === 0" @click="move(active.images, index, -1)" /><el-button :icon="ArrowRight" text title="图片后移" aria-label="图片后移" :disabled="working || index === active.images.length - 1" @click="move(active.images, index, 1)" /><el-button :icon="Delete" text type="danger" title="删除图片" aria-label="删除图片" @click="active.images.splice(index, 1)" /></div>
              </div></div>
              <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp" :multiple="uploadIndex < 0" hidden @change="uploadFiles" />
            </template>
          </section>
        </fieldset>
        <section v-if="view !== 'edit'" class="preview-panel">
          <div class="preview-heading"><h2>文档预览</h2><div class="commands"><span role="status">{{ brochureLanguageName(draft.language) }} · {{ layout.pageWidthMm }} × {{ layout.pageHeightMm }} mm · {{ previewFailed ? '预览失败' : previewPages ? `${previewPages} 页` : previewStatus }}</span><el-tooltip content="重新排版"><el-button :icon="Refresh" circle aria-label="重新排版" :disabled="initializing || exporting" @click="refreshPreview" /></el-tooltip></div></div>
          <el-alert v-if="previewFailed" :title="previewError" type="warning" show-icon :closable="false" />
          <el-alert v-else-if="previewSkipped" :title="`已从本次文档移除 ${previewSkipped} 张无法加载的图片，网站原图与草稿未改动。`" type="warning" show-icon :closable="false" />
          <iframe v-if="previewHtml && !previewFailed" :key="previewGeneration" ref="previewFrame" title="产品PDF预览" sandbox="allow-scripts" :srcdoc="previewHtml" />
        </section>
      </div>
    </main>
    <el-dialog v-model="importVisible" :title="`从产品库导入 · ${brochureLanguageName(draft.language)}`" :close-on-click-modal="!importing" :close-on-press-escape="!importing" :show-close="!importing" width="980px" class="brochure-dialog">
      <div class="import-filters"><el-input v-model="productSearch" :prefix-icon="Search" placeholder="搜索型号或分类" clearable aria-label="搜索产品" /><el-select v-model="categoryFilter" clearable placeholder="全部栏目" aria-label="产品栏目"><el-option v-for="category in productCategories" :key="category.id" :label="category.name" :value="category.id" /></el-select></div>
      <el-table ref="importTable" v-loading="loadingProducts || importing" :data="filteredProducts" row-key="id" max-height="440" @selection-change="importSelection = $event"><el-table-column type="selection" width="45" :reserve-selection="true" /><el-table-column label="图片" width="85"><template #default="{ row }"><el-image class="import-thumb" :src="brochureImageUrl(row.thumbnail || row.largeImage, profile?.publicBaseUrl)" fit="contain" /></template></el-table-column><el-table-column prop="title" label="来源产品" /><el-table-column label="目标语言栏目"><template #default="{ row }">{{ categoryName(row.menuId) || '栏目待翻译' }}</template></el-table-column><el-table-column label="翻译状态" width="140"><template #default="{ row }"><el-tag :type="brochureTranslationState(row, draft.language).type">{{ brochureTranslationState(row, draft.language).label }}</el-tag></template></el-table-column><el-table-column label="操作" width="100"><template #default="{ row }"><router-link :to="`/products/edit/${row.id}`" target="_blank">编辑产品</router-link></template></el-table-column></el-table>
      <template #footer><el-button :disabled="importing" @click="importVisible = false">取消</el-button><el-button type="primary" :loading="importing" :disabled="loadingProducts || !importSelection.length" @click="importProducts">导入 {{ importSelection.length }} 个产品</el-button></template>
    </el-dialog>
    <el-drawer v-model="libraryVisible" title="已保存的产品PDF资料" size="min(760px, 100%)">
      <el-select v-model="libraryLanguage" clearable placeholder="全部语言" aria-label="资料语言筛选" @change="loadLibrary"><el-option v-for="language in brochureLanguages" :key="language.code" :value="language.code" :label="language.name" /></el-select>
      <div class="library-search"><el-input v-model="librarySearch" :prefix-icon="Search" placeholder="搜索资料标题" clearable @keyup.enter="loadLibrary" /><el-button :icon="Search" @click="loadLibrary">查询</el-button></div>
      <el-table v-loading="loadingLibrary" :data="records" empty-text="暂无已保存资料"><el-table-column prop="title" label="资料标题" min-width="180" /><el-table-column label="语言" width="110"><template #default="{ row }">{{ brochureLanguageName(row.language) }}</template></el-table-column><el-table-column prop="itemCount" label="产品" width="65" /><el-table-column label="更新时间" width="120"><template #default="{ row }">{{ new Date(row.updateTime).toLocaleDateString() }}</template></el-table-column><el-table-column label="操作" width="95"><template #default="{ row }"><el-button :icon="Edit" text title="打开资料" aria-label="打开资料" :disabled="working" @click="openRecord(row.id)" /><el-button :icon="Delete" text type="danger" title="删除资料" aria-label="删除资料" :disabled="working" @click="removeRecord(row)" /></template></el-table-column></el-table>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox, type TableInstance } from 'element-plus';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Delete, Document, DocumentCopy, Download, Edit, FolderAdd, FolderOpened, Loading, Plus, Refresh, Search, Upload, View } from '@element-plus/icons-vue';
import ToolNav from '@/components/layout/ToolNav.vue';
import ThumbnailUpload from '@/components/ThumbnailUpload.vue';
import BrochureDetailEditor from './BrochureDetailEditor.vue';
import { useAvailableLanguages } from '@/composables/useAvailableLanguages';
import { findEquivalentMenuForLang } from '@/utils/menuLanguage';
import { brochureLanguages, brochureLanguageName, brochureTranslationState, exactBrochureProduct, isBrochureLanguage, type BrochureLanguage } from '@/utils/brochure-language';
import { getProductById, getProductList, type ProductItem } from '@/api/products';
import { getAll as getMenus, type MenuItem } from '@/api/menus';
import { getCurrentSiteProfile, type SiteBusinessProfile } from '@/api/sites';
import { uploadImages, validateImageUploadFiles } from '@/api/uploads';
import { deleteBrochure, exportBrochurePdf, getBrochure, getBrochures, saveBrochure, type BrochureSummary } from '@/api/brochures';
import { paginateForExport } from '@/utils/brochure-pagination';
import { brochureFileName, brochureHtml, brochureImageUrl, brochureWarnings, brochureTypography, brochureTypographyDefaults, brochureTypographyRanges, cloneBrochure, isBrochureDraft, newBrochure, newBrochureProduct, portableBrochure, previewBrochure, productToBrochure, validateBrochure } from '@/utils/brochure';
import { brochureLayout, brochureLayoutDefaults, brochureLayoutRanges, brochureFonts } from '@/utils/brochure-layout';
import { getErrorMessage } from '@/utils/request';
import { getActiveSiteId } from '@/utils/siteSelection';
import { useSitesStore } from '@/stores/sites';

const sites = useSitesStore();
const availableLanguages = useAvailableLanguages();
const draft = ref(newBrochure());
const typography = computed(() => brochureTypography(draft.value));
const layout = computed(() => brochureLayout(draft.value));
const pageFields = [
  { key: 'pageWidthMm', label: '页面宽度（mm）' }, { key: 'pageHeightMm', label: '页面高度（mm）' }, { key: 'pageMarginMm', label: '页边距（mm）' },
] as const;
const presets = { a4: [210, 297], landscape: [297, 210], a5: [148, 210] } as const;
const pagePreset = computed(() => Object.entries(presets).find(([, size]) => size[0] === layout.value.pageWidthMm && size[1] === layout.value.pageHeightMm)?.[0] || 'custom');
function setPagePreset(value: string) {
  if (working.value || !Object.prototype.hasOwnProperty.call(presets, value)) return;
  [draft.value.pageWidthMm, draft.value.pageHeightMm] = presets[value as keyof typeof presets];
}
function setPageNumber(key: keyof typeof brochureLayoutRanges, value: number | undefined) {
  if (working.value) return;
  const [min, max] = brochureLayoutRanges[key];
  draft.value[key] = typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : brochureLayoutDefaults[key];
}
const typographyFields = [
  { key: 'bodyFontSize', label: '正文字号（pt）', step: 0.5, precision: 1 },
  { key: 'headingFontSize', label: '正文标题字号（pt）', step: 1, precision: 0 },
  { key: 'lineHeight', label: '正文行距（倍）', step: 0.1, precision: 1 },
  { key: 'paragraphSpacing', label: '段落间距（pt）', step: 1, precision: 0 },
  { key: 'tableFontSize', label: '表格字号（pt）', step: 0.5, precision: 1 },
] as const;
function setTypographyNumber(key: keyof typeof brochureTypographyRanges, value: number | undefined) {
  if (working.value) return;
  const [min, max] = brochureTypographyRanges[key];
  draft.value[key] = typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : brochureTypographyDefaults[key];
}
function resetTypography() {
  if (!working.value) Object.assign(draft.value, brochureTypographyDefaults);
}
const warnings = computed(() => brochureWarnings(draft.value));
const currentId = ref<number>();
const baseline = ref(JSON.stringify(draft.value));
const dirty = computed(() => JSON.stringify(draft.value) !== baseline.value);
const profile = ref<SiteBusinessProfile>();
const initializing = ref(true);
const errorMessage = ref('');
const saving = ref(false);
const exporting = ref(false);
const importing = ref(false);
const uploading = ref(false);
const busy = computed(() => initializing.value || saving.value || exporting.value || importing.value || uploading.value);
const working = computed(() => !sites.activeSite || busy.value);
const exportProgress = ref('');
const view = ref<'split' | 'edit' | 'preview'>(window.innerWidth < 1200 ? 'edit' : 'split');
const selectedId = ref('');
const activeIndex = computed(() => draft.value.items.findIndex((item) => item.id === selectedId.value));
const active = computed(() => draft.value.items[activeIndex.value]);
const previewHtml = ref('');
const previewFrame = ref<HTMLIFrameElement>();
const previewPages = ref(0);
const previewFailed = ref(false);
const previewError = ref('');
const previewSkipped = ref(0);
const previewStatus = ref('等待排版');
const previewGeneration = ref(0);
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let previewWatchdog: ReturnType<typeof setTimeout> | undefined;
function refreshPreview() {
  clearTimeout(previewTimer);
  clearTimeout(previewWatchdog);
  previewGeneration.value++;
  previewHtml.value = '';
  previewPages.value = 0;
  previewFailed.value = false;
  previewError.value = '';
  previewSkipped.value = 0;
  previewStatus.value = '等待排版';
  if (initializing.value || view.value === 'edit') return;
  previewTimer = setTimeout(() => {
    try {
      previewHtml.value = brochureHtml(previewBrochure(draft.value, profile.value?.publicBaseUrl || ''), false, '', previewGeneration.value);
      previewWatchdog = setTimeout(() => {
        previewFailed.value = true;
        previewError.value = '预览排版超时，草稿未改动。请点击“重新排版”，或检查图片及正文内容。';
      }, 150000);
    } catch (error) { previewFailed.value = true; previewError.value = getErrorMessage(error, '预览生成失败'); }
  }, 600);
}
watch([draft, profile, view, initializing], refreshPreview, { deep: true, immediate: true });
const previewMessage = (event: MessageEvent) => {
  if (event.source === previewFrame.value?.contentWindow && event.data?.type === 'brochure-pagination' && event.data.previewId === previewGeneration.value && !previewFailed.value) {
    if (event.data.state === 'progress') {
      previewStatus.value = event.data.phase === 'images'
        ? `加载图片 ${Number(event.data.done) || 0}/${Number(event.data.total) || 0}${event.data.retry ? ' · 重试中' : ''}`
        : event.data.phase === 'fonts' ? '加载字体' : '自动分页';
      return;
    }
    if (event.data.state !== 'error' && event.data.state !== 'ready') return;
    clearTimeout(previewWatchdog);
    previewFailed.value = event.data.state === 'error';
    previewPages.value = event.data.state === 'ready' ? Number(event.data.pages) || 0 : 0;
    previewSkipped.value = event.data.state === 'ready' ? Number(event.data.skippedImages) || 0 : 0;
    if (previewFailed.value) previewError.value = event.data.phase === 'images'
      ? (Number(event.data.imageIndex) > 0 ? `第 ${Number(event.data.imageIndex)} 张文档图片重试后仍未加载成功，请检查图片后重新排版。` : '文档图片加载超时，请检查网络或减少图片后重新排版。')
      : event.data.phase === 'fonts' ? '字体加载超时，请重新排版。' : '自动分页失败或超时，请重新排版，或检查正文中是否有过大的表格、图片。';
  }
};
window.addEventListener('message', previewMessage);
const products = ref<ProductItem[]>([]);
const menus = ref<MenuItem[]>([]);
const importVisible = ref(false);
const loadingProducts = ref(false);
const productSearch = ref('');
const categoryFilter = ref<number>();
const importSelection = ref<ProductItem[]>([]);
const importTable = ref<TableInstance>();
const categoryName = (id: number, language = draft.value.language) => findEquivalentMenuForLang(menus.value, id, language, '3')?.name || '';
const productCategories = computed(() => [...new Set(products.value.map((product) => product.menuId))].map((id) => ({ id, name: categoryName(id) || `栏目 #${id}` })));
const filteredProducts = computed(() => products.value.filter((product) => (!categoryFilter.value || Number(product.menuId) === categoryFilter.value) && `${product.title} ${categoryName(product.menuId)}`.toLowerCase().includes(productSearch.value.toLowerCase())));
const libraryVisible = ref(false);
const records = ref<BrochureSummary[]>([]);
const librarySearch = ref('');
const libraryLanguage = ref('');
const loadingLibrary = ref(false);
const fileInput = ref<HTMLInputElement>();
const uploadIndex = ref(-1);
const storageKey = () => `pboot-brochure-draft-v1:site:${getActiveSiteId()}`;
let draftStorageReady = false;
const fail = (error: unknown) => { errorMessage.value = getErrorMessage(error); ElMessage.error(errorMessage.value); };
const move = <T,>(items: T[], index: number, offset: number) => { const next = index + offset; if (next >= 0 && next < items.length) items.splice(next, 0, ...items.splice(index, 1)); };

function persist() {
  if (initializing.value || !sites.activeSite || !draftStorageReady) return;
  try { localStorage.setItem(storageKey(), JSON.stringify({ draft: draft.value, id: currentId.value, baseline: baseline.value })); }
  catch { errorMessage.value = '浏览器草稿保存失败，请点击“保存资料”保存到项目。'; }
}
let persistTimer: ReturnType<typeof setTimeout> | undefined;
watch(draft, () => { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 500); }, { deep: true });
function applyProfile() {
  if (!profile.value) return;
  const source = profile.value;
  Object.assign(draft.value, { companyName: source.companyName, logoUrl: source.logoUrl, website: source.website, contactName: source.contactName, phone: source.whatsapp || source.phone, email: source.email });
}
async function discardChanges() {
  if (busy.value) return false;
  if (!dirty.value) return true;
  try { await ElMessageBox.confirm('当前修改尚未保存，确定离开这份资料吗？', '未保存的修改', { type: 'warning', confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' }); return true; } catch { return false; }
}
async function changeSite(id: number) { if (await discardChanges()) { persist(); sites.selectSite(id); } }
async function createNew() {
  if (!await discardChanges()) return;
  draft.value = newBrochure(availableLanguages.value.some(item => item.code === draft.value.language) ? draft.value.language : 'zh-CN'); currentId.value = undefined; selectedId.value = ''; applyProfile(); baseline.value = JSON.stringify(draft.value); errorMessage.value = ''; persist();
  draftStorageReady = true; persist();
}
async function changeLanguage(language: string) {
  if (working.value || language === draft.value.language || !isBrochureLanguage(language) || !availableLanguages.value.some(item => item.code === language)) return;
  if (!draft.value.items.length && !currentId.value) {
    const previousTitle = newBrochure(draft.value.language).title;
    draft.value.language = language;
    if (draft.value.title === previousTitle) draft.value.title = newBrochure(language).title;
    return;
  }
  try { await ElMessageBox.confirm(`先保存当前资料，再另建 ${brochureLanguageName(language)} 版本。产品文字和正文将重新读取该语言，定制文字不会自动翻译；自定义产品将保留图片并清空文字，需重新填写。原稿保持不变。`, '新建语言版本', { confirmButtonText: '保存并新建', cancelButtonText: '取消', type: 'warning' }); }
  catch { return; }
  if (!await save(false)) return;
  importing.value = true;
  try {
    menus.value = (await getMenus()).data;
    const next = cloneBrochure(draft.value);
    const items = [];
    for (const item of next.items) {
      const translated = item.productId ? await readProduct(item.productId, language) : newBrochureProduct();
      // Keep selected custom images and layout; text belongs to the selected language only.
      translated.images = item.images.map(image => ({ src: image.src, caption: translated.images.find(photo => photo.src === image.src)?.caption || '' }));
      translated.detailsEnabled = item.detailsEnabled;
      items.push(translated);
    }
    next.language = language; next.title = newBrochure(language).title; next.subtitle = ''; next.notes = ''; next.items = items;
    draft.value = next; currentId.value = undefined; baseline.value = ''; selectedId.value = items[0]?.id || ''; persist();
    ElMessage.success('已创建独立语言草稿，请核对后保存');
  } catch (error) { fail(error); } finally { importing.value = false; }
}
async function readProduct(id: number, language: BrochureLanguage) {
  const product = exactBrochureProduct((await getProductById(id, language)).data, language);
  return productToBrochure(product, categoryName(product.menuId, language));
}
async function readDetails() {
  const item = active.value;
  if (!item?.productId || working.value) return;
  if (item.detailsHtml) {
    try { await ElMessageBox.confirm('替换当前资料中的详情正文？不会修改产品库。', '重新读取正文', { confirmButtonText: '替换正文', cancelButtonText: '取消', type: 'warning' }); }
    catch { return; }
  }
  importing.value = true;
  try {
    const source = exactBrochureProduct((await getProductById(item.productId, draft.value.language)).data, draft.value.language);
    if (!source.content?.trim()) { ElMessage.warning('该语言的产品详情为空，当前正文未改动'); return; }
    item.detailsHtml = source.content; item.detailsEnabled = true;
    ElMessage.success('已读取产品详情');
  } catch (error) { fail(error); } finally { importing.value = false; }
}
async function clearDetails() {
  try { await ElMessageBox.confirm('清空当前资料的详情正文？产品库原文保持不变。', '清空正文', { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' }); }
  catch { return; }
  if (active.value) active.value.detailsHtml = '';
}
async function clearLegacySpecs() {
  try { await ElMessageBox.confirm('移除当前资料里的旧参数表？正文中的表格不受影响。', '移除参数表', { confirmButtonText: '移除', cancelButtonText: '取消' }); }
  catch { return; }
  if (active.value) active.value.specs = [];
}
function addBlank() { const item = newBrochureProduct(); draft.value.items.push(item); selectedId.value = item.id; }
async function removeProduct() {
  try { await ElMessageBox.confirm('仅从这份介绍中移除，不影响产品库。', '移除产品', { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }); }
  catch { return; }
  draft.value.items.splice(activeIndex.value, 1); selectedId.value = draft.value.items[0]?.id || '';
}
async function showImport() {
  importVisible.value = true; importSelection.value = []; importTable.value?.clearSelection(); loadingProducts.value = true;
  try { products.value = (await getProductList(undefined, 'zh-CN')).data; menus.value = (await getMenus()).data; }
  catch (error) { fail(error); } finally { loadingProducts.value = false; }
}
async function importProducts() {
  if (working.value) return;
  if (draft.value.items.length + importSelection.value.length > 20) { ElMessage.warning('每份介绍最多包含 20 个产品'); return; }
  importing.value = true;
  try {
    const items = [];
    for (const row of [...importSelection.value]) items.push(await readProduct(row.id, draft.value.language));
    draft.value.items.push(...items); selectedId.value = items[0]?.id || selectedId.value; importVisible.value = false;
    ElMessage.success('已导入所选语言的完整详情，修改仅作用于当前资料');
  } catch (error) { fail(error); } finally { importing.value = false; }
}
async function chooseUpload(index: number) { uploadIndex.value = index; await nextTick(); if (fileInput.value) { fileInput.value.value = ''; fileInput.value.click(); } }
async function uploadFiles(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || []);
  const item = active.value;
  const index = uploadIndex.value;
  if (!files.length || !item) return;
  if (index < 0 && item.images.length + files.length > 12) { ElMessage.warning('每个产品最多 12 张图片'); return; }
  const sizeError = validateImageUploadFiles(files);
  if (sizeError) { ElMessage.warning(sizeError); return; }
  uploading.value = true;
  try {
    const form = new FormData(); files.forEach((file) => form.append('imgArr', file));
    const urls = (await uploadImages(form)).data;
    if (!urls.length) throw new Error('上传未返回图片地址');
    if (index >= 0) item.images[index].src = urls[0];
    else item.images.push(...urls.map((src) => ({ src, caption: '' })));
  } catch (error) { fail(error); } finally { uploading.value = false; }
}
async function save(copy: boolean) {
  try { validateBrochure(draft.value); } catch (error) { fail(error); return false; }
  saving.value = true;
  const snapshot = cloneBrochure(draft.value);
  try { const row = (await saveBrochure(snapshot, copy ? undefined : currentId.value)).data; currentId.value = row.id; baseline.value = JSON.stringify(snapshot); persist(); errorMessage.value = ''; ElMessage.success(copy ? '已另存为新资料' : '资料已保存'); return true; }
  catch (error) { fail(error); return false; } finally { saving.value = false; }
}
async function loadLibrary() { loadingLibrary.value = true; try { records.value = (await getBrochures(librarySearch.value, libraryLanguage.value)).data; } catch (error) { fail(error); } finally { loadingLibrary.value = false; } }
function openLibrary() { libraryVisible.value = true; void loadLibrary(); }
async function openRecord(id: number) {
  if (!await discardChanges()) return;
  saving.value = true;
  try { const row = (await getBrochure(id)).data; draft.value = cloneBrochure(row.data); currentId.value = row.id; baseline.value = JSON.stringify(draft.value); selectedId.value = draft.value.items[0]?.id || ''; libraryVisible.value = false; errorMessage.value = ''; draftStorageReady = true; persist(); }
  catch (error) { fail(error); } finally { saving.value = false; }
}
async function removeRecord(row: BrochureSummary) {
  try { await ElMessageBox.confirm(`删除“${row.title}”？不删除产品库数据和图片文件。`, '删除资料', { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }); } catch { return; }
  saving.value = true;
  try { await deleteBrochure(row.id); if (currentId.value === row.id) { currentId.value = undefined; baseline.value = ''; persist(); } await loadLibrary(); } catch (error) { fail(error); } finally { saving.value = false; }
}
async function output(kind: 'web' | 'html' | 'pdf') {
  try { validateBrochure(draft.value); } catch (error) { fail(error); return; }
  const popup = kind === 'web' ? window.open('', '_blank') : null;
  if (kind === 'web' && !popup) { ElMessage.warning('请允许浏览器打开新窗口后重试'); return; }
  if (popup) { popup.opener = null; popup.document.write('<!doctype html><meta charset="utf-8"><title>正在生成产品资料</title><p>正在准备图片与产品资料...</p>'); popup.document.close(); }
  if (warnings.value.length) {
    try { await ElMessageBox.confirm(warnings.value.slice(0, 8).join('；') + '。仍要导出吗？', '导出前核对', { confirmButtonText: '继续导出', cancelButtonText: '返回编辑', type: 'warning' }); }
    catch { popup?.close(); return; }
  }
  exporting.value = true; exportProgress.value = ''; errorMessage.value = '';
  try {
    let skippedImages = 0;
    const portable = await portableBrochure(cloneBrochure(draft.value), profile.value?.publicBaseUrl || '', (done, total) => { exportProgress.value = `图片 ${done} / ${total}`; }, count => { skippedImages = count; });
    exportProgress.value = '正在自动分页';
    const token = crypto.randomUUID();
    const paginated = await paginateForExport(brochureHtml(portable, kind !== 'pdf', token), token);
    const html = paginated.html;
    if (kind === 'html') {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = brochureFileName(portable); link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      ElMessage.success(`HTML 已下载，共 ${paginated.pages} 页，图片已内嵌`);
    } else if (kind === 'pdf') {
      exportProgress.value = `正在生成 PDF，共 ${paginated.pages} 页`;
      const pdf = await exportBrochurePdf(html);
      if (!pdf.size || pdf.type !== 'application/pdf') throw new Error('服务器没有返回有效的 PDF 文件');
      const url = URL.createObjectURL(pdf);
      const link = document.createElement('a'); link.href = url; link.download = brochureFileName(portable).replace(/\.html$/i, '.pdf'); link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      ElMessage.success(`PDF 已下载，共 ${paginated.pages} 页`);
    } else if (popup && !popup.closed) {
      popup.document.open(); popup.document.write(html); popup.document.close();
    }
    if (skippedImages + paginated.skippedImages) ElMessage({ type: 'warning', message: `本次导出移除了 ${skippedImages + paginated.skippedImages} 张无法加载或超出大小限制的图片，其他内容已保留。`, duration: 12000 });
    persist();
  } catch (error) { popup?.close(); fail(error); } finally { exporting.value = false; }
}
const beforeUnload = (event: BeforeUnloadEvent) => { persist(); if (dirty.value) { event.preventDefault(); event.returnValue = ''; } };
onBeforeRouteLeave(async () => { const leave = await discardChanges(); if (leave) persist(); return leave; });
onBeforeUnmount(() => { clearTimeout(persistTimer); clearTimeout(previewTimer); clearTimeout(previewWatchdog); persist(); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('message', previewMessage); });
onMounted(async () => {
  try {
    await sites.refresh();
    if (!sites.activeSite) return;
    // Restore the local draft before any optional profile request can time out.
    const cached = localStorage.getItem(storageKey());
    if (cached) { const parsed = JSON.parse(cached); if (isBrochureDraft(parsed.draft)) { draft.value = parsed.draft; currentId.value = Number.isSafeInteger(parsed.id) && parsed.id > 0 ? parsed.id : undefined; baseline.value = typeof parsed.baseline === 'string' ? parsed.baseline : ''; selectedId.value = draft.value.items[0]?.id || ''; draftStorageReady = true; } else { errorMessage.value = '浏览器草稿格式无效，请从已保存资料中重新打开。'; } }
    else draftStorageReady = true;
    profile.value = (await getCurrentSiteProfile()).data;
    if (!cached) { applyProfile(); baseline.value = JSON.stringify(draft.value); }
  } catch (error) { fail(error); } finally { initializing.value = false; window.addEventListener('beforeunload', beforeUnload); }
});
</script>

<style scoped>
.brochure-tool{min-height:100vh;background:#f4f6f8;color:#273445;letter-spacing:0}.tool-header{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:78px;padding:18px 24px;background:white}.heading{display:flex;align-items:center;gap:12px;min-width:0}.heading>.el-icon{font-size:25px;color:#1677ff}.heading h1{font-size:22px;margin:0;white-space:nowrap}.heading span{font-size:13px;color:#74808e;overflow-wrap:anywhere}.site-select{width:210px;flex-shrink:0}.workspace{width:100%;max-width:none;box-sizing:border-box;margin:auto;padding:18px 24px 32px}.command-bar,.commands,.view-bar,.section-title,.product-actions,.preview-heading{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.command-bar{justify-content:space-between;padding-bottom:18px;border-bottom:1px solid #dfe5eb}.commands .el-button+.el-button{margin-left:0}.view-bar{justify-content:space-between;margin:18px 0}.view-bar>span{color:#7b8693;font-size:13px}.work-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;align-items:start}.work-grid.view-edit,.work-grid.view-preview{grid-template-columns:minmax(0,1fr)}.view-edit .editor{max-width:none}.editor{min-width:0;border:0;padding:0;margin:0}.editor-section{padding:22px 24px;background:white;border-bottom:1px solid #e2e7ed}.editor h2,.preview-heading h2{font-size:17px;margin:0 0 18px}.editor h3{font-size:15px;margin:0}.section-title{justify-content:space-between;margin-bottom:16px}.section-title h2{margin:0}.two-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 18px}.section-actions{margin:12px 0}.product-tabs{display:flex;gap:8px;overflow-x:auto;padding:3px 0 14px}.product-tabs button{font:inherit;font-size:13px;max-width:240px;flex-shrink:0;overflow-wrap:anywhere;padding:9px 12px;border:1px solid #dde5ec;border-radius:4px;background:#fff;cursor:pointer}.product-tabs button.selected{color:#1265ca;border-color:#1677ff;background:#edf5ff}.product-actions{justify-content:space-between;font-size:12px;color:#7b8693;margin:6px 0 18px}.spec-labels,.spec-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) 64px 90px;gap:8px;align-items:start;margin-bottom:9px}.spec-labels{font-size:12px;color:#7b8693}.row-actions{display:flex;align-items:center}.row-actions .el-button{width:28px;min-width:0;padding:4px;margin:0}.media-title{margin-top:26px}.image-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.image-item:first-child,.image-item:last-child:nth-child(even){grid-column:1/-1}.image-item{min-width:0;border:1px solid #e1e7ed;border-radius:6px;padding:8px}.image-item>.el-image{width:100%;height:190px;display:flex;background:#f5f7f8}.image-caption,.image-actions{display:flex;align-items:center;justify-content:space-between;padding:6px 0;gap:4px}.image-actions{padding-bottom:0}.image-actions .el-button{margin:0;padding:7px}.failed-image{font-size:12px;color:#d94e44;margin:auto}.preview-panel{position:sticky;top:12px;min-width:0}.preview-heading{justify-content:space-between;min-height:40px}.preview-heading h2{margin:0;font-size:14px}.preview-heading span{font-size:12px;color:#7b8693}.preview-panel iframe{width:100%;height:calc(100vh - 72px);min-height:650px;border:1px solid #dfe5eb;background:white}.view-preview .preview-panel{max-width:none;width:100%;margin:auto}.import-filters,.library-search{display:flex;gap:12px;margin-bottom:20px}.import-filters>.el-select{width:260px;flex-shrink:0}.import-thumb{width:60px;height:48px}.export-status{display:flex;align-items:center;gap:8px;padding:14px;color:#1d694f}.workspace>.el-alert{margin-top:16px}:deep(.el-form-item__label){font-size:13px}:deep(.el-drawer__body .el-button+.el-button){margin-left:0}
@media(max-width:1200px){.work-grid{grid-template-columns:minmax(0,1fr)}.preview-panel{position:static}.preview-panel iframe{height:850px}.command-bar{gap:16px}}
@media(max-width:600px){.tool-header{padding:15px 12px;flex-wrap:wrap}.heading span{max-width:130px}.heading h1{font-size:19px}.site-select{width:100%}.workspace{padding:14px 12px}.command-bar .el-button{padding:8px 10px;font-size:12px}.commands{gap:8px}.editor-section{padding:18px 14px}.two-columns{grid-template-columns:minmax(0,1fr)}.spec-row,.spec-labels{grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) 50px}.row-actions{grid-column:1/-1;justify-content:flex-end}.spec-labels span:last-child{display:none}.image-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.image-item>.el-image{height:120px}.import-filters{flex-wrap:wrap}.import-filters>.el-select{width:100%}.preview-panel iframe{min-height:650px}.section-title .commands{gap:5px}}
</style>
<style>.brochure-dialog{max-width:calc(100vw - 24px)}</style>
