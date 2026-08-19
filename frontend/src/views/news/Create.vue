<template>
  <section class="page">
    <div class="page-title">
      <div>
        <h2>添加新闻</h2>
        <p>填写栏目、缩略图和 7 种语言的新闻内容。</p>
      </div>
      <div class="page-actions">
        <el-button type="primary" plain :loading="translatingAll" :disabled="loading" @click="translateAllLanguages">
          {{ translatingAll ? "正在顺序翻译..." : "一键翻译" }}
        </el-button>
      </div>
    </div>
    <NewsForm ref="newsFormRef" v-model="form" :menus="menus" submit-text="新建新闻" :loading="loading" @submit="submit" @reset="reset" />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import NewsForm from "@/components/NewsForm.vue";
import { getAll, type MenuItem } from "@/api/menus";
import { createEmptyNewsForm, createNews, type NewsForm as NewsFormType } from "@/api/news";
import { getErrorMessage } from "@/utils/request";

const router = useRouter();
const loading = ref(false);
const translatingAll = ref(false);
const menus = ref<MenuItem[]>([]);
const newsFormRef = ref<InstanceType<typeof NewsForm> | null>(null);
const form = ref<NewsFormType>(createEmptyNewsForm());

const reset = () => {
  form.value = createEmptyNewsForm();
};

const translateAllLanguages = async () => {
  translatingAll.value = true;
  try {
    await newsFormRef.value?.generateAllTranslations();
  } finally {
    translatingAll.value = false;
  }
};

const submit = async () => {
  loading.value = true;
  try {
    await createNews({ ...form.value, author: "", source: "" });
    ElMessage.success("新增新闻成功");
    router.push("/news");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "新增新闻失败"));
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  try {
    const res = await getAll();
    menus.value = res.data;
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取栏目失败"));
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
</style>
