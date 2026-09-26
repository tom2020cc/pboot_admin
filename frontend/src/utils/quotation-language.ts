import type { QuotationDraft, QuotationLanguageCode, QuotationLine } from './quotation';
import type { ProductItem } from '@/api/products';
import { NEWS_LANGUAGES } from '@/api/news';

const keys = ['title', 'productCategory', 'customized', 'originCountry', 'warranty', 'paymentTerms', 'transportMode', 'notes', 'unit'] as const;
type Defaults = Record<typeof keys[number], string>;
const values: Record<QuotationLanguageCode, string[]> = {
  'zh-CN': ['工程机械商业报价单', '工程机械设备', '否', '中国', '12个月', 'T/T（30%定金，70%发货前付清）', '海运', '报价包含上述产品及配置；未列明项目不在本次报价范围内。', '台'],
  en: ['Commercial Quotation', 'Construction machinery', 'No', 'China', '12 months', 'T/T (30% deposit, 70% before shipment)', 'Sea freight', 'This quotation covers the listed products and configurations only. Unlisted items are excluded.', 'unit'],
  es: ['Cotización comercial', 'Maquinaria de construcción', 'No', 'China', '12 meses', 'T/T (30% de anticipo, 70% antes del envío)', 'Transporte marítimo', 'La oferta incluye únicamente los productos y configuraciones indicados. Los elementos no indicados quedan excluidos.', 'unidad'],
  fr: ['Devis commercial', 'Engins de chantier', 'Non', 'Chine', '12 mois', "T/T (acompte de 30 %, solde de 70 % avant expédition)", 'Transport maritime', 'Ce devis couvre uniquement les produits et configurations indiqués. Les éléments non mentionnés sont exclus.', 'unité'],
  ru: ['Коммерческое предложение', 'Строительная техника', 'Нет', 'Китай', '12 месяцев', 'T/T (аванс 30%, остаток 70% до отгрузки)', 'Морская перевозка', 'Предложение включает только указанные изделия и комплектации. Неуказанные позиции не включены.', 'шт.'],
  ar: ['عرض سعر تجاري', 'آلات البناء', 'لا', 'الصين', '12 شهرًا', 'T/T (دفعة مقدمة 30% و70% قبل الشحن)', 'الشحن البحري', 'يشمل العرض المنتجات والتجهيزات المذكورة فقط. البنود غير المذكورة غير مشمولة.', 'وحدة'],
  pt: ['Cotação comercial', 'Máquinas de construção', 'Não', 'China', '12 meses', 'T/T (entrada de 30%, saldo de 70% antes do embarque)', 'Transporte marítimo', 'Esta cotação inclui apenas os produtos e configurações indicados. Os itens não indicados estão excluídos.', 'unidade'],
  id: ['Penawaran Harga', 'Mesin konstruksi', 'Tidak', 'Tiongkok', '12 bulan', 'T/T (uang muka 30%, 70% sebelum pengiriman)', 'Pengiriman laut', 'Penawaran ini hanya mencakup produk dan konfigurasi yang tercantum. Item yang tidak tercantum tidak termasuk.', 'unit'],
  vi: ['Báo giá thương mại', 'Máy xây dựng', 'Không', 'Trung Quốc', '12 tháng', 'T/T (đặt cọc 30%, 70% trước khi giao hàng)', 'Vận tải biển', 'Báo giá chỉ bao gồm các sản phẩm và cấu hình được liệt kê. Các hạng mục không được liệt kê không nằm trong báo giá.', 'máy'],
  tr: ['Ticari Teklif', 'İnşaat makineleri', 'Hayır', 'Çin', '12 ay', 'T/T (%30 peşinat, %70 sevkiyat öncesi)', 'Deniz taşımacılığı', 'Bu teklif yalnızca listelenen ürün ve yapılandırmaları kapsar. Listelenmeyen kalemler dahil değildir.', 'adet'],
};
export const quotationLanguage = (value: unknown): QuotationLanguageCode => typeof value === 'string' && Object.prototype.hasOwnProperty.call(values, value) ? value as QuotationLanguageCode : 'zh-CN';
export const quotationLanguageName = (value: unknown) => NEWS_LANGUAGES.find(item => item.code === quotationLanguage(value))?.name || String(value);

export function exactQuotationProduct(product: ProductItem, language: QuotationLanguageCode): ProductItem {
  if (language === 'zh-CN') return product;
  const translated = product.translations?.find(item => item.lang === language);
  return { ...product, lang: language, title: translated?.title || '', subtitle: translated?.subtitle || '',
    summary: translated?.summary || '', description: translated?.summary || '', content: translated?.content || '',
    carouselTitles: translated?.carouselTitles || [], parameterRows: product.parameterRows || [] };
}
export const quotationDefaults = (language: QuotationLanguageCode): Defaults => Object.fromEntries(keys.map((key, index) => [key, values[language][index]])) as Defaults;
const defaultValue = (key: keyof Defaults, value: string, language: QuotationLanguageCode) =>
  Object.keys(values).some(lang => quotationDefaults(lang as QuotationLanguageCode)[key] === value)
    ? quotationDefaults(language)[key] : value;

// Only known defaults and product-library text change; financial/customer fields stay byte-for-byte identical.
export function quotationLanguageDraft(source: QuotationDraft, language: QuotationLanguageCode, translated: QuotationLine[]) {
  const copy = JSON.parse(JSON.stringify(source)) as QuotationDraft;
  copy.language = language;
  for (const key of keys) if (key !== 'unit') copy[key] = defaultValue(key, copy[key], language);
  copy.items = copy.items.map((item, index) => {
    const text = translated[index];
    if (!text || text.productId !== item.productId || !text.title.trim()) throw new Error(`产品 #${item.productId} 缺少${quotationLanguageName(language)}译文，请先在产品管理完成翻译`);
    return { ...item, title: text.title, categoryName: text.categoryName, specText: text.specText, unit: defaultValue('unit', item.unit, language) };
  });
  return copy;
}

export function quotationWarnings(draft: QuotationDraft) {
  const warnings: string[] = [];
  if (draft.items.some(item => !item.specText.trim())) warnings.push('部分产品没有参数，请核对产品译文或手动补充。');
  if (draft.language !== 'zh-CN' && /[\u3400-\u9fff]/.test(JSON.stringify([draft.title, draft.companyName, draft.companySubtitle, draft.productCategory, draft.customized, draft.originCountry, draft.warranty, draft.paymentTerms, draft.transportMode, draft.notes, ...draft.items.map(item => [item.title, item.categoryName, item.specText, item.remark])]))) warnings.push('当前外语报价含中文，请核对保留的自定义条款和产品内容。');
  return warnings;
}
