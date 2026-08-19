<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-width="86px" class="entity-form">
    <el-form-item label="邮箱" prop="email">
      <el-input v-model="form.email" placeholder="tom9@qq.com" />
    </el-form-item>
    <el-form-item label="密码" prop="password">
      <el-input
        v-model="form.password"
        type="password"
        show-password
        :placeholder="passwordPlaceholder"
      />
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :loading="loading" @click="submitForm">{{ submitText }}</el-button>
      <el-button @click="$emit('reset')">重置</el-button>
      <el-button @click="$router.push('/users')">返回列表</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import type { LoginInfo } from "@/api/users";

const form = defineModel<Partial<LoginInfo>>({ required: true });

const props = defineProps<{
  submitText: string;
  loading?: boolean;
  passwordRequired?: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  reset: [];
}>();

const formRef = ref<FormInstance>();
const passwordPlaceholder = computed(() => props.passwordRequired ? "请输入密码" : "留空表示不修改密码");

const rules = computed<FormRules<Partial<LoginInfo>>>(() => ({
  email: [
    { required: true, message: "请输入邮箱", trigger: "blur" },
    { type: "email", message: "邮箱格式不正确", trigger: "blur" },
  ],
  password: props.passwordRequired
    ? [
        { required: true, message: "请输入密码", trigger: "blur" },
        { min: 3, max: 32, message: "密码长度需要 3 到 32 位", trigger: "blur" },
      ]
    : [{ min: 3, max: 32, message: "密码长度需要 3 到 32 位", trigger: "blur" }],
}));

const submitForm = async () => {
  const valid = await formRef.value?.validate().catch(() => false);
  if (valid) emit("submit");
};
</script>

<style scoped>
.entity-form {
  max-width: 640px;
  padding: 24px;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}
</style>
