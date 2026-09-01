<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" class="entity-form">
    <el-form-item label="内容栏目" prop="menuId">
      <el-select v-model="form.menuId" class="full-control" placeholder="请选择单页栏目">
        <el-option v-for="item in menuOptions" :key="item.id" :label="item.optionLabel" :value="Number(item.id)" />
      </el-select>
    </el-form-item>

    <el-form-item label="多语言内容" class="language-item">
      <el-tabs v-model="activeLang" class="language-tabs">
        <el-tab-pane v-for="item in form.translations" :key="item.lang" :label="getLanguageName(item.lang)" :name="item.lang">
          <div class="translation-panel">
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
              <span class="translate-tip">从中文标签页生成内容；空白 URL 会自动补成当前语言前缀。</span>
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
  buildPageUrlName,
  ensurePageTranslations,
  findMissingPageSeoFields,
  getPageTranslationModels,
  translatePageDraft,
  type PageForm,
  type PageTranslation,
} from "@/api/pages";
import type { TranslationModel } from "@/api/news";
import { filterMenusByContentLangAndModel } from "@/utils/menuLanguage";
import { getErrorMessage } from "@/utils/request";
import SourceCodeEditor from "@/components/SourceCodeEditor.vue";

const form = defineModel<PageForm>({ required: true });

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
const translationModel = ref("");
const translationModels = ref<TranslationModel[]>([]);
const hasAvailableTranslationModel = computed(() => translationModels.value.some((item) => item.available));

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
    const preferredTranslation = translationModels.value.find((item) => item.available);
    if (preferredTranslation) translationModel.value = preferredTranslation.value;
  } catch (e) {
    ElMessage.warning(getErrorMessage(e, "获取翻译模型失败"));
  }
};

const generateTranslation = async (target: PageTranslation, showSuccess = true) => {
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
      model: translationModel.value,
      title: source?.title || "",
      subtitle: source?.subtitle || "",
      keywords: source?.keywords || "",
      summary: source?.description || "",
      content: source?.content || "",
    });

    target.title = res.data.title;
    target.urlName = target.urlName?.trim() || buildPageUrlName(source.urlName, String(target.lang), res.data.title);
    target.subtitle = res.data.subtitle;
    target.keywords = res.data.keywords || target.keywords || res.data.title;
    target.description = res.data.summary;
    target.content = res.data.content;
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
  const targets = (form.value.translations || []).filter((item) => item.lang !== DEFAULT_NEWS_LANG);
  if (!targets.length) return false;

  translatingAll.value = true;
  translationProgress.value = `0/${targets.length}`;
  try {
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      translationProgress.value = `${index + 1}/${targets.length}`;
      activeLang.value = String(target.lang);
      const success = await generateTranslation(target, false);
      if (!success) return false;
    }
    activeLang.value = DEFAULT_NEWS_LANG;
    ElMessage.success("全部语言已按顺序生成，请检查后保存或同步");
    return true;
  } finally {
    translatingAll.value = false;
    translationProgress.value = "";
  }
};

const validateSeoCompleteness = () => {
  syncTranslations();
  for (const translation of form.value.translations || []) {
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
  syncTranslations,
  syncDefaultFields,
  translatingAll,
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

.translate-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding: 12px;
  background: #f7f9fc;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.model-select {
  width: 260px;
}

.translate-tip {
  color: var(--el-text-color-regular);
  font-size: 13px;
}

@media (max-width: 760px) {
  .translate-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .model-select {
    width: 100%;
  }
}
</style>
