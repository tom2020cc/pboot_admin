import { computed, ref } from "vue";
import { create, getAll, remove, previewMenuDelete, getMenuById, update, type MenuForm, type MenuItem } from "@/api/menus";
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
  thumbnail: '',
  largeImage: '',
  seoTitle: '',
  seoKeywords: '',
  seoDescription: '',
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
  model: form.model || "",
  listTemplate: form.listTemplate || "",
  detailTemplate: form.detailTemplate || "",
});

export default function useMenus() {
  const allMenus = ref<MenuItem[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const loadingMenu = ref(false);
  const form = ref<MenuForm>(createEmptyForm());
  const originalForm = ref<MenuForm>();
  const hasUnsavedChanges = computed(() => Boolean(originalForm.value)
    && JSON.stringify(normalizeForm(form.value)) !== JSON.stringify(normalizeForm(originalForm.value!)));
  let loadedMenuId = '';
  let loadVersion = 0;

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
    if (saving.value) return;
    saving.value = true;
    try {
      await create(normalizeForm(form.value));
      ElMessage.success("添加菜单成功");
      router.push({ name: "menus" });
    } catch (e) {
      ElMessage.error(getErrorMessage(e, "添加菜单失败"));
    } finally {
      saving.value = false;
    }
  };

  const reset = () => {
    form.value = originalForm.value ? { ...originalForm.value, icon: [...originalForm.value.icon] } : createEmptyForm();
  };

  const handleDelete = async (id: string | number) => {
    try {
      const { data } = await previewMenuDelete(id);
      if (!data.canDelete) { await ElMessageBox.alert(data.reason, '暂不能删除', { type: 'warning' }); return; }
      const confirmed = await ElMessageBox.confirm(
        `将标记删除 ${data.items.length} 个关联栏目（${data.items.map(item => item.acode).join('、')}）。同步 PB 后正式删除，同步前可撤销。`,
        '确认关联删除', { confirmButtonText: '标记待删除', cancelButtonText: '取消', type: 'warning' },
      ).catch(() => false);
      if (!confirmed) return;
      await remove(id);
      ElMessage.success("已标记待删除，尚未修改 PB 网站");
      await getAllMenus();
    } catch (err) {
      ElMessage.error(getErrorMessage(err, "删除菜单失败"));
    }
  };

  const getMenuInfoById = async (id: string | number) => {
    const version = ++loadVersion;
    loadedMenuId = '';
    originalForm.value = undefined;
    form.value = createEmptyForm();
    loadingMenu.value = true;
    try {
      const res = await getMenuById(id);
      if (version !== loadVersion) return;
      form.value = {
        name: res.data.name,
        parentId: Number(res.data.parentId),
        publisher: res.data.publisher,
        href: res.data.href,
        code: res.data.code || "",
        sourceMenuId: res.data.sourceMenuId || 0,
        urlName: res.data.urlName || "",
        model: res.data.model || "",
        listTemplate: res.data.listTemplate || "",
        detailTemplate: res.data.detailTemplate || "",
        icon: Array.isArray(res.data.icon) ? res.data.icon : [],
        thumbnail: res.data.thumbnail ?? null,
        largeImage: res.data.largeImage ?? null,
        seoTitle: res.data.seoTitle ?? null,
        seoKeywords: res.data.seoKeywords ?? null,
        seoDescription: res.data.seoDescription ?? null,
        show: Boolean(res.data.show),
        orderNum: Number(res.data.orderNum),
      };
      originalForm.value = { ...form.value, icon: [...form.value.icon] };
      loadedMenuId = String(id);
    } catch (e) {
      if (version === loadVersion) ElMessage.error(getErrorMessage(e, "获取菜单详情失败"));
    } finally {
      if (version === loadVersion) loadingMenu.value = false;
    }
  };

  const handleEdit = async (id: string | number, stayOnPage = false) => {
    if (saving.value) return false;
    if (loadedMenuId !== String(id)) {
      ElMessage.error('栏目尚未加载成功，请刷新后重试');
      return false;
    }
    saving.value = true;
    try {
      await update(id, normalizeForm(form.value));
      ElMessage.success("修改菜单成功");
      if (stayOnPage) {
        await getMenuInfoById(id);
        await getAllMenus();
      } else router.push("/menus");
      return loadedMenuId === String(id);
    } catch (e) {
      ElMessage.error(getErrorMessage(e, "修改菜单失败"));
      return false;
    } finally {
      saving.value = false;
    }
  };

  return { allMenus, topMenus, form, loading, loadingMenu, saving, hasUnsavedChanges, onSubmit, reset, handleDelete, getMenuInfoById, handleEdit, getAllMenus };
}
