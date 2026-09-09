import request from '@/utils/request';
import type { BrochureDraft } from '@/utils/brochure';

export type BrochureSummary = { id: number; title: string; itemCount: number; createTime: string; updateTime: string };
export type BrochureRecord = BrochureSummary & { data: BrochureDraft };
export const getBrochures = (search = '') => request.get<BrochureSummary[]>('/brochures', { params: { search } });
export const getBrochure = (id: number) => request.get<BrochureRecord>(`/brochures/${id}`);
export const saveBrochure = (data: BrochureDraft, id?: number) => id
  ? request.patch<BrochureRecord>(`/brochures/${id}`, { data })
  : request.post<BrochureRecord>('/brochures', { data });
export const deleteBrochure = (id: number) => request.delete(`/brochures/${id}`);

export async function exportBrochurePdf(html: string) {
  const data = new FormData();
  data.append('document', new Blob([html], { type: 'text/html' }), 'product-introduction.html');
  try {
    return (await request.post<Blob>('/brochures/export-pdf', data, { responseType: 'blob', timeout: 180000 })).data;
  } catch (error: any) {
    if (error.code === 'ECONNABORTED') throw new Error('PDF 导出请求超时，请稍后重试');
    if (error.response?.data instanceof Blob) {
      let message = '';
      try { const body = JSON.parse(await error.response.data.text()); message = Array.isArray(body.message) ? body.message.join('，') : body.message; } catch { /* Non-JSON proxy errors are handled below. */ }
      if (message) throw new Error(message);
      if (error.response.status === 413) throw new Error('导出内容超过服务器上传限制，请压缩图片或调整服务器上传大小');
    }
    throw error;
  }
}
