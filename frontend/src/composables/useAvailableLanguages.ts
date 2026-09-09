import { computed } from "vue";
import { storeToRefs } from "pinia";
import { NEWS_LANGUAGES } from "@/api/news";
import { useSitesStore } from "@/stores/sites";

export const useAvailableLanguages = () => {
  const store = useSitesStore();
  const { siteLanguages, languagesLoaded } = storeToRefs(store);
  if (!languagesLoaded.value) store.refreshLanguages().catch(() => undefined);

  return computed(() => {
    if (!languagesLoaded.value) return NEWS_LANGUAGES.filter((item) => item.code === "zh-CN");
    const languageByCode = new Map<string, (typeof NEWS_LANGUAGES)[number]>(
      NEWS_LANGUAGES.map((item) => [item.code, item]),
    );
    const filtered = siteLanguages.value
      .map((item) => languageByCode.get(item.code))
      .filter((item): item is (typeof NEWS_LANGUAGES)[number] => Boolean(item));
    return filtered.length ? filtered : NEWS_LANGUAGES.filter((item) => item.code === "zh-CN");
  });
};
