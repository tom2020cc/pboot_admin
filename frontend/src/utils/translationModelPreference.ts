const STORAGE_KEY = "pboot-preferred-translation-model";

type TranslationModelOption = {
  value: string;
  provider?: string;
  available: boolean;
  operational?: boolean;
  recommended?: boolean;
};

export const getSavedTranslationModel = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
};

export const savePreferredTranslationModel = (value: string) => {
  if (!value) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Translation still works when browser storage is unavailable.
  }
};

export const resolvePreferredTranslationModel = <T extends TranslationModelOption>(models: T[], currentValue = "") => {
  const available = models.filter((model) => model.available && model.operational !== false);
  const candidates = [
    currentValue,
    getSavedTranslationModel(),
    available.find((model) => model.provider === "deepseek")?.value,
    available.find((model) => model.recommended)?.value,
    available[0]?.value,
  ];
  return candidates.find((value) => value && available.some((model) => model.value === value)) || "";
};
