<template>
  <section class="page">
    <div class="page-title">
      <h2>新增菜单</h2>
    </div>
    <MenuForm
      v-model="form"
      :top-menus="topMenus"
      :all-menus="allMenus"
      :loading="saving"
      submit-text="新建菜单"
      @submit="onSubmit"
      @reset="reset"
    />
  </section>
</template>

<script setup lang="ts">
import MenuForm from "@/components/MenuForm.vue";
import useMenus from "@/hooks/useMenus";

const { allMenus, topMenus, form, saving, onSubmit, reset } = useMenus();
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
