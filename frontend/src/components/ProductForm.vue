<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" class="entity-form">
    <div class="form-section">
      <div class="section-heading"><h3>基础与媒体</h3></div>

      <el-form-item label="内容栏目" prop="menuId">
        <el-select v-model="form.menuId" class="full-control" placeholder="请选择产品所属栏目">
          <el-option v-for="item in menuOptions" :key="item.id" :label="item.optionLabel" :value="Number(item.id)" />
        </el-select>
      </el-form-item>

      <div class="cover-grid">
        <el-form-item label="缩略图" class="cover-field">
          <ThumbnailUpload v-model="form.thumbnail" :upload="uploadThumbnail" />
        </el-form-item>

        <el-form-item label="产品大图" class="cover-field">
          <ThumbnailUpload v-model="form.largeImage" />
        </el-form-item>
      </div>

      <el-form-item label="视频地址">
        <el-input v-model="form.videoUrl" placeholder="例如：https://www.youtube.com/embed/xxxx" />
      </el-form-item>

      <el-form-item label="轮播多图" class="carousel-field">
        <CarouselUpload v-model:images="form.carouselImages" v-model:titles="defaultCarouselTitles" />
      </el-form-item>
    </div>

    <ProductParameters v-model="form.sharedParameters" class="form-section" />

    <div class="form-section language-section">
      <div class="section-heading"><h3>多语言内容</h3></div>
      <el-form-item class="language-item" label-width="0">
        <el-tabs v-model="activeLang" class="language-tabs">
          <el-tab-pane v-for="item in visibleTranslations" :key="item.lang" :label="getLanguageName(item.lang)" :name="item.lang">
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
                  :disabled="!availableSeoModels.length || Boolean(translatingLang)"
                  @click="optimizeChineseSeo(item)"
                >
                  AI 优化中文 SEO
                </el-button>
                <span class="translate-tip">保留产品标题，参考详情优化副标题、关键词、描述和轮播标题；URL 仅在为空时生成。</span>
              </div>
              <div v-if="item.lang !== DEFAULT_PRODUCT_LANG" class="translate-toolbar">
                <el-select v-model="translationModel" class="model-select" placeholder="选择翻译模型" :disabled="translatingAll || Boolean(translatingLang)">
                  <el-option
                    v-for="model in selectableTranslationModels"
                    :key="model.value"
                    :label="model.displayLabel || model.label"
                    :value="model.value"
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
                <span class="translate-tip">从中文内容生成；URL 自动使用当前语言前缀，已带正确前缀的自定义 URL 保留。</span>
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
    </div>

    <div class="form-section publish-section">
      <div class="section-heading"><h3>发布设置</h3></div>
      <div class="publish-grid">
        <el-form-item label="状态">
          <el-switch v-model="form.show" active-text="显示" inactive-text="隐藏" />
        </el-form-item>

        <el-form-item label="排序">
          <el-input-number v-model="form.orderNum" :min="0" :max="999" />
        </el-form-item>
      </div>

      <el-form-item label-width="0" class="action-row">
        <el-button type="primary" :loading="loading" @click="submitForm">{{ submitText }}</el-button>
        <el-button @click="$emit('reset')">重置</el-button>
        <el-button @click="$router.push('/products')">返回列表</el-button>
      </el-form-item>
    </div>
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
  uploadProductThumbnail,
  type ProductForm,
  type ProductTranslation,
} from "@/api/products";
import type { TranslationModel } from "@/api/news";
import type { MenuItem } from "@/api/menus";
import { getUploadUrl } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";
import { resolvePreferredTranslationModel, savePreferredTranslationModel } from "@/utils/translationModelPreference";
import { useAvailableLanguages } from "@/composables/useAvailableLanguages";
import ThumbnailUpload from "@/components/ThumbnailUpload.vue";
import CarouselUpload from "@/components/CarouselUpload.vue";
import SourceCodeEditor from "@/components/SourceCodeEditor.vue";
import ProductParameters from '@/components/ProductParameters.vue';
import { filterMenusByContentLangAndModel } from "@/utils/menuLanguage";
import { buildLanguageUrlName, ensureLanguageUrlName } from "@/utils/seoUrlName";
import { ensureTranslationMenusExist } from "@/utils/translationMenuGuard";

const form = defineModel<ProductForm>({ required: true });
const availableLanguages = useAvailableLanguages();
const visibleTranslations = computed(() => {
  const codes = new Set(availableLanguages.value.map((item) => item.code));
  return (form.value.translations || []).filter((item) => codes.has(item.lang as any));
});

const props = defineProps<{
  menus: MenuItem[];
  submitText: string;
  loading?: boolean;
  productId?: number;
  saveAfterEachTranslation?: () => Promise<unknown>;
}>();

const uploadThumbnail = async (file: File) => {
  const modelName = (form.value.translations?.find(item => item.lang === DEFAULT_PRODUCT_LANG)?.title || form.value.title || '').trim();
  if (!props.productId && !modelName) throw new Error('请先填写中文产品型号 / 标题，再上传缩略图');
  if (!props.productId && !form.value.menuId) throw new Error('请先选择中文产品栏目，再上传缩略图');
  const result = await uploadProductThumbnail(file, {
    productId: props.productId,
    menuId: form.value.menuId,
    modelName,
    referenceImage: form.value.largeImage || form.value.carouselImages?.[0] || form.value.thumbnail,
  });
  return result.data.url;
};

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
const translationModel = ref("");
const seoModel = ref("");
const translationModels = ref<TranslationModel[]>([]);
const translationStatus = ref("");
const selectableTranslationModels = computed(() =>
  translationModels.value.filter((item) => item.available && item.operational !== false),
);
const hasAvailableTranslationModel = computed(() => selectableTranslationModels.value.length > 0);
const availableSeoModels = computed(() =>
  translationModels.value.filter(
    (item) => item.available && item.operational !== false && item.value !== "qwen-mt-lite" && ["zhipu", "deepseek", "qwen", "openai"].includes(item.provider),
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
    translationModel.value = resolvePreferredTranslationModel(translationModels.value, translationModel.value);
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
    const originalTitle = target.title;
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
    target.title = originalTitle;
    target.subtitle = res.data.subtitle;
    target.keywords = res.data.keywords;
    target.urlName = String(target.urlName || "").trim()
      || buildLanguageUrlName(DEFAULT_PRODUCT_LANG, res.data.urlName, originalTitle);
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

const checkTranslationMenus = (targets: ProductTranslation[]) => ensureTranslationMenusExist({
  menus: props.menus,
  sourceMenuId: form.value.menuId,
  targets: targets.map((item) => ({ lang: String(item.lang) })),
  model: "3",
  contentLabel: "产品",
  getLanguageName,
});

const generateTranslation = async (
  target: ProductTranslation,
  showSuccess = true,
  modelValue = translationModel.value,
  skipMenuCheck = false,
) => {
  if (!skipMenuCheck && !(await checkTranslationMenus([target]))) return false;

  const source = form.value.translations?.find((item) => item.lang === DEFAULT_PRODUCT_LANG);
  if (!source?.title?.trim() && !source?.summary?.trim() && !source?.content?.trim()) {
    ElMessage.warning("请先在中文标签页填写标题、描述或详情");
    activeLang.value = DEFAULT_PRODUCT_LANG;
    return false;
  }

  translatingLang.value = String(target.lang);
  translationStatus.value = `正在生成 ${getLanguageName(String(target.lang))}，失败时后台会自动重试并切换备用模型...`;
  try {
    const res = await translateProductDraft({
      sourceLang: DEFAULT_PRODUCT_LANG,
      targetLang: String(target.lang),
      model: modelValue,
      title: source?.title || "",
      subtitle: source?.subtitle || "",
      keywords: source?.keywords || "",
      summary: source?.summary || "",
      content: source?.content || "",
      carouselTitles: source?.carouselTitles || [],
    });

    target.title = res.data.title;
    target.urlName = ensureLanguageUrlName(
      String(target.lang),
      target.urlName,
      res.data.title,
      source.urlName,
      source.title,
    );
    target.subtitle = res.data.subtitle;
    target.keywords = res.data.keywords;
    target.summary = res.data.summary;
    target.content = res.data.content;
    target.description = res.data.summary;
    target.carouselTitles = res.data.carouselTitles || [];
    syncTranslations();
    if (res.data.fallbackUsed) {
      const fallbackModel = translationModels.value.find((item) => item.value === res.data.model);
      ElMessage.info(`原模型暂时不可用，已自动改用 ${fallbackModel?.label || res.data.model} 完成`);
    }
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

  const allTargets = visibleTranslations.value.filter((item) => item.lang !== DEFAULT_PRODUCT_LANG);
  if (!allTargets.length) return false;
  const activeIndex = allTargets.findIndex((item) => String(item.lang) === String(activeLang.value));
  const targets = activeLang.value === DEFAULT_PRODUCT_LANG || activeIndex < 0
    ? allTargets
    : allTargets.slice(activeIndex);
  if (!(await checkTranslationMenus(targets))) return false;
  const modelValue = translationModel.value;
  if (!modelValue) {
    ElMessage.warning("请先选择可用的翻译模型");
    return false;
  }

  translatingAll.value = true;
  try {
    for (const [index, target] of targets.entries()) {
      const targetLang = String(target.lang);
      activeLang.value = targetLang;
      translationStatus.value = `正在翻译 ${getLanguageName(String(target.lang))}（${index + 1}/${targets.length}），后台会自动重试和切换备用模型...`;
      const success = await generateTranslation(target, false, modelValue, true);
      if (!success) {
        ElMessage.warning(`翻译在 ${getLanguageName(targetLang)} 停止；当前标签已保留在这里，再点一键翻译即可从这里继续`);
        return false;
      }

      if (props.saveAfterEachTranslation) {
        try {
          syncTranslations();
          syncDefaultFields();
          await props.saveAfterEachTranslation();
        } catch (e) {
          ElMessage.error(getErrorMessage(e, "自动保存翻译结果失败"));
          return false;
        }
      }
    }

    activeLang.value = DEFAULT_PRODUCT_LANG;
    ElMessage.success(`已从 ${getLanguageName(String(targets[0].lang))} 开始完成 ${targets.length} 种语言${props.saveAfterEachTranslation ? "并逐项保存" : ""}`);
    return true;
  } finally {
    translatingAll.value = false;
    translationStatus.value = "";
  }
};

const generateCurrentTranslation = async () => {
  if (translatingAll.value || translatingLang.value) return false;
  if (activeLang.value === DEFAULT_PRODUCT_LANG) {
    ElMessage.warning("请先切换到需要翻译的语言标签");
    return false;
  }

  const target = visibleTranslations.value.find((item) => String(item.lang) === String(activeLang.value));
  if (!target) {
    ElMessage.warning("没有找到当前语言");
    return false;
  }
  if (!translationModel.value) {
    ElMessage.warning("请先选择可用的翻译模型");
    return false;
  }

  const success = await generateTranslation(target, false, translationModel.value);
  if (!success) return false;
  if (props.saveAfterEachTranslation) {
    try {
      syncTranslations();
      syncDefaultFields();
      await props.saveAfterEachTranslation();
    } catch (e) {
      ElMessage.error(getErrorMessage(e, "自动保存翻译结果失败"));
      return false;
    }
  }
  ElMessage.success(`${getLanguageName(String(target.lang))}翻译已生成${props.saveAfterEachTranslation ? "并保存" : "，请检查后保存"}`);
  return true;
};

watch(
  () => [form.value.translations, form.value.carouselImages],
  () => syncTranslations(),
  { immediate: true, deep: true },
);

watch(translationModel, (value) => savePreferredTranslationModel(value));

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
  generateCurrentTranslation,
  syncTranslations,
  syncDefaultFields,
  translatingAll,
  translatingLang,
  translationStatus,
});
</script>

<style scoped>
.entity-form {
  width: 100%;
  max-width: none;
  box-sizing: border-box;
  overflow: hidden;
  padding: 0 28px;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  box-shadow: 0 2px 10px rgb(31 45 61 / 4%);
}

.full-control {
  width: 100%;
}

.form-section {
  padding: 24px 0 20px;
}

.form-section + .form-section {
  border-top: 1px solid var(--el-border-color-lighter);
}

.section-heading {
  display: flex;
  align-items: center;
  min-height: 24px;
  margin-bottom: 20px;
  padding-left: 12px;
  border-left: 4px solid var(--el-color-primary);
}

.section-heading h3 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 16px;
  font-weight: 700;
  line-height: 24px;
}

.cover-grid,
.publish-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 28px;
}

.cover-field :deep(.el-form-item__content),
.cover-field :deep(.thumb-upload),
.carousel-field :deep(.el-form-item__content) {
  min-width: 0;
  width: 100%;
}

.cover-field :deep(.input-row) {
  width: 100%;
}

.publish-grid :deep(.el-form-item) {
  margin-bottom: 0;
}

.publish-section {
  padding-bottom: 24px;
}

.action-row {
  margin-top: 22px;
  margin-bottom: 0;
  padding-top: 20px;
  border-top: 1px dashed var(--el-border-color);
}

.language-item :deep(.el-form-item__content) {
  display: block;
}

.language-tabs {
  width: 100%;
}

.translation-panel {
  padding: 18px 0 2px;
}

.translate-toolbar,
.seo-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
  padding: 12px 14px;
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
  flex: 1 1 320px;
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 20px;
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
    padding-right: 32px;
    padding-left: 32px;
  }
}

@media (max-width: 900px) {
  .cover-grid,
  .publish-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .publish-grid :deep(.el-form-item) {
    margin-bottom: 18px;
  }
}

@media (max-width: 640px) {
  .entity-form {
    padding-right: 16px;
    padding-left: 16px;
  }

  .form-section {
    padding-top: 20px;
  }

  .model-select {
    width: 100%;
  }

  .translate-toolbar :deep(.el-button),
  .seo-toolbar :deep(.el-button) {
    width: 100%;
  }
}
</style>
