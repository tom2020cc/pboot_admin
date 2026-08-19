<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" class="entity-form">
    <el-form-item label="内容栏目" prop="menuId">
      <el-select v-model="form.menuId" class="full-control" placeholder="请选择新闻所属栏目">
        <el-option v-for="item in menuOptions" :key="item.id" :label="item.optionLabel" :value="Number(item.id)" />
      </el-select>
    </el-form-item>

    <el-form-item label="缩略图">
      <ThumbnailUpload v-model="form.thumbnail" />
    </el-form-item>

    <el-form-item label="多语言内容" class="language-item">
      <el-tabs v-model="activeLang" class="language-tabs">
        <el-tab-pane v-for="item in form.translations" :key="item.lang" :label="getLanguageName(item.lang)" :name="item.lang">
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
              <span class="translate-tip">「AI 优化中文 SEO」优化全部 SEO 字段并补全图片 ALT；「AI 补全图片 ALT」只补正文图片缺失的 ALT，不改任何文字。</span>
            </div>
            <div v-if="item.lang !== DEFAULT_NEWS_LANG" class="translate-toolbar">
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
              <span class="translate-tip">从中文标签页的标题、副标题、关键词、描述和正文生成。</span>
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

    <el-form-item label="状态">
      <el-switch v-model="form.show" active-text="显示" inactive-text="隐藏" />
    </el-form-item>

    <el-form-item label="排序">
      <el-input-number v-model="form.orderNum" :min="0" :max="999" />
    </el-form-item>

    <el-form-item>
      <el-button type="primary" :loading="loading" @click="submitForm">{{ submitText }}</el-button>
      <el-button @click="$emit('reset')">重置</el-button>
      <el-button @click="$router.push('/news')">返回列表</el-button>
    </el-form-item>
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
  type NewsForm,
  type NewsTranslation,
  type TranslationModel,
} from "@/api/news";
import { getErrorMessage } from "@/utils/request";
import type { MenuItem } from "@/api/menus";
import ThumbnailUpload from "@/components/ThumbnailUpload.vue";
import SourceCodeEditor from "@/components/SourceCodeEditor.vue";
import { filterMenusByContentLangAndModel } from "@/utils/menuLanguage";

const form = defineModel<NewsForm>({ required: true });

const props = defineProps<{
  menus: MenuItem[];
  submitText: string;
  loading?: boolean;
  entityId?: number | string;
}>();

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
const optimizingAlts = ref(false);
const translationModel = ref("google-free");
const seoModel = ref("");
const translationModels = ref<TranslationModel[]>([]);
const hasAvailableTranslationModel = computed(() => translationModels.value.some((item) => item.available));
const availableSeoModels = computed(() =>
  translationModels.value.filter(
    (item) => item.available && item.value !== "qwen-mt-lite" && ["zhipu", "deepseek", "qwen", "openai"].includes(item.provider),
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
    translationModels.value = [...res.data].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
    const preferredTranslation = translationModels.value.find((item) => item.available);
    if (preferredTranslation) translationModel.value = preferredTranslation.value;
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
    target.urlName = target.urlName || res.data.urlName;
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

const countMissingAltImages = (html: string) =>
  (String(html || "").match(/<img\b[^>]*>/gi) || []).filter(
    (tag) => !(tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || "").trim(),
  ).length;

const fillImageAlts = async (target: NewsTranslation) => {
  if (target.lang !== DEFAULT_NEWS_LANG) return;
  if (!target.content?.trim()) {
    ElMessage.warning("请先填写正文内容，才能补全图片 ALT");
    return;
  }
  const missing = countMissingAltImages(target.content);
  if (!missing) {
    ElMessage.info("正文图片均已填写 ALT，无需补全");
    return;
  }
  if (!seoModel.value) {
    ElMessage.warning("请先配置智谱或 OpenAI API Key");
    return;
  }

  optimizingAlts.value = true;
  try {
    const res = await optimizeNewsSeoDraft({
      model: seoModel.value,
      contentType: "news",
      title: target.title || "",
      keywords: target.keywords || "",
      urlName: target.urlName || "",
      summary: target.summary || "",
      content: target.content || "",
      onlyAlts: true,
    });
    const filled = res.data.imageAlts?.length || 0;
    if (filled) target.content = res.data.content;
    syncDefaultFields();
    ElMessage.success(filled ? `已为 ${filled} 张图片补全 ALT，请检查后保存` : "AI 未返回有效 ALT，正文未修改");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "图片 ALT 补全失败"));
  } finally {
    optimizingAlts.value = false;
  }
};

const generateTranslation = async (target: NewsTranslation, showSuccess = true) => {
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
      model: translationModel.value,
      title: source?.title || "",
      subtitle: source?.subtitle || "",
      keywords: source?.keywords || "",
      summary: source?.summary || "",
      content: source?.content || "",
    });

    target.title = res.data.title;
    target.subtitle = res.data.subtitle;
    target.keywords = res.data.keywords || target.keywords || res.data.title;
    target.summary = res.data.summary;
    target.content = res.data.content;
    target.description = res.data.summary;
    if (!String(target.urlName || "").trim()) fillDefaultUrlName(target);
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

  const targets = (form.value.translations || []).filter((item) => item.lang !== DEFAULT_NEWS_LANG);
  if (!targets.length) return false;

  translatingAll.value = true;
  try {
    for (const target of targets) {
      activeLang.value = String(target.lang);
      const success = await generateTranslation(target, false);
      if (!success) return false;
    }

    activeLang.value = DEFAULT_NEWS_LANG;
    ElMessage.success("全部语言已按顺序生成，请检查后保存或同步");
    return true;
  } finally {
    translatingAll.value = false;
  }
};

watch(
  () => form.value.translations,
  () => syncTranslations(),
  { immediate: true },
);

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
  syncTranslations,
  syncDefaultFields,
  ensureDefaultUrlNames,
  translatingAll,
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

.language-tabs :deep(.el-tabs__content) {
  overflow: visible;
}

.translation-panel {
  padding: 16px 0 4px;
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

.field-tip {
  width: 100%;
  margin-top: 6px;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
}

@media (min-width: 1280px) {
  .entity-form {
    padding: 28px 32px;
  }
}
</style>
