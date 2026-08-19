<template>
  <section class="page">
    <div class="page-title">
      <h2>图片上传</h2>
      <p>测试后端 /img-upload/imgs 接口，最多一次上传 3 张。</p>
    </div>

    <div class="upload-panel">
      <ImageUpload v-model="filenames" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import ImageUpload from "@/components/ImageUpload.vue";

const filenames = ref<string[]>([]);
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

.upload-panel {
  max-width: 760px;
  padding: 24px;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}
</style>
