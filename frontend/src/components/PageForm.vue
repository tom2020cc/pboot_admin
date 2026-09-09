<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" class="entity-form">
    <el-form-item label="内容栏目" prop="menuId">
      <el-select v-model="form.menuId" class="full-control" placeholder="请选择单页栏目">
        <el-option v-for="item in menuOptions" :key="item.id" :label="item.optionLabel" :value="Number(item.id)" />
      </el-select>
    </el-form-item>

    <el-form-item label="多语言内容" class="language-item">
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

            <el-form-item label="页面标题" label-width="86px" required>
              <el-input v-model="item.title" placeholder="请输入当前语言的单页标题" />
            </el-form-item>
            <el-form-item label="URL名称" label-width="86px">
              <el-input v-model="item.urlName" placeholder="例如 aboutUs、en-aboutUs" />
            </el-form-item>
            <el-form-item label="副标题" label-width="86px">
              <el-input v-model="item.subtitle" placeholder="请输入当前语言的副标题" />
            </el-form-item>
            <el-form-item label="关键词" label-width="86px">
              <el-input v-model="item.keywords" placeholder="多个关键词可用英文逗号分隔" />
            </el-form-item>
            <el-form-item label="描述" label-width="86px">
              <el-input v-model="item.description" type="textarea" :rows="3" placeholder="请输入当前语言的 SEO 描述" />
            </el-form-item>
            <el-form-item label="正文内容" label-width="86px">
              <SourceCodeEditor v-model="item.content" placeholder="可输入 HTML 源码，例如 <p>关于我们正文</p>" />
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
      <el-button @click="$router.push('/pages')">返回列表</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import type { MenuItem } from "@/api/menus";
import {
  DEFAULT_NEWS_LANG,
  NEWS_LANGUAGES,
  ensurePageTranslations,
  findMissingPageSeoFields,
  getPageTranslationModels,
  optimizePageSeoDraft,
  translatePageDraft,
  type PageForm,
  type PageTranslation,
} from "@/api/pages";
import type { TranslationModel } from "@/api/news";
import { filterMenusByContentLangAndModel } from "@/utils/menuLanguage";
import { getErrorMessage } from "@/utils/request";
import { resolvePreferredTranslationModel, savePreferredTranslationModel } from "@/utils/translationModelPreference";
import { buildLanguageUrlName, ensureLanguageUrlName } from "@/utils/seoUrlName";
import SourceCodeEditor from "@/components/SourceCodeEditor.vue";
import { useAvailableLanguages } from "@/composables/useAvailableLanguages";
import { ensureTranslationMenusExist } from "@/utils/translationMenuGuard";

const form = defineModel<PageForm>({ required: true });
const availableLanguages = useAvailableLanguages();
const visibleTranslations = computed(() => {
  const codes = new Set(availableLanguages.value.map((item) => item.code));
  return (form.value.translations || []).filter((item) => codes.has(item.lang as any));
});

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
const activeLang = ref(DEFAULT_NEWS_LANG);
const translatingLang = ref("");
const translatingAll = ref(false);
const translationProgress = ref("");
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

const menuOptions = computed<MenuOption[]>(() => {
  const currentMenus = filterMenusByContentLangAndModel(props.menus, activeLang.value, "1");
  return currentMenus.map((item) => ({
    ...item,
    optionLabel: `单页栏目 / ${item.name}`,
  }));
});

const rules: FormRules<PageForm> = {
  menuId: [{ required: true, message: "请选择内容栏目", trigger: "change" }],
};

const getLanguageName = (lang: string) => NEWS_LANGUAGES.find((item) => item.code === lang)?.name || lang;

const syncTranslations = () => {
  const next = ensurePageTranslations(form.value.translations);
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
  form.value.description = defaultTranslation?.description || "";
  form.value.content = defaultTranslation?.content || "";
};

const loadTranslationModels = async () => {
  try {
    const res = await getPageTranslationModels();
    translationModels.value = [...res.data];
    translationModel.value = resolvePreferredTranslationModel(translationModels.value, translationModel.value);
    seoModel.value = availableSeoModels.value[0]?.value || "";
  } catch (e) {
    ElMessage.warning(getErrorMessage(e, "获取翻译模型失败"));
  }
};

const optimizeChineseSeo = async (target: PageTranslation) => {
  if (target.lang !== DEFAULT_NEWS_LANG) return;
  if (!target.title?.trim() && !target.description?.trim() && !target.content?.trim()) {
    ElMessage.warning("请先填写中文单页标题、描述或正文");
    return;
  }
  if (!seoModel.value) {
    ElMessage.warning("请先配置可用的 AI 模型 Key");
    return;
  }

  optimizingSeo.value = true;
  try {
    const res = await optimizePageSeoDraft({
      model: seoModel.value,
      contentType: "page",
      title: target.title || "",
      subtitle: target.subtitle || "",
      keywords: target.keywords || "",
      urlName: target.urlName || "",
      summary: target.description || "",
      content: target.content || "",
    });
    target.title = res.data.title;
    target.urlName = String(target.urlName || "").trim()
      || buildLanguageUrlName(DEFAULT_NEWS_LANG, res.data.urlName, res.data.title);
    target.subtitle = res.data.subtitle;
    target.keywords = res.data.keywords;
    target.description = res.data.summary;
    target.content = res.data.content;
    syncDefaultFields();
    ElMessage.success("中文单页 SEO 草稿已优化，请检查后保存");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "中文单页 SEO 优化失败"));
  } finally {
    optimizingSeo.value = false;
  }
};

const checkTranslationMenus = (targets: PageTranslation[]) => ensureTranslationMenusExist({
  menus: props.menus,
  sourceMenuId: form.value.menuId,
  targets: targets.map((item) => ({ lang: String(item.lang) })),
  model: "1",
  contentLabel: "单页",
  getLanguageName,
});

const generateTranslation = async (
  target: PageTranslation,
  showSuccess = true,
  modelValue = translationModel.value,
  skipMenuCheck = false,
) => {
  if (!skipMenuCheck && !(await checkTranslationMenus([target]))) return false;

  const source = form.value.translations?.find((item) => item.lang === DEFAULT_NEWS_LANG);
  if (!source?.title?.trim() && !source?.description?.trim() && !source?.content?.trim()) {
    ElMessage.warning("请先在中文标签页填写标题、描述或正文");
    activeLang.value = DEFAULT_NEWS_LANG;
    return false;
  }

  translatingLang.value = String(target.lang);
  try {
    const res = await translatePageDraft({
      sourceLang: DEFAULT_NEWS_LANG,
      targetLang: String(target.lang),
      model: modelValue,
      title: source?.title || "",
      subtitle: source?.subtitle || "",
      keywords: source?.keywords || "",
      summary: source?.description || "",
      content: source?.content || "",
    });

    target.title = res.data.title;
    target.urlName = ensureLanguageUrlName(
      String(target.lang),
      target.urlName,
      res.data.title,
      source.urlName,
    );
    target.subtitle = res.data.subtitle;
    target.keywords = res.data.keywords || target.keywords || res.data.title;
    target.description = res.data.summary;
    target.content = res.data.content;
    if (res.data.fallbackUsed) {
      const fallbackModel = translationModels.value.find((item) => item.value === res.data.model);
      ElMessage.info(`原模型暂时不可用，已自动改用 ${fallbackModel?.label || res.data.model} 完成`);
    }
    if (showSuccess) ElMessage.success(`${getLanguageName(String(target.lang))}翻译已生成，请检查后保存`);
    return true;
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
  translationProgress.value = `0/${targets.length}`;
  try {
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      translationProgress.value = `${index + 1}/${targets.length}`;
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
    translationProgress.value = "";
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

const validateSeoCompleteness = () => {
  syncTranslations();
  for (const translation of visibleTranslations.value) {
    const missing = findMissingPageSeoFields(translation);
    if (!missing.length) continue;
    activeLang.value = String(translation.lang);
    ElMessage.warning(`${getLanguageName(String(translation.lang))}缺少：${missing.join("、")}`);
    return false;
  }
  return true;
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
  translatingAll,
  translatingLang,
  translationProgress,
  validateSeoCompleteness,
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

.full-control,
.language-tabs {
  width: 100%;
}

.language-item :deep(.el-form-item__content) {
  display: block;
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

@media (max-width: 760px) {
  .translate-toolbar,
  .seo-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .model-select {
    width: 100%;
  }
}
</style>
