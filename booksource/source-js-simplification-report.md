# 书源 JS 精简与 common v3

2026-11-07，基线 `b9c1341`，分支 `feature/shared-common-all-sources`。108 个 canonical 源已生成 v3；本地测试通过，完整实机验收尚未完成。没有改 App/calibre，没有覆盖另一台手机的原源/原书缓存。

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

当前公共发布：`0fa34494c322b71172bd5e11f1897a570c319364`，父提交 `16908f51298880d881471b20b828d9961492efb6`，两个补充发布都只修改 `booksource/runtime/legado-shared-runtime.js`。没有发布 sites 模块、工作分支、手机源或凭据。固定 raw URL 已下载并逐字节一致，SHA-256：`405cc00a865fa357a57830c74670abf921c02f7a16a87ec213538789bceaf677`。首版 v3 公共 SHA 为 `2a746411dff84335ff5e6fe249d2dfdd2cb42d0e`（其父为 `09ab5cf52b7d089b618583af9ca98c16e4676116`），旧固定 URL 不受补丁影响。

## 体积与保全

按各源 JSON 对象序列化计，总量从 5,020,914 降至 540,859 bytes（约减少 89.2%）。字段 UTF-8 字节数：

| 字段 | 原值 | 新值 |
| --- | ---: | ---: |
| jsLib | 382,620 | 95,269 |
| loginUrl | 16,569 | 3,765 |
| loginUi | 29,762 | 6,131 |
| loginCheckJs | 48,205 | 1,995 |
| ruleContent.content | 161,508 | 69,824 |
| ruleContent.webJs | 3,690,469 | 13,436 |

33 个大 webJs 已移除重复库。108 个身份/顺序、启用与类型、非 JS 字段保留；burl、datestr、移动阅读 bookSourceComment 中的真实 DES 代码保留。两处既有代码错误定向修复：Russtrat 封面全角括号/错误 DOM 操作，移动阅读 getSource 中零宽字符。网站封面/登录/权限未因此自动算验收通过。

## 本地验证

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
