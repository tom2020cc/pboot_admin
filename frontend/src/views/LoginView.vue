<template>
  <div class="login-page">
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" size="large" class="login-form">
      <h2>{{ isRegister ? "注册账号" : "后台登录" }}</h2>
      <p class="login-sub">PbootCMS 内部管理后台</p>
      <el-form-item label="邮箱" prop="email">
        <el-input v-model="form.email" autocomplete="username" />
      </el-form-item>
      <el-form-item label="密码" prop="password">
        <el-input v-model="form.password" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="isLoading" @click="onSubmit">
          {{ isRegister ? "注册并登录" : "登录" }}
        </el-button>
      </el-form-item>
      <el-button link type="primary" @click="isRegister = !isRegister">
        {{ isRegister ? "已有账号，去登录" : "没有账号，立即注册" }}
      </el-button>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage } from "element-plus";
import { login, signup, type LoginInfo } from "@/api/users";
import { useMyTokenStore } from "@/stores/myToken";
import { useRoute, useRouter } from "vue-router";
import { getErrorMessage } from "@/utils/request";

const router = useRouter();
const route = useRoute();
const form = reactive<LoginInfo>({ email: "tom@qq.com", password: "tom1993" });
const formRef = ref<FormInstance>();
const isLoading = ref(false);
const isRegister = ref(false);
const myTokenStore = useMyTokenStore();

const rules: FormRules<LoginInfo> = {
  email: [
    { required: true, message: "邮箱不能为空", trigger: "blur" },
    { type: "email", message: "邮箱格式不正确", trigger: "blur" },
  ],
  password: [
    { required: true, message: "密码不能为空", trigger: "blur" },
    { min: 3, max: 32, message: "密码长度需要 3 到 32 位", trigger: "blur" },
  ],
};

const onSubmit = async () => {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  isLoading.value = true;
  try {
    if (isRegister.value) {
      await signup(form);
    }
    const res = await login(form);
    myTokenStore.saveToken(res.data.access_token);
    ElMessage.success(isRegister.value ? "注册并登录成功" : "登录成功");
    router.push((route.query.redirect as string) || "/");
  } catch (error) {
    ElMessage.error(getErrorMessage(error, isRegister.value ? "注册失败" : "登录失败"));
  } finally {
    isLoading.value = false;
  }
};
</script>

<style lang="scss" scoped>
.login-page {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, var(--el-color-primary-light-9), var(--el-bg-color-page));
}

.login-form {
  width: min(420px, calc(100vw - 32px));
  padding: 40px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);

  h2 {
    margin: 0;
    color: var(--el-text-color-primary);
    font-size: 24px;
    font-weight: 700;
  }

  .login-sub {
    margin: 6px 0 20px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }

  .el-button {
    width: 100%;
  }
}
</style>
