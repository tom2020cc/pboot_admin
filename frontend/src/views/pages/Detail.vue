<template>
  <section class="page">
    <div class="page-bar">
      <div>
        <h2>单页详情</h2>
        <p>后台预览当前单页内容，可切换语言并同步到网站。</p>
      </div>
      <div class="actions">
        <el-select v-model="currentLang" class="lang-select" @change="handleLangChange">
          <el-option v-for="item in NEWS_LANGUAGES" :key="item.code" :label="item.name" :value="item.code" />
        </el-select>
        <el-button @click="router.push('/pages')">返回列表</el-button>
        <el-button type="success" :loading="syncingCurrent" @click="handleSync(false)">同步当前语言</el-button>
        <el-button type="warning" :loading="syncingAll" @click="handleSync(true)">同步全部语言</el-button>
        <el-button type="primary" @click="router.push({ name: 'editPage', params: { id: route.params.id } })">编辑单页</el-button>
      </div>
    </div>

    <el-skeleton v-if="loading" :rows="8" animated />

    <article v-else-if="pageItem" class="preview">
      <div class="meta-row">
        <el-tag type="primary">{{ menuName }}</el-tag>
        <el-tag type="warning">{{ getLanguageName(currentLang) }}</el-tag>
        <el-tag :type="pageItem.show ? 'success' : 'info'">{{ pageItem.show ? "显示" : "隐藏" }}</el-tag>
      </div>
      <h1>{{ pageItem.title }}</h1>
      <p v-if="pageItem.subtitle" class="subtitle">{{ pageItem.subtitle }}</p>
      <div class="info-row">
        <span>排序：{{ pageItem.orderNum }}</span>
        <span>更新时间：{{ pageItem.updateTime || "-" }}</span>
      </div>
      <div v-if="pageItem.urlName || pageItem.keywords" class="seo-grid">
        <div v-if="pageItem.urlName"><span>URL名称</span><strong>{{ pageItem.urlName }}</strong></div>
        <div v-if="pageItem.keywords"><span>关键词</span><strong>{{ pageItem.keywords }}</strong></div>
        <div v-if="pageItem.description" class="wide"><span>描述</span><strong>{{ pageItem.description }}</strong></div>
      </div>
      <section class="content">
        <div v-if="normalizedContent" v-html="normalizedContent" />
        <el-empty v-else description="暂无正文内容" />
      </section>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { getAll, type MenuItem } from "@/api/menus";
import { DEFAULT_NEWS_LANG, NEWS_LANGUAGES, getPageById, syncPageToPboot, type PageItem } from "@/api/pages";
import { normalizeHtmlImageUrls } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const pageItem = ref<PageItem>();
const menus = ref<MenuItem[]>([]);
const currentLang = ref((route.query.lang as string) || DEFAULT_NEWS_LANG);
const syncingCurrent = ref(false);
const syncingAll = ref(false);

const normalizedContent = computed(() => normalizeHtmlImageUrls(pageItem.value?.content || ""));

const menuName = computed(() => {
  if (!pageItem.value) return "未选择栏目";
  const item = menus.value.find((menu) => Number(menu.id) === Number(pageItem.value?.menuId));
  return item?.name || `栏目 #${pageItem.value.menuId}`;
});

const getLanguageName = (lang: string) => NEWS_LANGUAGES.find((item) => item.code === lang)?.name || lang;

const loadDetail = async () => {
  loading.value = true;
  try {
    const [menuRes, pageRes] = await Promise.all([getAll(), getPageById(route.params.id as string, currentLang.value)]);
    menus.value = menuRes.data;
    pageItem.value = pageRes.data;
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取单页详情失败"));
  } finally {
    loading.value = false;
  }
};

const handleLangChange = async () => {
  await router.replace({ name: "pageDetail", params: { id: route.params.id }, query: { lang: currentLang.value } });
  await loadDetail();
};

const handleSync = async (all: boolean) => {
  if (all) syncingAll.value = true;
  else syncingCurrent.value = true;
  try {
    await syncPageToPboot(route.params.id as string, all ? { all: true } : { lang: currentLang.value });
    ElMessage.success(all ? "已同步全部语言到网站" : "已同步当前语言到网站");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步到网站失败"));
  } finally {
    syncingAll.value = false;
    syncingCurrent.value = false;
  }
};

onMounted(loadDetail);
watch(() => route.params.id, () => loadDetail());
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-bar,
.actions,
.meta-row,
.info-row {
  display: flex;
  gap: 10px;
}

.page-bar {
  align-items: center;
  justify-content: space-between;
}

.page-bar h2 {
  margin: 0;
  font-size: 22px;
}

.page-bar p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}

.actions {
  align-items: center;
}

.lang-select {
  width: 150px;
}

.preview {
  padding: 30px;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgb(16 24 40 / 5%);
}

.preview h1 {
  margin: 18px 0 12px;
  color: #101828;
  font-size: 30px;
  line-height: 1.35;
}

.subtitle,
.info-row {
  color: var(--el-text-color-regular);
}

.seo-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 20px 0;
}

.seo-grid div {
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #edf0f5;
  border-radius: 6px;
}

.seo-grid .wide {
  grid-column: 1 / -1;
}

.seo-grid span {
  display: block;
  margin-bottom: 4px;
  color: #98a2b3;
  font-size: 12px;
}

.seo-grid strong {
  color: #344054;
  font-size: 14px;
  word-break: break-word;
}

.content {
  max-width: 1120px;
  color: #344054;
  font-size: 15px;
  line-height: 1.9;
}

.content :deep(img) {
  display: block;
  max-width: min(100%, 920px);
  height: auto;
  max-height: 620px;
  object-fit: contain;
  margin: 16px auto;
  border-radius: 8px;
}

.content :deep(table) {
  width: 100%;
  max-width: 980px;
  margin: 18px auto;
  border-collapse: collapse;
}

.content :deep(td),
.content :deep(th) {
  padding: 8px 10px;
  border: 1px solid #d0d5dd;
}
</style>
