<template>
  <section class="page">
    <div class="page-title">
      <div>
        <h2>编辑产品</h2>
        <p>修改产品栏目、标题、缩略图、轮播多图和详情内容。</p>
      </div>
      <div class="page-actions">
        <el-button plain :loading="translatingCurrent" :disabled="loading || syncing || translatingAll" @click="translateCurrentLanguage">
          只翻译当前语言
        </el-button>
        <el-button type="primary" plain :loading="translatingAll" :disabled="loading || syncing || translatingCurrent" @click="translateAllLanguages">
          {{ translatingAll ? (translationProgress || "正在顺序翻译...") : "一键翻译" }}
        </el-button>
        <el-tooltip :disabled="canSyncAll" :content="syncDisabledTip" placement="bottom">
          <span>
            <el-button type="success" :loading="syncing" :disabled="!canSyncAll || loading || translatingAll || translatingCurrent" @click="syncAllLanguages">
              一键同步
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </div>

    <ProductForm
      ref="productFormRef"
      v-model="form"
      :menus="menus"
      :product-id="Number(route.params.id)"
      :save-after-each-translation="saveAfterEachTranslation"
      submit-text="保存修改"
      :loading="loading"
      @submit="submit"
      @reset="loadProduct"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import ProductForm from "@/components/ProductForm.vue";
import { getAll, type MenuItem } from "@/api/menus";
import {
  createEmptyProductForm,
  ensureProductTranslations,
  getProductById,
  syncProductToPboot,
  updateProduct,
  type ProductForm as ProductFormType,
} from "@/api/products";
import { getErrorMessage } from "@/utils/request";
import { showProductSyncResult } from '@/utils/productSyncFeedback';
import { useAvailableLanguages } from "@/composables/useAvailableLanguages";

const route = useRoute();
const router = useRouter();
const availableLanguages = useAvailableLanguages();
const loading = ref(false);
const syncing = ref(false);
const translatingAll = ref(false);
const translatingCurrent = ref(false);
const menus = ref<MenuItem[]>([]);
const productFormRef = ref<InstanceType<typeof ProductForm> | null>(null);
const translationProgress = computed(() => productFormRef.value?.translationStatus || "");

const form = ref<ProductFormType>(createEmptyProductForm());

const missingLanguages = computed(() =>
  availableLanguages.value.filter((lang) => {
    const item = form.value.translations?.find((translation) => translation.lang === lang.code);
    const carouselTitles = Array.isArray(item?.carouselTitles) ? item.carouselTitles : [];
    const missingCarouselTitle = form.value.carouselImages.some((_, index) => !carouselTitles[index]?.trim());

    return !item?.title?.trim() || !item?.summary?.trim() || !item?.content?.trim() || missingCarouselTitle;
  }).map((lang) => lang.name),
);

const canSyncAll = computed(() => missingLanguages.value.length === 0);
const syncDisabledTip = computed(() => (canSyncAll.value ? "" : `还有语言没填完整：${missingLanguages.value.join("、")}`));

const loadMenus = async () => {
  const res = await getAll();
  menus.value = res.data;
};

const loadProduct = async () => {
  loading.value = true;
  try {
    const res = await getProductById(route.params.id as string);
    form.value = {
      menuId: Number(res.data.menuId),
      title: res.data.title,
      urlName: res.data.urlName || "",
      subtitle: res.data.subtitle || "",
      keywords: res.data.keywords || "",
      thumbnail: res.data.thumbnail || "",
      largeImage: res.data.largeImage || "",
      videoUrl: res.data.videoUrl || "",
      sharedParameters: res.data.sharedParameters || null,
      carouselImages: Array.isArray(res.data.carouselImages) ? res.data.carouselImages : [],
      carouselTitles: Array.isArray(res.data.carouselTitles) ? res.data.carouselTitles : [],
      summary: res.data.summary || "",
      description: res.data.summary || "",
      content: res.data.content || "",
      author: "",
      source: "",
      show: Boolean(res.data.show),
      orderNum: Number(res.data.orderNum || 0),
      lang: res.data.lang || "zh-CN",
      translations: ensureProductTranslations(res.data.translations),
    };
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取产品详情失败"));
  } finally {
    loading.value = false;
  }
};

const submit = async () => {
  loading.value = true;
  try {
    productFormRef.value?.syncTranslations();
    productFormRef.value?.syncDefaultFields();
    await updateProduct(route.params.id as string, {
      ...form.value,
      author: "",
      source: "",
      menuId: Number(form.value.menuId),
      orderNum: Number(form.value.orderNum || 0),
    });
    ElMessage.success("修改产品成功");
    router.push("/products");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "修改产品失败"));
  } finally {
    loading.value = false;
  }
};

const saveAfterEachTranslation = async () => {
  productFormRef.value?.syncTranslations();
  productFormRef.value?.syncDefaultFields();
  await updateProduct(route.params.id as string, {
    ...form.value,
    author: "",
    source: "",
    menuId: Number(form.value.menuId),
    orderNum: Number(form.value.orderNum || 0),
  });
};

const translateCurrentLanguage = async () => {
  translatingCurrent.value = true;
  try {
    await productFormRef.value?.generateCurrentTranslation();
  } finally {
    translatingCurrent.value = false;
  }
};

const translateAllLanguages = async () => {
  translatingAll.value = true;
  try {
    await productFormRef.value?.generateAllTranslations();
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
    productFormRef.value?.syncTranslations();
    productFormRef.value?.syncDefaultFields();
    await updateProduct(route.params.id as string, {
      ...form.value,
      author: "",
      source: "",
      menuId: Number(form.value.menuId),
      orderNum: Number(form.value.orderNum || 0),
    });
    const res = await syncProductToPboot(route.params.id as string, { all: true });
    await showProductSyncResult(res.data, async () => (await syncProductToPboot(route.params.id as string, { all: true })).data);
    await loadProduct();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "同步产品到网站失败"));
  } finally {
    syncing.value = false;
  }
};

onMounted(async () => {
  try {
    await loadMenus();
    await loadProduct();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "加载产品失败"));
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

.page-actions span {
  display: inline-flex;
}
</style>
