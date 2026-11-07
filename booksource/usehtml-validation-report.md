# Legado usehtml 书源验证

> 历史阶段报告：下文保留当时的诊断与阻塞结论。后续 common-only 发布、localhost 新手机全文及完整单章 EPUB/calibre 验收已继续完成；当前状态以 [common-runtime-validation-report.md](common-runtime-validation-report.md) 为准。

更新：2026-11-06。

## 当前结论

**现有 App 已证明：下载正文可以保留 usehtml 内的 HTML，h1 可经过原生排版；IEEE 的真实 TeX 请求也可避免非法字符误求值。** 核心能力不必先编译 APK。

固定样本的 HTML 下载和缓存计数复用已通过；新增真实公式短样本的 HTTP 下载/重读、WS 完成标记、原生 h1 指标也通过。单张公式可经 App 图片接口正确返回 PNG。

这仍不是 IEEE/Carnegie 实站全流程、完整阅读界面或 EPUB 导出的验收。正式源和原书旧缓存未覆盖；没有为本次验证修改 Legado/Calibre 本体、创建 App 分支或编译 APK。

## 验证范围

| 环节 | 状态 | 证据与边界 |
| --- | --- | --- |
| 候选隔离、DOM、请求编码、HTTP/WS 工具 | PASS | 完整42项回归，无跳过；实际包装32项、公式解析器23项断言 |
| 旧 Rhino 公式兼容 | PASS | 4项、同样23项断言，含真实9737357公式 |
| 原翻译与公式朗读离线回归 | PASS | 公共 runtime 没有修改 |
| 固定样本 HTML 下载及缓存 | PASS | h1–h6、嵌套列表、强调、引用、实体、文本换行；首次/重读下载计数1 |
| 真实公式最小源 HTTP/WS | PASS | length637、首次/重读一致；WS322ms明确完成，1个usehtml和h1 |
| 缓存 HTML 的原生 h1 排版 | PASS（有限） | StaticLayout h1行高95、普通文字65、字号48；包装不显示为文字 |
| 单张真实公式图片接口 | PASS（有限） | 640×101、7288字节PNG，公式目视一致；不是整书内嵌图片验收 |
| IEEE 目录 | PASS | 125章，9737357实际index=1，标题已翻译 |
| IEEE 实站完整正文 | 未通过 | 最新原源及隔离源直连REST均45秒未取得正文；认证未证实恢复 |
| 真实全文保护编码回放 | 未通过 | 有效阶段日志进入546项公式准备，180秒未到首批请求；线程证据显示全局缓存锁等待链 |
| Carnegie 实站目录/正文 | 未通过 | 最近真实请求超时，尚无实站正文证据 |
| 翻页、选文/复制、搜索、朗读、全部样式 | 未验收 | 原生排版探针不能代替整个阅读页 |
| 手机 EPUB / Calibre | 未验收 | 尚未取得实际导出文件；仅完成源码风险检查 |

## 固定样本与缓存证据

主候选：`booksource/legado-usehtml-validation-candidate.json`，名称 `Carnegie endowment · HTML验证`。只改身份、显示名和正文尾部；部署使用私有手机快照，不覆盖正式源。

local 书用手机回环 HTTP 的 bodyJs 返回固定 HTML，不访问外网图片；所有文本标签标为 notranslate，目录标题预填翻译缓存。因此以下证据只证明文字结构和下载/缓存链：

- `http-local-after-toc-fix-first-v2.json` 与 `http-local-after-toc-fix-repeat-v2.json`：length1496、h1–h6完整，计数 UHV-FETCH-1，内容及摘要一致。
- `http-local-ws-after-toc-fix-v3.json`：WS真正解析完成，生成计数2；WS不保存正文。
- `http-local-after-ws-repeat-v3.json`：HTTP仍读到计数1的原缓存，不是WS新生成的2。

HTTP输出经过 ContentProcessor，不是直接导出原始缓存文件。上述计数与 `BookController.getBookContent()` 优先读 `BookHelp.getContent()` 的分支一致。

继承的 Carnegie 目录规则原来给已带 bodyJs JSON 的样本 URL 再加一段 webView JSON，导致“内容为空”。`tools/repair_usehtml_http_local.js` 只修正该 local 辅助源的章节 URL 提取，并只刷新其测试书目录；原候选、修复前快照及无关源均保留。

## 真实公式的完整短样本链

新源 `IEEE · HTML解析器短验证 44208843` 无登录信息。它用真实捕获的156字符导数公式，先重建原 JSON 请求并捕获非法字符，再用保护编码请求只读回环接口；最后输出保留 h1/TeX 的 HTML，跳过外部翻译和公式朗读服务。

- `ieee-parser-content-first-v1.json`、`ieee-parser-content-repeat-v1.json`：length637、内容/摘要相同，五项编码对照均true。
- `ieee-parser-ws-v1.json`：322ms、“正文页解析完成”、正常关闭。
- `android-html-parser-cached-probe-v7.json`：从该书缓存取得HTML，用 Android Html.fromHtml 和阅读器同类 StaticLayout；515ms正常完成，h1行高95>65，包装不显示。
- `ieee-single-formula-image-v1.png/json`：该实际TeX构造的Codecogs URL，通过测试书 /image 返回PNG。透明背景白底合成后确认公式正确；短样本正文没有img，不能据此声称原文图片已嵌入或整书缓存已通过。

较早 v3–v6 探针虽然测出本地中文 h1行高85>65，但后续断链、没有完成标记，不能当完整探针成功。新 v7 才同时具有指标和完成证据。其样本不含粗体、实体或下载计数标记，对应字段不作为失败或通过证据。

## 保留 HTML 的条件和限制

- 开启“适配特殊样式”；当前下载保护已实际生效。
- 前面的规则必须输出 HTML。末尾包裹不能恢复 @text 已丢失的结构。
- `booksource/runtime/legado-usehtml-validation.js` 保留正文 DOM、修正相对资源、去危险标记，解除重复包裹；使用 `&#10;` 保留块内文本换行。
- 已转义的 &lt;h1&gt; 不应再变成标题。
- 阅读器不是完整浏览器 CSS 排版，RSS WebView 的显示能力不能直接等同于下载书籍阅读器。
- `StringUtil.formatHtml()` 在 EPUB 导出中逐行套 p，没有专门处理 usehtml；存在非标准标签与块元素嵌套风险。未取得实际EPUB，不能把源码风险说成已验证失败。
- `../calibre/` 的 IEEE recipe 用 BeautifulSoup DOM 和公式图片处理保留结构；不代表 Legado 导出已具有相同行为。
- 已保存的纯文本缓存不会因书源新包裹而自动恢复HTML，本轮不刷新原书缓存。

## IEEE 转义和全文回放

补丁 `booksource/runtime/legado-usehtml-rule-json.js` 只编码 JSON 字符串中的规则分隔符，保留结构与解码值，包装原 _ltOptions，不二次编码图片URL。用户手加 usehtml 语法正常，不需要给 HTML 中的反斜杠再翻倍。它已在独立 IEEE 实验源部署，未修改公共 runtime 或正式源。

已登录的可见浏览器任务页面提供真实 REST 正文（HTTP200、366634字符、546个tex-math）和安全标题/摘要投影。没有导出、同步 Cookie 或签名凭据；被拒绝的 Cookie 导出没有执行，也没有间接规避。

完整原编码与保护编码回放保留原合并、公式、朗读和翻译流程，只回放已登记站点数据，签名媒体返回空。这不是认证恢复。旧两次回放在合并后1006关闭，不通过。

WS服务端的 socket 超时与 ping间隔均30秒，两套客户端均曾在该边界断开；现在Node和可选独立Python客户端主动保活。两次45秒Node探测发出4次保活，最终按客户端期限结束；未改服务端/Debug.kt。保护编码全文回放保活29次仍在300秒客户端期限结束，未取得正文完成结果。

更多对照、真实TeX与证据见 `booksource/ieee-usehtml-formula-report.md`。

## 状态保全与后续

最新 `phone-usehtml-cache-lock-verify-v8.json`：108正式源规则/配置不变，100个customOrder差异保留；4本原书仍在，原IEEE阅读进度两个字段差异保留。当前6实验源、9测试书；local/parser/两种replay各1章，ieee125章，其余0章。用户 canonical JSON 的已有改动、两份.orig及原有Android变更未覆盖。

临时 HTTP 样本服务器已停止。HTTP客户端退出不取消App下载，旧完整HTTP是否仍可能晚写入未知，所以不批量清理实验资源。新增短源和书已登记到严格身份/字段检查的清理逻辑。

本人已回复无法操作手机，不再重复同一手机认证请示。原源最新45秒没进入认证或公式阶段；不能归为确定的认证失败，也不能宣布认证恢复。总体任务尚未完成，未发送未验证的结果邮件。

复测不要重新建现有源/书。完整原规则、原生阅读页、批量图片及实际EPUB/Calibre仍需继续验证；如以后确需新信息或授权，再按本人请示流程处理，不因普通进度发送邮件。

本地入口：`tools/test_usehtml_validation.js` 与 `tools/tests/usehtml_*_test.js`、`ieee_usehtml_*_test.js`。设置 USEHTML_JAVA_HOME/JSOUP_JAR/ENGINE_JAR/KOTLIN_LIB；真实公式设置 USEHTML_IEEE_CAPTURE 指向已有私有响应。产物只写 /tmp。**不运行会批量写正式源的 test_translation_sources.js。**

## 最新只读诊断

本地 ajax/ajaxAll 对照469ms正常完成，批量返回1项，不能把全文等待归为普遍桥接死锁；未配置或修改原 IEEE 源限速。单公式 MathML 探测：1353ms；mathMarkup=2、speechMarkup=true，challengeHint=false。它不证明整个批次或整源通过。

该诊断只缩小阻断范围，原站、完整正文与整书验收仍没有通过。

## 本次后续定位：缓存锁阻断

当前完整回放候选登记为v3，仅更新实验jsLib，保留所有原正文处理、翻译与朗读开关和旧版本快照。第一次日志受jsLib独立作用域影响，已修正为显式桥接参数；不采用那次无日志的请求作定位证据。

有效180秒回放只到TH/formulas/speech:begin（546项），没有首批ajaxAll:begin。最新只读App线程投影570ms正常完成：19条缓存读取BLOCKED，线程7830在CacheManager.get内等待ajaxAll。请求头读取也受同一缓存等待影响；不能再把当前等待仅归为站点认证、公式反斜杠或普遍ajaxAll死锁。初始任务及具体Room调度原因尚未确认，手机方法反射不支持，不列为通过。

42项完整回归通过；最新phone-usehtml-cache-lock-verify-v8.json继续确认108正式源规则/配置不变、4原书及既有排序/进度差异保留。没有中断线程、重启App、清缓存或执行额外的手机缓存读取。实验资源保留。

需要本人明确授权后才能中断已核验的阻塞后台线程；这可能使其关联的目录/下载任务失败并放行其他等待任务。为这个新权限问题使用email-followup的console优先流程；不是重复此前手机认证请示。整体任务、完整原源、整书图片、原生阅读页及EPUB仍未验收完成，不发送未验证的结果邮件。

## 权限流程当前状态（2026-11-06）

一次email-followup原生持续等待已真实完成console宽限与单次发信，本次请示Message-ID已由Outlook确认。外部worker按60秒查信172次后，因邮件工具接口错误停止；没有模型轮询。当前没有经过校验的授权回复，不自动恢复、重发或再建请求，不发未验证的结果邮件。

等待后只读线程投影526ms完成，仍是19条缓存入口等待及线程7830在CacheManager.get内等待ajaxAll。没有中断线程、重启App或清理实验资源。后续邮件doctor只验证身份接口，不证明查信恢复。请在当前console明确授权恢复操作，或由本人重启App后再复测；整体任务仍未完成。
