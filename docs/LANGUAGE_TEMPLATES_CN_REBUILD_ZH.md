# 本地多语言模板按 CN 重建

2026-09-22：以 `E:/phpstudy_pro/WWW/shanbo-rig.c/template/cn/html` 为基准，重建 en、es、fr、ar、pt、ru、id、vi、tr 共 207 个 HTML 模板。旧 HTML 模板在全部替换内容校验通过后删除；英文原有的额外 `comm/v.html` 不再保留。图片、数据库业务内容和线上环境不在模板替换范围内。

各语言使用相同的页面结构、表单处理及参数字段；译文保存在 `tools/language-template-translations.json`。栏目编号按当前 PB 库中的语言和栏目 URL 对应关系转换，不能直接沿用 CN 编号。列表显示前三个参数位置，不足时显示已翻译的待补充提示；详情显示所有已填写字段。数据缺失不会自动复制 CN 数值，例如本轮其他语言 DTH30C 的扭矩字段仍为空。

本地 PHP 原有语言自动切换只更新 cookie，视图已在构造阶段选择旧语言，导致首次直达其他语言页面出现语言混用。本轮同时修复：

- `apps/home/controller/IndexController.php`：列表、详情和单页自动切换后同步主题，并保留手机版主题判断。
- `core/view/View.php`：增加专门的主题设置方法，允许解析前更新主题；其他模板变量仍禁止重复注入。
- `core/basic/Controller.php`：主题设置调用该专用方法。

复用命令（在管理项目根目录运行）：

```powershell
python -X utf8 tools/rebuild-language-templates.py
python -X utf8 tools/rebuild-language-templates.py --write
node tools/verify-rebuilt-language-templates.cjs
```

第一条仅校验；`--write` 会删除并重建以上九种语言的 HTML 模板，不能用于保留语言模板中的独立改动。先更新 CN 和翻译字典，再执行。`--extract-legacy` 和 `complete-template-translations.py` 是首次提取旧译文的辅助步骤，正常重建不应再次执行，否则可能覆盖人工校正的译文。

验证包括模板清单、语言栏目映射、include、HTTP 页面、内嵌 JavaScript、表单成功回调模拟、三项列表参数及跨语言首次访问。真实留言入库未作为验证操作。另在浏览器检查英文桌面列表、英文手机目录和阿拉伯语手机列表。所有操作均为本地，未部署。

????????AR ??? CN ????????????`lang="ar" dir="ltr"`??????????????? RTL ??????? Owl ?????????????????????????
