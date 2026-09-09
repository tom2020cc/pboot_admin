<template>
  <section class="page">
    <div class="page-title">
      <h2>编辑菜单</h2>
      <el-button v-if="isChinese" type="primary" plain :disabled="saving || loadingMenu || menuFormRef?.isBusy || translating" @click="openTranslation">
        <el-icon><Switch /></el-icon>翻译当前栏目
      </el-button>
    </div>
    <MenuForm
      ref="menuFormRef"
      v-model="form"
      :top-menus="topMenus"
      :all-menus="allMenus"
      :current-id="route.params.id as string"
      :loading="saving || loadingMenu || translating"
      submit-text="保存修改"
      @submit="handleEdit(route.params.id as string)"
      @reset="reset"
    />
    <MenuTranslationDialog v-model="translationOpen" :menu-id="String(route.params.id)" :name="form.name"
      @busy="translating = $event" @translated="getAllMenus" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from "vue-router";
import { ElMessageBox } from 'element-plus';
import { Switch } from '@element-plus/icons-vue';
import MenuForm from "@/components/MenuForm.vue";
import MenuTranslationDialog from '@/components/MenuTranslationDialog.vue';
import useMenus from "@/hooks/useMenus";
import { getMenuLang } from '@/utils/menuLanguage';
import { useSitesStore } from '@/stores/sites';

const route = useRoute();
const { allMenus, topMenus, form, saving, loadingMenu, hasUnsavedChanges, reset, getMenuInfoById, handleEdit, getAllMenus } = useMenus();
const menuFormRef = ref<InstanceType<typeof MenuForm>>();
const translationOpen = ref(false);
const translating = ref(false);
const sites = useSitesStore();
const isChinese = computed(() => getMenuLang(form.value) === 'cn');
onBeforeRouteLeave(() => !translating.value);
onBeforeRouteUpdate(() => !translating.value);

const openTranslation = async () => {
  if (saving.value || loadingMenu.value || menuFormRef.value?.isBusy || translating.value) return;
  const id = String(route.params.id), siteId = sites.activeSiteId;
  if (hasUnsavedChanges.value || !form.value.code) {
    const confirmed = await ElMessageBox.confirm('当前栏目有未保存修改或尚未绑定。先保存中文栏目，再翻译？', '保存后翻译',
      { confirmButtonText: '保存并继续', cancelButtonText: '取消', type: 'warning' }).catch(() => false);
    if (!confirmed || String(route.params.id) !== id || sites.activeSiteId !== siteId) return;
    if (!await menuFormRef.value?.validateForm() || !await handleEdit(id, true)) return;
  }
  if (String(route.params.id) === id && sites.activeSiteId === siteId) translationOpen.value = true;
};

watch(() => route.params.id, (id) => {
  if (route.name === 'editMenus' && id) getMenuInfoById(id as string);
}, { immediate: true });
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-title h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}
.page-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

.page-title p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}
</style>
