<template>
  <section class="page">
    <div class="page-title">
      <div>
        <h2>添加单页</h2>
        <p>维护单页栏目、SEO 信息和多语言正文。</p>
      </div>
      <el-button type="primary" plain :loading="translatingAll" :disabled="loading" @click="translateAllLanguages">
        {{ translatingAll ? "正在顺序翻译..." : "一键翻译" }}
      </el-button>
    </div>
    <PageForm ref="pageFormRef" v-model="form" :menus="menus" submit-text="新建单页" :loading="loading" @submit="submit" @reset="reset" />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import PageForm from "@/components/PageForm.vue";
import { getAll, type MenuItem } from "@/api/menus";
import { createEmptyPageForm, createPage, type PageForm as PageFormType } from "@/api/pages";
import { getErrorMessage } from "@/utils/request";

const router = useRouter();
const loading = ref(false);
const translatingAll = ref(false);
const menus = ref<MenuItem[]>([]);
const pageFormRef = ref<InstanceType<typeof PageForm> | null>(null);
const form = ref<PageFormType>(createEmptyPageForm());

const reset = () => {
  form.value = createEmptyPageForm();
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

const submit = async () => {
  loading.value = true;
  try {
    pageFormRef.value?.syncTranslations();
    pageFormRef.value?.syncDefaultFields();
    await createPage(form.value);
    ElMessage.success("添加单页成功");
    router.push("/pages");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "添加单页失败"));
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  const res = await getAll();
  menus.value = res.data;
});
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-title h2 {
  margin: 0;
  font-size: 22px;
}

.page-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-title p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}
</style>
