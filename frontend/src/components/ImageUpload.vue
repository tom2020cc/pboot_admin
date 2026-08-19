<template>
  <div class="image-upload">
    <el-upload
      v-model:file-list="fileList"
      action="#"
      list-type="picture-card"
      :auto-upload="false"
      :limit="3"
      accept="image/*"
      :on-exceed="handleExceed"
    >
      <el-icon><Plus /></el-icon>
    </el-upload>

    <div class="upload-actions">
      <el-button type="primary" :loading="uploading" @click="uploadSelected">
        上传图片
      </el-button>
      <el-button @click="clearFiles">清空选择</el-button>
    </div>

    <div v-if="model?.length" class="uploaded-list">
      <div v-for="filename in model" :key="filename" class="uploaded-item">
        <el-image :src="getUploadUrl(filename)" fit="cover" />
        <el-text truncated>{{ filename }}</el-text>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { UploadUserFile } from "element-plus";
import { ElMessage } from "element-plus";
import { uploadImages, getUploadUrl, validateImageUploadFiles } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";

const model = defineModel<string[]>({ required: true });
const fileList = ref<UploadUserFile[]>([]);
const uploading = ref(false);

const handleExceed = () => {
  ElMessage.warning("一次最多上传 3 张图片");
};

const clearFiles = () => {
  fileList.value = [];
};

const uploadSelected = async () => {
  const files = fileList.value.map((file) => file.raw).filter(Boolean);
  if (!files.length) {
    ElMessage.warning("请先选择图片");
    return;
  }
  const sizeError = validateImageUploadFiles(files as File[]);
  if (sizeError) {
    ElMessage.warning(sizeError);
    return;
  }

  const formData = new FormData();
  files.forEach((file) => formData.append("imgArr", file as File));

  uploading.value = true;
  try {
    const res = await uploadImages(formData);
    model.value = res.data;
    fileList.value = [];
    ElMessage.success("图片上传成功");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "图片上传失败"));
  } finally {
    uploading.value = false;
  }
};
</script>

<style scoped>
.image-upload {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.upload-actions {
  display: flex;
  gap: 8px;
}

.uploaded-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.uploaded-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.uploaded-item .el-image {
  width: 100%;
  height: 92px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
}
</style>
