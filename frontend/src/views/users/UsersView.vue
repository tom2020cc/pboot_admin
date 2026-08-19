<template>
  <section class="page">
    <div class="page-bar">
      <div>
        <h2>用户管理</h2>
        <p>管理后台登录用户，支持新增、编辑和删除。</p>
      </div>
      <el-button type="primary" @click="router.push('/users/create')">
        <el-icon><Plus /></el-icon>
        新增用户
      </el-button>
    </div>

    <el-table v-loading="loading" :data="filteredUsers" border stripe class="data-table">
      <el-table-column prop="id" label="ID" width="80" align="center" />
      <el-table-column prop="email" label="邮箱" min-width="220" />
      <el-table-column prop="createTime" label="创建时间" min-width="180" />
      <el-table-column prop="updateTime" label="更新时间" min-width="180" />
      <el-table-column label="操作" width="170" fixed="right" align="center">
        <template #default="{ row }">
          <el-button type="primary" link @click="router.push({ name: 'editUser', params: { id: row.id } })">
            编辑
          </el-button>
          <el-button type="danger" link @click="handleDelete(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { getUsers, removeUser, type UserInfo } from "@/api/users";
import { getErrorMessage } from "@/utils/request";

const router = useRouter();
const users = ref<UserInfo[]>([]);
const loading = ref(false);

const filteredUsers = computed(() => users.value);

const loadUsers = async () => {
  loading.value = true;
  try {
    const res = await getUsers();
    users.value = res.data;
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "获取用户列表失败"));
  } finally {
    loading.value = false;
  }
};

const handleDelete = async (id: number) => {
  await ElMessageBox.confirm("确认要删除该用户吗？", "删除提醒", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  }).catch(() => {
    ElMessage.info("删除操作已取消");
    return new Promise(() => {});
  });

  try {
    await removeUser(id);
    ElMessage.success("删除用户成功");
    loadUsers();
  } catch (e) {
    ElMessage.error(getErrorMessage(e, "删除用户失败"));
  }
};

onMounted(loadUsers);
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-bar h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.page-bar p {
  margin-top: 4px;
  color: var(--el-text-color-regular);
}
</style>
