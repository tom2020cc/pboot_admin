import { repairTranslatedHtml } from "@/api/uploads";
import type { ProductItem } from "@/api/products";
import { chineseParameterSpecs, productReferencePrice } from './productParameters';
import { paginatedQuotationHtml } from './quotation-pagination';
import { continuousQuotationHtml } from './quotation-continuous';
import { quotationImageUrl, embedQuotationImages } from './quotation-assets';
import { quotationLayout, quotationLayoutCss, type QuotationLayout } from './quotation-layout';
import { quotationDefaults, quotationLanguage } from './quotation-language';
import quotationPageCss from './quotation-page.css?raw';
import quotationWebCss from './quotation-web.css?raw';

export type QuotationLine = {
  id: string;
  productId: number;
  title: string;
  categoryName?: string;
  image: string;
  images?: string[];
  quantity: number;
  unit: string;
  unitPrice: number;
  specText: string;
  remark: string;
};

export type QuotationDraft = {
  version: 1;
  layout?: Partial<QuotationLayout>;
  language: QuotationLanguageCode;
  quotationNo: string;
  quotationDate: string;
  title: string;
  companyName: string;
  companySubtitle: string;
  logoUrl: string;
  website: string;
  assetBaseUrl: string;
  customerCompany: string;
  customerContact: string;
  salesName: string;
  salesDepartment: string;
  salesPosition: string;
  phone: string;
  whatsapp: string;
  wechat: string;
  email: string;
  productCategory: string;
  customized: string;
  originCountry: string;
  validityDays: number;
  currency: string;
  incoterm: string;
  warranty: string;
  paymentTerms: string;
  depositPercent: number;
  loadingPort: string;
  destinationPort: string;
  transportMode: string;
  freight: number;
  notes: string;
  items: QuotationLine[];
};

export type QuotationLanguageCode = 'zh-CN' | 'en' | 'es' | 'fr' | 'ru' | 'ar' | 'pt' | 'id' | 'vi' | 'tr';

export type QuotationSpec = {
  group: string;
  name: string;
  value: string;
};

const pad = (value: number) => String(value).padStart(2, "0");

export const localDateValue = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const createQuotationNo = (date = new Date()) =>
  `BJ-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-01`;

export const createDefaultQuotation = (): QuotationDraft => ({
  version: 1,
  layout: quotationLayout(),
  language: "zh-CN",
  quotationNo: createQuotationNo(),
  quotationDate: localDateValue(),
  title: "工程机械商业报价单",
  companyName: "",
  companySubtitle: "",
  logoUrl: "",
  website: "",
  assetBaseUrl: "",
  customerCompany: "",
  customerContact: "",
  salesName: "",
  salesDepartment: "",
  salesPosition: "",
  phone: "",
  whatsapp: "",
  wechat: "",
  email: "",
  productCategory: "工程机械设备",
  customized: "否",
  originCountry: "中国",
  validityDays: 8,
  currency: "USD",
  incoterm: "EXW",
  warranty: "12个月",
  paymentTerms: "T/T（30%定金，70%发货前付清）",
  depositPercent: 30,
  loadingPort: "",
  destinationPort: "",
  transportMode: "海运",
  freight: 0,
  notes: "报价包含上述产品及配置；未列明项目不在本次报价范围内。",
  items: [],
});

const cleanText = (value = "") =>
  String(value)
    .replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isSpecificationHeading = (name: string, value: string) =>
  /^(参数|项目|参数项目|参数名称|item|model|parameter(?: item)?|specifications?)$/i.test(cleanText(name))
  && /^(参数|数值|参数值|参数数值|value|parameter value|specifications?)$/i.test(cleanText(value));

const rowScore = (row: HTMLTableRowElement) => {
  const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
  return cells.length >= 2 && cells.some((cell) => cleanText(cell.textContent || "")) ? 1 : 0;
};

export const extractProductSpecifications = (content = "", defaultGroup = "技术参数"): QuotationSpec[] => {
  if (typeof DOMParser === "undefined" || !content) return [];
  const document = new DOMParser().parseFromString(repairTranslatedHtml(content), "text/html");
  const tables = [...document.querySelectorAll("table")];
  const table = tables
    .map((item) => ({ item, score: [...item.querySelectorAll("tr")].reduce((sum, row) => sum + rowScore(row), 0) }))
    .sort((left, right) => right.score - left.score)[0]?.item;

  if (!table) return [];
  const specs: QuotationSpec[] = [];
  let group = defaultGroup;

  for (const row of [...table.querySelectorAll("tr")]) {
    const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
    const values = cells.map((cell) => cleanText(cell.textContent || "")).filter(Boolean);
    if (!values.length) continue;

    const isGroup = cells.length === 1 || Number(cells[0]?.getAttribute("colspan") || 1) >= 2;
    if (isGroup) {
      group = values[0].slice(0, 80) || group;
      continue;
    }

    const name = values[0];
    const value = values.slice(1).join(" / ");
    if (!name || !value || isSpecificationHeading(name, value)) continue;
    specs.push({ group, name, value });
  }

  return specs;
};

export const formatSpecificationText = (specs: QuotationSpec[]) => {
  const lines: string[] = [];
  let currentGroup = "";
  for (const item of specs) {
    if (item.group && item.group !== currentGroup) {
      currentGroup = item.group;
      lines.push(`[${currentGroup}]`);
    }
    lines.push(`${item.name}：${item.value}`);
  }
  return lines.join("\n");
};

export const parseSpecificationText = (value = "", defaultGroup = "技术参数"): QuotationSpec[] => {
  let group = defaultGroup;
  const specs: QuotationSpec[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const groupMatch = line.match(/^\[(.+)]$/);
    if (groupMatch) {
      group = groupMatch[1].trim() || group;
      continue;
    }
    const separator = line.search(/[：:]/);
    if (separator < 1) {
      specs.push({ group, name: line, value: "-" });
      continue;
    }
    const name = line.slice(0, separator).trim(), entry = line.slice(separator + 1).trim() || "-";
    if (!isSpecificationHeading(name, entry)) specs.push({ group, name, value: entry });
  }
  return specs;
};

export const createQuotationLine = (product: ProductItem, categoryName = "", currency = 'USD', language: QuotationLanguageCode = 'zh-CN'): QuotationLine => {
  const label = QUOTATION_COPY[language];
  const sharedSpecs = language === 'zh-CN' ? (product.parameterRows?.map((row) => ({ group: '公共参数', name: row.unit ? `${row.name} (${row.unit})` : row.name, value: row.value })) ?? chineseParameterSpecs(product.sharedParameters)) : [];
  const specs = [...sharedSpecs, ...extractProductSpecifications(product.content || "", label.specifications)];
  const fallback = [product.subtitle, product.summary].map(cleanText).filter(Boolean).slice(0, 2);
  const specText = specs.length
    ? formatSpecificationText(specs)
    : fallback.map(value => `${label.specifications}: ${value}`).join("\n");
  const image = product.largeImage || product.carouselImages?.[0] || "";
  return {
    id: `product-${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId: product.id,
    title: cleanText(product.title),
    categoryName: cleanText(categoryName),
    image,
    images: image ? [image] : [],
    quantity: 1,
    unit: quotationDefaults(language).unit,
    unitPrice: productReferencePrice(product.sharedParameters, currency),
    specText,
    remark: "",
  };
};

export const quotationSubtotal = (draft: QuotationDraft) =>
  draft.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);

export const quotationTotal = (draft: QuotationDraft) => quotationSubtotal(draft) + Number(draft.freight || 0);

export const quotationDeposit = (draft: QuotationDraft) =>
  quotationTotal(draft) * Math.max(0, Math.min(100, Number(draft.depositPercent || 0))) / 100;

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeFileName = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 80);

export const quotationHtmlFileName = (draft: QuotationDraft) => {
  const languageSuffix = draft.language && draft.language !== "zh-CN" ? `-${draft.language}` : "";
  return `${safeFileName(draft.quotationNo || "报价单")}${languageSuffix}.html`;
};

export const publicAssetUrl = quotationImageUrl;

export const formatMoney = (value: number, currency = "USD") => {
  const amount = Number(value || 0);
  return `${currency} ${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatAmount = (value: number) => Number(value || 0).toLocaleString("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const QUOTATION_COPY: Record<QuotationLanguageCode, Record<string, string>> = {
  id: {
    customerCompany:'Perusahaan pelanggan', customerContact:'Kontak pelanggan', quotationDate:'Tanggal penawaran', salesRepresentative:'Perwakilan penjualan', validity:'Masa berlaku', salesDepartment:'Departemen', productCategory:'Kategori produk', salesPosition:'Jabatan', customized:'Kustomisasi khusus', whatsapp:'WhatsApp', originCountry:'Negara asal', wechat:'WeChat', currency:'Mata uang', warranty:'Garansi', incoterm:'Syarat penyerahan', paymentTerms:'Syarat pembayaran', contact:'Kontak lain', phone:'Telepon', email:'Email', days:'hari', products:'Produk dan konfigurasi', productsKicker:'', productImage:'Gambar produk', itemCategory:'Kategori', specifications:'Spesifikasi teknis', amountColumns:'Jumlah / Harga satuan / Total', quantity:'Jumlah', unitPrice:'Harga satuan', total:'Total', note:'Catatan', subtotal:'Subtotal peralatan', logistics:'Pengiriman dan logistik', logisticsKicker:'', loadingPort:'Pelabuhan muat', destinationPort:'Pelabuhan tujuan', transportMode:'Metode pengiriman', freight:'Ongkos kirim', deposit:'Uang muka', balance:'Sisa pembayaran', grandTotal:'Total penawaran', notes:'Catatan penawaran', emptyProducts:'Belum ada produk', emptyImage:'Tidak ada gambar', emptySpecs:'Tidak ada spesifikasi', print:'Ekspor PDF', downloadHtml:'Unduh HTML',
  },
  vi: {
    customerCompany:'Công ty khách hàng', customerContact:'Người liên hệ', quotationDate:'Ngày báo giá', salesRepresentative:'Nhân viên kinh doanh', validity:'Hiệu lực báo giá', salesDepartment:'Bộ phận', productCategory:'Loại sản phẩm', salesPosition:'Chức vụ', customized:'Tùy chỉnh đặc biệt', whatsapp:'WhatsApp', originCountry:'Xuất xứ', wechat:'WeChat', currency:'Tiền tệ', warranty:'Bảo hành', incoterm:'Điều kiện giao hàng', paymentTerms:'Điều kiện thanh toán', contact:'Liên hệ khác', phone:'Điện thoại', email:'Email', days:'ngày', products:'Sản phẩm và cấu hình', productsKicker:'', productImage:'Hình ảnh sản phẩm', itemCategory:'Danh mục', specifications:'Thông số kỹ thuật', amountColumns:'Số lượng / Đơn giá / Tổng', quantity:'Số lượng', unitPrice:'Đơn giá', total:'Thành tiền', note:'Ghi chú', subtotal:'Tổng giá thiết bị', logistics:'Vận chuyển và giao nhận', logisticsKicker:'', loadingPort:'Cảng xếp hàng', destinationPort:'Cảng đích', transportMode:'Phương thức vận chuyển', freight:'Cước vận chuyển', deposit:'Tiền đặt cọc', balance:'Số tiền còn lại', grandTotal:'Tổng báo giá', notes:'Ghi chú báo giá', emptyProducts:'Chưa chọn sản phẩm', emptyImage:'Không có hình ảnh', emptySpecs:'Chưa có thông số', print:'Xuất PDF', downloadHtml:'Tải HTML',
  },
  tr: {
    customerCompany:'Müşteri şirketi', customerContact:'İlgili kişi', quotationDate:'Teklif tarihi', salesRepresentative:'Satış temsilcisi', validity:'Teklif geçerliliği', salesDepartment:'Departman', productCategory:'Ürün kategorisi', salesPosition:'Pozisyon', customized:'Özel yapılandırma', whatsapp:'WhatsApp', originCountry:'Menşe ülke', wechat:'WeChat', currency:'Para birimi', warranty:'Garanti', incoterm:'Teslim koşulları', paymentTerms:'Ödeme koşulları', contact:'Diğer iletişim', phone:'Telefon', email:'E-posta', days:'gün', products:'Ürünler ve yapılandırma', productsKicker:'', productImage:'Ürün görseli', itemCategory:'Kategori', specifications:'Teknik özellikler', amountColumns:'Miktar / Birim fiyat / Toplam', quantity:'Miktar', unitPrice:'Birim fiyat', total:'Toplam', note:'Not', subtotal:'Ekipman ara toplamı', logistics:'Nakliye ve lojistik', logisticsKicker:'', loadingPort:'Yükleme limanı', destinationPort:'Varış limanı', transportMode:'Nakliye yöntemi', freight:'Navlun', deposit:'Peşinat', balance:'Bakiye', grandTotal:'Genel toplam', notes:'Teklif notları', emptyProducts:'Ürün seçilmedi', emptyImage:'Görsel yok', emptySpecs:'Teknik özellik yok', print:'PDF dışa aktar', downloadHtml:'HTML indir',
  },
  "zh-CN": {
    customerCompany: "客户公司", customerContact: "客户联系人", quotationDate: "报价日期",
    salesRepresentative: "本次报价第一责任人", validity: "报价有效期", salesDepartment: "隶属部门",
    productCategory: "产品类型", salesPosition: "职位", customized: "是否为特殊定制款",
    whatsapp: "WhatsApp 联系方式", originCountry: "原产国", wechat: "微信联系方式",
    currency: "报价货币类型", warranty: "售后服务", incoterm: "报价贸易规则（交货方式）",
    paymentTerms: "本次报价付款方式", contact: "其他联系方式", phone: "联系电话", email: "联系邮箱",
    days: "天", products: "产品与配置报价", productsKicker: "PRODUCTS AND CONFIGURATIONS",
    productImage: "产品图片", itemCategory: "所属分类", specifications: "技术规格", amountColumns: "数量 / 单价 / 总价",
    quantity: "数量", unitPrice: "单价", total: "总价", note: "备注", subtotal: "产品设备总价",
    logistics: "运输费用", logisticsKicker: "LOGISTICS", loadingPort: "装货港", destinationPort: "目的港",
    transportMode: "运输方式", freight: "运费", deposit: "定金", balance: "尾款", grandTotal: "报价总额",
    notes: "报价说明", emptyProducts: "尚未选择报价产品", emptyImage: "暂无图片", emptySpecs: "暂无技术参数",
    print: "导出 PDF", downloadHtml: "下载 HTML",
  },
  en: {
    customerCompany: "Customer Company", customerContact: "Customer Contact", quotationDate: "Quotation Date",
    salesRepresentative: "Sales Representative", validity: "Quotation Validity", salesDepartment: "Department",
    productCategory: "Product Category", salesPosition: "Position", customized: "Special Customization",
    whatsapp: "WhatsApp", originCountry: "Country of Origin", wechat: "WeChat",
    currency: "Currency", warranty: "After-sales Warranty", incoterm: "Trade Term (Delivery)",
    paymentTerms: "Payment Terms", contact: "Other Contact", phone: "Phone", email: "Email",
    days: "days", products: "Products and Configuration", productsKicker: "PRODUCTS AND CONFIGURATIONS",
    productImage: "Product Image", itemCategory: "Category", specifications: "Technical Specifications", amountColumns: "Quantity / Unit Price / Total",
    quantity: "Quantity", unitPrice: "Unit Price", total: "Total", note: "Note", subtotal: "Equipment Subtotal",
    logistics: "Shipping and Logistics", logisticsKicker: "LOGISTICS", loadingPort: "Loading Port", destinationPort: "Destination Port",
    transportMode: "Shipping Method", freight: "Freight", deposit: "Deposit", balance: "Balance", grandTotal: "Grand Total",
    notes: "Quotation Notes", emptyProducts: "No products selected", emptyImage: "No image", emptySpecs: "No specifications",
    print: "Export PDF", downloadHtml: "Download HTML",
  },
  es: {
    customerCompany: "Empresa cliente", customerContact: "Contacto del cliente", quotationDate: "Fecha de cotización",
    salesRepresentative: "Responsable comercial", validity: "Validez de la oferta", salesDepartment: "Departamento",
    productCategory: "Categoría de producto", salesPosition: "Cargo", customized: "Personalización especial",
    whatsapp: "WhatsApp", originCountry: "País de origen", wechat: "WeChat", currency: "Moneda",
    warranty: "Garantía posventa", incoterm: "Condición comercial", paymentTerms: "Condiciones de pago",
    contact: "Otros contactos", phone: "Teléfono", email: "Correo electrónico", days: "días",
    products: "Productos y configuración", productsKicker: "PRODUCTOS Y CONFIGURACIONES", productImage: "Imagen del producto", itemCategory: "Categoría",
    specifications: "Especificaciones técnicas", amountColumns: "Cantidad / Precio unitario / Total", quantity: "Cantidad",
    unitPrice: "Precio unitario", total: "Total", note: "Nota", subtotal: "Subtotal de equipos",
    logistics: "Transporte y logística", logisticsKicker: "LOGÍSTICA", loadingPort: "Puerto de carga",
    destinationPort: "Puerto de destino", transportMode: "Método de transporte", freight: "Flete",
    deposit: "Anticipo", balance: "Saldo", grandTotal: "Total general", notes: "Notas de la oferta",
    emptyProducts: "No se han seleccionado productos", emptyImage: "Sin imagen", emptySpecs: "Sin especificaciones", print: "Exportar PDF", downloadHtml: "Descargar HTML",
  },
  fr: {
    customerCompany: "Société cliente", customerContact: "Contact client", quotationDate: "Date du devis",
    salesRepresentative: "Responsable commercial", validity: "Validité du devis", salesDepartment: "Département",
    productCategory: "Catégorie de produit", salesPosition: "Poste", customized: "Personnalisation spéciale",
    whatsapp: "WhatsApp", originCountry: "Pays d'origine", wechat: "WeChat", currency: "Devise",
    warranty: "Garantie après-vente", incoterm: "Condition commerciale", paymentTerms: "Conditions de paiement",
    contact: "Autres contacts", phone: "Téléphone", email: "E-mail", days: "jours",
    products: "Produits et configuration", productsKicker: "PRODUITS ET CONFIGURATIONS", productImage: "Image du produit", itemCategory: "Catégorie",
    specifications: "Spécifications techniques", amountColumns: "Quantité / Prix unitaire / Total", quantity: "Quantité",
    unitPrice: "Prix unitaire", total: "Total", note: "Remarque", subtotal: "Sous-total des équipements",
    logistics: "Transport et logistique", logisticsKicker: "LOGISTIQUE", loadingPort: "Port de chargement",
    destinationPort: "Port de destination", transportMode: "Mode de transport", freight: "Fret",
    deposit: "Acompte", balance: "Solde", grandTotal: "Total général", notes: "Notes du devis",
    emptyProducts: "Aucun produit sélectionné", emptyImage: "Aucune image", emptySpecs: "Aucune spécification", print: "Exporter en PDF", downloadHtml: "Télécharger le HTML",
  },
  ru: {
    customerCompany: "Компания клиента", customerContact: "Контактное лицо", quotationDate: "Дата предложения",
    salesRepresentative: "Ответственный менеджер", validity: "Срок действия", salesDepartment: "Отдел",
    productCategory: "Категория продукции", salesPosition: "Должность", customized: "Специальное исполнение",
    whatsapp: "WhatsApp", originCountry: "Страна происхождения", wechat: "WeChat", currency: "Валюта",
    warranty: "Гарантия", incoterm: "Условия поставки", paymentTerms: "Условия оплаты",
    contact: "Другие контакты", phone: "Телефон", email: "Эл. почта", days: "дней",
    products: "Продукция и комплектация", productsKicker: "ПРОДУКЦИЯ И КОМПЛЕКТАЦИЯ", productImage: "Изображение", itemCategory: "Категория",
    specifications: "Технические характеристики", amountColumns: "Количество / Цена / Сумма", quantity: "Количество",
    unitPrice: "Цена за единицу", total: "Сумма", note: "Примечание", subtotal: "Стоимость оборудования",
    logistics: "Доставка и логистика", logisticsKicker: "ЛОГИСТИКА", loadingPort: "Порт погрузки",
    destinationPort: "Порт назначения", transportMode: "Способ доставки", freight: "Фрахт",
    deposit: "Аванс", balance: "Остаток", grandTotal: "Итого", notes: "Примечания к предложению",
    emptyProducts: "Продукция не выбрана", emptyImage: "Нет изображения", emptySpecs: "Нет характеристик", print: "Экспорт в PDF", downloadHtml: "Скачать HTML",
  },
  ar: {
    customerCompany: "شركة العميل", customerContact: "جهة اتصال العميل", quotationDate: "تاريخ عرض السعر",
    salesRepresentative: "مسؤول المبيعات", validity: "صلاحية العرض", salesDepartment: "القسم",
    productCategory: "فئة المنتج", salesPosition: "المنصب", customized: "تخصيص خاص",
    whatsapp: "واتساب", originCountry: "بلد المنشأ", wechat: "ويتشات", currency: "العملة",
    warranty: "ضمان ما بعد البيع", incoterm: "شروط التسليم", paymentTerms: "شروط الدفع",
    contact: "وسائل اتصال أخرى", phone: "الهاتف", email: "البريد الإلكتروني", days: "يومًا",
    products: "المنتجات والتجهيزات", productsKicker: "المنتجات والتجهيزات", productImage: "صورة المنتج", itemCategory: "الفئة",
    specifications: "المواصفات الفنية", amountColumns: "الكمية / سعر الوحدة / الإجمالي", quantity: "الكمية",
    unitPrice: "سعر الوحدة", total: "الإجمالي", note: "ملاحظة", subtotal: "إجمالي المعدات",
    logistics: "الشحن والخدمات اللوجستية", logisticsKicker: "الخدمات اللوجستية", loadingPort: "ميناء التحميل",
    destinationPort: "ميناء الوصول", transportMode: "طريقة الشحن", freight: "الشحن",
    deposit: "الدفعة المقدمة", balance: "الرصيد", grandTotal: "الإجمالي الكلي", notes: "ملاحظات عرض السعر",
    emptyProducts: "لم يتم اختيار منتجات", emptyImage: "لا توجد صورة", emptySpecs: "لا توجد مواصفات", print: "تصدير PDF", downloadHtml: "تنزيل HTML",
  },
  pt: {
    customerCompany: "Empresa cliente", customerContact: "Contato do cliente", quotationDate: "Data da cotação",
    salesRepresentative: "Responsável comercial", validity: "Validade da cotação", salesDepartment: "Departamento",
    productCategory: "Categoria do produto", salesPosition: "Cargo", customized: "Personalização especial",
    whatsapp: "WhatsApp", originCountry: "País de origem", wechat: "WeChat", currency: "Moeda",
    warranty: "Garantia pós-venda", incoterm: "Condição comercial", paymentTerms: "Condições de pagamento",
    contact: "Outros contatos", phone: "Telefone", email: "E-mail", days: "dias",
    products: "Produtos e configuração", productsKicker: "PRODUTOS E CONFIGURAÇÕES", productImage: "Imagem do produto", itemCategory: "Categoria",
    specifications: "Especificações técnicas", amountColumns: "Quantidade / Preço unitário / Total", quantity: "Quantidade",
    unitPrice: "Preço unitário", total: "Total", note: "Observação", subtotal: "Subtotal dos equipamentos",
    logistics: "Transporte e logística", logisticsKicker: "LOGÍSTICA", loadingPort: "Porto de carga",
    destinationPort: "Porto de destino", transportMode: "Método de transporte", freight: "Frete",
    deposit: "Entrada", balance: "Saldo", grandTotal: "Total geral", notes: "Notas da cotação",
    emptyProducts: "Nenhum produto selecionado", emptyImage: "Sem imagem", emptySpecs: "Sem especificações", print: "Exportar PDF", downloadHtml: "Baixar HTML",
  },
};

const getQuotationCopy = (draft: QuotationDraft) => QUOTATION_COPY[draft.language || "zh-CN"] || QUOTATION_COPY["zh-CN"];

const renderMetaRow = (leftLabel: string, leftValue: string, rightLabel: string, rightValue: string) => `
  <div class="q-meta-row">
    <span>${escapeHtml(leftLabel)}</span><strong>${escapeHtml(leftValue || "-")}</strong>
    <span>${escapeHtml(rightLabel)}</span><strong>${escapeHtml(rightValue || "-")}</strong>
  </div>`;

const renderSpecs = (value: string, copy: Record<string, string>) => {
  const specs = parseSpecificationText(value, copy.specifications);
  if (!specs.length) return `<div class="q-spec-empty">${escapeHtml(copy.emptySpecs)}</div>`;
  let currentGroup = specs[0].group || copy.specifications;
  return `<table class="q-specs"><colgroup><col style="width:42%"><col></colgroup><thead><tr><th colspan="2">${escapeHtml(currentGroup)}</th></tr></thead><tbody>${specs.map((item) => {
    const group = item.group || copy.specifications;
    const groupRow = group !== currentGroup
      ? `<tr class="q-spec-group" data-q-group="${escapeHtml(group)}"><th colspan="2">${escapeHtml(group)}</th></tr>`
      : "";
    currentGroup = group;
    return `${groupRow}<tr data-q-group="${escapeHtml(group)}" class="q-spec-row${item.name.length + item.value.length > 600 ? ' long-value' : ''}"><th scope="row">${escapeHtml(item.name)}</th><td>${escapeHtml(item.value)}</td></tr>`;
  }).join("")}</tbody></table>`;
};

export const buildQuotationBody = (draft: QuotationDraft) => {
  draft = normalizeQuotation(draft);
  const t = getQuotationCopy(draft);
  const logo = publicAssetUrl(draft.logoUrl, draft.assetBaseUrl);
  const subtotal = quotationSubtotal(draft);
  const total = quotationTotal(draft);
  const deposit = quotationDeposit(draft);
  const balance = total - deposit;
  const priceHeading = (label: string, currency = '') => {
    const width = Array.from(label).reduce((size, char) => size + (/[^\u0000-\u00ff]/.test(char) ? 1 : 0.65), 0);
    return `<span><b class="q-price-label" style="--q-label-chars:${Math.max(1, width)}">${escapeHtml(label)}</b>${currency ? `<b class="q-price-currency">(${escapeHtml(currency)})</b>` : ''}</span>`;
  };
  const items = draft.items.map((item, index) => {
    const imageValues = (Array.isArray(item.images) ? item.images : [item.image])
      .map((value) => String(value || "").trim())
      .filter((value, imageIndex, values) => value && values.indexOf(value) === imageIndex)
      .slice(0, 3);
    const images = imageValues.map((value) => publicAssetUrl(value, draft.assetBaseUrl));
    const lineTotal = Number(item.quantity || 0) * Number(item.unitPrice || 0);
    const moneyCell = (value: number) => { const text = formatAmount(value); return `<strong dir="ltr"><span class="q-money" style="--q-money-chars:${Math.max(1, text.length * 0.62)}">${escapeHtml(text)}</span></strong>`; };
    const productName = cleanText(item.title || "");
    const categoryName = cleanText(item.categoryName || "");
    const productTitle = categoryName && !productName.toLocaleLowerCase().includes(categoryName.toLocaleLowerCase())
      ? `${productName} ${categoryName}`.trim()
      : productName || categoryName;
    const specs = parseSpecificationText(item.specText, t.specifications);
    const compact = specs.length <= 8 && specs.reduce((size, spec) => size + spec.name.length + spec.value.length + spec.group.length, 0) <= 600;
    return `
      <section data-q-line="${index}" class="q-product${compact ? ' q-product-short' : ''}">
        <div class="q-product-title"><span>${index + 1}</span><strong>${escapeHtml(productTitle || item.title)}</strong></div>
        <div class="q-product-grid${compact ? ' q-product-compact' : ''}">
          <div class="q-product-photo">${images.length ? `<div class="q-photo-gallery q-photo-count-${images.length}">${images.map((image, imageIndex) => `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.title)} ${imageIndex + 1}" />`).join("")}</div>` : `<span>${escapeHtml(t.emptyImage)}</span>`}</div>
          <div class="q-product-price">
            <div class="q-price-head">
              ${priceHeading(t.quantity)}${priceHeading(t.unitPrice, draft.currency)}${priceHeading(t.total, draft.currency)}
            </div>
            <div class="q-price-values">
              <strong><bdi>${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</bdi></strong>${moneyCell(item.unitPrice)}${moneyCell(lineTotal)}
            </div>
          </div>
          <div class="q-product-specs">${renderSpecs(item.specText, t)}</div>
        </div>
        ${item.remark ? `<div class="q-product-remark"><strong>${escapeHtml(t.note)}：</strong>${escapeHtml(item.remark)}</div>` : ""}
      </section>`;
  }).join("");

  return `
  <main class="quotation-document" lang="${escapeHtml(draft.language || "zh-CN")}" dir="${draft.language === "ar" ? "rtl" : "ltr"}">
    <header class="q-company">
      <div class="q-company-heading">
        ${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(draft.companyName)}" />` : ""}
        <h1>${escapeHtml(draft.companyName)}</h1>
      </div>
      <p>${escapeHtml(draft.companySubtitle)}</p>
    </header>
    <div class="q-document-title">
      <span>${escapeHtml(draft.quotationNo)}</span>
      <h2>${escapeHtml(draft.title)}</h2>
      <span>${escapeHtml(draft.quotationDate)}</span>
    </div>
    <section class="q-meta">
      ${renderMetaRow(t.customerCompany, draft.customerCompany, t.customerContact, draft.customerContact)}
      ${renderMetaRow(t.quotationDate, draft.quotationDate, t.salesRepresentative, draft.salesName)}
      ${renderMetaRow(t.validity, `${draft.validityDays} ${t.days}`, t.salesDepartment, draft.salesDepartment)}
      ${renderMetaRow(t.productCategory, draft.productCategory, t.salesPosition, draft.salesPosition)}
      ${renderMetaRow(t.customized, draft.customized, t.whatsapp, draft.whatsapp || draft.phone)}
      ${renderMetaRow(t.originCountry, draft.originCountry, t.wechat, draft.wechat)}
      ${renderMetaRow(t.currency, draft.currency, t.warranty, draft.warranty)}
      ${renderMetaRow(t.incoterm, draft.incoterm, t.paymentTerms, draft.paymentTerms)}
      ${renderMetaRow(t.email, draft.email, t.phone, draft.phone)}
    </section>
    <section class="q-section">
      <div class="q-section-heading"><span>I</span><h3>${escapeHtml(t.products)}</h3><small>${escapeHtml(t.productsKicker)}</small></div>
      <div class="q-column-head"><span>${escapeHtml(t.productImage)}</span><span>${escapeHtml(t.specifications)}</span><span>${escapeHtml(t.amountColumns)}</span></div>
      ${items || `<div class="q-empty">${escapeHtml(t.emptyProducts)}</div>`}
      <div class="q-subtotal"><span>${escapeHtml(t.subtotal)}（${escapeHtml(draft.currency)}）</span><strong>${escapeHtml(formatAmount(subtotal))}</strong></div>
    </section>
    <section class="q-section q-logistics">
      <div class="q-section-heading"><span>II</span><h3>${escapeHtml(t.logistics)}</h3><small>${escapeHtml(t.logisticsKicker)}</small></div>
      <div class="q-logistics-grid">
        <div><span>${escapeHtml(t.loadingPort)}</span><strong>${escapeHtml(draft.loadingPort || "-")}</strong></div>
        <div><span>${escapeHtml(t.destinationPort)}</span><strong>${escapeHtml(draft.destinationPort || "-")}</strong></div>
        <div><span>${escapeHtml(t.transportMode)}</span><strong>${escapeHtml(draft.transportMode || "-")}</strong></div>
        <div><span>${escapeHtml(t.freight)}</span><strong>${escapeHtml(formatMoney(draft.freight, draft.currency))}</strong></div>
      </div>
    </section>
    <section class="q-summary">
      <div><span>${escapeHtml(t.deposit)}（${escapeHtml(draft.depositPercent)}%）</span><strong>${escapeHtml(formatMoney(deposit, draft.currency))}</strong></div>
      <div><span>${escapeHtml(t.balance)}（${escapeHtml(100 - Number(draft.depositPercent || 0))}%）</span><strong>${escapeHtml(formatMoney(balance, draft.currency))}</strong></div>
      <div class="q-grand-total"><span>${escapeHtml(t.grandTotal)}</span><strong>${escapeHtml(formatMoney(total, draft.currency))}</strong></div>
    </section>
    ${draft.notes ? `<section class="q-notes"><h3>${escapeHtml(t.notes)}</h3><p>${escapeHtml(draft.notes).replace(/\n/g, "<br />")}</p></section>` : ""}
    <footer class="q-footer"><span>${escapeHtml(draft.companyName)}</span><span>${escapeHtml(draft.website.replace(/^https?:\/\//i, ""))}</span><span>${escapeHtml(draft.quotationNo)}</span></footer>
  </main>`;
};

export const QUOTATION_STYLES = quotationPageCss;

export const buildQuotationHtml = (draft: QuotationDraft, token = '') => (quotationLayout(draft.layout).pageMode === 'paged' ? paginatedQuotationHtml : continuousQuotationHtml)(
  buildQuotationBody(draft), escapeHtml(draft.quotationNo + ' ' + draft.title), quotationLanguage(draft.language), token,
  { css: quotationPageCss + quotationLayoutCss(draft.layout), layout: draft.layout },
);
export const buildQuotationPreviewHtml = buildQuotationHtml;

export const buildQuotationWebHtml = (draft: QuotationDraft) => `<!doctype html>
<html lang="${quotationLanguage(draft.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(draft.quotationNo + ' ' + draft.title)}</title><style>${quotationPageCss}${quotationLayoutCss(draft.layout)}${quotationWebCss}</style></head><body>${buildQuotationBody(draft)}</body></html>`;

export function normalizeQuotation(value: Partial<QuotationDraft>): QuotationDraft {
  const draft = { ...createDefaultQuotation(), ...value, language: quotationLanguage(value.language) };
  draft.layout = quotationLayout(value.layout);
  draft.items = (Array.isArray(value.items) ? value.items : []).map(item => {
    const images = [...new Set((Array.isArray(item.images) ? item.images : [item.image]).filter(Boolean))].slice(0, 3);
    return { ...item, images, image: images[0] || '', specText: item.specText || '', remark: item.remark || '', unit: item.unit || quotationDefaults(draft.language).unit };
  });
  return draft;
}

export function validateQuotation(draft: QuotationDraft) {
  if (!draft.quotationNo.trim() || !draft.title.trim()) throw new Error('请填写报价编号和标题');
  if (!draft.quotationDate || !/^\d{4}-\d{2}-\d{2}$/.test(draft.quotationDate)) throw new Error('请选择报价日期');
  if (!draft.items.length || draft.items.length > 20) throw new Error('每份报价须包含 1 至 20 个产品');
  const valid = (n: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!valid(draft.freight) || !valid(draft.depositPercent) || draft.depositPercent > 100 || !valid(draft.validityDays) || draft.validityDays < 1) throw new Error('请检查运费、定金比例和有效期');
  for (const item of draft.items) {
    if (!item.title.trim()) throw new Error('产品名称为空，请完成该语言的产品翻译');
    if (!valid(item.quantity) || !valid(item.unitPrice) || !Number.isFinite(item.quantity * item.unitPrice)) throw new Error('产品数量和单价必须为有效的非负数字');
    if (item.specText.length > 100000 || item.remark.length > 10000) throw new Error('产品参数或备注过长，请精简');
  }
  if (!Number.isFinite(quotationTotal(draft))) throw new Error('报价总额超出有效范围');
}

export async function portableQuotation(draft: QuotationDraft, progress: (done: number, total: number) => void) {
  const normalized = normalizeQuotation(draft);
  const embedded = await embedQuotationImages([normalized.logoUrl, ...normalized.items.flatMap(item => item.images || [])], normalized.assetBaseUrl, progress);
  return { ...normalized, logoUrl: embedded.get(normalized.logoUrl) || '', assetBaseUrl: '', items: normalized.items.map(item => ({
    ...item, images: (item.images || []).map(src => embedded.get(src) || ''), image: embedded.get(item.images?.[0] || '') || '',
  })) };
}
