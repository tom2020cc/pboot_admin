import { repairTranslatedHtml } from "@/api/uploads";
import type { ProductItem } from "@/api/products";

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

export type QuotationLanguageCode = "zh-CN" | "en" | "es" | "fr" | "ru" | "ar" | "pt";

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
  language: "zh-CN",
  quotationNo: createQuotationNo(),
  quotationDate: localDateValue(),
  title: "工程机械商业报价单",
  companyName: "山东恒建行工程机械有限公司",
  companySubtitle: "工程机械与钻探设备解决方案",
  logoUrl: "https://shanbo.cc/static/logo.jpg",
  website: "https://shanbo.cc",
  assetBaseUrl: "https://shanbo.cc",
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

const rowScore = (row: HTMLTableRowElement) => {
  const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
  return cells.length >= 2 && cells.some((cell) => cleanText(cell.textContent || "")) ? 1 : 0;
};

export const extractProductSpecifications = (content = ""): QuotationSpec[] => {
  if (typeof DOMParser === "undefined" || !content) return [];
  const document = new DOMParser().parseFromString(repairTranslatedHtml(content), "text/html");
  const tables = [...document.querySelectorAll("table")];
  const table = tables
    .map((item) => ({ item, score: [...item.querySelectorAll("tr")].reduce((sum, row) => sum + rowScore(row), 0) }))
    .sort((left, right) => right.score - left.score)[0]?.item;

  if (!table) return [];
  const specs: QuotationSpec[] = [];
  let group = "技术参数";

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
    const isHeaderRow = /^(参数|项目|item|model|specifications?)$/i.test(name)
      && /^(参数|数值|value|specifications?)$/i.test(value);
    if (!name || !value || isHeaderRow) continue;
    specs.push({ group, name, value });
  }

  return specs.slice(0, 80);
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

export const parseSpecificationText = (value = ""): QuotationSpec[] => {
  let group = "技术参数";
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
    specs.push({ group, name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() || "-" });
  }
  return specs;
};

export const createQuotationLine = (product: ProductItem, categoryName = ""): QuotationLine => {
  const specs = extractProductSpecifications(product.content || "");
  const fallback = [product.subtitle, product.summary].map(cleanText).filter(Boolean).slice(0, 2);
  const specText = specs.length
    ? formatSpecificationText(specs)
    : fallback.map((value, index) => `${index === 0 ? "产品说明" : "配置说明"}：${value}`).join("\n");
  const image = product.largeImage || product.thumbnail || product.carouselImages?.[0] || "";
  return {
    id: `product-${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId: product.id,
    title: cleanText(product.title) || `产品 #${product.id}`,
    categoryName: cleanText(categoryName),
    image,
    images: image ? [image] : [],
    quantity: 1,
    unit: "台",
    unitPrice: 0,
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

export const publicAssetUrl = (value: string, baseUrl: string) => {
  const source = String(value || "").trim();
  if (!source) return "";
  if (/^(https?:)?\/\//i.test(source) || /^data:/i.test(source)) return source;
  const base = String(baseUrl || "https://shanbo.cc").replace(/\/+$/, "");
  return `${base}/${source.replace(/^\/+/, "")}`;
};

export const formatMoney = (value: number, currency = "USD") => {
  const amount = Number(value || 0);
  return `${currency} ${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatAmount = (value: number) => Number(value || 0).toLocaleString("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const QUOTATION_COPY: Record<QuotationLanguageCode, Record<string, string>> = {
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

const renderSpecs = (value: string, emptyText: string) => {
  const specs = parseSpecificationText(value);
  if (!specs.length) return `<div class="q-spec-empty">${escapeHtml(emptyText)}</div>`;
  let currentGroup = "";
  return `<div class="q-specs">${specs.map((item) => {
    const groupRow = item.group && item.group !== currentGroup
      ? `<div class="q-spec-group">${escapeHtml(item.group)}</div>`
      : "";
    currentGroup = item.group;
    return `${groupRow}<div class="q-spec-row"><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(item.value)}</strong></div>`;
  }).join("")}</div>`;
};

export const buildQuotationBody = (draft: QuotationDraft) => {
  draft = { ...createDefaultQuotation(), ...draft, items: Array.isArray(draft.items) ? draft.items : [] };
  const t = getQuotationCopy(draft);
  const logo = publicAssetUrl(draft.logoUrl, draft.assetBaseUrl);
  const subtotal = quotationSubtotal(draft);
  const total = quotationTotal(draft);
  const deposit = quotationDeposit(draft);
  const balance = total - deposit;
  const items = draft.items.map((item, index) => {
    const imageValues = (Array.isArray(item.images) && item.images.length ? item.images : [item.image])
      .map((value) => String(value || "").trim())
      .filter((value, imageIndex, values) => value && values.indexOf(value) === imageIndex)
      .slice(0, 3);
    const images = imageValues.map((value) => publicAssetUrl(value, draft.assetBaseUrl));
    const lineTotal = Number(item.quantity || 0) * Number(item.unitPrice || 0);
    const productName = cleanText(item.title || "");
    const categoryName = cleanText(item.categoryName || "");
    const productTitle = categoryName && !productName.toLocaleLowerCase().includes(categoryName.toLocaleLowerCase())
      ? `${productName} ${categoryName}`.trim()
      : productName || categoryName;
    return `
      <section class="q-product">
        <div class="q-product-title"><span>${index + 1}</span><strong>${escapeHtml(productTitle || item.title)}</strong></div>
        <div class="q-product-grid">
          <div class="q-product-photo">${images.length ? `<div class="q-photo-gallery q-photo-count-${images.length}">${images.map((image, imageIndex) => `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.title)} ${imageIndex + 1}" />`).join("")}</div>` : `<span>${escapeHtml(t.emptyImage)}</span>`}</div>
          <div class="q-product-specs">${renderSpecs(item.specText, t.emptySpecs)}</div>
          <div class="q-product-price">
            <div class="q-price-head">
              <span>${escapeHtml(t.quantity)}</span><span>${escapeHtml(t.unitPrice)}（${escapeHtml(draft.currency)}）</span><span>${escapeHtml(t.total)}（${escapeHtml(draft.currency)}）</span>
            </div>
            <div class="q-price-values">
              <strong>${escapeHtml(item.quantity)}</strong><strong>${escapeHtml(formatAmount(item.unitPrice))}</strong><strong>${escapeHtml(formatAmount(lineTotal))}</strong>
            </div>
          </div>
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
    <footer class="q-footer"><span>${escapeHtml(draft.companyName)}</span><a href="${escapeHtml(draft.website)}">${escapeHtml(draft.website.replace(/^https?:\/\//i, ""))}</a><span>${escapeHtml(draft.quotationNo)}</span></footer>
  </main>`;
};

export const QUOTATION_STYLES = `
  :root{--q-ink:#20262e;--q-muted:#667085;--q-line:#3d4652;--q-soft-line:#d3dae4;--q-soft:#f4f6f8;--q-brand:#c45f08;--q-brand-dark:#9f4704;--q-brand-soft:#fff6e9;color:var(--q-ink);background:#eef1f5;font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;background:#eef1f5;color:var(--q-ink)}
  .web-actions{position:sticky;top:0;z-index:10;display:flex;justify-content:center;gap:10px;padding:10px;background:rgba(255,255,255,.96);border-bottom:1px solid #d9dee7}
  .web-actions button{min-height:36px;padding:0 16px;border:1px solid #1677ff;border-radius:6px;color:#fff;background:#1677ff;font:600 14px inherit;cursor:pointer}.web-actions button.secondary{color:#1677ff;background:#fff}
  .quotation-document{width:min(calc(100% - 24px),1600px);margin:12px auto 24px;padding:38px 44px;border:1px solid #d8dee7;background:#fff;box-shadow:0 10px 30px rgba(31,45,61,.11)}
  .q-company{padding:2px 20px 12px;border-bottom:2px solid var(--q-line);text-align:center}
  .q-company-heading{display:flex;align-items:center;justify-content:center;gap:16px;min-height:58px}
  .q-company-heading img{display:block;width:auto;max-width:150px;height:56px;object-fit:contain}
  .q-company h1{margin:0;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:29px;font-weight:600;line-height:1.15;letter-spacing:0}
  .q-company p{margin:4px 0 0;color:#475467;font-size:12px;line-height:1.5}
  .q-document-title{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;padding:16px 0 14px;border-bottom:1px solid var(--q-line)}
  .q-document-title h2{margin:0;font-size:21px;font-weight:700;text-align:center;letter-spacing:0}
  .q-document-title span{color:var(--q-muted);font-size:11px}.q-document-title span:last-child{text-align:right}
  .q-meta{margin-top:16px;border:1px solid #aab3bf}
  .q-meta-row{display:grid;grid-template-columns:110px minmax(0,1fr) 110px minmax(0,1fr);min-height:33px;border-bottom:1px solid var(--q-soft-line);background:var(--q-soft)}
  .q-meta-row:last-child{border-bottom:0}.q-meta-row span,.q-meta-row strong{display:flex;align-items:center;padding:6px 9px;font-size:12px}
  .q-meta-row span{color:#475467;border-right:1px solid var(--q-soft-line)}.q-meta-row strong{background:#fff;font-weight:650}
  .q-section{margin-top:20px}.q-section-heading{display:grid;grid-template-columns:34px auto 1fr;align-items:center;gap:8px;min-height:40px;padding:0 13px;border-left:4px solid var(--q-brand);color:#fff;background:#292e35}
  .q-section-heading>span{display:grid;place-items:center;width:24px;height:24px;border:1px solid rgba(255,255,255,.5);border-radius:50%;font-size:11px;font-weight:700}
  .q-section-heading h3{margin:0;font-size:14px}.q-section-heading small{justify-self:end;color:#d7dde5;font-size:10px}
  .q-column-head{display:grid;grid-template-columns:27% minmax(0,1fr) minmax(250px,25%);border:1px solid var(--q-line);border-top:0;background:var(--q-brand);color:#fff;font-size:11px;font-weight:600;text-align:center}
  .q-column-head span{padding:6px;border-right:1px solid rgba(255,255,255,.3)}.q-column-head span:last-child{border:0}
  .q-product{border:1px solid var(--q-line);border-top:0;break-inside:avoid}
  .q-product-title{display:flex;align-items:center;gap:9px;min-height:38px;padding:7px 10px;border-bottom:1px solid var(--q-line);background:#f7f8fa}
  .q-product-title span{display:grid;place-items:center;width:22px;height:22px;border-radius:4px;color:#fff;background:var(--q-brand);font-size:11px;font-weight:700}.q-product-title strong{font-size:14px;font-weight:700}
  .q-product-grid{display:grid;grid-template-columns:27% minmax(0,1fr) minmax(250px,25%);min-height:220px}
  .q-product-photo{display:grid;place-items:center stretch;min-width:0;padding:8px;border-right:1px solid var(--q-line);color:#98a2b3;font-size:12px}
  .q-photo-gallery{display:grid;width:100%;gap:8px;align-content:center}.q-photo-gallery img{display:block;width:100%;height:auto}
  .q-photo-count-2{grid-template-columns:1fr}.q-photo-count-3{grid-template-columns:1fr 1fr}.q-photo-count-3 img:first-child{grid-column:1/-1}
  .q-product-specs{display:flex;min-width:0;border-right:1px solid var(--q-line)}.q-specs{display:flex;flex:1;flex-direction:column;min-height:100%}.q-spec-group{flex:0 0 auto;padding:6px 8px;background:#e9edf2;border-bottom:1px solid var(--q-soft-line);color:#344054;font-size:11px;font-weight:700;text-align:center}
  .q-spec-row{display:grid;flex:1 1 auto;grid-template-columns:minmax(130px,42%) 1fr;border-bottom:1px solid var(--q-soft-line)}.q-spec-row:last-child{border-bottom:0}.q-spec-row span,.q-spec-row strong{display:flex;align-items:center;padding:7px 10px;font-size:11px;line-height:1.5}.q-spec-row span{border-right:1px solid var(--q-soft-line);color:#475467;background:#fafbfc}.q-spec-row strong{color:#1f2937;font-weight:650}.q-spec-empty{display:grid;flex:1;place-items:center;min-height:180px;color:#98a2b3;font-size:12px}
  .q-product-price{display:grid;grid-template-rows:auto 1fr;min-width:0}.q-price-head,.q-price-values{display:grid;grid-template-columns:24% 38% 38%;text-align:center}.q-price-head{color:#fff;background:var(--q-brand-dark);border-bottom:1px solid var(--q-line)}.q-price-head span{display:grid;place-items:center;min-width:0;padding:7px 4px;border-right:1px solid rgba(255,255,255,.28);font-size:10px;font-weight:600}.q-price-head span:last-child{border-right:0}.q-price-values strong{display:grid;place-items:center;min-width:0;padding:11px 6px;border-right:1px solid var(--q-line);background:#fbfcfd;font-size:12px;font-weight:650;overflow-wrap:anywhere}.q-price-values strong:last-child{border-right:0;color:var(--q-brand-dark);background:var(--q-brand-soft);font-size:14px}
  .q-product-remark{padding:8px 10px;border-top:1px solid var(--q-line);color:#475467;background:#fafbfc;font-size:11px}.q-subtotal{display:grid;grid-template-columns:1fr minmax(250px,25%);border:1px solid var(--q-line);border-top:0;font-size:12px}.q-subtotal span,.q-subtotal strong{padding:10px 14px}.q-subtotal span{color:#475467;text-align:right}.q-subtotal strong{border-left:1px solid var(--q-line);color:var(--q-brand-dark);background:var(--q-brand-soft);text-align:center;font-size:14px}
  .q-logistics-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--q-line);border-top:0}.q-logistics-grid>div{padding:11px 12px;border-right:1px solid var(--q-soft-line);background:#fbfcfd}.q-logistics-grid>div:last-child{border:0}.q-logistics-grid span,.q-logistics-grid strong{display:block}.q-logistics-grid span{color:var(--q-muted);font-size:10px}.q-logistics-grid strong{margin-top:5px;font-size:12px}
  .q-summary{margin-top:16px;border:1px solid var(--q-line)}.q-summary>div{display:flex;justify-content:flex-end;gap:28px;padding:9px 15px;border-bottom:1px solid var(--q-soft-line);color:#344054;background:#f7f8fa}.q-summary>div:last-child{border:0}.q-summary span{min-width:220px;text-align:right}.q-summary strong{min-width:180px;text-align:right}.q-summary .q-grand-total{padding:12px 15px;color:#fff;background:#292e35;font-size:15px}.q-summary .q-grand-total strong{color:#ffbd70;font-size:19px}
  .q-notes{margin-top:16px;padding:13px 15px;border:1px solid #f2d2ae;border-left:4px solid var(--q-brand);background:#fffaf3}.q-notes h3{margin:0 0 6px;color:#7a3803;font-size:13px}.q-notes p{margin:0;color:#475467;font-size:11px;line-height:1.75}.q-footer{display:flex;justify-content:space-between;gap:16px;margin-top:24px;padding-top:9px;border-top:1px solid var(--q-soft-line);color:#8a94a3;font-size:10px}.q-footer a{color:inherit;text-decoration:none}.q-empty{padding:36px;border:1px solid var(--q-line);border-top:0;color:#98a2b3;text-align:center}
  .quotation-document[dir="rtl"] .q-meta-row span{border-right:0;border-left:1px solid #c8d0dc}.quotation-document[dir="rtl"] .q-summary span,.quotation-document[dir="rtl"] .q-summary strong{text-align:left}
  @media(max-width:760px){.quotation-document{margin:0;padding:18px 12px;border:0;box-shadow:none}.q-company{padding-inline:0}.q-company-heading{gap:9px;min-height:44px}.q-company-heading img{max-width:92px;height:42px}.q-document-title{grid-template-columns:1fr}.q-document-title span,.q-document-title span:last-child{text-align:center}.q-document-title h2{grid-row:1}.q-meta-row{grid-template-columns:90px 1fr}.q-column-head{display:none}.q-product-grid{grid-template-columns:1fr}.q-product-photo,.q-product-specs{border-right:0;border-bottom:1px solid var(--q-line)}.q-product-price{min-height:112px}.q-subtotal{grid-template-columns:1fr 42%}.q-logistics-grid{grid-template-columns:1fr 1fr}.q-summary span,.q-summary strong{min-width:0}.q-summary>div{justify-content:space-between}.q-company h1{font-size:17px}.q-company p{font-size:10px}}
  @media print{body{background:#fff}.web-actions{display:none}.quotation-document{width:100%;margin:0;padding:0;border:0;box-shadow:none}@page{size:A4 landscape;margin:9mm}.q-section,.q-product,.q-logistics,.q-summary{break-inside:avoid}}
`;

export const buildQuotationPreviewHtml = (draft: QuotationDraft) => `<style>${QUOTATION_STYLES}</style>${buildQuotationBody(draft)}`;

export const buildQuotationHtml = (draft: QuotationDraft) => `<!doctype html>
<html lang="${escapeHtml(draft.language || "zh-CN")}" dir="${draft.language === "ar" ? "rtl" : "ltr"}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(draft.quotationNo)} ${escapeHtml(draft.title)}</title>
  <style>${QUOTATION_STYLES}</style>
</head>
<body>
  <div class="web-actions"><button type="button" onclick="window.print()">${escapeHtml(getQuotationCopy(draft).print)}</button><button id="download-html" class="secondary" type="button">${escapeHtml(getQuotationCopy(draft).downloadHtml)}</button></div>
  ${buildQuotationBody(draft)}
  <script>
    document.getElementById("download-html").addEventListener("click", function () {
      var source = "<!doctype html>\\n" + document.documentElement.outerHTML;
      var blob = new Blob([source], { type: "text/html;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = ${JSON.stringify(quotationHtmlFileName(draft))};
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  </script>
</body>
</html>`;
