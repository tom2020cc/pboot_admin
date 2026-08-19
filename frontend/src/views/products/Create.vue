<template>
  <section class="page">
    <div class="page-title">
      <div>
        <h2>添加产品</h2>
        <p>填写产品所属栏目、标题、缩略图和轮播多图。</p>
      </div>
      <div class="page-actions">
        <el-button type="primary" plain :loading="translatingAll" :disabled="loading" @click="translateAllLanguages">
          {{ translatingAll ? "正在顺序翻译..." : "一键翻译" }}
        </el-button>
      </div>
    </div>
    <ProductForm ref="productFormRef" v-model="form" :menus="menus" submit-text="新建产品" :loading="loading" @submit="submit" @reset="reset" />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import ProductForm from "@/components/ProductForm.vue";
import { getAll, type MenuItem } from "@/api/menus";
import { createEmptyProductForm, createProduct, type ProductForm as ProductFormType } from "@/api/products";
import { getErrorMessage } from "@/utils/request";

const router = useRouter();
const loading = ref(false);
const translatingAll = ref(false);
const menus = ref<MenuItem[]>([]);
const productFormRef = ref<InstanceType<typeof ProductForm> | null>(null);

const form = ref<ProductFormType>(createEmptyProductForm());

const reset = () => {
  form.value = createEmptyProductForm();
};

const translateAllLanguages = async () => {
  translatingAll.value = true;
  try {
    await productFormRef.value?.generateAllTranslations();
  } finally {
    translatingAll.value = false;
  }
};

const submit = async () => {
  loading.value = true;
  try {
    await createProduct({ ...form.value, author: "", source: "", menuId: Number(form.value.menuId), orderNum: Number(form.value.orderNum || 0) });
    ElMessage.success("新增产品成功");
    router.push("/products");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "新增产品失败"));
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
