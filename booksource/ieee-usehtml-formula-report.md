# IEEE usehtml 公式修复与验证

> 历史阶段报告：下文保留当时的诊断与阻塞结论。后续 common-only 发布、localhost 新手机全文及完整单章 EPUB/calibre 验收已继续完成；当前状态以 [common-runtime-validation-report.md](common-runtime-validation-report.md) 为准。

更新：2026-11-06。目标：`https://ieeexplore.ieee.org/document/9737357/`。

## 当前结论

真实公式已在手机的实际请求解析器中复现“不允许的字符”，保护编码后通过；最小隔离源也完成了 HTML 正文下载、重读、WS 解析和原生 h1 排版检查。42 项完整离线回归及旧 Rhino 的 4 项公式回归均通过。

**这不是原 IEEE 书源全流程通过。** 新阶段/线程诊断将当前等待缩到 App 全局缓存锁等待链，见下文；不是新的 TeX 非法字符记录。 最新原源及隔离源直连 REST 均在 45 秒客户端期限内未拿到正文；本次没有走到公式处理，也没有认证恢复证据。保护编码完整真实正文回放保活29次后仍在300秒客户端期限结束，缺少完成标记，不能列为通过。正式源、原书旧缓存和 Legado/Calibre 本体均未覆盖，没有为本次验证创建 App 分支或编译 APK。

## 已确认的错误路径

`AnalyzeUrl.replaceKeyPageJs()` 在 JSON 解码前扫描请求规则里的 `{{…}}`。LaTeX 即使处于 JSON 字符串中，也可能被误送进 JavaScript 引擎。

本篇真实正文中的公式：

```tex
\begin{equation*} \frac {d}{{d\mathrm {snr} }}I\left ({{\mathrm {snr} } }\right) = \frac {1}{2}MMSE\left ({{\mathrm {snr} } }\right).\tag{1}\end{equation*}
```

手机对照保留完整的 156 字符 TeX，将原 `_ltOptions()` 的 POST 选项仅改为 GET，以便请求只读的手机回环接口：

- 原序列化器：`legacyRejected=true`、`legacyIllegalCharacter=true`。
- 保护编码：`guardAccepted=true`。
- 解码：`exactTex=true`、`exactHeaders=true`，不改变原文和请求头。

这是**用真实公式重建的请求对照**，不是捕获了原书源那一次失败请求；不能声称它是原报错的唯一原因。用户手加的 `"<usehtml>"+result+"</usehtml>"` 语法正常，HTML 文字中的反斜杠不需要再手工翻倍。

## 补丁

`booksource/runtime/legado-usehtml-rule-json.js`：

- 只保护 JSON 字符串 token 中的 `<>&@{}`，结构括号不变。
- 包装现有 `_ltOptions()`，保留 headers、方法、正文及其他选项。
- 可重复加载；不修改全局 `JSON.stringify` 或公共翻译运行时。
- JSON 解码后数据一致；Codecogs URL 不二次编码。

补丁已存在于独立源 `IEEE · HTML公式验证`，没有覆盖正式 IEEE 源。`tools/build_ieee_usehtml_validation.js` 从指定快照生成候选，只改身份、名称、jsLib 和正文尾部，保留原登录、目录、开关和手加标签。已有私有候选与部署记录不要重建。

保护脚本位于共享 runtime 之后；将来如果重新同步整个 runtime 后缀，要重新应用它。本轮未运行批量迁移或会写正式翻译源的 `test_translation_sources.js`。

## 实机短样本

为了避开继承规则中的其他处理和外部服务，另建无登录信息的最小源 `IEEE · HTML解析器短验证 44208843`，仅执行上述真实公式对照，再返回 h1 和 TeX HTML。它不是网站认证或实际翻译验证。

| 项目 | 结果 | 私有证据 |
| --- | --- | --- |
| 实际解析器原编码/保护编码 | PASS | `ieee-parser-content-first-v1.json` 内五项布尔对照均为 true |
| HTML 下载与重读 | PASS | 首次/重读 length=637、内容及摘要完全相同 |
| WS 正文规则 | PASS | `ieee-parser-ws-v1.json`，322ms，明确“正文页解析完成”，1 个 usehtml、1 个 h1 |
| 缓存 HTML 的 Android 排版 | PASS（有限范围） | `android-html-parser-cached-probe-v7.json`，515ms 正常完成，h1 行高95，普通文字65，TextPaint=48 |
| 单张实际公式图 | PASS（图片接口） | `ieee-single-formula-image-v1.png/json`，App 返回640×101 PNG、7288字节，已白底合成目视核对公式 |

原生指标使用 Android `Html.fromHtml` 与阅读器同类的 `StaticLayout`，不是肉眼验收整个 App 阅读页。短样本没有粗体/实体/下载计数标记，因此那些字段不在该样本的验收范围。

公式 PNG 通过测试书的 `/image` 接口取得，透明背景下的公式与上面 TeX 一致。但短样本正文没有 img 标签：**不能用这次单图请求证明原文内嵌图片、整书图片缓存、夜间颜色或全部公式图都已通过。**

## 完整正文与站点访问

真实 REST 正文通过已登录的可见 XPRA Chrome 任务专用页面读取：HTTP200、length=366634、546 个 tex-math；标题/摘要/目录另保存安全投影。没有导出 Cookie、同步登录凭据或复制签名媒体凭据。Cookie 导出曾被审批拒绝，相关命令没有执行，Cookie 文件不存在；没有采用间接导出方法。

两份完整回放（原编码/保护编码）用上述真实数据，保留原内容合并、公式、翻译逻辑。只有已登记的三个 IEEE Ajax 响应被回放，签名媒体返回空并保留直接路径回退；不是登录恢复。

旧 `ieee-replay-legacy-ws-v1.json` 和 `ieee-replay-guard-ws-v1.json` 都在合并后关闭1006，缺少完成标记，不能列为通过。原编码完整 HTTP 的“fetch failed”未取得细化 cause，不能把它归为确定的公式错误或确定超时。

本轮查到服务端 `WebService` 的 WS socket 超时和服务端 ping 间隔均为30秒；Node 与独立 Python 客户端都在约30秒断开。客户端现每10秒保活：Node 的两次45秒探测保持了4次保活，最终按客户端期限结束，未再在30秒断开。未修改用户 Debug.kt 或服务端代码。

最新只读证据：

- `ieee-original-after-done-baseline-v2.json`：原源45秒无正文完成，无公式异常记录。
- `ieee-phone-direct-rest-v1.json`：无代理隔离源直连 REST，45秒没有取得元数据。
- `ieee-replay-guard-ws-keepalive-v2.json`：保活29次、300106ms客户端期限结束，未完成；没有新的非法字符异常记录。

较早原源和实验源曾报 `IEEE 需要手动认证`；最新两次请求没有到达该检查，因此不能直接把当前超时归为认证失败，也不能声称认证已恢复。本人此前已回复无法操作手机，不重复相同认证请示。

## 状态保全与剩余

`phone-usehtml-cache-lock-verify-v8.json`：108 正式源规则/配置保持原样；100 个 customOrder 差异保留；4 本原书仍在，原 IEEE 的 durChapterPos/durChapterTime 差异保留。当前保留6个实验源、9本测试书：local/parser/两个 replay 各1章，ieee125章，其余0章。

不刷新原书旧缓存；其此前173985字符的纯文本不是新 HTML 下载证据。HTTP 客户端结束不取消 App 内下载任务，旧完整 HTTP 是否仍有晚写入未知，故暂不清理实验资源。

剩余：原站访问及认证、原规则完整正文、整书图片、实际阅读页翻页/选文/复制/搜索/朗读，以及手机实际 EPUB 导出后在 Calibre 中验收。没有把未完成工作当作已完成，也未发送未验证的结果邮件。

所有私有数据在 `booksource/.usehtml-validation-phone/`（目录700、文件600、已忽略）。本地 JVM 测试产物仅在 /tmp。

## 后续只读服务诊断

`phone-local-ajaxall-v1.json`：同一脚本中 ajax 和 ajaxAll 访问手机回环接口均返回；469ms 正常完成、responses=1，无外部请求。不能据全文等待就认定批量桥接普遍死锁。

原源/完整回放的 concurrentRate 均未配置，短源为1；没有修改任何源限速。单公式 MathML 探测：1353ms；mathMarkup=2、speechMarkup=true，challengeHint=false。它不证明整个批次或整源通过。

全文等待的唯一原因尚未确认，不把连接保活、单张SVG成功或局部请求成功当作完整原源已恢复。

## 本次新增：全局缓存锁等待链

隔离保护编码回放仅更新 jsLib 的阶段计数日志，正文规则与公式、朗读、翻译开关保持原样。已保存 v1/v2，当前登记候选为 `ieee-replay-guard-candidate-v3.json`，严格清理仅识别这些已登记版本；没有新增源或书。

`ieee-replay-guard-stage-trace-v3.json` 180秒超时且无阶段记录。首次日志工具错误依赖 jsLib 外的全局 java，不能把那次“无日志”当作定位证据。修正版显式使用调用参数中的桥接对象，并增加无全局 java 的回归。

有效证据 `ieee-replay-guard-stage-trace-v4.json`：180110ms、17次保活、未完成；依次记录 TH:begin（402456字符）、formulas:begin、speech:begin（546项），没有第一批 ajaxAll:begin。因此这次等待发生在公式朗读准备中，还未进入该回放的首批公式网络请求。

只读线程投影 `phone-usehtml-thread-projection-v1/v2/v3/v4.json` 均正常完成。最新570ms：76个App线程、21条相关栈，19条BLOCKED在CacheManager.get入口；另一个线程7830位于CacheManager.get内部，向上经过协程和目录/正文脚本，正在ajaxAll中TIMED_WAITING。请求头/登录信息的缓存读取路径也在锁外等待；只保存类/方法名、状态和数字，没有读取登录信息或凭据内容。

与源码 CacheManager.get 的 @Synchronized 合起来，形成当前全局缓存锁循环等待的证据。初始触发任务和具体Room调度细节尚未确认；没有取得专门的监视器owner数据。手机的缓存方法反射核验不支持（cacheReflection=false），不把它说成实机同步标记通过。

没有中断该后台线程、杀死/重启App或清空缓存。额外缓存读取探针只做了离线测试；看到已有19条锁等待后未在手机执行，避免再留下一个不能及时取消的等待调用。

新增日志/只读诊断回归后完整42项通过、无跳过，公共runtime未修改。正式108源规则/配置与4本原书再次核验保全；100个customOrder及原IEEE两个阅读进度差异继续保留。旧等待调用仍可能晚执行，暂不清理6个实验源、9本测试书。

继续实机全文验收需要先解除这个后台阻塞。线程7830关联的原始任务未确定，中断可能使一个目录/下载任务失败并让其他等待任务继续，因此需本人明确授权；此前“无法操作手机”的认证回复不视为中断授权。按email-followup进行新的console优先权限请示，不重复旧认证请示，不发送未验证的结果邮件。

## 权限请示等待结束（2026-11-06）

email-followup按当前可信会话执行了一次持续原生阻塞：console宽限300秒，随后只发送一次权限请示。已有Outlook查信记录确认本次请求Message-ID，实际送达邮箱；外部非LLM worker每60秒查信，完成172次检查后因“Outlook MCP tool returned an error”停止。等待期间没有模型轮询、额外agent或crontab改动。

当前私有状态为error、reply为空，未得到可执行的本人授权。未恢复/重发请求，未中断线程或重启App；也未发送最终结果邮件。后续doctor仅确认身份接口可用，不能据此确认查信已恢复；沿同一状态显式恢复前仍需确认故障已消除，禁止换状态绕过去重。

等待后新证据phone-usehtml-thread-after-owner-wait-v5.json：526ms正常完成，仍有19条CacheManager.get入口BLOCKED，线程7830仍在缓存方法内等待ajaxAll。阻断并未自行消失。工具原文在等待期间未变化。

整体实机全文、原站认证、整书图片、完整阅读页及EPUB仍未通过。现在等待当前console的明确恢复授权；如果不授权，保留补丁和证据，等本人能够重启App后再继续。
