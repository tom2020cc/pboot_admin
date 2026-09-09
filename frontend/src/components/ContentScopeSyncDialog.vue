<template>
  <el-dialog :model-value="modelValue" title="一键同步到 PB" width="680px" class="content-scope-dialog"
    :close-on-click-modal="!syncing" :close-on-press-escape="!syncing" :show-close="!syncing" @close="close">
    <el-form label-position="top">
      <el-form-item :label="`中文${contentName}栏目（包含子栏目）`">
        <el-select v-model="menuId" filterable :disabled="syncing" :placeholder="`选择中文${contentName}栏目`" style="width: 100%">
          <el-option v-for="item in chineseMenus" :key="item.id" :value="Number(item.id)" :label="menuLabel(item.id)" />
        </el-select>
      </el-form-item>
    </el-form>
    <div v-loading="checking" class="scope-preview">
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
      <template v-if="preview">
        <p class="sync-site">{{ preview.siteName }} / {{ preview.menuName }}</p>
        <div class="scope-counts">
          <span><strong>{{ itemCount }}</strong> {{ isNews ? '篇新闻' : '个产品' }}</span>
          <span><strong>{{ preview.totalLanguages }}</strong> 种语言</span>
          <span><strong>{{ preview.readyCount }}</strong> 个可同步版本</span>
        </div>
        <el-alert v-if="result" type="success" show-icon :closable="false"
          :title="`同步完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped.length} 个语言版本`" />
        <el-alert v-else-if="preview.blocked.length" type="error" show-icon :closable="false" title="栏目或 URL 检查未通过，本次不能同步" />
        <el-alert v-else-if="!preview.readyCount" type="warning" show-icon :closable="false" title="当前范围没有内容完整的语言版本可同步" />
        <el-alert v-else type="info" show-icon :closable="false" :title="`同步已保存的完整语言版本；自动备份，只新增或更新，不删除 PB ${contentName}。`" />
        <el-collapse v-if="preview.blocked.length || preview.skipped.length" class="sync-issues">
          <el-collapse-item v-if="preview.blocked.length" :title="`需先处理 ${preview.blocked.length} 项`" name="blocked">
            <ul class="issue-list"><li v-for="item in preview.blocked" :key="`${issueId(item)}:${item.lang}`">
              {{ item.title }} / {{ languageName(item.lang) }}：{{ item.reason }}
            </li></ul>
          </el-collapse-item>
          <el-collapse-item v-if="preview.skipped.length" :title="`跳过 ${preview.skipped.length} 个内容未完整的语言版本`" name="skipped">
            <ul class="issue-list"><li v-for="item in preview.skipped" :key="`${issueId(item)}:${item.lang}`">
              {{ item.title }} / {{ languageName(item.lang) }}：{{ item.reason }}
            </li></ul>
          </el-collapse-item>
        </el-collapse>
      </template>
    </div>
    <template #footer>
      <el-button :disabled="syncing" @click="close">{{ result ? '完成' : '取消' }}</el-button>
      <el-button v-if="!result" type="primary" :icon="Upload" :loading="syncing"
        :disabled="checking || !!error || !preview?.readyCount || !!preview?.blocked.length" @click="sync">
        同步全部语言
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import axios from 'axios';
import { Upload } from '@element-plus/icons-vue';
import type { MenuItem } from '@/api/menus';
import { previewProductScopeSync, syncAllProductScopeLanguages, type ProductScopeSyncResult } from '@/api/products';
import { DEFAULT_NEWS_LANG, NEWS_LANGUAGES, previewNewsScopeSync, syncAllNewsScopeLanguages, type NewsScopeSyncResult } from '@/api/news';
import { filterMenusByContentLangAndModel, formatMenuPathForLang } from '@/utils/menuLanguage';
import { getErrorMessage } from '@/utils/request';

const props = withDefaults(defineProps<{ modelValue: boolean; menus: MenuItem[]; initialMenuId?: number; contentType?: 'product' | 'news' }>(), { contentType: 'product' });
const isNews = computed(() => props.contentType === 'news');
const contentName = computed(() => isNews.value ? '新闻' : '产品');
const contentModel = computed(() => isNews.value ? '2' : '3');
type ScopeSyncResult = ProductScopeSyncResult | NewsScopeSyncResult;
const issueId = (item: ScopeSyncResult['blocked'][number]) => 'newsId' in item ? item.newsId : item.productId;
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; synced: [] }>();
const menuId = ref<number>();
const checking = ref(false);
const syncing = ref(false);
const error = ref('');
const preview = ref<ScopeSyncResult>();
const result = ref<ScopeSyncResult>();
const itemCount = computed(() => !preview.value ? 0 : 'totalNews' in preview.value ? preview.value.totalNews : preview.value.totalProducts);
let requestVersion = 0;
const chineseMenus = computed(() => filterMenusByContentLangAndModel(props.menus, DEFAULT_NEWS_LANG, contentModel.value));
const menuLabel = (id: string | number) => formatMenuPathForLang(props.menus, id, DEFAULT_NEWS_LANG, contentModel.value);
const languageName = (lang: string) => NEWS_LANGUAGES.find(item => item.code === lang)?.name || lang;
const syncError = (e: unknown) => axios.isAxiosError(e) && e.code === 'ECONNABORTED'
  ? '同步响应超时，结果尚未确认，请稍后刷新检查；重复同步只会新增或更新。' : getErrorMessage(e, '同步检查失败');
const close = () => { if (!syncing.value) emit('update:modelValue', false); };

watch(() => props.modelValue, value => { if (value) menuId.value = props.initialMenuId; });
watch([() => props.modelValue, menuId], async ([visible, id]) => {
  const version = ++requestVersion;
  preview.value = undefined;
  result.value = undefined;
  error.value = '';
  checking.value = false;
  if (!visible || !id) return;
  checking.value = true;
  try {
    const response = isNews.value ? await previewNewsScopeSync(id) : await previewProductScopeSync(id);
    if (version === requestVersion) preview.value = response.data;
  } catch (e) {
    if (version === requestVersion) error.value = syncError(e);
  } finally {
    if (version === requestVersion) checking.value = false;
  }
});

const sync = async () => {
  if (!menuId.value || syncing.value || checking.value || !preview.value?.readyCount || preview.value.blocked.length) return;
  syncing.value = true;
  error.value = '';
  try {
    const response = isNews.value ? await syncAllNewsScopeLanguages(menuId.value) : await syncAllProductScopeLanguages(menuId.value);
    result.value = response.data;
    preview.value = response.data;
    emit('synced');
  } catch (e) {
    error.value = syncError(e);
  } finally {
    syncing.value = false;
  }
};
</script>

<style scoped>
.scope-preview { min-height: 56px; }
.sync-site { margin: 0 0 12px; color: var(--el-text-color-regular); }
.scope-counts { display: flex; flex-wrap: wrap; gap: 12px 24px; margin-bottom: 20px; }
.scope-counts strong { font-size: 22px; color: var(--el-text-color-primary); }
.sync-issues { margin-top: 16px; }
.issue-list { max-height: 240px; overflow: auto; margin: 0; padding-left: 20px; overflow-wrap: anywhere; }
.issue-list li { margin: 4px 0; }
:global(.content-scope-dialog) { max-width: calc(100vw - 32px); }
</style>
