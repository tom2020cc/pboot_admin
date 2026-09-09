<template>
  <el-form ref="formRef" :model="form" :rules="rules" :disabled="optimizingSeo || loading" label-width="96px" class="entity-form">
    <div class="section-heading"><h3>栏目信息</h3><el-tag size="small" :type="isChinese ? 'success' : 'info'">{{ isChinese ? '中文母版' : '翻译内容' }}</el-tag></div>
    <el-form-item label="菜单名称" prop="name">
      <el-input v-model="form.name" placeholder="例如：产品中心" />
    </el-form-item>
    <el-form-item label="菜单路径" prop="href">
      <el-input v-model="form.href" placeholder="例如：/products" />
    </el-form-item>
    <el-form-item label="PB 栏目编码">
      <el-input v-model="form.code" placeholder="保存后自动分配" disabled />
    </el-form-item>
    <el-form-item label="URL名称">
      <el-input v-model="form.urlName" placeholder="例如：products" />
    </el-form-item>
    <el-form-item v-if="!form.code" label="内容类型" prop="model">
      <el-select v-model="form.model" class="full-control" placeholder="选择栏目内容类型" :loading="loadingModels">
        <el-option v-for="item in contentModels" :key="item.value" :label="item.label" :value="String(item.value)" />
      </el-select>
    </el-form-item>
    <el-form-item v-if="!isChinese" label="中文来源">
      <el-select v-model="form.sourceMenuId" class="full-control" filterable :disabled="Boolean(savedSourceId)" placeholder="选择对应的中文栏目">
        <el-option v-for="item in chineseSources" :key="item.id" :label="getMenuPath(item)" :value="Number(item.id)" />
      </el-select>
    </el-form-item>
    <el-form-item label="上级菜单" prop="parentId">
      <el-select v-model="form.parentId" placeholder="选择上级菜单" class="full-control" filterable :disabled="!isChinese">
        <el-option label="顶级栏目（作为一级栏目）" :value="0" />
        <el-option
          v-for="item in selectableParentMenus"
          :key="item.id"
          :label="`${getMenuPath(item)}（作为子栏目）`"
          :value="Number(item.id)"
          :disabled="isCurrentOrDescendant(item)"
        />
      </el-select>
      <div class="parent-hint">
        <el-tag :type="form.parentId === 0 ? 'success' : 'primary'" effect="light">
          {{ form.parentId === 0 ? "一级栏目" : `${currentMenuLevel}级栏目` }}
        </el-tag>
        <span v-if="form.parentId !== 0">归属到：{{ selectedParentName }}</span>
        <span v-else>该菜单会显示在一级栏目中。</span>
      </div>
      <div v-if="parentWarning" class="parent-warning">{{ parentWarning }}</div>
    </el-form-item>
    <div class="section-heading section-divider"><h3>栏目图片</h3></div>
    <div class="media-grid">
      <el-form-item label="栏目缩略图">
        <ThumbnailUpload v-if="isChinese" v-model="thumbnail" label="栏目缩略图" />
        <el-image v-else-if="thumbnail" :src="getUploadUrl(thumbnail)" fit="contain" class="readonly-image" />
        <el-text v-else type="info">未设置</el-text>
      </el-form-item>
      <el-form-item label="栏目大图">
        <ThumbnailUpload v-if="isChinese" v-model="largeImage" label="栏目大图" />
        <el-image v-else-if="largeImage" :src="getUploadUrl(largeImage)" fit="contain" class="readonly-image" />
        <el-text v-else type="info">未设置</el-text>
      </el-form-item>
    </div>
    <div class="section-heading section-divider"><h3>栏目 SEO</h3></div>
    <div v-if="isChinese" class="seo-toolbar">
      <el-select v-model="seoModel" placeholder="选择 AI SEO 模型" class="model-select" aria-label="栏目 SEO 模型">
        <el-option v-for="item in availableSeoModels" :key="item.value" :label="item.displayLabel || item.label" :value="item.value" />
      </el-select>
      <el-button type="success" :loading="optimizingSeo" :disabled="!seoModel" @click="optimizeChineseSeo">AI 优化中文 SEO</el-button>
    </div>
    <el-form-item label="SEO 标题">
      <el-input v-model="seoTitle" :readonly="!isChinese" placeholder="栏目 SEO 标题" />
    </el-form-item>
    <el-form-item label="SEO 关键字">
      <el-input v-model="seoKeywords" :readonly="!isChinese" placeholder="栏目 SEO 关键字" />
    </el-form-item>
    <el-form-item label="SEO 描述">
      <el-input v-model="seoDescription" :readonly="!isChinese" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="栏目 SEO 描述" />
    </el-form-item>
    <div class="section-divider"></div>
    <el-form-item label="是否显示">
      <el-switch v-model="form.show" active-text="显示" inactive-text="隐藏" :disabled="!isChinese" />
    </el-form-item>
    <el-form-item label="排序" prop="orderNum">
      <el-input-number v-model="form.orderNum" :min="0" :max="999" :disabled="!isChinese" />
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :loading="loading" @click="submitForm">{{ submitText }}</el-button>
      <el-button @click="$emit('reset')">重置</el-button>
      <el-button @click="$router.push('/menus')">返回列表</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage } from "element-plus";
import { getPbootMenuModels, getMenuTranslationModels, optimizeMenuSeoDraft, type MenuForm, type MenuItem, type MenuTranslationModel } from "@/api/menus";
import ThumbnailUpload from "@/components/ThumbnailUpload.vue";
import { getUploadUrl } from "@/api/uploads";
import { getMenuLang } from "@/utils/menuLanguage";
import { getErrorMessage } from "@/utils/request";
import { resolvePreferredTranslationModel } from "@/utils/translationModelPreference";

const form = defineModel<MenuForm>({ required: true });

const props = defineProps<{
  topMenus: MenuItem[];
  allMenus?: MenuItem[];
  submitText: string;
  loading?: boolean;
  currentId?: string | number;
}>();

const emit = defineEmits<{
  submit: [];
  reset: [];
}>();

const formRef = ref<FormInstance>();

const menuList = computed(() => {
  return props.allMenus?.length ? props.allMenus : props.topMenus;
});

const menuById = computed(() => {
  return new Map(menuList.value.map((item) => [String(item.id), item]));
});

const currentMenuLang = computed(() => {
  const lang = getMenuLang({ code: form.value.code || "" });
  if (lang) return lang;

  const currentParent = menuById.value.get(String(form.value.parentId || ""));
  return (currentParent ? getMenuLang(currentParent) : "") || "cn";
});

const isChinese = computed(() => currentMenuLang.value === 'cn');
const savedSourceId = computed(() => menuById.value.get(String(props.currentId))?.sourceMenuId);
const chineseSources = computed(() => menuList.value.filter(item => getMenuLang(item) === 'cn' && !item.pendingDelete
  && String(item.model) === String(form.value.model)));
const contentModels = ref<Array<{ value: string; label: string }>>([]);
const loadingModels = ref(false);
watch(() => !props.loading && !form.value.code, async (needed) => {
  if (!needed || contentModels.value.length || loadingModels.value) return;
  loadingModels.value = true;
  try { contentModels.value = (await getPbootMenuModels()).data; }
  catch (error) { ElMessage.error(getErrorMessage(error, '获取 PB 内容类型失败')); }
  finally { loadingModels.value = false; }
}, { immediate: true });
watch(() => form.value.parentId, (id) => {
  if (!form.value.code) form.value.model = menuById.value.get(String(id))?.model || form.value.model;
});
const thumbnail = computed({
  get: () => form.value.thumbnail ?? form.value.icon?.[0] ?? '',
  set: (value: string) => { form.value.thumbnail = value; form.value.icon = value ? [value] : []; },
});
const largeImage = computed({ get: () => form.value.largeImage ?? '', set: (value: string) => { form.value.largeImage = value; } });
const seoField = (field: 'seoTitle' | 'seoKeywords' | 'seoDescription') => computed({
  get: () => form.value[field] ?? '',
  set: (value: string) => { form.value[field] = value; },
});
const seoTitle = seoField('seoTitle');
const seoKeywords = seoField('seoKeywords');
const seoDescription = seoField('seoDescription');
const optimizingSeo = ref(false);
const seoModel = ref('');
const models = ref<MenuTranslationModel[]>([]);
const availableSeoModels = computed(() => models.value.filter((item) => item.available && item.operational !== false && item.value !== 'qwen-mt-lite' && ['zhipu', 'openai', 'deepseek', 'qwen'].includes(item.provider)));

onMounted(async () => {
  try {
    models.value = (await getMenuTranslationModels()).data;
    seoModel.value = resolvePreferredTranslationModel(availableSeoModels.value);
  } catch (error) { ElMessage.warning(getErrorMessage(error, '获取栏目 SEO 模型失败')); }
});

const optimizeChineseSeo = async () => {
  if (!isChinese.value || optimizingSeo.value) return;
  if (!form.value.name.trim()) { ElMessage.warning('请先填写中文栏目名称'); return; }
  const draft = form.value;
  const id = props.currentId;
  optimizingSeo.value = true;
  try {
    const result = (await optimizeMenuSeoDraft({
      model: seoModel.value, lang: 'cn', menuId: id == null ? undefined : String(id),
      name: draft.name, parentName: selectedParent.value ? getMenuPath(selectedParent.value) : '',
      seoTitle: seoTitle.value, seoKeywords: seoKeywords.value, seoDescription: seoDescription.value,
    })).data;
    if (form.value !== draft || props.currentId !== id) return;
    draft.seoTitle = result.seoTitle;
    draft.seoKeywords = result.seoKeywords;
    draft.seoDescription = result.seoDescription;
    ElMessage.success('中文栏目 SEO 草稿已优化，请检查后保存');
  } catch (error) { ElMessage.error(getErrorMessage(error, '栏目 SEO 优化失败')); }
  finally { optimizingSeo.value = false; }
};

const sameLangMenus = computed(() => {
  return menuList.value.filter((item) => getMenuLang(item) === currentMenuLang.value);
});

const getMenuPath = (menu: MenuItem | undefined, seen = new Set<string>()): string => {
  if (!menu) return "";

  const key = String(menu.id);
  if (seen.has(key)) return menu.name;
  seen.add(key);

  const parentId = Number(menu.parentId || 0);
  if (!parentId) return menu.name;

  const parent = menuById.value.get(String(parentId));
  const parentPath = getMenuPath(parent, seen);
  return parentPath ? `${parentPath} / ${menu.name}` : menu.name;
};

const getMenuLevel = (menu: MenuItem | undefined, seen = new Set<string>()): number => {
  if (!menu) return 1;

  const key = String(menu.id);
  if (seen.has(key)) return 1;
  seen.add(key);

  const parentId = Number(menu.parentId || 0);
  if (!parentId) return 1;

  return getMenuLevel(menuById.value.get(String(parentId)), seen) + 1;
};

const isCurrentOrDescendant = (menu: MenuItem) => {
  const currentId = String(props.currentId || "");
  if (!currentId) return false;

  let cursor: MenuItem | undefined = menu;
  const seen = new Set<string>();
  while (cursor) {
    const key = String(cursor.id);
    if (key === currentId) return true;
    if (seen.has(key)) return true;
    seen.add(key);

    const parentId = Number(cursor.parentId || 0);
    if (!parentId) break;
    cursor = menuById.value.get(String(parentId));
  }

  return false;
};

const selectableParentMenus = computed(() => {
  return sameLangMenus.value.filter((item) => !item.pendingDelete && !isCurrentOrDescendant(item));
});

const selectedParent = computed(() => {
  if (Number(form.value.parentId || 0) === 0) return undefined;
  return menuById.value.get(String(form.value.parentId));
});

const selectedParentName = computed(() => {
  return selectedParent.value ? getMenuPath(selectedParent.value) : `未找到父级栏目 #${form.value.parentId}`;
});

const currentMenuLevel = computed(() => {
  if (Number(form.value.parentId || 0) === 0) return 1;
  return getMenuLevel(selectedParent.value) + 1;
});

const parentWarning = computed(() => {
  if (Number(form.value.parentId || 0) === 0) return "";
  if (!selectedParent.value) return "本地数据库里缺少这个父级栏目，请先在菜单管理执行“一键同步 PB 数据”，再回来修改。";

  const parentLang = getMenuLang(selectedParent.value);
  if (parentLang && parentLang !== currentMenuLang.value) {
    return `父级栏目语言是 ${parentLang}，当前栏目语言是 ${currentMenuLang.value}，建议选择同语言父级。`;
  }

  return "";
});

const rules: FormRules<MenuForm> = {
  name: [{ required: true, message: "请输入菜单名称", trigger: "blur" }],
  href: [{ required: true, message: "请输入菜单路径", trigger: "blur" }],
};

const validateForm = async () => {
  form.value.publisher = form.value.publisher || "admin";
  form.value.model = form.value.model || "";
  if (!form.value.code && !form.value.model) { ElMessage.warning('请选择栏目内容类型'); return false; }
  const valid = await formRef.value?.validate().catch(() => false);
  return Boolean(valid);
};
const submitForm = async () => { if (await validateForm()) emit('submit'); };
defineExpose({ validateForm, isBusy: computed(() => Boolean(props.loading) || optimizingSeo.value) });
</script>

<style scoped>
.entity-form {
  max-width: 1120px;
  padding: 24px;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.section-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
.section-heading h3 { margin: 0; padding-left: 12px; border-left: 3px solid var(--el-color-primary); font-size: 16px; line-height: 24px; }
.section-divider { margin-top: 26px; padding-top: 24px; border-top: 1px solid var(--el-border-color-lighter); }
.media-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.media-grid :deep(.el-form-item__content) { min-width: 0; }
.readonly-image { width: 178px; height: 102px; }
.seo-toolbar { display: flex; flex-wrap: wrap; gap: 10px; padding: 12px; margin-bottom: 20px; background: #f2f8f5; border: 1px solid #d7e9df; border-radius: 6px; }
.model-select { width: 380px; max-width: 100%; }
@media (max-width: 1100px) { .media-grid { grid-template-columns: minmax(0, 1fr); gap: 0; } }
@media (max-width: 600px) {
  .entity-form { padding: 16px; }
  .entity-form :deep(.el-form-item) { display: block; }
  .entity-form :deep(.el-form-item__label) { display: block; width: auto !important; text-align: left; }
  .entity-form :deep(.el-form-item__content) { margin-left: 0 !important; }
}

.full-control {
  width: 100%;
}

.field-note {
  margin-top: 6px;
  color: #98a2b3;
  font-size: 12px;
  line-height: 1.5;
}

.parent-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.parent-warning {
  margin-top: 8px;
  color: #e6a23c;
  font-size: 13px;
  line-height: 1.5;
}
</style>
