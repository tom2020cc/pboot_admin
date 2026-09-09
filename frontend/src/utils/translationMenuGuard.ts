import { ElMessageBox } from "element-plus";
import type { MenuItem } from "@/api/menus";
import { findEquivalentMenuForLang } from "@/utils/menuLanguage";

type TranslationTarget = {
  lang: string;
};

type TranslationMenuGuardOptions = {
  menus: MenuItem[];
  sourceMenuId: number | string | undefined;
  targets: TranslationTarget[];
  model: string;
  contentLabel: string;
  getLanguageName: (lang: string) => string;
};

const showMissingMenuAlert = async (message: string) => {
  await ElMessageBox.alert(message, "缺少目标语言栏目", {
    confirmButtonText: "知道了",
    type: "warning",
    closeOnClickModal: false,
  }).catch(() => undefined);
};

export const ensureTranslationMenusExist = async ({
  menus,
  sourceMenuId,
  targets,
  model,
  contentLabel,
  getLanguageName,
}: TranslationMenuGuardOptions) => {
  if (!sourceMenuId) {
    await showMissingMenuAlert(`请先选择中文${contentLabel}栏目，再开始翻译。`);
    return false;
  }

  const sourceMenu = menus.find((item) => Number(item.id) === Number(sourceMenuId));
  if (!sourceMenu) {
    await showMissingMenuAlert(`当前中文${contentLabel}栏目不存在或尚未同步，请先到“栏目管理”刷新栏目。`);
    return false;
  }

  const missingLanguages = [...new Set(
    targets
      .map((target) => String(target.lang))
      .filter((lang) => lang && lang !== "zh-CN")
      .filter((lang) => !findEquivalentMenuForLang(menus, sourceMenuId, lang, model)),
  )];
  if (!missingLanguages.length) return true;

  const languageNames = missingLanguages.map(getLanguageName).join("、");
  await showMissingMenuAlert(
    `当前中文栏目“${sourceMenu.name}”缺少 ${languageNames} 的对应${contentLabel}栏目。请先到“栏目管理”同步或创建对应栏目，再回来翻译。此次尚未调用 AI，不会消耗模型额度。`,
  );
  return false;
};
