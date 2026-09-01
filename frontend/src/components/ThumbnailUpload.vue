<template>
  <div class="thumb-upload">
    <div class="input-row">
      <el-input v-model="model" placeholder="上传后自动填入文件名，也可手动输入" />
      <el-upload action="#" :auto-upload="false" :show-file-list="false" accept="image/*" :on-change="handleChange">
        <el-button type="primary" :loading="uploading">
          <el-icon><UploadFilled /></el-icon>
          上传图片
        </el-button>
      </el-upload>
    </div>

    <div v-if="model" class="preview-row">
      <el-image :src="getUploadUrl(model)" fit="cover" class="preview" />
      <el-button type="danger" link @click="model = ''">删除</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { UploadFile } from "element-plus";
import { ElMessage } from "element-plus";
import { getImageUploadSizeError, getUploadUrl, uploadImages } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";
import { UploadFilled } from "@element-plus/icons-vue";

const model = defineModel<string>({ required: true });
const uploading = ref(false);

const handleChange = async (file: UploadFile) => {
  if (!file.raw) return;
  const sizeError = getImageUploadSizeError(file.raw);
  if (sizeError) {
    ElMessage.warning(sizeError);
    return;
  }

  const formData = new FormData();
  formData.append("imgArr", file.raw);

  uploading.value = true;
  try {
    const res = await uploadImages(formData);
    model.value = res.data[0] || "";
    ElMessage.success("缩略图上传成功");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "缩略图上传失败"));
  } finally {
    uploading.value = false;
  }
};
</script>

<style scoped>
.thumb-upload {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.preview-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.preview {
  width: 178px;
  height: 102px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
}
</style>
