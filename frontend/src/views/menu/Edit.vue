<template>
  <section class="page">
    <div class="page-title">
      <h2>编辑菜单</h2>
      <p>修改菜单基础信息、显示状态、排序和图标。</p>
    </div>
    <MenuForm
      v-model="form"
      :top-menus="topMenus"
      :all-menus="allMenus"
      :current-id="route.params.id as string"
      submit-text="保存修改"
      @submit="handleEdit(route.params.id as string)"
      @reset="reset"
    />
  </section>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useRoute } from "vue-router";
import MenuForm from "@/components/MenuForm.vue";
import useMenus from "@/hooks/useMenus";

const route = useRoute();
const { allMenus, topMenus, form, reset, getMenuInfoById, handleEdit } = useMenus();

onMounted(() => {
  getMenuInfoById(route.params.id as string);
});
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

.page-title p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}
</style>
