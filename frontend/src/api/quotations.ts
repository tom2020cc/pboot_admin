import request from "@/utils/request";
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
