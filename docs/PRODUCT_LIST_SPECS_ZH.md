# 产品列表属性通用读取

2026-09-23：已在本地 PB 网站 `E:/phpstudy_pro/WWW/shanbo-rig.c` 实现，未部署线上。

## 展示规则

- 首页产品卡片和产品列表共用 `[list:product_specs]` 标签。
- 从 PB 的 `ay_extfield` 读取产品模型（mcode=3）的单行文本字段，按 `sorting`、字段名称排序，从当前产品的扩展字段值中取最多三个非空值。
- 一项显示一项，两项显示两项；没有属性时不输出属性容器，不再补“待补充 / Not provided”。数字 0 正常显示。
- 图片、视频、其他模型的字段和已退役的兼容字段不参与展示。
- 已有字段的十种语言名称和单位集中保存在 `apps/home/controller/product-spec-labels.json`，不再分散在十套列表模板里。新增字段没有词条时直接显示 PB 字段说明及数值，不会因缺少模板映射而漏掉。新增字段的翻译与单位可在此公共字典补充，不会自动翻译。

PB 字段定义本身没有管理项目的 `enabled` 标志。本规则按 PB 实际字段及非空数值展示，不读取管理项目私有配置；管理项目中关掉字段不会自动清除已有 PB 值。要改变网站属性，需把字段排序、产品字段值同步到 PB。只改管理项目中的资料、尚未同步到 PB 时，网站仍读取原有 PB 数据。

这次修改只影响产品列表卡片，产品详情页保持原有全部属性展示逻辑。

## 后续操作

修改产品数值或新增字段后，将字段定义及数据同步到 PB，再发布 PB 数据库即可；不必逐语言修改列表模板。图片与模板文件仍按网站文件单独发布。

首次上线通用功能需要同时发布以下 PB 文件，之后清理 PB 页面缓存：

- `apps/home/controller/ParserController.php`
- `apps/home/controller/ProductSpecsRenderer.php`
- `apps/home/controller/product-spec-labels.json`
- `apps/home/model/ParserModel.php`
- `template/comm/home-products.css`
- 十种语言的 `template/{cn,en,es,fr,ar,pt,ru,id,vi,tr}/html/comm/home_product_specs.html`

仅发布管理项目代码或 PB 数据库不会安装这次的 PB 渲染功能。PB 升级时应保留 `ParserController` 中的 `product_specs` 分支和 `ParserModel` 中的 `getProductSpecFields` 方法。

## 验证

运行 `php tools/test-product-list-specs.php <PB网站根目录>` 验证无属性、1/2/3/4 项、零值、排序、新字段无映射、非属性排除、HTML/PB 标签转义及十种语言名称单位。

本地 HTTP 验证覆盖十种语言的首页、光伏打桩机列表和配件列表：光伏列表每张卡片实际输出三项且包含 13000 N·m；配件页无空属性容器；首页无占位行。未修改数据库或线上文件。
