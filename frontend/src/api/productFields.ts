import request from '@/utils/request';

export type ProductField = {
  name: string; label: string; unit: string; sort: number; enabled: boolean; type: number;
  key?: 'depthM' | 'coreCapacity' | 'diameterMm' | 'engine';
  pbootExists: boolean; localUsed: number; pbUsed: number; locked: boolean;
};
export type ProductFieldsResult = { siteId: number; siteName: string; fields: ProductField[] };
export type SaveProductField = Pick<ProductField, 'label' | 'unit' | 'sort' | 'enabled'> & { name?: string };
export const getProductFields = () => request.get<ProductFieldsResult>('/product-fields');
export const createProductField = (value: SaveProductField) => request.post<ProductFieldsResult>('/product-fields', value);
export const updateProductField = (name: string, value: SaveProductField) => request.patch<ProductFieldsResult>(`/product-fields/${encodeURIComponent(name)}`, value);
export const deleteProductField = (name: string) => request.delete<ProductFieldsResult>(`/product-fields/${encodeURIComponent(name)}`);
export const importProductFields = () => request.post<ProductFieldsResult>('/product-fields/import');
export const syncProductFields = () => request.post<{ synced: number }>('/product-fields/sync');
