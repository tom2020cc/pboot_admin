<template>
  <div class="thumb-upload">
    <div class="input-row">
      <el-input v-model="model" placeholder="上传后自动填入文件名，也可手动输入" />
      <el-upload action="#" :auto-upload="false" :disabled="uploading" :show-file-list="false" accept="image/*" :on-change="handleChange">
        <el-button type="primary" :loading="uploading">
          <el-icon><UploadFilled /></el-icon>
          上传图片
        </el-button>
      </el-upload>
    </div>

    <div v-if="model" class="preview-row">
      <el-image :src="previewUrl" :fit="upload ? 'contain' : 'cover'" class="preview" :class="{ 'product-thumbnail': upload }">
        <template #error>
          <div class="image-error">
            <span>图片加载失败</span>
            <el-button text :icon="Refresh" aria-label="重新加载图片" @click="reloadVersion++">重试</el-button>
          </div>
        </template>
      </el-image>
      <el-button type="danger" link @click="model = ''">删除</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { UploadFile } from "element-plus";
import { ElMessage } from "element-plus";
import { getImageUploadSizeError, getUploadUrl, uploadImages } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";
import { Refresh, UploadFilled } from "@element-plus/icons-vue";

const model = defineModel<string>({ required: true });
const props = withDefaults(defineProps<{ label?: string; upload?: (file: File) => Promise<string> }>(), { label: '缩略图' });
const uploading = ref(false);
const reloadVersion = ref(0);
const previewUrl = computed(() => {
  const url = getUploadUrl(model.value);
  return reloadVersion.value ? `${url}${url.includes('?') ? '&' : '?'}reload=${reloadVersion.value}` : url;
});
watch(model, () => { reloadVersion.value = 0; });

const handleChange = async (file: UploadFile) => {
  if (!file.raw || uploading.value) return;
  const sizeError = getImageUploadSizeError(file.raw);
  if (sizeError) {
    ElMessage.warning(sizeError);
    return;
  }

  const formData = new FormData();
  formData.append("imgArr", file.raw);

  uploading.value = true;
  try {
    if (props.upload) model.value = await props.upload(file.raw);
    else {
      const res = await uploadImages(formData);
      model.value = res.data[0] || "";
    }
    ElMessage.success(`${props.label}上传成功`);
  } catch (e) {
    ElMessage.error(getErrorMessage(e, `${props.label}上传失败`));
  } finally {
    uploading.value = false;
  }
};
</script>

<style scoped>
.thumb-upload {
  display: flex;
  width: 100%;
  min-width: 0;
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

.image-error { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--el-text-color-secondary); }
.preview.product-thumbnail { height: auto; aspect-ratio: 5 / 4; }
</style>
