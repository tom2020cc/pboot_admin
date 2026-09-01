<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" class="entity-form">
    <el-form-item label="内容栏目" prop="menuId">
      <el-select v-model="form.menuId" class="full-control" placeholder="请选择产品所属栏目">
        <el-option v-for="item in menuOptions" :key="item.id" :label="item.optionLabel" :value="Number(item.id)" />
      </el-select>
    </el-form-item>

    <el-form-item label="缩略图">
      <ThumbnailUpload v-model="form.thumbnail" />
    </el-form-item>

    <el-form-item label="产品大图">
      <ThumbnailUpload v-model="form.largeImage" />
    </el-form-item>

    <el-form-item label="视频地址">
      <el-input v-model="form.videoUrl" placeholder="例如：https://www.youtube.com/embed/xxxx" />
    </el-form-item>

    <el-form-item label="轮播多图">
      <CarouselUpload v-model:images="form.carouselImages" v-model:titles="defaultCarouselTitles" />
    </el-form-item>

    <el-form-item label="多语言内容" class="language-item">
      <el-tabs v-model="activeLang" class="language-tabs">
        <el-tab-pane v-for="item in form.translations" :key="item.lang" :label="getLanguageName(item.lang)" :name="item.lang">
          <div class="translation-panel">
            <div v-if="item.lang === DEFAULT_PRODUCT_LANG" class="seo-toolbar">
              <el-select v-model="seoModel" class="model-select" placeholder="选择 AI SEO 模型">
                <el-option
                  v-for="model in availableSeoModels"
                  :key="model.value"
                  :label="model.displayLabel || model.label"
                  :value="model.value"
                />
              </el-select>
              <el-button
                type="success"
                :loading="optimizingSeo"
                :disabled="!availableSeoModels.length || Boolean(translatingLang) || optimizingAlts"
                @click="optimizeChineseSeo(item)"
              >
                AI 优化中文 SEO
              </el-button>
              <el-button
                type="success"
                plain
                :loading="optimizingAlts"
                :disabled="!availableSeoModels.length || Boolean(translatingLang) || optimizingSeo"
                @click="fillImageAlts(item)"
              >
                AI 补全图片 ALT
              </el-button>
              <span class="translate-tip">「AI 优化中文 SEO」优化全部 SEO 字段并补全图片 ALT；「AI 补全图片 ALT」只补详情图片缺失的 ALT，不改任何文字和轮播标题。</span>
            </div>
            <div v-if="item.lang !== DEFAULT_PRODUCT_LANG" class="translate-toolbar">
              <el-select v-model="translationModel" class="model-select" placeholder="选择翻译模型">
                <el-option
                  v-for="model in translationModels"
                  :key="model.value"
                  :label="model.available ? (model.displayLabel || model.label) : `${model.displayLabel || model.label}（未配置 Key）`"
                  :value="model.value"
                  :disabled="!model.available"
                />
              </el-select>
              <el-button
                type="primary"
                :loading="translatingLang === item.lang"
                :disabled="!hasAvailableTranslationModel || Boolean(translatingLang)"
                @click="generateTranslation(item)"
              >
                生成{{ getLanguageName(item.lang) }}
              </el-button>
              <span class="translate-tip">从中文标签页的标题、描述、详情和轮播标题生成。</span>
            </div>

            <el-form-item label="产品标题" label-width="92px" required>
              <el-input v-model="item.title" placeholder="请输入当前语言的产品标题" />
            </el-form-item>

            <el-form-item label="URL名称" label-width="92px">
              <el-input v-model="item.urlName" placeholder="例如：sd46-bulldozer" />
            </el-form-item>

            <el-form-item label="副标题" label-width="92px">
              <el-input v-model="item.subtitle" placeholder="请输入当前语言的副标题" />
            </el-form-item>

            <el-form-item label="关键词" label-width="92px">
              <el-input v-model="item.keywords" placeholder="多个关键词可用英文逗号分隔" />
            </el-form-item>

            <el-form-item label="描述" label-width="92px">
              <el-input v-model="item.summary" type="textarea" :rows="3" placeholder="请输入当前语言的产品 SEO 描述" />
            </el-form-item>

            <el-form-item label="轮播标题" label-width="92px">
              <div class="carousel-title-list">
                <div v-for="(image, index) in form.carouselImages" :key="`${item.lang}-${image}-${index}`" class="carousel-title-row">
                  <el-image :src="getUploadUrl(image)" fit="cover" class="mini-thumb" />
                  <el-input v-model="item.carouselTitles[index]" :placeholder="`第 ${index + 1} 张图片标题`" />
                </div>
                <el-text v-if="!form.carouselImages.length" type="info">请先上传轮播图片</el-text>
              </div>
            </el-form-item>

            <el-form-item label="产品详情" label-width="92px">
              <SourceCodeEditor v-model="item.content" placeholder="可输入 HTML 源码，例如 <p>产品详情</p>" />
            </el-form-item>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-form-item>

    <el-form-item label="状态">
      <el-switch v-model="form.show" active-text="显示" inactive-text="隐藏" />
    </el-form-item>

    <el-form-item label="排序">
      <el-input-number v-model="form.orderNum" :min="0" :max="999" />
    </el-form-item>

    <el-form-item>
      <el-button type="primary" :loading="loading" @click="submitForm">{{ submitText }}</el-button>
      <el-button @click="$emit('reset')">重置</el-button>
      <el-button @click="$router.push('/products')">返回列表</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import {
  DEFAULT_PRODUCT_LANG,
  PRODUCT_LANGUAGES,
  ensureProductTranslations,
  getProductTranslationModels,
  optimizeProductSeoDraft,
  translateProductDraft,
  type ProductForm,
  type ProductTranslation,
} from "@/api/products";
import type { TranslationModel } from "@/api/news";
import type { MenuItem } from "@/api/menus";
import { getUploadUrl } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";
import ThumbnailUpload from "@/components/ThumbnailUpload.vue";
import CarouselUpload from "@/components/CarouselUpload.vue";
import SourceCodeEditor from "@/components/SourceCodeEditor.vue";
import { filterMenusByContentLangAndModel } from "@/utils/menuLanguage";

const form = defineModel<ProductForm>({ required: true });

const props = defineProps<{
  menus: MenuItem[];
  submitText: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  reset: [];
}>();

type MenuOption = MenuItem & { optionLabel: string };

const formRef = ref<FormInstance>();
const activeLang = ref(DEFAULT_PRODUCT_LANG);
const translatingLang = ref("");
const translatingAll = ref(false);
const optimizingSeo = ref(false);
const optimizingAlts = ref(false);
const translationModel = ref("");
const seoModel = ref("");
const translationModels = ref<TranslationModel[]>([]);
const translationStatus = ref("");
const hasAvailableTranslationModel = computed(() => translationModels.value.some((item) => item.available));
const availableSeoModels = computed(() =>
  translationModels.value.filter(
    (item) => item.available && item.value !== "qwen-mt-lite" && ["zhipu", "deepseek", "qwen", "openai"].includes(item.provider),
  ),
);

const defaultCarouselTitles = computed({
  get() {
    const defaultTranslation = form.value.translations?.find((item) => item.lang === DEFAULT_PRODUCT_LANG);
    return defaultTranslation?.carouselTitles || form.value.carouselTitles || [];
  },
  set(value: string[]) {
    form.value.carouselTitles = value;
    const defaultTranslation = form.value.translations?.find((item) => item.lang === DEFAULT_PRODUCT_LANG);
    if (defaultTranslation) defaultTranslation.carouselTitles = value;
  },
});

const menuOptions = computed<MenuOption[]>(() => {
  const currentMenus = filterMenusByContentLangAndModel(props.menus, activeLang.value, "3");
  const map = new Map(currentMenus.map((item) => [String(item.id), item]));
  return currentMenus.map((item) => {
    const parent = map.get(String(item.parentId));
    return {
      ...item,
      optionLabel: Number(item.parentId) === 0 ? `一级栏目 / ${item.name}` : `${parent?.name || "未知栏目"} / ${item.name}`,
    };
  });
});

const rules: FormRules<ProductForm> = {
  menuId: [{ required: true, message: "请选择内容栏目", trigger: "change" }],
};

const getLanguageName = (lang: string) => PRODUCT_LANGUAGES.find((item) => item.code === lang)?.name || lang;

const syncTranslations = () => {
  const next = ensureProductTranslations(form.value.translations);
  const current = form.value.translations || [];
  const sameOrder = current.length === next.length && current.every((item, index) => item.lang === next[index].lang);
  if (!sameOrder) form.value.translations = next;

  form.value.translations?.forEach((item) => {
    if (!Array.isArray(item.carouselTitles)) item.carouselTitles = [];
    while (item.carouselTitles.length < form.value.carouselImages.length) item.carouselTitles.push("");
    if (item.carouselTitles.length > form.value.carouselImages.length) item.carouselTitles.splice(form.value.carouselImages.length);
  });
};

const syncDefaultFields = () => {
  const defaultTranslation = form.value.translations?.find((item) => item.lang === DEFAULT_PRODUCT_LANG);
  form.value.title = defaultTranslation?.title || "";
  form.value.urlName = defaultTranslation?.urlName || "";
  form.value.subtitle = defaultTranslation?.subtitle || "";
  form.value.keywords = defaultTranslation?.keywords || "";
  form.value.summary = defaultTranslation?.summary || "";
  form.value.description = form.value.summary;
  form.value.content = defaultTranslation?.content || "";
  form.value.carouselTitles = defaultTranslation?.carouselTitles || [];
};

const loadTranslationModels = async () => {
  try {
    const res = await getProductTranslationModels();
    translationModels.value = [...res.data];
    const preferredTranslation = translationModels.value.find((item) => item.available);
    if (preferredTranslation) translationModel.value = preferredTranslation.value;
    const preferredSeoModel = availableSeoModels.value[0];
    seoModel.value = preferredSeoModel?.value || "";
  } catch (e) {
    ElMessage.warning(getErrorMessage(e, "获取翻译模型失败"));
  }
};

const optimizeChineseSeo = async (target: ProductTranslation) => {
  if (target.lang !== DEFAULT_PRODUCT_LANG) return;
  if (!target.title?.trim() && !target.summary?.trim() && !target.content?.trim()) {
    ElMessage.warning("请先填写中文产品标题、描述或详情");
    return;
  }
  if (!seoModel.value) {
    ElMessage.warning("请先配置智谱或 OpenAI API Key");
    return;
  }

  optimizingSeo.value = true;
  try {
    const res = await optimizeProductSeoDraft({
      model: seoModel.value,
      contentType: "product",
      title: target.title || "",
      subtitle: target.subtitle || "",
      keywords: target.keywords || "",
      urlName: target.urlName || "",
      summary: target.summary || "",
      content: target.content || "",
      carouselTitles: target.carouselTitles || [],
    });
    target.title = res.data.title;
    target.subtitle = res.data.subtitle;
    target.keywords = res.data.keywords;
    target.urlName = target.urlName || res.data.urlName;
    target.summary = res.data.summary;
    target.description = res.data.summary;
    target.content = res.data.content;
    target.carouselTitles = res.data.carouselTitles || target.carouselTitles;
    syncDefaultFields();
    ElMessage.success("中文产品 SEO 草稿已优化，请检查后保存");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "中文产品 SEO 优化失败"));
  } finally {
    optimizingSeo.value = false;
  }
};

const countMissingAltImages = (html: string) =>
  (String(html || "").match(/<img\b[^>]*>/gi) || []).filter(
    (tag) => !(tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || "").trim(),
  ).length;

const fillImageAlts = async (target: ProductTranslation) => {
  if (target.lang !== DEFAULT_PRODUCT_LANG) return;
  if (!target.content?.trim()) {
    ElMessage.warning("请先填写产品详情，才能补全图片 ALT");
    return;
  }
  const missing = countMissingAltImages(target.content);
  if (!missing) {
    ElMessage.info("详情图片均已填写 ALT，无需补全");
    return;
  }
  if (!seoModel.value) {
    ElMessage.warning("请先配置智谱或 OpenAI API Key");
    return;
  }

  optimizingAlts.value = true;
  try {
    const res = await optimizeProductSeoDraft({
      model: seoModel.value,
      contentType: "product",
      title: target.title || "",
      subtitle: target.subtitle || "",
      keywords: target.keywords || "",
      urlName: target.urlName || "",
      summary: target.summary || "",
      content: target.content || "",
      carouselTitles: target.carouselTitles || [],
      onlyAlts: true,
    });
    const filled = res.data.imageAlts?.length || 0;
    if (filled) target.content = res.data.content;
    syncDefaultFields();
    ElMessage.success(filled ? `已为 ${filled} 张图片补全 ALT，请检查后保存` : "AI 未返回有效 ALT，详情未修改");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "图片 ALT 补全失败"));
  } finally {
    optimizingAlts.value = false;
  }
};

const generateTranslation = async (target: ProductTranslation, showSuccess = true) => {
  const source = form.value.translations?.find((item) => item.lang === DEFAULT_PRODUCT_LANG);
  if (!source?.title?.trim() && !source?.summary?.trim() && !source?.content?.trim()) {
    ElMessage.warning("请先在中文标签页填写标题、描述或详情");
    activeLang.value = DEFAULT_PRODUCT_LANG;
    return false;
  }

  translatingLang.value = String(target.lang);
  translationStatus.value = `正在生成 ${getLanguageName(String(target.lang))}，内容多时可能需要几十秒...`;
  try {
    const res = await translateProductDraft({
      sourceLang: DEFAULT_PRODUCT_LANG,
      targetLang: String(target.lang),
      model: translationModel.value,
      title: source?.title || "",
      subtitle: source?.subtitle || "",
      keywords: source?.keywords || "",
      summary: source?.summary || "",
      content: source?.content || "",
      carouselTitles: source?.carouselTitles || [],
    });

    target.title = res.data.title;
    target.subtitle = res.data.subtitle;
    target.keywords = res.data.keywords;
    target.summary = res.data.summary;
    target.content = res.data.content;
    target.description = res.data.summary;
    target.carouselTitles = res.data.carouselTitles || [];
    syncTranslations();
    if (!showSuccess) return true;
    ElMessage.success(`${getLanguageName(String(target.lang))}翻译已生成，请检查后保存`);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, `生成${getLanguageName(String(target.lang))}翻译失败`));
    return false;
  } finally {
    translatingLang.value = "";
    if (!translatingAll.value) translationStatus.value = "";
  }
};

const generateAllTranslations = async () => {
  if (translatingAll.value || translatingLang.value) return false;

  const targets = (form.value.translations || []).filter((item) => item.lang !== DEFAULT_PRODUCT_LANG);
  if (!targets.length) return false;

  translatingAll.value = true;
  try {
    for (const [index, target] of targets.entries()) {
      activeLang.value = String(target.lang);
      translationStatus.value = `正在翻译 ${getLanguageName(String(target.lang))}（${index + 1}/${targets.length}），请不要关闭页面...`;
      const success = await generateTranslation(target, false);
      if (!success) return false;
    }

    activeLang.value = DEFAULT_PRODUCT_LANG;
    ElMessage.success("全部语言已按顺序生成，请检查后保存或同步");
    return true;
  } finally {
    translatingAll.value = false;
    translationStatus.value = "";
  }
};

watch(
  () => [form.value.translations, form.value.carouselImages],
  () => syncTranslations(),
  { immediate: true, deep: true },
);

onMounted(loadTranslationModels);

const submitForm = async () => {
  syncTranslations();
  syncDefaultFields();

  const defaultTranslation = form.value.translations?.find((item) => item.lang === DEFAULT_PRODUCT_LANG);
  if (!defaultTranslation?.title?.trim()) {
    activeLang.value = DEFAULT_PRODUCT_LANG;
    ElMessage.warning("请先填写中文产品标题");
    return;
  }

  const valid = await formRef.value?.validate().catch(() => false);
  if (valid) emit("submit");
};

defineExpose({
  generateAllTranslations,
  syncTranslations,
  syncDefaultFields,
  translatingAll,
  translationStatus,
});
</script>

<style scoped>
.entity-form {
  width: 100%;
  max-width: none;
  box-sizing: border-box;
  padding: 24px;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.full-control {
  width: 100%;
}

.language-item :deep(.el-form-item__content) {
  display: block;
}

.language-tabs {
  width: 100%;
}

.translation-panel {
  padding: 16px 0 4px;
}

.translate-toolbar,
.seo-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding: 12px;
  background: #f7f9fc;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.seo-toolbar {
  background: #f1f8f4;
  border-color: #cfe8d7;
}

.model-select {
  width: 260px;
}

.translate-tip {
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.carousel-title-list {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 10px;
}

.carousel-title-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.mini-thumb {
  width: 88px;
  height: 54px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
}

@media (min-width: 1280px) {
  .entity-form {
    padding: 28px 32px;
  }
}
</style>
