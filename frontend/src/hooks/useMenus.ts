import { computed, ref } from "vue";
import { create, getAll, remove, getMenuById, update, type MenuForm, type MenuItem } from "@/api/menus";
import { ElMessage, ElMessageBox } from "element-plus";
import router from "@/router";
import { getErrorMessage } from "@/utils/request";

const createEmptyForm = (): MenuForm => ({
  name: "",
  parentId: 0,
  publisher: "admin",
  href: "",
  code: "",
  urlName: "",
  model: "",
  listTemplate: "",
  detailTemplate: "",
  icon: [],
  show: true,
  orderNum: 0,
});

const normalizeForm = (form: MenuForm): MenuForm => ({
  ...form,
  parentId: Number(form.parentId || 0),
  orderNum: Number(form.orderNum || 0),
  icon: Array.isArray(form.icon) ? form.icon : String(form.icon || "").split(",").filter(Boolean),
  show: Boolean(form.show),
  publisher: form.publisher || "admin",
  model: "",
  listTemplate: "",
  detailTemplate: "",
});

export default function useMenus() {
  const allMenus = ref<MenuItem[]>([]);
  const loading = ref(false);
  const form = ref<MenuForm>(createEmptyForm());

  const getAllMenus = async () => {
    loading.value = true;
    try {
      const res = await getAll();
      allMenus.value = res.data.sort((a, b) => Number(a.orderNum) - Number(b.orderNum));
    } catch (e) {
      ElMessage.error(getErrorMessage(e, "获取菜单信息失败"));
    } finally {
      loading.value = false;
    }
  };

  getAllMenus();

  const topMenus = computed(() => allMenus.value.filter((i) => Number(i.parentId) === 0));

  const onSubmit = async () => {
    try {
      await create(normalizeForm(form.value));
      ElMessage.success("添加菜单成功");
      router.push({ name: "menus" });
    } catch (e) {
      ElMessage.error(getErrorMessage(e, "添加菜单失败"));
    }
  };

  const reset = () => {
    form.value = createEmptyForm();
  };

  const handleDelete = async (id: string | number) => {
    await ElMessageBox.confirm("确认要删除该菜单吗？", "删除提醒", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    }).catch(() => {
      ElMessage.info("删除操作已取消");
      return new Promise(() => {});
    });

    try {
      await remove(id);
      ElMessage.success("删除菜单成功");
      getAllMenus();
    } catch (err) {
      ElMessage.error(getErrorMessage(err, "删除菜单失败"));
    }
  };

  const getMenuInfoById = async (id: string | number) => {
    try {
      const res = await getMenuById(id);
      form.value = {
        name: res.data.name,
        parentId: Number(res.data.parentId),
        publisher: res.data.publisher,
        href: res.data.href,
        code: res.data.code || "",
        urlName: res.data.urlName || "",
        model: "",
        listTemplate: "",
        detailTemplate: "",
        icon: Array.isArray(res.data.icon) ? res.data.icon : [],
        show: Boolean(res.data.show),
        orderNum: Number(res.data.orderNum),
      };
    } catch (e) {
      ElMessage.error(getErrorMessage(e, "获取菜单详情失败"));
    }
  };

  const handleEdit = async (id: string | number) => {
    try {
      await update(id, normalizeForm(form.value));
      ElMessage.success("修改菜单成功");
      router.push("/menus");
    } catch (e) {
      ElMessage.error(getErrorMessage(e, "修改菜单失败"));
    }
  };

  return { allMenus, topMenus, form, loading, onSubmit, reset, handleDelete, getMenuInfoById, handleEdit, getAllMenus };
}
