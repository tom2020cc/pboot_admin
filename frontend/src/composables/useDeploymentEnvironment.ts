import { computed, ref } from 'vue';

type Environment = 'local' | 'baota' | 'unknown';
const environment = ref<Environment>('unknown');
const loading = ref(true);
const failed = ref(false);
const apiUrl = new URL(import.meta.env.VITE_API_BASE_URL || 'http://localhost:5108', window.location.origin);
const apiOrigin = apiUrl.origin;
const apiBase = apiUrl.href.replace(/\/+$/, '');
let request: Promise<void> | undefined;

async function refresh() {
  if (request) return request;
  loading.value = true;
  failed.value = false;
  environment.value = 'unknown';
  request = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${apiBase}/project-identity`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('identity unavailable');
      const identity = await response.json();
      if (identity.project !== 'pboot-admin-center') throw new Error('unexpected project');
      if (identity.environment === 'local' || identity.environment === 'baota') environment.value = identity.environment;
    } catch { failed.value = true; }
    finally { window.clearTimeout(timeout); loading.value = false; request = undefined; }
  })();
  return request;
}

export function useDeploymentEnvironment() {
  const label = computed(() => loading.value ? '环境确认中' : environment.value === 'local' ? '本地调试' : environment.value === 'baota' ? '宝塔线上' : '环境未确认');
  const localPage = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const remoteConnection = computed(() => localPage && environment.value === 'baota');
  return { environment, label, loading, failed, apiOrigin, apiBase, remoteConnection, refresh };
}
