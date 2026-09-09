<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" class="entity-form">
    <div class="form-section">
      <div class="section-heading"><h3>基础信息</h3></div>
      <el-form-item label="内容栏目" prop="menuId">
        <el-select v-model="form.menuId" class="full-control" placeholder="请选择新闻所属栏目">
          <el-option v-for="item in menuOptions" :key="item.id" :label="item.optionLabel" :value="Number(item.id)" />
        </el-select>
      </el-form-item>

      <el-form-item label="缩略图" class="thumbnail-field">
        <ThumbnailUpload v-model="form.thumbnail" :upload="uploadThumbnail" />
      </el-form-item>
    </div>

    <div class="form-section language-section">
      <div class="section-heading"><h3>多语言内容</h3></div>
      <el-form-item class="language-item" label-width="0">
      <el-tabs v-model="activeLang" class="language-tabs">
        <el-tab-pane v-for="item in visibleTranslations" :key="item.lang" :label="getLanguageName(item.lang)" :name="item.lang">
          <div class="translation-panel">
            <div v-if="item.lang === DEFAULT_NEWS_LANG" class="seo-toolbar">
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
            </div>
            <div v-if="item.lang !== DEFAULT_NEWS_LANG" class="translate-toolbar">
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

            <el-form-item label="内容标题" label-width="86px" required>
              <el-input v-model="item.title" placeholder="请输入当前语言的新闻标题" />
            </el-form-item>

            <el-form-item v-if="entityIdText" label="新闻ID" label-width="86px">
              <el-input :model-value="entityIdText" disabled />
            </el-form-item>

            <el-form-item label="URL名称" label-width="86px">
              <el-input v-model="item.urlName" :placeholder="getUrlNamePlaceholder(item.lang)">
                <template #append>
                  <el-button :disabled="!entityIdText" @click="fillDefaultUrlName(item)">使用默认</el-button>
                </template>
              </el-input>
              <div class="field-tip">
                不填写时自动使用 {{ getUrlNamePlaceholder(item.lang) }}，同步到网站后作为该语言详情页 URL 名称。
              </div>
            </el-form-item>

            <el-form-item label="副标题" label-width="86px">
              <el-input v-model="item.subtitle" placeholder="请输入当前语言的副标题" />
            </el-form-item>

            <el-form-item label="关键词" label-width="86px">
              <el-input v-model="item.keywords" placeholder="多个关键词可用英文逗号分隔" />
            </el-form-item>

            <el-form-item label="描述" label-width="86px">
              <el-input v-model="item.summary" type="textarea" :rows="3" placeholder="请输入当前语言的 SEO 描述" />
            </el-form-item>

            <el-form-item label="正文内容" label-width="86px">
              <SourceCodeEditor v-model="item.content" placeholder="可输入 HTML 源码，例如 <p>新闻正文</p>" />
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
        <el-button @click="$router.push('/news')">返回列表</el-button>
      </el-form-item>
    </div>
  </el-form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import {
  DEFAULT_NEWS_LANG,
  NEWS_LANGUAGES,
  ensureNewsTranslations,
  getTranslationModels,
  optimizeNewsSeoDraft,
  translateNewsDraft,
  uploadNewsThumbnail,
  type NewsForm,
  type NewsTranslation,
  type TranslationModel,
} from "@/api/news";
import { getErrorMessage } from "@/utils/request";
import { resolvePreferredTranslationModel, savePreferredTranslationModel } from "@/utils/translationModelPreference";
import { useAvailableLanguages } from "@/composables/useAvailableLanguages";
import type { MenuItem } from "@/api/menus";
import ThumbnailUpload from "@/components/ThumbnailUpload.vue";
import SourceCodeEditor from "@/components/SourceCodeEditor.vue";
import { filterMenusByContentLangAndModel } from "@/utils/menuLanguage";
import { buildLanguageUrlName, ensureLanguageUrlName } from "@/utils/seoUrlName";
import { ensureTranslationMenusExist } from "@/utils/translationMenuGuard";

const form = defineModel<NewsForm>({ required: true });
const availableLanguages = useAvailableLanguages();
const visibleTranslations = computed(() => {
  const codes = new Set(availableLanguages.value.map((item) => item.code));
  return (form.value.translations || []).filter((item) => codes.has(item.lang as any));
});

const props = defineProps<{
  menus: MenuItem[];
  submitText: string;
  loading?: boolean;
  entityId?: number | string;
}>();

const uploadThumbnail = async (file: File) => {
  const title = (form.value.translations?.find(item => item.lang === DEFAULT_NEWS_LANG)?.title || form.value.title || '').trim();
  if (!props.entityId && !title) throw new Error('请先填写中文新闻标题，再上传缩略图');
  if (!props.entityId && !form.value.menuId) throw new Error('请先选择中文新闻栏目，再上传缩略图');
  const result = await uploadNewsThumbnail(file, {
    newsId: props.entityId ? Number(props.entityId) : undefined,
    menuId: form.value.menuId,
    title,
    referenceImage: form.value.thumbnail,
  });
  return result.data.url;
};

const emit = defineEmits<{
  submit: [];
  reset: [];
}>();

type MenuOption = MenuItem & { optionLabel: string };

const formRef = ref<FormInstance>();
const activeLang = ref(DEFAULT_NEWS_LANG);
const translatingLang = ref("");
const translatingAll = ref(false);
const optimizingSeo = ref(false);
const translationModel = ref("");
const seoModel = ref("");
const translationModels = ref<TranslationModel[]>([]);
const selectableTranslationModels = computed(() =>
  translationModels.value.filter((item) => item.available && item.operational !== false),
);
const hasAvailableTranslationModel = computed(() => selectableTranslationModels.value.length > 0);
const availableSeoModels = computed(() =>
  translationModels.value.filter(
    (item) => item.available && item.operational !== false && item.value !== "qwen-mt-lite" && ["zhipu", "deepseek", "qwen", "openai"].includes(item.provider),
  ),
);
const entityIdText = computed(() => (props.entityId === undefined || props.entityId === null ? "" : String(props.entityId)));

const menuOptions = computed<MenuOption[]>(() => {
  const currentMenus = filterMenusByContentLangAndModel(props.menus, activeLang.value, "2");
  const map = new Map(currentMenus.map((item) => [String(item.id), item]));
  return currentMenus.map((item) => {
    const parent = map.get(String(item.parentId));
    return {
      ...item,
      optionLabel: Number(item.parentId) === 0 ? `一级栏目 / ${item.name}` : `${parent?.name || "未知栏目"} / ${item.name}`,
    };
  });
});

const rules: FormRules<NewsForm> = {
  menuId: [{ required: true, message: "请选择内容栏目", trigger: "change" }],
};

const getLanguageName = (lang: string) => NEWS_LANGUAGES.find((item) => item.code === lang)?.name || lang;

const getUrlLangPrefix = (lang: string) => {
  if (lang === DEFAULT_NEWS_LANG) return "cn";
  return String(lang || "en").replace(/[^a-z0-9-]/gi, "").toLowerCase() || "en";
};

const getDefaultUrlName = (lang: string) => (entityIdText.value ? `${getUrlLangPrefix(lang)}-${entityIdText.value}` : "");

const getUrlNamePlaceholder = (lang: string) => getDefaultUrlName(lang) || `${getUrlLangPrefix(lang)}-新闻ID`;

const fillDefaultUrlName = (item: NewsTranslation) => {
  const next = getDefaultUrlName(String(item.lang));
  if (next) item.urlName = next;
};

const ensureDefaultUrlNames = () => {
  if (!entityIdText.value) return;
  for (const item of form.value.translations || []) {
    if (!String(item.urlName || "").trim()) item.urlName = getDefaultUrlName(String(item.lang));
  }
};

const syncTranslations = () => {
  const next = ensureNewsTranslations(form.value.translations);
  const current = form.value.translations || [];
  const sameOrder = current.length === next.length && current.every((item, index) => item.lang === next[index].lang);
  if (!sameOrder) form.value.translations = next;
};

const syncDefaultFields = () => {
  const defaultTranslation = form.value.translations?.find((item) => item.lang === DEFAULT_NEWS_LANG);
  form.value.title = defaultTranslation?.title || "";
  form.value.urlName = defaultTranslation?.urlName || "";
  form.value.subtitle = defaultTranslation?.subtitle || "";
  form.value.keywords = defaultTranslation?.keywords || "";
  form.value.summary = defaultTranslation?.summary || "";
  form.value.description = form.value.summary;
  form.value.content = defaultTranslation?.content || "";
};

const loadTranslationModels = async () => {
  try {
    const res = await getTranslationModels();
    translationModels.value = [...res.data];
    translationModel.value = resolvePreferredTranslationModel(translationModels.value, translationModel.value);
    const preferredSeoModel = availableSeoModels.value[0];
    seoModel.value = preferredSeoModel?.value || "";
    return true;
  } catch (e) {
    ElMessage.warning(getErrorMessage(e, "获取翻译模型失败"));
  }
};

const optimizeChineseSeo = async (target: NewsTranslation) => {
  if (target.lang !== DEFAULT_NEWS_LANG) return;
  if (!target.title?.trim() && !target.summary?.trim() && !target.content?.trim()) {
    ElMessage.warning("请先填写中文标题、描述或正文");
    return;
  }
  if (!seoModel.value) {
    ElMessage.warning("请先配置智谱或 OpenAI API Key");
    return;
  }

  optimizingSeo.value = true;
  try {
    const res = await optimizeNewsSeoDraft({
      model: seoModel.value,
      contentType: "news",
      title: target.title || "",
      subtitle: target.subtitle || "",
      keywords: target.keywords || "",
      urlName: target.urlName || "",
      summary: target.summary || "",
      content: target.content || "",
    });
    target.title = res.data.title;
    target.subtitle = res.data.subtitle;
    target.keywords = res.data.keywords;
    target.urlName = String(target.urlName || "").trim()
      || buildLanguageUrlName(DEFAULT_NEWS_LANG, res.data.urlName, res.data.title, getDefaultUrlName(DEFAULT_NEWS_LANG));
    target.summary = res.data.summary;
    target.description = res.data.summary;
    target.content = res.data.content;
    syncDefaultFields();
    ElMessage.success("中文 SEO 草稿已优化，请检查后保存");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "中文 SEO 优化失败"));
  } finally {
    optimizingSeo.value = false;
  }
};

const checkTranslationMenus = (targets: NewsTranslation[]) => ensureTranslationMenusExist({
  menus: props.menus,
  sourceMenuId: form.value.menuId,
  targets: targets.map((item) => ({ lang: String(item.lang) })),
  model: "2",
  contentLabel: "新闻",
  getLanguageName,
});

const generateTranslation = async (
  target: NewsTranslation,
  showSuccess = true,
  modelValue = translationModel.value,
  skipMenuCheck = false,
) => {
  if (!skipMenuCheck && !(await checkTranslationMenus([target]))) return false;

  const source = form.value.translations?.find((item) => item.lang === DEFAULT_NEWS_LANG);
  if (!source?.title?.trim() && !source?.summary?.trim() && !source?.content?.trim()) {
    ElMessage.warning("请先在中文标签页填写标题、描述或正文");
    activeLang.value = DEFAULT_NEWS_LANG;
    return false;
  }

  translatingLang.value = String(target.lang);
  try {
    const res = await translateNewsDraft({
      sourceLang: DEFAULT_NEWS_LANG,
      targetLang: String(target.lang),
      model: modelValue,
      title: source?.title || "",
      subtitle: source?.subtitle || "",
      keywords: source?.keywords || "",
      summary: source?.summary || "",
      content: source?.content || "",
    });

    target.title = res.data.title;
    target.urlName = ensureLanguageUrlName(
      String(target.lang),
      target.urlName,
      res.data.title,
      source.urlName,
      getDefaultUrlName(String(target.lang)),
    );
    target.subtitle = res.data.subtitle;
    target.keywords = res.data.keywords || target.keywords || res.data.title;
    target.summary = res.data.summary;
    target.content = res.data.content;
    target.description = res.data.summary;
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
  }
};

const generateAllTranslations = async () => {
  if (translatingAll.value || translatingLang.value) return false;

  const allTargets = visibleTranslations.value.filter((item) => item.lang !== DEFAULT_NEWS_LANG);
  if (!allTargets.length) return false;
  const activeIndex = allTargets.findIndex((item) => String(item.lang) === String(activeLang.value));
  const targets = activeLang.value === DEFAULT_NEWS_LANG || activeIndex < 0
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
    for (const target of targets) {
      activeLang.value = String(target.lang);
      const success = await generateTranslation(target, false, modelValue, true);
      if (!success) {
        ElMessage.warning(`翻译在 ${getLanguageName(String(target.lang))} 停止；当前标签已保留在这里，再点一键翻译即可从这里继续`);
        return false;
      }
    }

    activeLang.value = DEFAULT_NEWS_LANG;
    ElMessage.success(`已从 ${getLanguageName(String(targets[0].lang))} 开始完成 ${targets.length} 种语言，请检查后保存或同步`);
    return true;
  } finally {
    translatingAll.value = false;
  }
};

const generateCurrentTranslation = async () => {
  if (translatingAll.value || translatingLang.value) return false;
  if (activeLang.value === DEFAULT_NEWS_LANG) {
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
  return generateTranslation(target, true, translationModel.value);
};

watch(
  () => form.value.translations,
  () => syncTranslations(),
  { immediate: true },
);

watch(translationModel, (value) => savePreferredTranslationModel(value));

onMounted(loadTranslationModels);

const submitForm = async () => {
  syncTranslations();
  ensureDefaultUrlNames();
  syncDefaultFields();

  const defaultTranslation = form.value.translations?.find((item) => item.lang === DEFAULT_NEWS_LANG);
  if (!defaultTranslation?.title?.trim()) {
    activeLang.value = DEFAULT_NEWS_LANG;
    ElMessage.warning("请先填写中文标题");
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
  ensureDefaultUrlNames,
  translatingAll,
  translatingLang,
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

.thumbnail-field :deep(.el-form-item__content),
.thumbnail-field :deep(.thumb-upload) {
  min-width: 0;
  width: 100%;
}

.publish-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 28px;
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

.language-tabs :deep(.el-tabs__content) {
  overflow: visible;
}

.translation-panel {
  padding: 18px 0 2px;
}

.translation-panel :deep(.el-input),
.translation-panel :deep(.el-textarea),
.translation-panel :deep(.source-editor) {
  width: 100%;
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

.field-tip {
  width: 100%;
  margin-top: 6px;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
}

@media (min-width: 1280px) {
  .entity-form {
    padding-right: 32px;
    padding-left: 32px;
  }
}

@media (max-width: 900px) {
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
