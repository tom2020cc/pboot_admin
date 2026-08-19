<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" class="entity-form">
    <el-form-item label="菜单名称" prop="name">
      <el-input v-model="form.name" placeholder="例如：产品中心" />
    </el-form-item>
    <el-form-item label="菜单路径" prop="href">
      <el-input v-model="form.href" placeholder="例如：/products" />
    </el-form-item>
    <el-form-item label="编码">
      <el-input v-model="form.code" placeholder="例如：pboot:en:102" disabled />
      <div class="field-note">编码用于绑定 PbootCMS 原栏目，建议不要手动修改。</div>
    </el-form-item>
    <el-form-item label="URL名称">
      <el-input v-model="form.urlName" placeholder="例如：products" />
    </el-form-item>
    <el-form-item label="上级菜单" prop="parentId">
      <el-select v-model="form.parentId" placeholder="选择上级菜单" class="full-control" filterable>
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
    <el-form-item label="菜单图标">
      <ImageUpload v-model="form.icon" />
    </el-form-item>
    <el-form-item label="是否显示">
      <el-switch v-model="form.show" active-text="显示" inactive-text="隐藏" />
    </el-form-item>
    <el-form-item label="排序" prop="orderNum">
      <el-input-number v-model="form.orderNum" :min="0" :max="999" />
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :loading="loading" @click="submitForm">{{ submitText }}</el-button>
      <el-button @click="$emit('reset')">重置</el-button>
      <el-button @click="$router.push('/menus')">返回列表</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import type { MenuForm, MenuItem } from "@/api/menus";
import ImageUpload from "@/components/ImageUpload.vue";
import { getMenuLang } from "@/utils/menuLanguage";

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
  return currentParent ? getMenuLang(currentParent) : "cn";
});

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
  return sameLangMenus.value.filter((item) => !isCurrentOrDescendant(item));
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

const submitForm = async () => {
  form.value.publisher = form.value.publisher || "admin";
  form.value.model = form.value.model || "";
  form.value.listTemplate = "";
  form.value.detailTemplate = "";
  const valid = await formRef.value?.validate().catch(() => false);
  if (valid) emit("submit");
};
</script>

<style scoped>
.entity-form {
  max-width: 760px;
  padding: 24px;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
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
