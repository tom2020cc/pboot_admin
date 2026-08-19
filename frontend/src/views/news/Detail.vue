<template>
  <section class="page">
    <div class="page-bar">
      <div>
        <h2>新闻详情</h2>
        <p>后台预览当前新闻内容，可切换不同语言版本。</p>
      </div>
      <div class="actions">
        <el-select v-model="currentLang" class="lang-select" @change="handleLangChange">
          <el-option v-for="item in NEWS_LANGUAGES" :key="item.code" :label="item.name" :value="item.code" />
        </el-select>
        <el-button @click="router.push('/news')">返回列表</el-button>
        <el-button type="success" :loading="syncingCurrent" @click="handleSync(false)">同步当前语言</el-button>
        <el-button type="warning" :loading="syncingAll" @click="handleSync(true)">同步全部语言</el-button>
        <el-button type="primary" @click="router.push({ name: 'editNews', params: { id: route.params.id } })">
          编辑新闻
        </el-button>
      </div>
    </div>

    <el-skeleton v-if="loading" :rows="8" animated />

    <article v-else-if="news" class="preview">
      <div class="meta-row">
        <el-tag type="primary">{{ menuName }}</el-tag>
        <el-tag type="warning">{{ getLanguageName(currentLang) }}</el-tag>
        <el-tag :type="news.show ? 'success' : 'info'">{{ news.show ? "显示" : "隐藏" }}</el-tag>
      </div>

      <h1>{{ news.title }}</h1>
      <p v-if="news.subtitle" class="subtitle">{{ news.subtitle }}</p>

      <div class="info-row">
        <span>排序：{{ news.orderNum }}</span>
        <span>更新时间：{{ news.updateTime || "-" }}</span>
      </div>

      <div v-if="news.urlName || news.keywords" class="seo-grid">
        <div v-if="news.urlName">
          <span>URL名称</span>
          <strong>{{ news.urlName }}</strong>
        </div>
        <div v-if="news.keywords">
          <span>关键词</span>
          <strong>{{ news.keywords }}</strong>
        </div>
      </div>

      <section v-if="news.thumbnail" class="cover-panel">
        <el-image :src="getUploadUrl(news.thumbnail)" fit="contain" class="cover">
          <template #error>
            <div class="image-empty">图片加载失败</div>
          </template>
        </el-image>
      </section>

      <section v-if="news.summary" class="summary">
        {{ news.summary }}
      </section>

      <section class="content">
        <div v-if="normalizedContent" v-html="normalizedContent" />
        <el-empty v-else description="暂无正文内容" />
      </section>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { getAll, type MenuItem } from "@/api/menus";
import { DEFAULT_NEWS_LANG, NEWS_LANGUAGES, getNewsById, syncNewsToPboot, type NewsItem } from "@/api/news";
import { getUploadUrl, normalizeHtmlImageUrls } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const news = ref<NewsItem>();
const menus = ref<MenuItem[]>([]);
const currentLang = ref((route.query.lang as string) || DEFAULT_NEWS_LANG);
const syncingCurrent = ref(false);
const syncingAll = ref(false);

const normalizedContent = computed(() => normalizeHtmlImageUrls(news.value?.content || ""));

const menuName = computed(() => {
  if (!news.value) return "未选择栏目";
  const item = menus.value.find((menu) => Number(menu.id) === Number(news.value?.menuId));
  if (!item) return `栏目 #${news.value.menuId}`;
  const parent = menus.value.find((menu) => Number(menu.id) === Number(item.parentId));
  return Number(item.parentId) === 0 ? item.name : `${parent?.name || "未知栏目"} / ${item.name}`;
});

const getLanguageName = (lang: string) => {
  return NEWS_LANGUAGES.find((item) => item.code === lang)?.name || lang;
};

const loadDetail = async () => {
  loading.value = true;
  try {
    const [menuRes, newsRes] = await Promise.all([getAll(), getNewsById(route.params.id as string, currentLang.value)]);
    menus.value = menuRes.data;
    news.value = newsRes.data;
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取新闻详情失败"));
  } finally {
    loading.value = false;
  }
};

const handleLangChange = async () => {
  await router.replace({ name: "newsDetail", params: { id: route.params.id }, query: { lang: currentLang.value } });
  await loadDetail();
};

const handleSync = async (all: boolean) => {
  if (all) syncingAll.value = true;
  else syncingCurrent.value = true;

  try {
    const res = await syncNewsToPboot(route.params.id as string, all ? { all: true } : { lang: currentLang.value });
    const urls = res.data.synced.map((item) => item.url).join("，");
    ElMessage.success(urls ? `已同步到网站：${urls}` : "已同步到网站");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步到网站失败"));
  } finally {
    syncingAll.value = false;
    syncingCurrent.value = false;
  }
};

onMounted(loadDetail);
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.page-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-bar h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.page-bar p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}

.actions,
.meta-row,
.info-row {
  display: flex;
  gap: 10px;
}

.actions {
  align-items: center;
}

.lang-select {
  width: 150px;
}

.preview {
  width: 100%;
  max-width: none;
  box-sizing: border-box;
  padding: 30px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

.preview h1 {
  max-width: 1160px;
  margin: 18px 0 12px;
  color: var(--el-text-color-primary);
  font-size: 30px;
  font-weight: 700;
  line-height: 1.35;
}

.subtitle {
  margin: -4px 0 14px;
  color: var(--el-text-color-regular);
  font-size: 17px;
  line-height: 1.6;
}

.info-row {
  flex-wrap: wrap;
  margin-bottom: 20px;
  color: var(--el-text-color-regular);
}

.seo-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.seo-grid div {
  padding: 12px 14px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.seo-grid span {
  display: block;
  margin-bottom: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.seo-grid strong {
  color: var(--el-text-color-regular);
  font-size: 14px;
  font-weight: 600;
  word-break: break-word;
}

.cover-panel {
  display: flex;
  width: 100%;
  min-height: 420px;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
  overflow: hidden;
  background: linear-gradient(180deg, var(--el-fill-color-light) 0%, var(--el-color-primary-light-9) 100%);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-card);
}

.cover {
  width: 100%;
  height: 520px;
}

.summary {
  margin-bottom: 20px;
  padding: 16px 18px;
  color: var(--el-text-color-regular);
  line-height: 1.8;
  background: var(--el-color-primary-light-9);
  border-left: 4px solid var(--el-color-primary);
  border-radius: 6px;
}

.content {
  max-width: 1120px;
  color: var(--el-text-color-regular);
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
  border-radius: var(--radius-card);
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
  border: 1px solid var(--el-border-color);
}

.content p {
  margin: 0 0 12px;
}

.image-empty {
  display: flex;
  width: 100%;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
}

@media (max-width: 980px) {
  .page-bar {
    align-items: flex-start;
    flex-direction: column;
  }

  .actions {
    flex-wrap: wrap;
  }

  .cover-panel {
    min-height: 260px;
  }

  .cover {
    height: 320px;
  }

  .seo-grid {
    grid-template-columns: 1fr;
  }
}
</style>
