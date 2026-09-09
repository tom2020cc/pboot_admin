import { ElLoading, ElMessage, ElMessageBox } from 'element-plus';
import { PRODUCT_LANGUAGES, type PbootProductSyncResult } from '@/api/products';
import { syncAllMenusToPboot } from '@/api/menus';
import { getActiveSiteId } from '@/utils/siteSelection';

export async function showProductSyncResult(result: PbootProductSyncResult, retry?: () => Promise<PbootProductSyncResult>) {
  const name = (code: string) => PRODUCT_LANGUAGES.find((item) => item.code === code)?.name || code;
  const completed = `已同步 ${result.synced.length} 种语言：${result.synced.map((item) => name(item.lang)).join('、')}`;
  if (result.skipped?.length) {
    const groups = new Map<string, string[]>();
    for (const item of result.skipped) groups.set(item.reason, [...(groups.get(item.reason) || []), name(item.lang)]);
    const reasons = [...groups].map(([reason, langs]) => `${langs.join('、')}：${reason}`).join('；');
    const summary = `${completed}。未同步 ${result.skipped.length} 种语言：${reasons}。`;
    if (retry && result.skipped.some((item) => item.reasonCode === 'pboot-menu-missing')) {
      const siteId = result.siteId || getActiveSiteId();
      const confirmed = await ElMessageBox.confirm(
        `${summary}将先备份并把当前项目的栏目同步到「${result.siteName || '当前网站'}」，再重试这个产品的全部语言。已有网站模板不会修改。`,
        '同步栏目后继续',
        { type: 'warning', confirmButtonText: '同步栏目并重试', cancelButtonText: '稍后处理', closeOnClickModal: false },
      ).then(() => true).catch(() => false);
      if (!confirmed) return;
      const assertSameSite = () => {
        if (getActiveSiteId() !== siteId) throw new Error('当前站点已切换，请在所选站点重新执行同步。');
      };
      assertSameSite();
      const loading = ElLoading.service({ lock: true, text: '正在备份并同步栏目…' });
      let next: PbootProductSyncResult;
      try {
        await syncAllMenusToPboot();
        assertSameSite();
        loading.setText('正在重试产品全部语言…');
        next = await retry();
      } finally { loading.close(); }
      // Offer at most one repair attempt; persistent failures remain visible.
      await showProductSyncResult(next);
    } else {
      await ElMessageBox.alert(summary, '部分语言未同步', { type: 'warning', confirmButtonText: '知道了' }).catch(() => undefined);
    }
  } else ElMessage.success({ message: completed, duration: 5000 });
}
