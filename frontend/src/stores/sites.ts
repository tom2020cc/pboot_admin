import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { getCurrentSiteLanguages, getSites, type ManagedSite, type SiteLanguage } from "@/api/sites";
import { getActiveSiteId, saveActiveSiteId } from "@/utils/siteSelection";

export const useSitesStore = defineStore("managedSites", () => {
  const sites = ref<ManagedSite[]>([]);
  const siteLanguages = ref<SiteLanguage[]>([]);
  const languagesLoaded = ref(false);
  const languagesLoading = ref(false);
  const activeSiteId = ref(getActiveSiteId());
  const loading = ref(false);

  const enabledSites = computed(() => sites.value.filter((site) => site.enabled));
  const activeSite = computed(() => enabledSites.value.find((site) => site.id === activeSiteId.value));

  const refresh = async () => {
    loading.value = true;
    try {
      sites.value = (await getSites()).data || [];
      const selected = enabledSites.value.find((site) => site.id === activeSiteId.value);
      if (!selected) {
        const fallback = enabledSites.value.find((site) => site.isDefault) || enabledSites.value[0];
        activeSiteId.value = fallback?.id || 0;
        saveActiveSiteId(activeSiteId.value);
      }
      await refreshLanguages();
    } finally {
      loading.value = false;
    }
  };

  const refreshLanguages = async () => {
    if (languagesLoading.value) return;
    languagesLoading.value = true;
    try {
      siteLanguages.value = (await getCurrentSiteLanguages()).data || [];
    } finally {
      languagesLoaded.value = true;
      languagesLoading.value = false;
    }
  };

  const selectSite = (id: number, reload = true) => {
    activeSiteId.value = id;
    saveActiveSiteId(id);
    if (reload) window.location.reload();
  };

  return {
    sites,
    siteLanguages,
    languagesLoaded,
    languagesLoading,
    enabledSites,
    activeSiteId,
    activeSite,
    loading,
    refresh,
    refreshLanguages,
    selectSite,
  };
});
