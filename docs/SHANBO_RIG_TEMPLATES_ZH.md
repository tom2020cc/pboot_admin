# 山铂钻机中英文模板维护

## 目录方式

参考源站：`E:/phpstudy_pro/WWW/shanbo.c`。
实际修改站：`E:/phpstudy_pro/WWW/shanbo-rig.c`。
源站文件保持不动；没有修改 Pboot 核心代码或数据库表结构。

```text
template/
  cn/html/             中文页面、中文 comm 局部文件
  en/html/             英文页面、英文 comm 局部文件
  comm/
    about.html
    language.html
    m_language.html
    page.html
    videos.html
static/tem/             两种语言共用 CSS、JS、字体和模板图片
```

与原站相同，每种语言的 html 目录保持 22 个模板文件，根公共目录保持 5 个文件。
旧的 cn/html/shared 引用已取消，static/cn-template 不再被模板使用。

## 公共引用

语言模板通过 `{include file=/template/comm/about.html}` 使用公共页面。
公共页面内部的 `{include file=comm/head.html}` 等相对引用，
由 Pboot 按当前主题解析到 cn/html/comm 或 en/html/comm。
因此公共结构只改一处，导航文字、栏目编号、询盘文案仍属于各自语言。

视频列表数据的栏目编号保留在 cn/html/videolist.html 与 en/html/videolist.html，
公共 videos.html 只负责展示，不再依赖源站的静态视频数据。

## 栏目对应

| 用途 | 中文 scode | 英文 scode |
| --- | --- | --- |
| 关于我们 | 1 | 48 |
| 新闻 | 2 | 49 |
| 产品总栏目 | 5 | 52 |
| 视频 | 8 | 55 |
| 联系我们 | 11 | 58 |
| 水井钻机 | 15 | 62 |
| 岩芯钻机 | 19 | 66 |
| 潜孔钻机 | 20 | 67 |
| 光伏打桩机 | 21 | 68 |
| 桩基钻机 | 22 | 69 |
| 配件 | 24 | 71 |
| 分体式岩芯钻机 | 43 | 90 |
| 一体式岩芯钻机 | 44 | 91 |

英文主题配置为 en，中文主题仍为 cn。
英文栏目 URL 名称增加 en- 前缀，避免 Pboot 按重复 URL 命中中文栏目。
31 个英文栏目在项目后台的 href/urlName 也同步更新，编号与父子关系未变。
英文关于、联系页面沿用站内已有英文正文；没有重新生成产品内容。
目前前台语言切换只开放中文、英文。其他语言的后台内容仍保留，
待对应主题和模板完成后，再加入公共语言菜单。

## 产品参数与图片

模板直接读取已有 PB 扩展字段，不创建公共参数表或修改 CMS 结构。
岩芯钻机展示 ext_drill_depth、ext_core_capacity、ext_param_7801907f4e874d29。
取芯能力按字符串展示，例如 BQ 1600 / NQ 1200 / HQ 700。
水井分支展示钻深、钻径和已约定的扭矩字段；空字段不输出。
目前实际数据验证覆盖岩芯机型，水井扭矩字段有数据后需再核对。

主图样式在 static/tem/css/p.css：
没有固定像素宽高，也不锁定 1:1 或 5:4。
宽度随可用栏目空间自适应，高度按原图比例自动撑开，不裁切；
手机端不超出页面。视频 iframe 保留视频自身的 16:9。
Swiper 使用 autoHeight，图片加载和轮播切换后自动重新计算高度。
中英文 product.html 为该样式附带版本号，避免旧浏览器缓存继续裁切图片。

## 检查与备份

在项目根目录运行 `node tools/verify-rig-templates.cjs`：
检查中英文栏目、模板引用、静态资源、内联脚本语法，
以及 PB 表结构和已有产品字段未变（忽略浏览测试增加的访问量）。
当前检查覆盖 71 个页面、391 个内联脚本，全部通过。
另已实际检查桌面与手机端主图比例、参数、轮播操作。

备份：`E:/phpstudy_pro/WWW/pboot_admin_center/backups/cn-en-shared-template-20260905-133343`。
包含旧模板、旧静态资源、数据库快照及本次配置变更记录。
需要回退时按变更记录恢复对应字段，不要整库覆盖后续新增产品。

修改模板后使用 PB 后台的“清理缓存”；修改 CSS 后同步调整引用版本号。
网站原有社交标签中 Instagram/TikTok/YouTube 仍配置为百度翻译地址，
这是后台内容配置，未擅自替换为猜测的社交账号。

