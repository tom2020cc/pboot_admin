<template>
  <section class="page">
    <div class="page-title">
      <h2>新增用户</h2>
      <p>创建一个可以登录后台的新账号。</p>
    </div>
    <UserForm v-model="form" submit-text="新建用户" password-required :loading="loading" @submit="submit" @reset="reset" />
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import UserForm from "@/components/UserForm.vue";
import { createUser, type LoginInfo } from "@/api/users";
import { getErrorMessage } from "@/utils/request";

const router = useRouter();
const loading = ref(false);
const form = ref<Partial<LoginInfo>>({ email: "", password: "" });

const reset = () => {
  form.value = { email: "", password: "" };
};

const submit = async () => {
  loading.value = true;
  try {
    await createUser(form.value as LoginInfo);
    ElMessage.success("新增用户成功");
    router.push("/users");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "新增用户失败"));
  } finally {
    loading.value = false;
  }
};
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
