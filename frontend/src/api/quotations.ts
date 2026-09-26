import request from "@/utils/request";
import { quotationLayout, type QuotationLayout } from '@/utils/quotation-layout';
import type { QuotationDraft } from "@/utils/quotation";

export type QuotationRecord = {
  id: number;
  quotationNo: string;
  customerCompany: string;
  customerContact: string;
  currency: string;
  total: number;
  itemCount: number;
  quotationDate: string;
  data: QuotationDraft;
  createTime: string;
  updateTime: string;
};

export type QuotationPayload = Omit<QuotationRecord, "id" | "createTime" | "updateTime">;

export const getQuotationList = (search = "") =>
  request<QuotationRecord[]>({ method: "GET", url: "/quotations", params: search ? { search } : undefined });

export const getQuotationById = (id: number) =>
  request<QuotationRecord>({ method: "GET", url: `/quotations/${id}` });

export const getNextQuotationNumber = (date: string) =>
  request<{ quotationNo: string }>({ method: "GET", url: "/quotations/next-number", params: { date } });

export const createQuotation = (data: QuotationPayload) =>
  request<QuotationRecord>({ method: "POST", url: "/quotations", data });

export const updateQuotation = (id: number, data: QuotationPayload) =>
  request<QuotationRecord>({ method: "PATCH", url: `/quotations/${id}`, data });

export const removeQuotation = (id: number) =>
  request<{ msg: string; id: number }>({ method: "DELETE", url: `/quotations/${id}` });

export async function exportQuotationPdf(html: string, layout?: Partial<QuotationLayout>) {
  const data = new FormData();
  data.append('document', new Blob([html], { type: 'text/html' }), 'quotation.html');
  const paper = quotationLayout(layout);
  data.append('widthMm', String(paper.pageWidth));
  data.append('heightMm', String(paper.pageMode === 'continuous' ? 0 : paper.pageHeight));
  try {
    return (await request.post<Blob>('/quotations/export-pdf', data, { responseType: 'blob', timeout: 180000 })).data;
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
