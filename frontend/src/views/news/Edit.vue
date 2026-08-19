<template>
  <section class="page">
    <div class="page-title">
      <div>
        <h2>编辑新闻</h2>
        <p>维护新闻栏目、缩略图，以及每个语言版本的标题、描述和正文。</p>
      </div>
      <div class="page-actions">
        <el-button type="primary" plain :loading="translatingAll" :disabled="loading || syncing" @click="translateAllLanguages">
          {{ translatingAll ? "正在顺序翻译..." : "一键翻译" }}
        </el-button>
        <el-tooltip :disabled="canSyncAll" :content="syncDisabledTip" placement="bottom">
          <span>
            <el-button type="success" :loading="syncing" :disabled="!canSyncAll || loading || translatingAll" @click="syncAllLanguages">
              一键同步
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </div>

    <NewsForm
      ref="newsFormRef"
      v-model="form"
      :menus="menus"
      :entity-id="newsId"
      submit-text="保存修改"
      :loading="loading"
      @submit="submit"
      @reset="loadNews"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import NewsForm from "@/components/NewsForm.vue";
import { getAll, type MenuItem } from "@/api/menus";
import {
  NEWS_LANGUAGES,
  createEmptyNewsForm,
  ensureNewsTranslations,
  getNewsById,
  syncNewsToPboot,
  updateNews,
  type NewsForm as NewsFormType,
} from "@/api/news";
import { getErrorMessage } from "@/utils/request";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const syncing = ref(false);
const translatingAll = ref(false);
const menus = ref<MenuItem[]>([]);
const newsFormRef = ref<InstanceType<typeof NewsForm> | null>(null);
const form = ref<NewsFormType>(createEmptyNewsForm());
const newsId = computed(() => route.params.id as string);

const missingLanguages = computed(() =>
  NEWS_LANGUAGES.filter((lang) => {
    const item = form.value.translations?.find((translation) => translation.lang === lang.code);
    return !item?.title?.trim() || !item?.summary?.trim() || !item?.content?.trim();
  }).map((lang) => lang.name),
);

const canSyncAll = computed(() => missingLanguages.value.length === 0);
const syncDisabledTip = computed(() => (canSyncAll.value ? "" : `还有语言没填完整：${missingLanguages.value.join("、")}`));

const loadMenus = async () => {
  const res = await getAll();
  menus.value = res.data;
};

const loadNews = async () => {
  loading.value = true;
  try {
    const res = await getNewsById(route.params.id as string);
    form.value = {
      menuId: Number(res.data.menuId),
      title: res.data.title || "",
      urlName: res.data.urlName || "",
      subtitle: res.data.subtitle || "",
      keywords: res.data.keywords || "",
      thumbnail: res.data.thumbnail || "",
      summary: res.data.summary || "",
      description: res.data.summary || "",
      content: res.data.content || "",
      author: "",
      source: "",
      show: Boolean(res.data.show),
      orderNum: Number(res.data.orderNum || 0),
      lang: res.data.lang,
      translations: ensureNewsTranslations(res.data.translations),
    };
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取新闻详情失败"));
  } finally {
    loading.value = false;
  }
};

const submit = async () => {
  loading.value = true;
  try {
    newsFormRef.value?.syncTranslations();
    newsFormRef.value?.ensureDefaultUrlNames();
    newsFormRef.value?.syncDefaultFields();
    await updateNews(newsId.value, {
      ...form.value,
      author: "",
      source: "",
      menuId: Number(form.value.menuId),
      orderNum: Number(form.value.orderNum || 0),
    });
    ElMessage.success("修改新闻成功");
    router.push("/news");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "修改新闻失败"));
  } finally {
    loading.value = false;
  }
};

const translateAllLanguages = async () => {
  translatingAll.value = true;
  try {
    await newsFormRef.value?.generateAllTranslations();
  } finally {
    translatingAll.value = false;
  }
};

const syncAllLanguages = async () => {
  if (!canSyncAll.value) {
    ElMessage.warning(syncDisabledTip.value);
    return;
  }

  syncing.value = true;
  try {
    newsFormRef.value?.syncTranslations();
    newsFormRef.value?.ensureDefaultUrlNames();
    newsFormRef.value?.syncDefaultFields();
    await updateNews(newsId.value, {
      ...form.value,
      author: "",
      source: "",
      menuId: Number(form.value.menuId),
      orderNum: Number(form.value.orderNum || 0),
    });
    const res = await syncNewsToPboot(newsId.value, { all: true });
    ElMessage.success(`已同步 ${res.data.synced.length} 个语言到网站`);
    await loadNews();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步新闻到网站失败"));
  } finally {
    syncing.value = false;
  }
};

onMounted(async () => {
  try {
    await loadMenus();
    await loadNews();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "加载新闻失败"));
  }
});
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.page-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-title h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.page-title p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}

.page-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 4px;
}

.page-actions span {
  display: inline-flex;
}
</style>
