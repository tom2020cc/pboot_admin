<template>
  <section class="page">
    <div class="page-title">
      <h2>编辑用户</h2>
      <p>可修改邮箱，也可以填写新密码完成重置。</p>
    </div>
    <UserForm v-model="form" submit-text="保存修改" :loading="loading" @submit="submit" @reset="loadUser" />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import UserForm from "@/components/UserForm.vue";
import { getUserById, updateUser, type LoginInfo } from "@/api/users";
import { getErrorMessage } from "@/utils/request";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const form = ref<Partial<LoginInfo>>({ email: "", password: "" });

const loadUser = async () => {
  loading.value = true;
  try {
    const res = await getUserById(route.params.id as string);
    form.value = { email: res.data.email, password: "" };
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取用户详情失败"));
  } finally {
    loading.value = false;
  }
};

const submit = async () => {
  const payload: Partial<LoginInfo> = { email: form.value.email };
  if (form.value.password) payload.password = form.value.password;

  loading.value = true;
  try {
    await updateUser(route.params.id as string, payload);
    ElMessage.success("修改用户成功");
    router.push("/users");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "修改用户失败"));
  } finally {
    loading.value = false;
  }
};

onMounted(loadUser);
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
