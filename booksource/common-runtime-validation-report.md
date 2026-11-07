# Common-only 公共库发布与手机验收

2026-11-07。只共享公共库，站点代码和手机私有资料不发布。

## 已发布与部署

- 分支：`common-runtime`。
- Commit：`70fac1ccb404e67fcfd426066a412620b2ee22cf`。
- 唯一发布文件：`booksource/runtime/legado-shared-runtime.js`。
- 固定 URL：`https://raw.githubusercontent.com/wanghaosjtu/booksrc/70fac1ccb404e67fcfd426066a412620b2ee22cf/booksource/runtime/legado-shared-runtime.js`。
- `master` 保持 `32d90338ca4907e15644a54793f65dd8afa83208`，没有发布 `sites/ieee.js`、手机源或调试资料。
- 本地 canonical 和 localhost 手机只迁移 IEEE、State.gov、China Daily；三个源完整读回一致，其他 105 个源对象不变。
- 手机另有一个独立短验证源和单章验证书，供本人导出完整 EPUB；它不属于正式试点，不发布到 Git。

## 已通过

- 14 项回归测试，零失败、零 skipped；其中真实 Rhino/Jsoup/Kotlin RuleAnalyzer 验证 26 个断言。
- 校验 54 个正式翻译源，包含 3 个网络 common 试点；其余内联源不变。
- 手机真实 `importScript`、factory 初始化、版本检查、调用者/语言隔离、源内联公式配置。
- 真实 IEEE `d\mathrm{snr}` 公式经手机请求规则解析后逐字保留，未触发 `{{…}}` 插值或非法字符。
- 独立验证书下载正文并重读，内容完全一致；标题/blockquote 分段保留 HTML，公式留在原位置。
- 独立 TEXT 实机验证通过：只修改临时书籍的渲染变量，不修改正式源或原书；正文没有 `<usehtml>`/标题标签，公式 SVG 别名保留，缓存重读一致。临时 TEXT 验证书已删除，HTML 验证书保留供导出。
- 完整 URL 选项通过手机图片接口成功渲染真实公式；读回原生缓存，确认后缀 `.svg`、内容 SVG，9713 字节。
- 真实 IEEE `document/9737357` 全文：约 147.7 秒，215223 字符，104 个 HTML 标题片段、546 个公式 SVG 别名、25 个其他图片；无图片处于 `<usehtml>` 内，无剩余 `tex-math` 标签或脚本错误。
- China Daily 的真实目录/正文调试通过，目录原始规则命中 45 个节点。
- 本人提供的完整手机 EPUB 已通过 ZIP/CRC、SVG 路径/内容/OPF 类型和 calibre 6.0 实际阅读器验证，详见下一节。

## 手机 EPUB 与 calibre 验收

2026-11-07，本人提供 `common-runtime-validation_COMMON HTML SVG v1-601e872160a1.epub`。这是此前保留的独立单章验证书，不是本地合成文件，也不是 IEEE 整书。

- 原 EPUB SHA-256：`af5fc4ba9df67b6816d5a4a0fe414575715c43e52378a15aafd079d661d58998`；测试前后相同，没有修改原文件。
- ZIP 完整，11 个成员全部 CRC 通过；首项 `mimetype` 未压缩，值为 `application/epub+zip`。
- 正文图片引用 `../Images/58f0807c105899be.svg`，对应资源存在；归档内没有 `.latex` 文件。
- OPF 的对应 manifest 项为 `image/svg+xml`；图片是真正的 SVG XML，9713 字节、16 个绘图 path，`viewBox="0 0 259.65 41.22"`。
- 导出的 SVG 与先前读回的手机原生缓存逐字节一致，SHA-256 为 `66dbf795649ca6b4e7c76e31d762203b4fd0f06e9acb7565a2d6d20ad3956f75`。
- 原章 `h1`、`h2`、`blockquote`、末尾标记均保留；公式仍在原位置，不在 `<usehtml>` 内。
- calibre 6.0.0 的 `calibre.srv.render_book.render_for_viewer` 成功；转换后 manifest 继续将该图片识别为 `image/svg+xml`。
- 实际启动独立的 calibre `ebook-viewer` / QtWebEngine 6.3.1，读取手机 EPUB 的逐字节副本。SVG `complete=true`、原生尺寸 `260×41`，实际布局约 `224.875×35.688`；h1/h2 的计算字号分别为 32px/24px，blockquote 和章末也正常进入布局。
- 已关闭首次欢迎遮罩并目视核验截图，真实公式可见，不是坏图占位。无头测试环境缺少中文字形，测试标记中的中文显示方框；这不属于 SVG 或源规则错误。

兼容性边界：Legado 导出仍包含 `<p><usehtml><h1>…</h1></usehtml></p>`，并生成没有 XML 自闭合的 `<img>`，原章未通过严格 XML 解析。calibre 明确回退为 HTML/tag-soup 解析并成功显示；本验收不等同于 EPUBCheck 标准合规，也不保证所有严格 EPUB 阅读器都兼容。默认字体 CSS 的旧设备 `file://` / `res://` 引用也被 calibre 拦截，使用后备字体，不影响公式图片。

检查脚本、calibre 的独立配置/缓存、DOM 指标及 `calibre/viewer-final-screenshot.png` 均存放在 Git 忽略的本次私有资料目录，没有发布到 GitHub。

## 未通过或待验收

- State.gov：手机目录为空；服务器访问同地址返回 HTTP 403。书源的站点规则未改，记为站点阻断，不能算真实目录/正文通过。
- IEEE：现有固定期号目录地址/请求选项的原样调试返回空目录；未修改既有目录规则，不将全文通过等同于目录通过。
- IEEE 整书的实际 EPUB 尚未提供；独立单章样本的通过不代表整书每一张图片都已逐张验收。当前 common-only 发布、部署及单章完整导出验收已完成，不再被导出文件缺失阻塞。
- 旧 `_IEEE 802.11bn.epub` 缺 ZIP 尾目录，不能作为完整导出验收。

HTTP 没有 EPUB 导出入口，脚本安全策略屏蔽 App Context/Intent；今后仍由本人在 App 导出后提供文件，不尝试反射绕过，也不以本地模拟 EPUB 代替实际导出。

## 维护

维护步骤见 `Legado-skills.md` 第 8 节。升级公共库必须换完整 commit URL；首次加载需要联网。已有旧正文缓存不会自动重写成 SVG 别名，需要更新正文或重新下载后再导出。回滚只恢复本次备份的三个正式源，先核对当前源没有用户新改动，不清除原书缓存。

所有手机源备份、原始调试消息、公式图片和等待状态均留在 Git 忽略的私有目录；本报告只记录非敏感结论，不随本次公共库提交发布。
