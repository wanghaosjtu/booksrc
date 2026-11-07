# 全量共享 Common 迁移验收

2026-11-07。108 个 canonical 书源均已接入固定 Git SHA 的网络公共库，localhost 手机已全部部署并独立读回核对。本次没有修改 App 或 calibre，也没有发布远端站点模块。

## 版本与发布范围

- 工作分支：`feature/shared-common-all-sources`。
- 迁移前稳定版：`5e5599b`（`Checkpoint common runtime pilots and HTML SVG validation`）。
- 公共库 v2：`09ab5cf52b7d089b618583af9ca98c16e4676116`，发布到 `common-runtime`。
- 该发布提交相对父提交仅修改 `booksource/runtime/legado-shared-runtime.js`；工作分支、手机源和私有调试资料未推送。

固定下载地址：

```text
https://raw.githubusercontent.com/wanghaosjtu/booksrc/09ab5cf52b7d089b618583af9ca98c16e4676116/booksource/runtime/legado-shared-runtime.js
```

远端与本地公共库逐字节一致：22,470 字节，SHA-256 `a8ab3336e7dc355406ad5698e159744e3cc7a47111c2673b82c5f1c989ffa5f4`。

## 迁移内容

全部源的 `jsLib` 保留站点代码和设置，移除内联旧 common，改用同一轻量加载器。包括 53 个原先空/自定义库的源、51 个 disabled 源及 1 个音频源；不改变启用状态、类型或凭空开启翻译/HTML。中国社会科学期刊的 `burl`、Test 的 `datestr` 保留。首次调用公共入口才联网，`importScript` 返回的文本在独立 factory 中执行，并检查 v2 及全部入口；不捕获首次调用者的 `java/cache`。

本地 canonical 此次只改变 108 个 `jsLib` 和 56 个 `ruleContent.content`，其他字段保持原样。`jsLib` 总量从 993,515 降到 382,620 字节，减少约 61.5%。手机候选从本次完整备份派生；71 个源原有的其他手机/本地差异（名称、规则、登录、启用等）得到保留，没有用 canonical 全对象覆盖手机。

公共处理修正：

- `ltExtract` 对 `usehtml` 解包 DOM，保留标题、内联节点和图片；普通选择器（包括 TeX）仍提取文字。
- `ltPrepareImages` 支持字符串或 Jsoup DOM，仅处理图片。先选择 data-src/srcset/picture/anchor 的实际地址，再清理属性；按真实章节 URL 解析 `//`、`/`、相对路径和 `../`。
- 绝对/签名图片的查询字节、Legado URL 选项及 TeX 保持原样。Nature 手工 extraction 使用公共入口；求是仍不翻译、不强制 HTML。TH/TC 和既有手工图片流程获得章节基准 URL。
- 重复 HTML 处理不嵌套 `usehtml`，图片仍在包装外。IEEE 默认 HTML，明确的 TEXT 选择不变；默认值在 Java 空字符串转为 JS String 后应用。
- 保留安全请求 JSON 编码与 CodeCogs `.svg` 导出别名，不删除 TeX 反斜杠，不把公式改为 PNG。

## 手机全量核对

仅使用用户指定的 `localhost:1122` HTTP / `localhost:1123` WS，不使用手机 MCP、ADB 或其他设备。

先备份完整 109 源，用受支持的 revision inventory 和最多三路单源读取，前后核对 revision。部署逐源核对原备份，保存后完整字段读回并记录 journal；HTTP 保存失败先确认状态，不盲目重发 POST。早期遇到的两次 HTTP 500 未取得服务端原因，不能将其归因于公共库；后续确认断点状态后恢复，最终全部成功。

最终独立 `verify` 结果：

```json
{"verifiedTargets":108,"unchangedOtherSources":1,"total":109}
```

108 个正式源与本次候选完整一致，原有额外验证源不变。本次新增短源和 HTML/TEXT 测试书均已清理；原书架 220 本书的身份、名称和来源保持，未清除原书缓存。备份、候选、journal、原始 WS 及图片证据仅保留在 Git 忽略的 `booksource/.usehtml-validation-phone/common-all-20261107-v1/`（目录 700、文件 600）。

## 实机样本与回归

独立 v2 短样本通过真实 `importScript`/factory、调用者语言隔离、原始 `d\mathrm{snr}` 请求解析和逐字 round-trip、图片 URI、HTML 解包与重复处理。HTML 下载/缓存重读一致（602 字符）；独立 TEXT 无 `usehtml`/标题标签，SVG 别名及缓存一致。公式经手机原生图片接口渲染返回 HTTP 200 PNG（640×101，9,919 字节）；这里只证明 App 的图片显示，不将 PNG 接口输出误称为 SVG 缓存内容。

真实规则输出抽样：

| 源 | 正文页面 | 已验证的结果 |
| --- | --- | --- |
| IEEE | `document/9737357` | 正文解析完成，无脚本错误；104 个 HTML 标题片段，571 图（546 个公式 SVG 别名、25 个其他图），所有图片地址绝对，无 `tex-math` 残留，逐个 `usehtml` 包装内均无图片 |
| Nature | `articles/d41586-026-03545-7`（链接来自真实 issue 页） | 正文解析完成，无脚本错误，实际输出中的 1 张图为绝对地址；不等同于订阅全文或完整翻译验收 |
| 求是 | `20261102/f4e3d17c407244519c463e714d030672/c.html` | 正文解析完成，无脚本错误，5 张图全部为绝对地址；一张实际图片下载确认为 PNG，没有新增翻译/HTML |

私有第一版图片分析的跨包装正则曾误判 IEEE 包装内有图片，并重复统计 SVG 字符串。另存更正记录，按每个包装和 `img src` 计数；旧记录未改写。

回归全部通过：

- `node --test tools/tests/*_test.js`：64 项，0 失败、0 skipped。
- 真实 Rhino / Jsoup / Kotlin RuleAnalyzer：484 个断言，包含全部 108 个库的惰性初始化与公共图片入口。模拟 importer 只用于本地引擎检查，联网验收由上述手机样本单独证明。
- `node tools/test_usehtml_validation.js`：4 项通过，真实 DOM 32 个检查。
- `python3 tools/test_runtime_only_sync.py`：4 项通过；旧 translation 迁移器在全网络化后为 no-op。
- `python3 tools/validate_translation_sources.py`：108 网络 common 源；54 个既有正式翻译源、48 HTML 目录、6 JSON 目录、52 个抽象正文规则；固定同一完整 SHA。
- 全量构建/重复迁移幂等性及无关字段保全检查通过。

## 验收边界与维护

108 源迁移/字段保全通过不代表所有站点的发现、目录、翻译、认证或 WAF 问题已解决。本次不批量修网站规则，不把 disabled 源重新启用。此前 State.gov 的 HTTP 403/空目录、IEEE 的既有期号目录问题仍按站点阻断记录。

完整手机单章 EPUB 的 `.svg`、OPF `image/svg+xml` 与 calibre 实际显示证据见 [v1 验收报告](common-runtime-validation-report.md)，不是本轮 v2 新导出的整书验收。严格 XHTML/EPUBCheck 兼容性和旧 MOBI 转换的公式放大问题不属于此次 common 迁移。

首次使用公共入口需要联网；升级必须发布新提交并更换固定 SHA，已有旧正文缓存不会自动重写。回滚仅恢复本次实际部署的备份对象，并先核对手机没有用户新改动；不要全备份覆盖其他源。后续操作流程见 [Legado-skills.md](../Legado-skills.md) 第 8 节。
