# 书源 JS 精简与 common v3

2026-11-07 创建，2026-11-08 续验；基线 `b9c1341`，分支 `feature/shared-common-all-sources`。108 个 canonical 源已生成 v3；本地测试通过，完整实机验收尚未完成。没有改 App/calibre，没有覆盖另一台手机的原源/原书缓存。最新补修、HTML 使用统计和实机状态见文末 2026-11-08 节。

首版实现已 check in 为 `b75c199`（`Simplify all source JS with shared common v3`）；随后补充了 IEEE 异常边界审计，当前源使用下面的新公共 SHA。工作分支未推送。

## 改动与发布

- 加载器两行：惰性 importScript + eval，成功后缓存 API；调用为 `common(java).TH/TT/...`。去掉 factory、桥接、版本检查和异常包装，调用者/设置明确传入。
- 38 个 UI、34 个标准登录脚本、28 个验证脚本接入 common。保留 UI 顺序/默认值、真实登录 URL、未知自定义函数和动作，不将手机登录信息复制到 canonical。
- 去掉最终正文图片/链接的重复补域名与 image_base_url。保留 lazy/srcset/picture/anchor 选择，图片在 usehtml 外，原生 Formatter 解析相对 URL；实际请求/跨页资产仍正确解析地址。
- 补充去掉 Carnegie Mosco 正文背景图和中国社会科学期刊同页封面的重复解析。BookInfo 最终调用原生 NetworkUtils，正文最终调用 Formatter；9 个剩余 resolveRequest 用于跨页资产/真实请求、HTTP-only 镜像转换或分页去重，不是重复的最终图片处理。迁移器只改完整指纹匹配的两个函数，用户编辑过的函数保留。
- 已核对的大段 WebView 翻译改成公共 DOM 清理/Readability，正文只翻译一次；迁移器按完整 AST 指纹匹配 33 个旧脚本，未知/编辑过的长脚本保留原样。旧 Russtrat、RISS、Test、Oxford 翻译也统一；Oxford 先提取访问权限脚本，再处理正文。
- 通用 Jsoup Readability、RSC 恢复、WIRIS SVG renderer 移入 common。RSC 只解码 JSON 字符串，保留 TeX 反斜杠；公式保持 SVG 别名/原位，不转 PNG。
- 去掉宽泛吞错/伪造空目录。网络 I/O 与服务无效响应保留原文，选择器/JSON/类型/脚本错误直接抛出；IEEE 的已核对 REST/签名服务回退保留，程序错误不再被吞掉。
- 收尾审计发现 IEEE 三个网络 catch 仍豁免所有 SyntaxError，已改为直接 networkError：ajax/cache 的 SyntaxError 和 TypeError 均原样抛出。只有明确的外部 JSON 解码使用 common.serviceJson；无效服务数据返回 null 并记录通用诊断，缓存 JSON.parse 仍报错。签名 URL 的字符逐字不变。
- common 的网络错误边界也保留 null/undefined 等原始抛出值，不生成二次 TypeError。调试工具排除输入请求 URL 的回显后再判断错误、完成标记及 HTML 计数；故意构造的测试异常不再被回显误判，真实运行异常仍报错。

当前公共发布：`47c94d927ecbefbea6c3f828ecdb522918bd2b5d`，父提交 `0fa34494c322b71172bd5e11f1897a570c319364`，只修改 `booksource/runtime/legado-shared-runtime.js`。没有发布 sites 模块、工作分支、手机源或凭据。固定 raw URL 已下载并逐字节一致，94,366 bytes、SHA-256：`4b7ad2874b146b1e3f1602a3b619749f0bdc82155db333d059dd09f36c59780f`。此前 `0fa3449…` 的父为 `16908f51298880d881471b20b828d9961492efb6`，raw SHA-256 为 `405cc00a865fa357a57830c74670abf921c02f7a16a87ec213538789bceaf677`；首版 v3 公共 SHA 为 `2a746411dff84335ff5e6fe249d2dfdd2cb42d0e`（其父为 `09ab5cf52b7d089b618583af9ca98c16e4676116`）。旧固定 URL 不受补丁影响。最新补审见文末。

## 体积与保全

2026-11-07 版按各源 JSON 对象序列化计，总量从 5,020,914 降至 540,859 bytes（约减少 89.2%）。字段 UTF-8 字节数：

| 字段 | 原值 | 新值 |
| --- | ---: | ---: |
| jsLib | 382,620 | 95,269 |
| loginUrl | 16,569 | 3,765 |
| loginUi | 29,762 | 6,131 |
| loginCheckJs | 48,205 | 1,995 |
| ruleContent.content | 161,508 | 69,824 |
| ruleContent.webJs | 3,690,469 | 13,436 |

33 个大 webJs 已移除重复库。108 个身份/顺序、启用与类型、非 JS 字段保留；burl、datestr、移动阅读 bookSourceComment 中的真实 DES 代码保留。两处既有代码错误定向修复：Russtrat 封面全角括号/错误 DOM 操作，移动阅读 getSource 中零宽字符。网站封面/登录/权限未因此自动算验收通过。

## 初版本地验证（2026-11-07）

- `node --test tools/tests/*_test.js`：90 tests，通过，0 skipped。
- 真实 HtmlUnit Rhino fork + Jsoup + Kotlin RuleAnalyzer：1488 checks，通过；108 库惰性初始化，969 段规则/UI action 实际编译。
- 编译实际 HtmlFormatter 及提取的原生 NetworkUtils URL 方法（只省略无关 Android 网络/日志依赖），验证 //、根路径、../、懒加载、srcset、picture、签名查询和 URL 选项。
- 验证原始 IEEE 9737357 TeX 安全编码、usehtml 解包/重复处理、SVG 别名、调用者隔离、明确选项、错误抛出、Jsoup/RSC 正文恢复、WIRIS MathML/SVG。
- `python3 tools/validate_translation_sources.py`：108 v3 源；54 正式翻译源，48 HTML / 6 JSON TOC，54 公共正文规则；同一固定 SHA。
- `python3 tools/test_runtime_only_sync.py`：4 tests，通过；旧同步工具不重写网络化源。

新 SHA 的 108 源已生成；相对首版只改加载器/WebView 固定 SHA、IEEE 正文异常边界和上述两处最终图片地址，其他字段不变；同一 SHA 的完整重建幂等。最新离线候选在 `booksource/.usehtml-validation-phone/source-js-simplification-20261107-native-output-v1/`，上一阶段候选在 `source-js-simplification-20261107-service-json-v1/`。手机输入复用原机既有备份，仅供本地生成：刻意不提供部署所需的 snapshot-summary.json。原机恢复后必须完整重新备份/生成，不能把旧基线候选直接部署。

## 实机状态与继续条件

localhost:1122 返回 ECONNREFUSED。按用户授权改在 `10.92.24.102` 做独立样本；完整 114 源备份/revision 核对、创建后 115 源读回和原 114 源哈希保全已通过。没有把 localhost 的候选部署到备用机。

测试清理已完成：本轮拥有的短验证源已删除，完整回读核对原 114 源未变。本轮没有创建 HTML/TEXT 验证书，也没有删除用户原书或旧验证源。提交前重新运行本地回归，83 tests、1474 引擎 checks、108 源结构校验及 4 个同步回归均通过，0 skipped。

首版 v3 的备用机 HTTP/WS 正常：固定 SHA 的直接 ajax 下载约 0.77 秒，下载 + eval + 图片 helper 约 0.92 秒，版本 3，完整脚本 93,445 字符。原生 importScript 55 秒/25 秒超时，独立 cache.get 25 秒超时，未到正文完成/metrics。

只读线程投影确认 CacheManager.get 的全局锁被另一线程持有：该线程在持锁路径内等待 AnalyzeRule.ajaxAll；21 个缓存入口线程阻塞，importScript/登录/正文缓存均在等待。不替换加载器来掩盖全局缓存问题，不中断用户线程、不反射绕过限制、不修改 App。

提交后在备用机新建独立短样本复查，HTTP 200，WS 只读线程投影 552 ms 完成；同一持锁线程仍等待 ajaxAll，22 个缓存入口阻塞。没有再向缓存入口追加挂起请求，也没有创建测试书。随后删除本轮短源，并完整回读核对原 114 源未变。私有证据目录为 `booksource/.usehtml-validation-phone/source-js-simplification-20261107-10-92-smoke-v3-followup1/`。

service-json 阶段再核对一次：线程投影 596 ms，仍为同一持锁线程、22 个入口阻塞。`16908f5…` 的直接 ajax 下载 + eval + 图片/外部 JSON/输入转换异常检查通过，1,219 ms，93,790 字符；请求回显产生的误报已用原始证据重新核对，运行完成且无真实异常。这不证明正式 importScript 或书籍缓存通过。样本已清理，原 114 源未变；证据在 `source-js-simplification-20261107-10-92-smoke-v3-service-json1/`。

最终 `0fa3449…` 样本的 ajax 下载 + eval 及图片/外部 JSON/输入转换/原始 null 异常检查通过，938 ms，93,794 字符，正文调试解析完成且无异常。只读线程复查 570 ms，仍为同一持锁线程和 22 个入口阻塞；未增加新的缓存挂起请求，未创建测试书。最后删除短源并全量回读，原 114 源未变，证据在 `source-js-simplification-20261107-10-92-smoke-v3-final1/`。本轮再次运行 email-followup doctor 仍返回 Outlook HTTP 401，未启动等待/发信；手机恢复仍需要本人处理。正式 importScript、书籍缓存、SVG 图片端点、WebView 及三站点新版本验收均未完成，不能用直接 eval 成功替代。

需要重开阅读 App 解除缓存锁，再复跑独立样本：真实 importScript、UI/设置、HTML/TEXT、缓存重读、SVG 渲染、WebView common，随后 Nature/求是/IEEE 真正文。通过前不批量部署。原机恢复后先确认最新源与备份一致；如有用户改动重新备份/生成，不用旧快照覆盖。

按阻塞处理要求读取并尝试 `email-followup` 技能预检。Python 3.12.3 及原生等待工具可用，但现有 Outlook 配置的只读 doctor 返回 HTTP 401，临时关闭代理的检查也返回 401。邮件流程未通过预检，因此没有发请示/结果邮件、没有启动原生等待或邮件查询 worker、没有修改认证/全局配置。需要本人在 console 告知已重开 App（可强行停止后重开，无需清理数据），或恢复 localhost 的 1122/1123 后继续验收。

本次私有目录：`booksource/.usehtml-validation-phone/source-js-simplification-20261107-v1/`（原机备份/108 候选）和 `source-js-simplification-20261107-10-92-smoke-v3/`（备用机备份/独立样本/诊断）。正文缓存/完整 EPUB/MOBI 不属于本轮修改；旧 EPUB/calibre 证据不作为 v3 新实机通过证据。

## 2026-11-08：缓存恢复、补修与 HTML 使用审计

两台设备的 HTTP 重新检查均为 200。localhost 完整读取 109 个原源，revision 前后稳定，108 个目标齐全；线程投影无 CacheManager 入口阻塞。正式 `common(java)` importScript 短样本 1,332 ms 完成，v3、调用者隔离、原始 TeX/规则解析、SVG 别名、相对图片 URI、usehtml 解包/重复处理、UI/设置和原始异常边界均通过。

原机独立 HTML 书正文 765 字符，缓存重读完全一致，原生 Formatter 正确解析 `//`、相对目录和根路径图片；显式 TEXT 书无 usehtml/标题标签，保留 SVG 别名并重读一致。公式经原生图片端点返回 HTTP 200 PNG，640×101、9,919 bytes，SHA-256 `bda592759551dc6fb5e6a35b91cdaba4c6ac6b5767aa2a56600beab9b2f7f68b`。这证明 SVG 请求选项/渲染路径，不把 PNG 接口输出误称为 SVG 缓存或新 EPUB 导出。

本轮发现并补修两处实现遗漏：

- IEEE 正文仍保留 `typeof ltUseHtmlBlocks === "function"` 三元判断，函数移到 common 后全局名不存在，会跳过包装。迁移器现移除已匹配公共调用的三元判断；实际 IEEE render 尾段回归验证默认 HTML、显式 HTML/TEXT，保留加载异常。无旧 runtime 的可选 TH 三元分支仍只接图片处理，未知函数/附加条件不按名称猜测删除。
- 33 个普通 URL WebView 的 webJs 原来调用 `java.importScript`，而该路径没有 Java bridge。现改为浏览器自身 CORS GET 固定 SHA、eval/cache API，再调用 webClean，仍为两行。只替换完整已审计程序，站点选项保留；附加的用户代码不猜测改写。HTTP 非 200、CORS、DOM 选择器错误不伪造成功。

相对 `9c0abca`，canonical 只改 34 个源：33 个 `ruleContent.webJs` 和 IEEE 的一个 `ruleContent.content`，其他字段、身份、顺序和启用状态保持。当前总对象量 547,722 bytes，相对原始 5,020,914 bytes 减少 89.09%；额外体积是明确的浏览器加载步骤，不再复制大库。公共 runtime 文件和固定 SHA `0fa34494c322b71172bd5e11f1897a570c319364` 未改，没有新发布/推工作分支。

最新回归：97 tests 全部通过、0 skipped；1488 个实际 Rhino/Jsoup/Kotlin RuleAnalyzer/原生 Formatter/NetworkUtils 检查，969 段规则/UI action 编译；4 个同步回归及 108 源 validator 通过。新增隔离真实 Chrome 测试使用逐字相同的本地公共库和两个 HTTP 端口，验证真实 CORS、无 Java bridge、API 重用、Readability/标题/原文保留，以及 HTTP 403、无 CORS、无效 DOM 选择器的失败边界。它不证明 Git 网络或手机 Native WebView 已通过。

### usehtml 到底有多少源

这是正文规则配置统计，不是关键词出现在公共库里的次数，也不是所有书籍缓存的实际模式。全部 108 个 canonical/手机目标中，只有 **IEEE 1 个**显式调用 HTML 包装；原机 109 个原源中另有旧独立验证源 `Common HTML/SVG 短验证 v1-601e872160a1`，因此含该测试源为 2 个。本轮自建临时样本不计入正式源，已清理。

| 源 | 显式 usehtml | 当前行为 |
| --- | --- | --- |
| IEEE | 是 | 默认 HTML，可按书/设置选择 TEXT |
| Science | 否 | TH 翻译后是裸 HTML，无渲染模式 UI |
| Nature | 否 | TH 提取/翻译，保留原来的 TEXT 行为 |
| 求是网 | 否 | 只处理图片，不新增翻译或富文本 |
| ScienceDirect | 否 | TH/MathML 图片处理，不包装标题 |

Science 已从 localhost 新鲜回读，与本轮完整备份无差异，仍为 v2，未部署本次 v3。它提取 main/article，选择文章体，再 TH；TH/TC 保留中间 DOM 供翻译，但不自动插入 usehtml。BookContent 只暂存 usehtml 片段，随后 `HtmlFormatter.formatKeepImg` 把裸 h1–h6 变成换行并去掉标签，最后仅恢复暂存的包装；TextChapterLayout 也只为 usehtml 调用 `setTypeHtml`。因此当前 Science 不能显示这些标题层级，这不是 common 网络加载失败，也不是本轮简化才引入的问题。

如需改变 Science 的行为，应在正文 TH 后显式调用 `common(java).ltUseHtmlBlocks(result,java)`，保持图片在包装外，并开启 App「适配特殊样式」。共享库可支持这个入口，但没有擅自为 Science/其余 107 个源改变默认格式；旧正文缓存也不会自动变成富文本。

### 剩余实机阻塞与已清理范围

localhost 的 Native WebView 没有返回：嵌套 bodyJs、正文规则 `java.webView` 最小无库对照均超时；收敛到生产用的 URL `webView:true`/`webJs`、仅手机自身 HTTP、无外网/无库对照仍在 25,288 ms 超时。没有取得 browser metrics，不能算通过或把 Chrome 证据替代它。线程投影仍为零缓存入口阻塞，因此不能把原机这个现象继续归因于昨天的缓存锁，具体 WebView 运行原因尚未确认。下一步需要本人将原机阅读强行停止后重开、保持亮屏/前台、重新启用 Web 服务；不要求清理数据。

备用 `10.92.24.102` 完整独立备份/读回 114 个原源不变；只读投影仍为旧线程 7830 持锁等待 ajaxAll、22 个缓存入口阻塞。其 `java.webView` 会隐式读 getLoginHeader/cache，不能作为无缓存/纯浏览器证据；没有再做正式 importScript 或书籍缓存探测。未向备用机部署 canonical，也没有创建测试书；最后删除本轮拥有的短源并全量核对原 114 源不变。

原机两批短源/HTML、TEXT 测试书也已清理，完整回读原 109 源哈希不变，原书身份/来源保全。三个网站本轮仅做公共 curl：Nature 与求是正文 HTTP 200，IEEE 文章页 HTTP 202、空响应；没有把这些或旧实机结果当作三站点新版本规则验收。优先三源和 108 源部署尚未进行。

本轮按 `email-followup` 完整读取技能、定位脚本并验证 Python 3.12.3；只读 doctor 仍返回 **Outlook MCP HTTP 401**。预检不通过即停止邮件流程：没有创建请求 STATE、没有 await_owner/worker、没有请示或结果邮件、没有修改认证/全局配置。需要本人通过 console 恢复手机后继续。

私有证据均在 `booksource/.usehtml-validation-phone/`，目录 700/文件 600：`source-js-simplification-20261108-local-v3-run1/` 是首阶段备份/候选，已被 `source-js-simplification-20261108-local-v3-run2/` 的最新完整备份/108 候选替代，不能再部署 run1。短样本证据为 `source-js-simplification-20261108-local-v3-smoke1/`、`source-js-simplification-20261108-local-v3-web2/` 和 `source-js-simplification-20261108-10-92-web-v3-1/`，均已清理。恢复后先确认手机没有用户新改动；有则新建完整备份/重新生成，不复用旧目录的 --write。

## 2026-11-08 补审：漏网 Readability 与原生超时窗口

PMA search 的 jsLib 仍有未被规则调用、但供手动调试的 `auto_clean_up`，其中内联约 43 KB Readability。其 62 个 prototype 成员与公共库只差三处先前精简掉的吞错 catch，构造器相同。现按原始/精简后完整 AST 指纹替换为小委托函数：保留名称、原文 DOM 操作与 module.exports，使用公共 browserReadable 的 strict 模式；未知修改保留原函数。普通 webClean 的第三方畸形属性兼容处理不变。没有只因该函数暂无规则调用就删除公开调试入口。

PMA jsLib 从 45,532 降至 2,419 bytes；全部 108 源当前总对象量 502,891 bytes，相对原始 5,020,914 bytes 减少 **89.98%**。相对 `f9abef9`，统一替换固定 SHA 后只有 PMA 的 jsLib 有语义差异，其余源字段原样保全。38 UI、34 标准 login、28 loginCheckJs 仍为公共调用；剩余 15 个 loginUrl 是 13 个真实站点 URL 和 2 个自定义脚本，未冒充通用设置替换。正式 usehtml 统计仍只有 IEEE 1 源，未改变 Science 或其他源的默认显示模式。

新增真实隔离 Chrome 对照：旧 helper 与新 helper 连续调用两次后的正文 DOM 逐字相同，标题/段落/图片/锚点保全，公共库只读取一次，module.exports 仍为函数。URL、title getter、setAttribute 三种原始 TypeError 均按对象身份原样抛出；普通 webClean 保留原第三方兼容行为。未知附加代码、固定 SHA 升级和重建幂等单独覆盖。新 SHA 生成后的最新完整回归为 **100 tests、0 fail/skip**，真实 Rhino/Jsoup/Kotlin/Formatter/NetworkUtils 仍为 1488 checks、969 段规则/UI action 编译；108 源 validator（54 正式翻译源、48 HTML/6 JSON TOC）与 4 项同步回归均通过。

补审发现先前无库 Native 对照的 WS 客户端仅等 25 秒，早于 BackstageWebView 默认 60 秒；URL 的 timeout 实际只约束 HTTP 读取。工具已去掉误导的 HTTP timeout 参数，两个 Native 分支均留 75 秒，且调试摘要保留 TimeoutCancellationException。新独立样本访问手机自身 HTTP、不加载库或外网，在 **60,296 ms** 正常关闭 WS 并返回 `kotlinx.coroutines.TimeoutCancellationException: Timed out waiting for 60000 ms`；客户端 timedOut=false、没有 browser metrics、正文未完成。这是真实 Native 期限到期，而不是再次把客户端取消当根因证明。具体 WebView 未回调原因仍不明，尚需本人恢复 App；没有把它归因于公共库下载。

公共发布 `47c94d9…` 只推进 common-runtime，raw 与已测试文件逐字节一致。localhost 的新 SHA 正式 importScript 短样本 **1,349 ms**、全部指标通过，新增 browserReadable API 在 Android 实际初始化；调用者隔离、TeX/规则解析、SVG 别名、相对 URI、HTML 解包/重复处理、登录/UI 和原始异常均通过。它不证明 Native 浏览器调用、新书缓存或新 EPUB；旧 `0fa3449…` 的缓存/图片证据仍只标注旧版本。

最新完整 109 原源备份与 108 候选在 `source-js-simplification-20261108-local-v3-readable1/`，含已生成的 IEEE/Nature/求是三源 priority 候选及公共发布逐字节验证；替代 run1/run2，旧候选不能部署。独立保全检查 3299 项，108 源身份/启用/类型/登录变量/非 JS 字段保全，canonical 与 phone candidates 重建均幂等。当前只有 IEEE 正文及七猫分类数据超过 10 KB，不含嵌套 Readability 副本。Native 期限证据在 `source-js-simplification-20261108-local-v3-native-window1/`，新 SHA 短样本在 `source-js-simplification-20261108-local-v3-readable-smoke1/`；没有创建书籍或部署 canonical，两个短源已分别 cleanup 并完整回读验证原 109 源不变。恢复后仍需先核对用户是否修改源，有变化则新建备份/候选，不复用 --write。

email-followup 仍按已有 401 预检失败停止，未重复轮询 Outlook、未启动等待/worker、未发请示或结果邮件。Native/三站点/108 源部署未完成，不把公共发布和本地/短样本通过当作目标完成。
