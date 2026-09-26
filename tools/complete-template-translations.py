"""Review and complete labels introduced since the previous localized templates."""
import json
from pathlib import Path

p = Path(__file__).with_name('language-template-translations.json')
maps = json.loads(p.read_text(encoding='utf-8'))
langs = ['en','es','fr','ar','pt','ru','id','vi','tr']
rows = {
 '最大回转扭矩': ['Maximum Rotary Torque','Par de rotación máximo','Couple de rotation maximal','أقصى عزم دوران','Torque máximo de rotação','Максимальный крутящий момент','Torsi Putar Maksimum','Mô-men xoắn quay tối đa','Maksimum Dönüş Torku'],
 '技术参数': ['Technical Specifications','Especificaciones técnicas','Caractéristiques techniques','المواصفات الفنية','Especificações técnicas','Технические характеристики','Spesifikasi Teknis','Thông số kỹ thuật','Teknik Özellikler'],
 '待补充': ['Not provided','No disponible','Non renseigné','غير متوفر','Não informado','Не указано','Belum tersedia','Chưa có thông tin','Belirtilmemiş'],
 '发动机': ['Engine','Motor','Moteur','المحرك','Motor','Двигатель','Mesin','Động cơ','Motor'],
 '外形尺寸长宽高': ['Dimensions (L × W × H)','Dimensiones (L × An × Al)','Dimensions (L × l × H)','الأبعاد (الطول × العرض × الارتفاع)','Dimensões (C × L × A)','Габариты (Д × Ш × В)','Dimensi (P × L × T)','Kích thước (D × R × C)','Boyutlar (U × G × Y)'],
 '重量': ['Weight','Peso','Poids','الوزن','Peso','Масса','Berat','Trọng lượng','Ağırlık'],
 '下载产品手册': ['Download Product Brochure','Descargar folleto del producto','Télécharger la brochure du produit','تنزيل كتيب المنتج','Baixar catálogo do produto','Скачать каталог продукции','Unduh Brosur Produk','Tải tài liệu sản phẩm','Ürün Broşürünü İndir'],
 '产品列表': ['Products','Productos','Produits','المنتجات','Produtos','Продукция','Produk','Sản phẩm','Ürünler'],
 '暂无产品': ['No products found.','No hay productos.','Aucun produit disponible.','لا توجد منتجات حالياً.','Nenhum produto disponível.','Товары отсутствуют.','Belum ada produk.','Chưa có sản phẩm.','Henüz ürün yok.'],
 '日期：': ['Date:','Fecha:','Date :','التاريخ:','Data:','Дата:','Tanggal:','Ngày:','Tarih:'],
 '浏览：': ['Views:','Visitas:','Vues :','المشاهدات:','Visualizações:','Просмотры:','Dilihat:','Lượt xem:','Görüntülenme:'],
 '栏目导航': ['Navigation','Navegación','Navigation','التنقل','Navegação','Навигация','Navigasi','Điều hướng','Gezinme'],
 '个视频': ['videos','vídeos','vidéos','فيديوهات','vídeos','видео','video','video','video'],
 '正在提交...': ['Submitting...','Enviando...','Envoi en cours...','جارٍ الإرسال...','Enviando...','Отправка...','Mengirim...','Đang gửi...','Gönderiliyor...'],
 '来自 ShanBo 官方 YouTube 频道，点击视频即可在本页播放。': ['From the official ShanBo YouTube channel. Click a video to play it on this page.','Del canal oficial de ShanBo en YouTube. Haz clic en un vídeo para reproducirlo aquí.','Depuis la chaîne YouTube officielle de ShanBo. Cliquez sur une vidéo pour la lire ici.','من قناة ShanBo الرسمية على YouTube. انقر على الفيديو لتشغيله في هذه الصفحة.','Do canal oficial da ShanBo no YouTube. Clique em um vídeo para reproduzi-lo aqui.','С официального YouTube-канала ShanBo. Нажмите на видео для просмотра на этой странице.','Dari kanal YouTube resmi ShanBo. Klik video untuk memutarnya di halaman ini.','Từ kênh YouTube chính thức của ShanBo. Nhấp vào video để phát ngay trên trang này.','ShanBo resmi YouTube kanalından. Bu sayfada oynatmak için bir videoya tıklayın.'],
 '产品详情：': ['Product Details:','Detalles del producto:','Détails du produit :','تفاصيل المنتج:','Detalhes do produto:','Описание товара:','Detail Produk:','Chi tiết sản phẩm:','Ürün Ayrıntıları:'],
}
for i, lang in enumerate(langs):
    m = maps[lang]
    # Unit-bearing labels from old detail tables do not align after CN gained fields.
    for k in list(m):
        if '(' in k or '{content:' in k or k.startswith('[aria-label='):
            del m[k]
    for key, values in rows.items(): m[key] = values[i]
    m['回拖力'] = m['回拉力']
    m['版权所有。'] = m.pop('2026 版权所有。').replace('2026 ', '')
    # Keep literals safe in both HTML attributes and JavaScript string contexts.
    for key in m:
        m[key] = m[key].replace("\\'", '’').replace("'", '’').replace('"', '”')
p.write_text(json.dumps(maps, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print('Completed reviewed translations for nine languages.')
