# IEEE 非 WebView 公式朗读修复

手机：10.92.24.102。目标文章：https://ieeexplore.ieee.org/document/11753535。

## 已实现

- TH 新增布尔选项 formula_speech，默认关闭，仅 IEEE 正文开启。
- 清理成对的外层美元符号及括号分隔符；内部转义、公式环境和编号保持原样。
- Codecogs SVG 后追加可见的 span.formula-speech.notranslate，朗读来自 MathML 接口的 .cc-speech。
- 公式去重，最多四路并发，波间隔 500 ms；成功朗读按规范化 TeX 缓存 30 天。失败保留 SVG 和语义/MathML/TeX 回退文本，不缓存失败。
- tools/migrate_translation_sources.py --runtime-only 仅同步 54 个正式源的运行时后缀，不恢复旧登录信息或规则；旧源及测试源保持不变。

## 验证和部署

离线运行时测试、安全同步测试、IEEE 正文校验、全正式源校验及七个六源修复回归均通过。同步再次执行为零变更。

手机已保存版本验证：126 个行内公式、12 个显示公式，138 张 SVG 均有相邻且非空的朗读文本；96 种 TeX 均取得英文朗读。首次处理约 21 秒，缓存后约 0.5 秒、零次朗读请求。服务失败、嵌套公式、重复处理及默认 Codecogs/WIRIS 行为亦通过。

手机仅修改 IEEE 的 jsLib、ruleContent.content，字段回读一致，其他书源未改变。私密备份保存在工作区之外。

回归入口：LEGADO_PHONE=10.92.24.102 node tools/test_ieee_formula_speech_phone.js；追加 --saved 验证手机已保存的代码。该脚本不保存书源，模拟翻译结果只使用内存缓存，不污染真实翻译缓存。

## 原生完整下载验证（认证刷新后）

首次原生 debug_source 验证被现有 loginCheckJs 拦住并提示“IEEE 需要手动认证”。用户在手机通过 SourceUrl 完成认证后，重跑原生正文调试成功，日志确认“正文页解析完成”，约 10.8 秒完成。没有修改或绕过认证检测。

原生正文包含 138 张公式 SVG，URL 中外层美元符号为零。逐个对照 96 种公式的成功朗读缓存，全部 138 张 SVG 后都完整保留对应英文朗读文字。阅读器格式化会去掉 span 标签及其 class，但不会删除朗读文本。

标题及摘要元数据回退成功，正文内目录含 7 项，12 张媒体图片成功取得签名 URL。原生下载、公式渲染和朗读文本链路验证完成，无剩余认证阻塞。旧章节缓存仍需用户刷新才会展示新正文。
