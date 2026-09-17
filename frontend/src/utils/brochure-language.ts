import type { ProductItem } from '@/api/products';
import { NEWS_LANGUAGES } from '@/api/news';

export type BrochureLanguage = typeof NEWS_LANGUAGES[number]['code'];
export const brochureLanguages = NEWS_LANGUAGES;
export const isBrochureLanguage = (value: unknown): value is BrochureLanguage => brochureLanguages.some(item => item.code === value);
export const brochureLanguageName = (value: string) => brochureLanguages.find(item => item.code === value)?.name || value;

const text: Record<BrochureLanguage, readonly string[]> = {
  'zh-CN': ['产品资料', '技术参数', '产品简介', '产品特点', '联系我们', '备注', '参数', '规格', '产品型号', '正在排版...', '分页失败，请检查图片后重试。'],
  en: ['Product Catalogue', 'Technical specifications', 'Overview', 'Key features', 'Contact', 'Notes', 'Parameter', 'Specification', 'Product', 'Preparing pages...', 'Pagination failed. Check images and try again.'],
  es: ['Catálogo de productos', 'Especificaciones técnicas', 'Descripción', 'Características', 'Contacto', 'Notas', 'Parámetro', 'Especificación', 'Producto', 'Preparando páginas...', 'Error de paginación. Revise las imágenes.'],
  fr: ['Catalogue de produits', 'Caractéristiques techniques', 'Présentation', 'Points forts', 'Contact', 'Notes', 'Paramètre', 'Spécification', 'Produit', 'Préparation des pages...', 'Échec de pagination. Vérifiez les images.'],
  ru: ['Каталог продукции', 'Технические характеристики', 'Описание', 'Особенности', 'Контакты', 'Примечания', 'Параметр', 'Характеристика', 'Изделие', 'Подготовка страниц...', 'Ошибка разбивки на страницы. Проверьте изображения.'],
  ar: ['كتالوج المنتجات', 'المواصفات الفنية', 'نظرة عامة', 'المزايا الرئيسية', 'اتصل بنا', 'ملاحظات', 'المعلمة', 'المواصفة', 'المنتج', 'جارٍ إعداد الصفحات...', 'تعذر تنسيق الصفحات. تحقق من الصور.'],
  pt: ['Catálogo de produtos', 'Especificações técnicas', 'Descrição', 'Características', 'Contato', 'Notas', 'Parâmetro', 'Especificação', 'Produto', 'Preparando páginas...', 'Falha na paginação. Verifique as imagens.'],
  id: ['Katalog Produk', 'Spesifikasi teknis', 'Ringkasan', 'Fitur utama', 'Kontak', 'Catatan', 'Parameter', 'Spesifikasi', 'Produk', 'Menyiapkan halaman...', 'Paginasi gagal. Periksa gambar.'],
  tr: ['Ürün Kataloğu', 'Teknik özellikler', 'Genel bakış', 'Öne çıkan özellikler', 'İletişim', 'Notlar', 'Parametre', 'Özellik', 'Ürün', 'Sayfalar hazırlanıyor...', 'Sayfalama başarısız. Görselleri kontrol edin.'],
  vi: ['Danh mục sản phẩm', 'Thông số kỹ thuật', 'Tổng quan', 'Đặc điểm nổi bật', 'Liên hệ', 'Ghi chú', 'Thông số', 'Quy cách', 'Sản phẩm', 'Đang dàn trang...', 'Dàn trang thất bại. Vui lòng kiểm tra hình ảnh.'],
};
export function brochureLabels(language: BrochureLanguage) {
  const [title, specs, overview, highlights, contact, notes, name, value, product, preparing, error] = text[language];
  return { title, specs, overview, highlights, contact, notes, name, value, product, preparing, error };
}

// Detail responses contain the untranslated master as fallback. Never import it as foreign text.
export function exactBrochureProduct(product: ProductItem, language: BrochureLanguage): ProductItem {
  if (language === 'zh-CN') return product;
  const translated = product.translations?.find(item => item.lang === language);
  return { ...product, lang: language, title: translated?.title || '', subtitle: translated?.subtitle || '',
    summary: translated?.summary || '', description: translated?.summary || '', content: translated?.content || '',
    carouselTitles: translated?.carouselTitles || [], parameterRows: product.parameterRows || [] };
}

export function brochureTranslationState(product: ProductItem, language: BrochureLanguage) {
  if (language === 'zh-CN') return { label: '中文原稿', type: 'info' as const };
  const progress = product.translationProgress;
  if (progress?.completedLanguages.includes(language)) return { label: '翻译完整', type: 'success' as const };
  if (progress?.missing.some(item => item.lang === language)) return { label: '翻译待补充', type: 'warning' as const };
  return { label: '待核对翻译', type: 'info' as const };
}
