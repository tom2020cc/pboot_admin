export const ACTIVE_SITE_STORAGE_KEY = "pbootActiveSiteId";
// Keep an open tab on its own site when another tab changes the saved default.
let selectedSiteId: number | undefined;

export const getActiveSiteId = () => {
  if (selectedSiteId !== undefined) return selectedSiteId;
  const id = Number(localStorage.getItem(ACTIVE_SITE_STORAGE_KEY) || 0);
  selectedSiteId = Number.isSafeInteger(id) && id > 0 ? id : 0;
  return selectedSiteId;
};

export const saveActiveSiteId = (id: number) => {
  selectedSiteId = Number.isSafeInteger(id) && id > 0 ? id : 0;
  if (selectedSiteId) localStorage.setItem(ACTIVE_SITE_STORAGE_KEY, String(selectedSiteId));
  else localStorage.removeItem(ACTIVE_SITE_STORAGE_KEY);
};

export const applySiteSelectionFromUrl = () => {
  const url = new URL(window.location.href);
  const value = url.searchParams.get('siteId');
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) return;
  saveActiveSiteId(Number(value));
  url.searchParams.delete('siteId');
  window.history.replaceState(window.history.state, '', url.toString());
};
