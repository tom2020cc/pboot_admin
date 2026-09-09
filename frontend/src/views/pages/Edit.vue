<template>
  <section class="page">
    <div class="page-title">
      <div>
        <h2>编辑单页</h2>
        <p>修改单页栏目、SEO 信息和多语言正文，可一键翻译并同步全部语言到网站。</p>
      </div>
      <div class="page-actions">
        <el-button plain :loading="translatingCurrent" :disabled="loading || syncing || translatingAll" @click="translateCurrentLanguage">
          只翻译当前语言
        </el-button>
        <el-button
          type="primary"
          plain
          :loading="translatingAll"
          :disabled="loading || syncing || translatingCurrent"
          @click="translateAllLanguages"
        >
          {{ translatingAll ? `正在翻译 ${translationProgress}` : "一键翻译" }}
        </el-button>
        <el-button type="success" :loading="syncing" :disabled="loading || translatingAll || translatingCurrent" @click="syncAllLanguages">
          一键同步
        </el-button>
      </div>
    </div>
    <PageForm
      ref="pageFormRef"
      v-model="form"
      :menus="menus"
      submit-text="保存修改"
      :loading="loading"
      @submit="submit"
      @reset="loadPage"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import PageForm from "@/components/PageForm.vue";
import { getAll, type MenuItem } from "@/api/menus";
import {
  createEmptyPageForm,
  ensurePageTranslations,
  getPageById,
  syncPageToPboot,
  updatePage,
  type PageForm as PageFormType,
} from "@/api/pages";
import { getErrorMessage } from "@/utils/request";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const syncing = ref(false);
const translatingAll = ref(false);
const translatingCurrent = ref(false);
const menus = ref<MenuItem[]>([]);
const pageFormRef = ref<InstanceType<typeof PageForm> | null>(null);
const form = ref<PageFormType>(createEmptyPageForm());
const translationProgress = computed(() => pageFormRef.value?.translationProgress || "");

const loadPage = async () => {
  loading.value = true;
  try {
    const res = await getPageById(route.params.id as string);
    form.value = {
      menuId: Number(res.data.menuId),
      title: res.data.title || "",
      urlName: res.data.urlName || "",
      subtitle: res.data.subtitle || "",
      keywords: res.data.keywords || "",
      description: res.data.description || "",
      content: res.data.content || "",
      show: Boolean(res.data.show),
      orderNum: Number(res.data.orderNum || 0),
      lang: res.data.lang,
      translations: ensurePageTranslations(res.data.translations),
    };
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取单页详情失败"));
  } finally {
    loading.value = false;
  }
};

const submit = async () => {
  loading.value = true;
  try {
    pageFormRef.value?.syncTranslations();
    pageFormRef.value?.syncDefaultFields();
    await updatePage(route.params.id as string, form.value);
    ElMessage.success("修改单页成功");
    router.push("/pages");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "修改单页失败"));
  } finally {
    loading.value = false;
  }
};

const translateAllLanguages = async () => {
  if (translatingAll.value) return;
  translatingAll.value = true;
  try {
    await pageFormRef.value?.generateAllTranslations();
  } finally {
    translatingAll.value = false;
  }
};

const translateCurrentLanguage = async () => {
  translatingCurrent.value = true;
  try {
    await pageFormRef.value?.generateCurrentTranslation();
  } finally {
    translatingCurrent.value = false;
  }
};

const syncAllLanguages = async () => {
  if (!pageFormRef.value?.validateSeoCompleteness()) return;
  syncing.value = true;
  try {
    pageFormRef.value?.syncTranslations();
    pageFormRef.value?.syncDefaultFields();
    await updatePage(route.params.id as string, form.value);
    const res = await syncPageToPboot(route.params.id as string, { all: true });
    ElMessage.success(`已同步 ${res.data.synced.length} 个语言到网站`);
    await loadPage();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步单页到网站失败"));
  } finally {
    syncing.value = false;
  }
};

onMounted(async () => {
  const res = await getAll();
  menus.value = res.data;
  await loadPage();
});

watch(() => route.params.id, () => loadPage());
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
}

.page-title p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}

.page-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

@media (max-width: 760px) {
  .page-title {
    flex-direction: column;
  }
}
</style>
