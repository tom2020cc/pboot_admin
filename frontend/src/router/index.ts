import { createRouter, createWebHashHistory } from "vue-router";
import AppLayout from "@/components/layout/AppLayout.vue";
import IndexView from "@/views/IndexView.vue";
import { useMyTokenStore } from "@/stores/myToken";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("@/views/LoginView.vue") },
    {
      path: "/quotations",
      name: "quotations",
      component: () => import("@/views/quotations/QuotationTool.vue"),
      meta: { title: "报价单生成", requiresAuth: true },
    },
    {
      path: "/",
      component: AppLayout,
      meta: { requiresAuth: true },
      children: [
        { path: "", name: "dashboard", component: IndexView, meta: { title: "后台概览" } },
        { path: "menus", name: "menus", component: () => import("@/views/MenusView.vue"), meta: { title: "菜单管理" } },
        { path: "menus/create", name: "createMenus", component: () => import("@/views/menu/Create.vue"), meta: { title: "新增菜单" } },
        { path: "menus/edit/:id", name: "editMenus", component: () => import("@/views/menu/Edit.vue"), meta: { title: "编辑菜单" } },
        { path: "news", name: "news", component: () => import("@/views/news/NewsView.vue"), meta: { title: "新闻管理" } },
        { path: "news/create", name: "createNews", component: () => import("@/views/news/Create.vue"), meta: { title: "添加新闻" } },
        { path: "news/detail/:id", name: "newsDetail", component: () => import("@/views/news/Detail.vue"), meta: { title: "新闻详情" } },
        { path: "news/edit/:id", name: "editNews", component: () => import("@/views/news/Edit.vue"), meta: { title: "编辑新闻" } },
        { path: "pages", name: "pages", component: () => import("@/views/pages/PagesView.vue"), meta: { title: "单页管理" } },
        { path: "pages/create", name: "createPage", component: () => import("@/views/pages/Create.vue"), meta: { title: "添加单页" } },
        { path: "pages/detail/:id", name: "pageDetail", component: () => import("@/views/pages/Detail.vue"), meta: { title: "单页详情" } },
        { path: "pages/edit/:id", name: "editPage", component: () => import("@/views/pages/Edit.vue"), meta: { title: "编辑单页" } },
        { path: "videos", name: "videos", component: () => import("@/views/videos/VideosView.vue"), meta: { title: "视频管理" } },
        { path: "products", name: "products", component: () => import("@/views/products/ProductsView.vue"), meta: { title: "产品管理" } },
        { path: "products/create", name: "createProduct", component: () => import("@/views/products/Create.vue"), meta: { title: "添加产品" } },
        { path: "products/detail/:id", name: "productDetail", component: () => import("@/views/products/Detail.vue"), meta: { title: "产品详情" } },
        { path: "products/edit/:id", name: "editProduct", component: () => import("@/views/products/Edit.vue"), meta: { title: "编辑产品" } },
        { path: "users", name: "users", component: () => import("@/views/users/UsersView.vue"), meta: { title: "用户管理" } },
        { path: "users/create", name: "createUser", component: () => import("@/views/users/Create.vue"), meta: { title: "新增用户" } },
        { path: "users/edit/:id", name: "editUser", component: () => import("@/views/users/Edit.vue"), meta: { title: "编辑用户" } },
        { path: "uploads", name: "uploads", component: () => import("@/views/UploadView.vue"), meta: { title: "图片上传" } },
        { path: "about", name: "about", component: () => import("@/views/AboutView.vue"), meta: { title: "关于" } },
        { path: "/:pathMatch(.*)*", name: "NotFound", component: () => import("@/views/404.vue") },
      ],
    },
  ],
});

router.beforeEach((to, _from, next) => {
  if (to.matched.some((route) => route.meta?.requiresAuth)) {
    const tokenStore = useMyTokenStore();
    if (!tokenStore.token) {
      next({ path: "/login", query: { redirect: to.fullPath } });
      return;
    }
  }
  next();
});

export default router;
