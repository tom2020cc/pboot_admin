<template>
  <div class="carousel-upload">
    <div class="upload-row">
      <el-upload action="#" :auto-upload="false" :show-file-list="false" multiple accept="image/*" :on-change="handleChange">
        <el-button type="primary" :loading="uploading">
          <el-icon><UploadFilled /></el-icon>
          上传多图
        </el-button>
      </el-upload>
      <el-text type="info">可连续选择多张图片，上传后可填写每张图标题。</el-text>
    </div>

    <div v-if="items.length" class="carousel-grid">
      <div v-for="(item, index) in items" :key="`${item.image}-${index}`" class="carousel-item">
        <div class="image-frame">
          <el-image :src="getUploadUrl(item.image)" fit="contain" class="carousel-image" />
          <span class="image-index">{{ index + 1 }}</span>
        </div>
        <el-input v-model="item.title" placeholder="图片标题" @input="syncModel" />
        <el-button type="danger" link class="remove-btn" @click="removeItem(index)">删除</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { UploadFile } from "element-plus";
import { ElMessage } from "element-plus";
import { getImageUploadSizeError, getUploadUrl, uploadImages } from "@/api/uploads";
import { getErrorMessage } from "@/utils/request";
import { UploadFilled } from "@element-plus/icons-vue";

const images = defineModel<string[]>("images", { required: true });
const titles = defineModel<string[]>("titles", { required: true });
const uploading = ref(false);

const items = computed({
  get() {
    return images.value.map((image, index) => ({ image, title: titles.value[index] || "" }));
  },
  set(nextItems: Array<{ image: string; title: string }>) {
    images.value = nextItems.map((item) => item.image);
    titles.value = nextItems.map((item) => item.title);
  },
});

const syncModel = () => {
  items.value = [...items.value];
};

const removeItem = (index: number) => {
  const nextItems = [...items.value];
  nextItems.splice(index, 1);
  items.value = nextItems;
};

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
    const nextImages = [...images.value, ...res.data];
    images.value = nextImages;
    titles.value = [...titles.value, ...res.data.map(() => "")];
    ElMessage.success("轮播图上传成功");
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "轮播图上传失败"));
  } finally {
    uploading.value = false;
  }
};
</script>

<style scoped>
.carousel-upload {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 12px;
}

.upload-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.carousel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 12px;
}

.carousel-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.image-frame {
  position: relative;
  overflow: hidden;
  background: #f6f8fb;
  border-radius: 6px;
}

.carousel-image {
  width: 100%;
  height: 118px;
}

.image-index {
  position: absolute;
  top: 8px;
  left: 8px;
  min-width: 24px;
  height: 24px;
  color: #fff;
  font-size: 12px;
  line-height: 24px;
  text-align: center;
  background: rgb(16 24 40 / 70%);
  border-radius: 999px;
}

.remove-btn {
  align-self: center;
}
</style>
