import axios, { type AxiosRequestHeaders } from "axios";
import { useMyTokenStore } from "@/stores/myToken";
import { ElMessage } from "element-plus";
import router from "@/router";
import { getActiveSiteId } from "@/utils/siteSelection";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5108";

const request = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

export const getErrorMessage = (error: unknown, fallback = "请求失败") => {
  if (axios.isAxiosError(error)) {
    if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
      return "请求超时：后台已停止当前语言处理，之前完成的语言不受影响；再次点击一键翻译会从断点继续。";
    }
    const message = error.response?.data?.message;
    if (Array.isArray(message)) return message.join("，");
    return message || error.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
};

request.interceptors.request.use((config) => {
  if (!config.headers) {
    config.headers = {} as AxiosRequestHeaders;
  }
  const store = useMyTokenStore();
  if (store.token) {
    config.headers.Authorization = `Bearer ${store.token}`;
  }
  const activeSiteId = getActiveSiteId();
  if (activeSiteId && !config.headers["X-Pboot-Site-Id"]) config.headers["X-Pboot-Site-Id"] = String(activeSiteId);
  return config;
});

request.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      ElMessage.error("登录已过期，请重新登录");
      useMyTokenStore().saveToken("");
      router.push({ path: "/login" });
    }
    return Promise.reject(error);
  }
);
export default request;
