export type MenuTranslationJob = {
  id: string;
  module: 'news' | 'product';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  menuId: number;
  targetLang: string;
  model: string;
  sourceMenuId: number;
  sourceMenuName: string;
  targetMenuName: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  failedItems: Array<{
    id: number;
    title: string;
    error: string;
  }>;
  currentTitle: string;
  errors: string[];
  backupPath: string;
  startedAt: string;
  finishedAt?: string;
  message: string;
};
