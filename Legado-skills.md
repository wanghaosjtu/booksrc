---
name: legado-book-source
description: 为指定网站生成 Legado 阅读 App 的书源 JSON。支持俄语等外语网站的翻译需求。
---

# Legado 书源生成 Skill

## 统一翻译与 DOM 运行时

正式活动书源以 `booksource/legado-book-sources-current.json` 为唯一编辑源。全部 108 个源内联两行 `booksource/runtime/legado-common-loader.js`，首次 `common(java)` 从固定 Git SHA 加载 `booksource/runtime/legado-shared-runtime.js`。站点规则/参数仍内联，通用登录 UI、设置和验证函数放在 common；空库/自定义库接入加载器，但不因此给小说、音频或中文源开启翻译/HTML。不要批量修改 `booksource/archive/`、单源快照或 legado-E 本体。

公共入口均为 `common(java).方法(...)`：TT 翻译单值/数组并缓存、分批和最多四路并发；TJ 翻译 JSON 并跳过 URL/ID；TC 只翻译文本节点；TH 统一移除、提取、图片、公式和可选 Readability。`ltExtract(htmlOrDoc,java,selectors)` 对 usehtml 解包 DOM，普通选择器（如 TeX）仍提取文字；`ltPrepareImages(htmlOrDoc,java,options)` 只处理图片。网络 I/O/服务无效响应保留原文；选择器、类型、JSON/脚本错误必须抛出，不加宽泛 catch，不伪造空目录。

共享 TH 不等于开启富文本。2026-11-08 核对 108 个正式源，只有 IEEE 的正文显式调用 `ltUseHtmlBlocks`（默认 HTML，可切 TEXT）；Science、Nature、求是和 ScienceDirect 均未开启。原机还有一个旧的独立 HTML 验证源，不计入正式源。Science 的 TH 返回裸 HTML，随后原生 Formatter 删除标题标签；不能把这当作公共库加载失败，或未获要求就批量改变所有源的默认格式。需要标题层级时，正文 TH 之后显式调用 `common(java).ltUseHtmlBlocks(result,java)`，并开启 App「适配特殊样式」；旧正文缓存不会自动重写。

`serviceJson(response,java)` 只解码外部服务的 JSON：无效 JSON 返回 null 并记录不含原文的诊断；转换输入前的程序异常仍抛出。缓存和本地规则数据继续用 JSON.parse，不能用此方法掩盖坏缓存。IEEE 的网络 catch 不再豁免所有 SyntaxError，只有这一步外部解码允许回退。

只保留被引用的内联设置，不再生成五个未使用变量；TH 配置明确传入，不能从隐藏 factory 读取。canonical 额外元数据仅供统计，Android 导入会丢弃它们。JSON 目录一次 TJ，HTML 目录一次 TH 后再选择节点。保留 IEEE/Springer CodeCogs、ScienceDirect/Sage MathML/WIRIS 和 WAF/签名等站点逻辑；不要重复 Rhino 正文翻译与 WebView 整页翻译，WebView 只用公共 webClean 清理 DOM/Readability。

当前 Edge `translatetext` 接口可匿名调用；若 `https://edge.microsoft.com/translate/auth` 返回 404，公共 runtime 仍会带空 `Bearer` 继续请求，失败时保留原文。不要把 auth 404 当作整页翻译失败。

修改后运行：

```sh
node --test tools/tests/shared_common_test.js
python3 tools/validate_translation_sources.py
```

发布、全量迁移和 localhost HTTP/WS 验证见第 8 节。历史 `migrate_translation_sources.py` 在全部网络化后是 no-op；不要运行会用历史源覆盖手机的 `test_translation_sources.js`。结构校验覆盖全部源，目录/翻译检查仍单独统计既有 54 个正式翻译源；不能把该子集或站点/WAF 阻断当作全量通过。

## 功能说明
为指定网站生成 [Legado-E（阅读）](https://github.com/Luoyacheng/legado-E) 阅读 App 的书源 JSON 文件。

## 工作流程

### 1. 网站类型判断
首先明确网站类型，决定采用哪种技术路线：

| 类型 | 特征 | 技术方案 |
|------|------|----------|
| JSON API 型 | 分页数据通过 `/api/...?page=1` 等接口返回 JSON | 直接用 `@json:` + `@js:` 解析 |
| HTML 服务端渲染型 | 分页通过 URL 参数 `?page=1` 或 `/page/1` 切换，页面直接返回 HTML | 用 `@css:` 解析 HTML |

### 2. 实际访问目标网站
**必须先用 curl 实际访问目标网站**，确认：
- 网站是否可以访问（有的网站会屏蔽爬虫）
- **每种页面类型都要抓取验证**：列表页、详情页、目录/文章列表页、正文页——同一站点不同页面的 CSS 类名可能完全不同
- 列表页的 HTML 结构（文章标题、链接的 CSS 选择器）
- 分页格式（`?page=1` 还是 `/page/1`）
- 文章详情页的正文 CSS 选择器
- **搜索表单的真实 action URL**（有些网站 `/?s=` 不是真正的搜索端点，需在页面 HTML 中搜索 `<form` 找到真实的搜索 API 地址，如 `findit.state.gov/search`）

**禁止凭记忆或猜测 CSS 选择器**，所有选择器必须来自实际 curl 抓取的 HTML。

### 3. 生成书源 JSON

#### 3.1 基本字段
- `bookSourceName`：书源名称
- `bookSourceUrl`：网站根域名（如 `https://example.com`）
- `bookSourceType`：0（图文）
- `exploreUrl`：发现页入口，格式为 `分类名::URL`，多个用 `\n` 分隔
- `searchUrl`：搜索 URL，支持标准 URL（如 `https://example.com/search?q={{key}}&page={{page}}`）或 `@js:` 表达式

#### 3.2 搜索页（ruleSearch）

搜索规则各字段与发现页完全相同。搜索地址中的 `{{key}}` 替换为搜索关键词，`{{page}}` 替换为页码。

**搜索端点探测**：
- 不要假设 `/?s=` 就是搜索地址。在页面 HTML 中搜索 `<form` 标签的 `action` 属性，找到真正的搜索端点
- 有些网站的搜索由第三方服务提供（如 `findit.state.gov`），可能被 CloudFront 等 CDN 地域封锁
- 如果搜索端点不可用，保留 `@js:` 假搜索（返回单个空壳结果），确保书源不报错即可

**`checkKeyWord` 字段**：
位于 `ruleSearch` 内，是调试时自动填充的默认搜索词。**必须设置一个能搜到大量结果的热门关键词**（如 `"Israel"`, `"2024"`, `"technology"`），否则调试器不知道该搜什么。

| 字段 | 说明 |
|------|------|
| `bookList` | 搜索结果列表容器选择器（CSS/XPath/JSON/JS） |
| `bookUrl` | 书籍详情页链接 |
| `name` | **必须翻译**（外语网站） |
| `author` | 作者 |
| `kind` | 分类 |
| `coverUrl` | 封面 URL |
| `intro` | 简介 |
| `lastChapter` | 最新章节 |
| `wordCount` | 字数 |
| `checkKeyWord` | **调试用**：默认搜索词，选能搜到大量结果的热门词 |

> ⚠️ **如果网站没有公开的搜索 API**，用 `@js:` 模拟搜索。示例（参考 `russtrat.json`）：
> ```json
> "searchUrl": "@js:java.put('key',key);java.put('page',page);",
> "ruleSearch": {
>   "bookList": "@js:[1]",
>   "bookUrl": "@js:'https://russtrat.ru/analytics'",
>   "name": "@js:'Search: ' + (java.get('key') || '')",
>   "checkKeyWord": "Israel"
> }
> ```

#### 3.3 发现页（ruleExplore）

发现页的规则结构与搜索页完全相同，但输入源不同——搜索页来自用户输入，发现页来自 `exploreUrl`。

- `bookList`：返回分类列表（如 `['Аналитика', 'Новости']`）
- `bookUrl`：指向对应分类的 URL
- `name`：**必须翻译**（外语网站）

#### 3.4 文章列表（ruleToc）
- `chapterList`：文章列表容器的 CSS 选择器，并且**默认在前面加 `-` 实现倒序显示**
- `chapterName`：**必须翻译**
- `chapterUrl`：文章详情页链接
- `nextTocUrl`：下一页链接

#### 3.4 正文内容（ruleContent）
- `content`：正文 CSS 选择器，如 `@css:div.content@html`
- 如需翻译正文，在 `@css:` 后加 `<js>...</js>`，使用 Microsoft Translate API

#### 3.5 翻译功能（可选）
如需翻译外语正文，使用 Microsoft Translate API（免费、无需密钥）。

**目录/书名翻译**（使用公共库，不再复制 auth/API 代码）：
```javascript
result=common(java).TT(result,java,cache);
result;
```

**正文翻译（推荐用 Jsoup，更可靠）**：

> Legado-E 支持 `org.jsoup.Jsoup`。用 Jsoup 解析 HTML 比手写正则更可靠、代码更短。

```javascript
result=common(java).TH(result,java,cache,{
  remove_selector:["script","noscript","style"],
  extract_selector:["inline-formula tex-math"]
});
result;
```

> ⚠️ **Jsoup 注意事项**：
> - 用 `for` 循环遍历 `doc.select()` 结果（`els.size()` + `els.get(i)`），**不要用 `.each()`**（Rhino 不支持该 Jsoup 方法）
> - `doc.body().html()` 返回 Java String，必须用 `''+` 转为 JS string 后才能调 `.replace()` 等 JS 方法
> - 每个标签文本长度控制在 5000 字符以内，避免超过翻译 API 限制

**只处理图片的中文源**（选择真实 src，交给 App 解析相对 URL）：
```javascript
result=common(java).ltPrepareImages(result,java);
result;
```

### 4. 关键规则（必须遵守）

#### 规则一：书籍名和目录名都要翻译
如果是外语网站，以下字段**必须**通过 `<js>...</js>` 调用翻译 API 翻译成中文：
- `ruleExplore.name`（发现页入口名称）
- `ruleToc.chapterName`（目录/文章标题）

示例（`chapterName` 字段）：
```
@css:h6@text
<js>
var TARGET_LANG = 'zh-Hans';
// ... 获取 token ...
// ... 调用翻译 API ...
result = translatedText;  // 翻译后的标题
</js>
```

#### 规则二：目录默认倒序（前面加 `-`）
Legado 支持在文章列表前加 `-` 来实现倒序显示。**默认在翻译后的 `chapterList` 前面加 `-`**。

示例：
```javascript
// 翻译完成后，在前面加 '-'
if (arr[0] && arr[0].translations && arr[0].translations[0]) {
  result = '-' + arr[0].translations[0].text;
} else {
  result = '-' + result;
}
```

#### 规则三：所有 CSS 选择器必须来自实际抓取
禁止凭猜测写 CSS 选择器。必须先 `curl` 抓取页面 HTML，确认选择器准确后再写入书源。

#### 规则四：最终图片地址交给原生 Formatter

`HtmlFormatter.formatKeepImg` 已按响应 URL 解析 `//host/path`、根路径和 `../`。不再补域名/image_base_url；common 只选 lazy/srcset/picture/anchor 地址，删除重复属性清理循环。图片必须在 usehtml 外，否则跳过原生 Formatter。跨页资产和实际 java.ajax/connect 请求仍需要正确地址，可用 `common(java).resolveRequest(value,base)`；签名查询和 URL 选项必须原样保留。

### 5. 调试与验证

书源编写完成后，**必须通过调试验证**，确保「发现 → 书籍 → 目录 → 正文」全流程可用。非中文网站还需验证翻译功能。

#### 5.1 调试环境

手机运行 Legado-E，需在设置中开启「Web 服务」：

| 服务 | 地址 | 用途 |
|------|------|------|
| HTTP API | `http://<手机IP>:1122` | 保存书源、获取章节/正文 |
| WebSocket 调试 | `ws://<手机IP>:1123/bookSourceDebug` | 书源搜索调试 |
| Web 页面 | `http://<手机IP>:1122/vue/index.html#/bookSource` | 手动可视化调试（兜底） |

> **手机 IP 会变动**：每次调试前先确认手机 WiFi IP 地址。以下示例用 `192.168.31.73` 代表，实际使用时替换。

#### 5.1.1 从远程 Linux 沙箱调试手机（SSH/plink 端口转发）

当调试工作在**远程 Linux 服务器**（如本沙箱环境）而手机在**本地局域网**时，需要用户在本地 Windows/PC 上通过 SSH 反向转发（`-R`）把手机的两个 Web 服务端口都转发到远程服务器的 `localhost`，这样沙箱内的 curl / WebSocket 客户端才能直接访问 `localhost:1122` / `localhost:1123`。

**PuTTY plink 命令示例**（用户在本地 PC 上执行）：
```
plink -R 1122:192.168.31.72:1122 -R 1123:192.168.31.72:1123 haow1-gv
```
- `192.168.31.72` 为手机的局域网 IP（需替换为实际值）
- `haow1-gv` 为 SSH 配置里的远程服务器别名
- 必须**同时转发 1122（HTTP API）和 1123（WebSocket 调试）**两个端口，缺一个都无法完整调试（1122 用于 saveBookSource/saveBook/getBookContent，1123 用于 WebSocket 实时调试正文规则）

**原生 OpenSSH 等价命令**：
```bash
ssh -R 1122:192.168.31.72:1122 -R 1123:192.168.31.72:1123 haow1-gv
```

**沙箱侧验证转发是否生效**：
```bash
ss -tlnp | grep -E "1122|1123"
# 应看到 127.0.0.1:1122 和 127.0.0.1:1123 均为 LISTEN 状态
nc -zv 127.0.0.1 1122   # HTTP API
nc -zv 127.0.0.1 1123   # WebSocket 调试
```

> ⚠️ **只转发 1122 不够**：很多任务（如调试 `ruleContent.content` 对某个具体 URL 的解析结果）**必须**用 WebSocket 调试（1123端口），因为 HTTP API 的 `getBookContent` 要求章节已经通过 `ruleToc` 写入本地数据库——对于像 IEEE 这种目录/搜索接口被 CloudFront WAF 拦截的网站，`getChapterList` 会失败（返回 WAF 挑战页导致 JSON 解析错误），此时**唯一**能直接对任意 URL 跑 `ruleContent.content` 规则的方式就是 WebSocket 的 `--<url>` 前缀调试。
>
> 如果用户后续才补加 1123 的转发（例如先只转发了 1122），沙箱侧的 `ss -tlnp` 会显示端口刚从 `Connection refused` 变为可连接，此时无需重启任何调试脚本，直接重跑 WebSocket 调试即可。

**已知的 SSH 反向转发限制**：在已建立的 SSH ControlMaster 连接上，用 `ssh -O forward -R <port>:<target>` **动态追加**新的远程转发**可能失败**（`remote port forwarding failed for listen port ...`）。这种情况下必须让用户在本地重新建立一个包含所有所需 `-R` 参数的新连接（如上面的 `plink` 命令），而不是尝试在沙箱侧动态修改已有连接。

#### 5.1.2 手机在同一局域网时：直接用手机IP访问 + 清空 http_proxy

如果手机和沙箱在**同一局域网**（不需要 SSH 端口转发），可以直接用手机的局域网 IP + 端口访问（如 `http://10.92.27.11:1122`）。

> ⚠️ **沙箱环境默认配置了公司代理**（`http_proxy`/`https_proxy` 环境变量，如 `http://secure-proxy4.qualcomm.com:9090`），会导致直连手机局域网 IP 返回 **403** 或被代理拦截（返回 "Qualcomm Web Gateway - Notification" 页面）。
>
> **解决方法**：直连手机 IP 时，在该次命令前临时清空代理环境变量：
> ```bash
> http_proxy= https_proxy= HTTP_PROXY= HTTPS_PROXY= curl -sS "http://10.92.27.11:1122/getBookSources"
> ```
> 注意：`export http_proxy=` 只在当前 bash 进程生效，**不会持久化到后续新的 shell 调用**（每次工具调用可能是新进程）。因此**每一条**需要直连手机 IP 的命令都要在命令前加上这个前缀，不能只 `export` 一次就假设后续命令也生效。

**调试优先级**：WebSocket 调试工具 → HTTP API → Web 页面

> ⚠️ **调试时保持手机亮屏**：WebSocket 连接需要手机保持活跃。调试前请在手机上开启"保持亮屏"或连接充电器。
>
> ⚠️ **HTTP API 的 `getChapterList` 可能返回空**：如果书籍刚通过 `saveBook` 创建但还没在 App 内打开过，`getChapterList` 可能返回失败。优先用 WebSocket 调试工具逐规则验证。

**验证连通性**（调试前执行一次）：
```powershell
# 测试 HTTP API
Invoke-RestMethod -Uri "http://192.168.31.73:1122/getBookSources" -Method GET -TimeoutSec 5

# 测试 WebSocket
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync("ws://192.168.31.73:1123/bookSourceDebug", [Threading.CancellationToken]::None).Wait(3000)
$ws.State  # 应当为 Open
$ws.Dispose()
```

#### 5.2 HTTP API 调试（优先方案）

工作区提供 `api_debug_tool.ps1` 脚本辅助，也可以直接用 `Invoke-WebRequest -UseBasicParsing` 调用（更稳定）。

> **注意**：`POST /saveBookSource` 的 Body 必须是**单个书源对象**（`{...}`），不是数组（`[{...}]`）。如果 JSON 文件是数组，需要先提取第一个元素：
> ```powershell
> $arr = Get-Content "书源文件.json" -Encoding UTF8 -Raw | ConvertFrom-Json
> $single = $arr[0] | ConvertTo-Json -Depth 10 -Compress
> ```

**Step 1 — 保存书源到手机**：
```powershell
# JSON 文件是单个对象时
$json = Get-Content "书源文件.json" -Encoding UTF8 -Raw
Invoke-WebRequest -Uri "http://192.168.31.73:1122/saveBookSource" -Method POST -Body $json -ContentType "application/json" -UseBasicParsing

# JSON 文件是数组时（如 russtrat.json）
$arr = Get-Content "书源文件.json" -Encoding UTF8 -Raw | ConvertFrom-Json
$single = $arr[0] | ConvertTo-Json -Depth 10 -Compress
Invoke-WebRequest -Uri "http://192.168.31.73:1122/saveBookSource" -Method POST -Body $single -ContentType "application/json" -UseBasicParsing
```

> **PowerShell JSON 陷阱**：`ConvertTo-Json -Compress` 会把中文和 Unicode 字符转成 `\uXXXX` 转义序列，可能导致书源中 `<js>` 代码块的引号被破坏。建议用 `[System.IO.File]::WriteAllText` + `[System.Text.UTF8Encoding]::new($false)` 保存 JSON 避免此问题。
> ```powershell
> $json = $data | ConvertTo-Json -Depth 10 -Compress
> [System.IO.File]::WriteAllText("文件.json", $json, [System.Text.UTF8Encoding]::new($false))
> ```

成功返回：`{"isSuccess": true, "errorMsg": ""}`

**Step 2 — 验证书源已保存**：
```powershell
$r = Invoke-WebRequest -Uri "http://192.168.31.73:1122/getBookSource?url=https://目标网站域名" -UseBasicParsing
# 查看返回：$r.Content
```

**Step 3 — 插入书籍（可选，HTTP API 调试目录/正文时才需要）**：
```powershell
$book = @{bookUrl="https://目标网站/某分类页"; name="测试书籍"; author="作者"; tocUrl="https://目标网站/某分类页"; origin="https://目标网站"} | ConvertTo-Json -Compress
Invoke-WebRequest -Uri "http://192.168.31.73:1122/saveBook" -Method POST -Body $book -ContentType "application/json" -UseBasicParsing
```
**Step 4 — 验证目录**：
```powershell
$r = Invoke-WebRequest -Uri "http://192.168.31.163:1122/getChapterList?url=https://目标网站/某分类页" -UseBasicParsing
$resp = $r.Content | ConvertFrom-Json
# 查看章节数量：$resp.data.Count
# 查看前5章标题：$resp.data | Select-Object -First 5
```
返回的章节列表应非空，每项含 `name`（标题）和 `url`（链接）。如果是外语网站，标题应已翻译成中文。

**Step 5 — 验证正文**：
```powershell
# index 使用 getChapterList 返回的真实 index；当前版本首章通常为 0
$r = Invoke-WebRequest -Uri "http://192.168.31.163:1122/getBookContent?url=https://目标网站/某分类页&index=1" -UseBasicParsing
$resp = $r.Content | ConvertFrom-Json
# 查看正文前 300 字：$resp.data.Substring(0, 300)
```
返回的正文应可读、无乱码。TEXT 模式不应有意外 HTML 标签残留；明确启用 HTML 的源应按第 8 节核对 `<usehtml>`、标题结构和图片位置。如果是外语网站，正文应已翻译为中文。

**Step 6 — 多章抽样验证**：
修改 `index=3`、`index=5` 等，验证多章均可获取。验证完可以删除测试书籍：
```powershell
$body = '["https://目标网站/某分类页"]'
Invoke-WebRequest -Uri "http://192.168.31.163:1122/deleteBook" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
```

#### 5.3 WebSocket 调试（推荐方案）

使用工作区的 `book_source_debug_tool.ps1` 脚本，通过 WebSocket 连接实时调试书源：

**支持四种调试模式**：

| 模式 | 说明 | 输入格式 |
|------|------|----------|
| `explore` | 调试发现页 → 自动联动详情→目录→正文 | `分类名::URL` |
| `info` | 调试详情页 | 裸 URL |
| `toc` | 调试目录页 | 裸 URL（脚本自动加 `++` 前缀） |
| `content` | 调试正文页 | 裸 URL（脚本自动加 `--` 前缀） |
| `search` | 搜索调试 | 搜索关键词 |

**使用示例**：

```powershell
# 调试详情页
.\book_source_debug_tool.ps1 -Mode info -BookSourceUrl "https://www.state.gov" -Url "https://..." -ServerHost "192.168.31.73"

# 调试目录页（-Url 不加 ++，脚本自动添加）
.\book_source_debug_tool.ps1 -Mode toc -BookSourceUrl "https://www.state.gov" -Url "https://..." -ServerHost "192.168.31.73"

# 调试正文页（-Url 不加 --，脚本自动添加）
.\book_source_debug_tool.ps1 -Mode content -BookSourceUrl "https://www.state.gov" -Url "https://..." -ServerHost "192.168.31.73"

# 调试发现页
.\book_source_debug_tool.ps1 -Mode explore -BookSourceUrl "https://www.state.gov" -Url "Bureaus::https://..." -ServerHost "192.168.31.73"

# 搜索调试
.\book_source_debug_tool.ps1 -Mode search -BookSourceUrl "https://www.state.gov" -Url "diplomacy" -ServerHost "192.168.31.73"

# 跳过书源检查（书源未保存时）
.\book_source_debug_tool.ps1 -Mode info -BookSourceUrl "https://..." -Url "https://..." -SkipSourceCheck -ServerHost "192.168.31.73"
```

> **注意**：`-Url` 参数传入裸 URL，不需要手动加 `++`/`--` 前缀。脚本内部根据 `-Mode` 自动添加。如果手动加了前缀，会变成 `++++url` 导致请求失败（`Expected URL scheme 'http' or 'https' but no scheme was found`）。

**参数说明**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-Mode` | 调试模式 | 必填 |
| `-BookSourceUrl` | 书源 URL | 必填 |
| `-Url` | 调试目标 URL 或关键词 | 必填 |
| `-ServerHost` | Legado-E 服务器 IP | 192.168.31.163 |
| `-WsPort` | WebSocket 端口 | 1123 |
| `-HttpPort` | HTTP API 端口 | 1122 |
| `-SkipSourceCheck` | 跳过书源存在性检查 | false |

**原始 WebSocket 调试方法**（备用）：

```powershell
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [Threading.CancellationToken]::None
$ws.ConnectAsync("ws://192.168.31.163:1123/bookSourceDebug", $ct).Wait(3000)

# 发送调试消息
$msg = '{"key":"搜索关键词","tag":"https://书源URL"}'
$bytes = [Text.Encoding]::UTF8.GetBytes($msg)
$ws.SendAsync([ArraySegment[byte]]$bytes, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait(3000)

# 接收响应
$buf = New-Object byte[] 8192
$rms = $ws.ReceiveAsync([ArraySegment[byte]]$buf, $ct)
$rms.Wait(5000)
$response = [Text.Encoding]::UTF8.GetString($buf, 0, $rms.Result.Count)
Write-Host $response

$ws.Dispose()
```

#### 5.4 Web 页面手动调试（兜底方案）

当 API 和 WebSocket 均无法满足调试需求时，使用 Web 页面可视化调试。

**直接在手机浏览器打开**：`http://192.168.31.163:1122/vue/index.html#/bookSource`

在页面上：粘贴书源 JSON → 点击调试搜索 → 输入关键词 → 查看搜索结果 → 进入书籍 → 查看目录 → 进入正文。

**通过 Edge CDP 远程调试**（电脑端操控手机页面）：

Edge 启动参数（已在 PC 上配置）：
```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9999
```

使用方法：
1. 启动 Edge 后，在 Edge 浏览器中打开手机 Web 服务页面：`http://192.168.31.163:1122/vue/index.html#/bookSource`
2. 通过 Chrome DevTools Protocol (CDP) 连接 Edge 的调试端口 `http://127.0.0.1:9999`
3. 使用 Playwright 或 Puppeteer 操作页面进行自动化调试
4. 工作区已有 `screenshot_edge.js`（Playwright）和 `cdp_screenshot.ps1`（原生 CDP）作为参考

#### 5.5 调通标准检查清单

每个书源必须以下全部通过才算调通：

| 环节 | 验证方法 | 通过标准 |
|------|----------|----------|
| ☐ 发现 | 书源 JSON 中 `exploreUrl` 非空即可 | 手机上能看到发现入口 |
| ☐ 书籍 | `/getBookSource` 查询成功 | 书源已在手机端正确保存 |
| ☐ 目录 | `/getChapterList` 返回非空列表 | 章节标题已翻译（外语）+ 倒序 |
| ☐ 正文 | `/getBookContent` 返回可读文本 | TEXT 无意外 HTML 残留；HTML 保留预期结构；无乱码，图片为绝对路径 |
| ☐ 翻译 | 检查目录标题/正文内容 | 非中文内容均已翻译为中文字幕 |

#### 5.6 常见调试错误速查

| 错误现象 | 原因 | 解决方案 |
|----------|------|----------|
| 保存书源返回失败 | JSON 格式不合法 | 用 `ConvertFrom-Json` 验证 JSON 后修复 |
| `getChapterList` 返回空 | CSS 选择器未命中，或书籍未在 App 中打开过 | curl 抓取页面 HTML，重新确认 `chapterList` 选择器；优先用 WebSocket 调试 |
| 正文返回 HTML 标签 | `@text` 用得不对 | 正文应使用 `@css:div.content@html`（不是 `@text`）|
| 正文图片不显示 | 懒加载未选真实地址，或图片被包进 usehtml | 用 common 的图片 helper；图片移出 usehtml，由原生 Formatter 解析相对 URL |
| 翻译不生效 | Microsoft API 不通或 auth 未缓存 | 检查 `java.put("AUTH",...)` 是否正确执行 |
| 目录标题未倒序 | 未在章节列表前加 `-` | 在 `chapterList` 的前加 `-` |
| `TypeError: 找不到函数 each` | Jsoup 的 `.each()` 不被 Rhino 支持 | 改用 `for` 循环：`for(var i=0;i<els.size();i++){var el=els.get(i);...}` |
| `String.replace` 方法签名不匹配 | `doc.body().html()` 返回 Java String | 用 `''+doc.body().html()` 转为 JS string |
| `searchUrl` 返回 403 | 搜索端点被 CDN 地域封锁 | 在页面 HTML 中找 `<form action="...">` 确认真实搜索地址；如不可用则降级为 `@js:` 假搜索 |
| WebSocket `++URL no scheme` | `-Url` 参数重复加了 `++` 前缀 | `-Url` 传裸 URL，脚本会自动加前缀 |

### 6. 输出
- 生成 `.json` 文件，保存到工作区
- 确保已通过第 5 步的调试验证（发现 → 书籍 → 目录 → 正文）
- 用户明确要求分发时才上传；common-only 工作只发布公共库，不上传手机源、登录、Cookie 或私有备份

## 示例参考
- 俄语网站书源（正则翻译+倒序）：`russtrat.json`、`russtrat_regex_translate.json`
- 英语网站书源（Jsoup 翻译+发现页分页）：`state_bureaus.json`
- JSON API 型书源（Jsoup 正文翻译）：`Carnegie.json`

## 注意事项
- Microsoft Translate API 的 auth token 每次调用可能不同，建议在翻译函数内动态获取并缓存
- 翻译大段正文时，逐标签翻译（每条文本控制在 5000 字符以内）
- 如果翻译 API 无法访问，可以去掉翻译功能，只保留原文书源
- 调试 WebSocket 的最后一条消息接收超时（`Wait` 异常）是正常现象，脚本已在超时前收到所有有效调试消息
- `ConvertTo-Json -Compress` 会将 `<js>` 中的单引号 `'` 转义为 `\u0027`，不影响功能但有碍阅读。如需保留原样用 `[System.IO.File]::WriteAllText` 保存

## 7. 实战经验：通用正文修复、并行翻译与可恢复导出

### 7.1 修改前备份，导出放到 `booksource/`

修改手机书源前，先从 Web 服务导出全部书源到独立私有目录；不要直接用手机导出覆盖 canonical（Android 会丢弃额外元数据，手机也可能有用户新改动）。`getBookSources` 可能直接返回数组或包在 `data` 字段中；大导出超时时，`shared_common_phone.js` 从受支持的 revision inventory 分批读取完整对象，并核对前后 sourceRevision，不能以少数单源响应冒充完整备份。

```bash
node tools/shared_common_phone.js snapshot booksource/.usehtml-validation-phone/<new-run>
```

部署后再次读取对应书源，用 `jq -S` 与本地文件比较；不要只以 HTTP 成功响应作为部署成功的依据。

### 7.2 不依赖固定 CSS 的正文提取

当一个来源可能跳转到站外文章时，正文规则不能依赖本站的固定 class。推荐顺序如下：

1. 用 Jsoup 遍历 `p, pre, blockquote, td`，按段落长度、标点、链接密度、class/id 的正负关键词给父节点评分。
2. 克隆最高分候选并移除导航、页脚、分享、广告、表单和脚本等噪声。
3. 候选正文不足时保留原结果作为回退，而不是返回空字符串。

这套 Readability 必须在翻译前运行，避免把导航、营销 JSON、相关推荐送进翻译 API。

### 7.3 Next.js `next-route-announcer` 空壳回退

部分 Next.js 页面会偶发只返回 `next-route-announcer` 等路由壳；但响应的 `script` 中仍可能包含 `self.__next_f.push(...)` 的 RSC 数据流。处理要点：

- 使用 TH 的 `readable:true` 公共评分器，先收集 RSC，再移除 script。
- 只解码 RSC 的 JSON 字符串，不替换原始 `\n`/反斜杠、不 eval 页面脚本，否则会把 TeX `\neq` 改成换行。
- 该分支不使用站点固定 selector，正常 SSR 页面不会进入它。
- 用临时规则强制正常候选为空，可在手机上验证 RSC 回退；验证结束后必须立即恢复正式书源。

### 7.4 WebView 的使用边界

`webView` 适合站外页面、Cloudflare 验证或确实需要浏览器渲染的页面，但不应因为一个页面异常就无条件施加到所有章节。

- `BackstageWebView` 会反复执行 `webJs`，直到返回非 `null` 结果；大段 Arc90 Readability 很容易触发“js执行超时”。
- `webJs` 只应做轻量 DOM 清理，并始终返回 `document.body.outerHTML`（没有 body 时返回 `document.documentElement.outerHTML`）。
- 站外 URL 可在 `chapterUrl` 中追加 `,{"webView":true}`；如需等待客户端水合，可经实测后追加 `webViewDelayTime`（毫秒）。
- 通过 WebSocket 调试正文时，使用裸 URL 的 `--` 前缀；要覆盖 WebView 分支，则传入带 URL 选项的完整章节 URL。

### 7.5 Microsoft 翻译并发控制

对长正文，不要为每个文本节点串行调用 `java.ajax`。可按以下限制批处理：

- 每个请求最多约 4,000 字符、最多 200 段。
- 用 `java.ajaxAll(urls, false)` 每波并行最多 4 个请求，波间隔约 500 ms。
- 按原文和目标语言缓存翻译结果；失败的批次保留原文，避免整页失败。
- `concurrentRate: "1"` 是书源请求频率限制（约每 1 ms），不是“翻译串行”。

### 7.6 手机验证最低标准

不要只验证一个可访问页面。至少覆盖：本站长文、列表中真实站外文章，以及一个可触发 Next.js/RSC 回退的页面。WebSocket 调试输出必须确认“正文页解析完成”，并抽查正文首段、尾段和图片；同时确认没有导航、推荐文章或脚本数据混入正文。

## 8. 全量 Common-only 网络公共库

### 8.1 发布范围与固定版本

只共享 `booksource/runtime/legado-shared-runtime.js`，包含大库和通用登录 UI/设置/验证函数；站点参数、真正的登录 URL、WAF/IEEE 请求规则继续内联。不要新增远端 sites 模块，不要发布手机源、Cookie、登录信息或调试备份。

公共库发布在 `common-runtime` 分支。当前 v3 的完整 commit：

```text
47c94d927ecbefbea6c3f828ecdb522918bd2b5d
https://raw.githubusercontent.com/wanghaosjtu/booksrc/47c94d927ecbefbea6c3f828ecdb522918bd2b5d/booksource/runtime/legado-shared-runtime.js
```

全量迁移 canonical 的每个唯一身份，包括 disabled、空 jsLib、自定义库及音频源。中国社会科学期刊的 `burl`、Test 的 `datestr` 必须保留。以下三个历史试点的身份仍不能按名称改写：

| 试点 | bookSourceUrl |
|------|---------------|
| IEEE | `https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=` |
| State.gov | `https://www.state.gov` |
| China Daily | `https://carnegieendowment.org/`（现有身份，不改名为新 URL） |

### 8.2 加载器、配置与缓存

加载器内联在全部 jsLib，只有两行：未使用 common 的源不联网；第一次 common(java) eval 当前调用者的 importScript 文本，成功后缓存 API。调用为 `common(java).TT/TH/...`，无 factory/桥接/版本检查/错误包装，保留原始错误。

- `importScript` **返回文本，不会执行脚本**。不要只调用它而省略求值。
- API 不捕获首调用者的 java/cache/站点设置，后续调用使用明确参数；只保留被引用的内联变量。
- UI 用 `@js:common(java).loginUi()` 或传入行名/自定义行；设置用 `common(java).login(java,result,options)`，check 用 `common(java).check(result,java,options)`。未知登录脚本/动作不得按函数名猜测删除。
- 不使用混合「公共库 URL + 内联 site 字符串」的 JSON map；Legado 的 map 加载分支会忽略非 URL 字符串。
- 首次加载需联网，失败不静默退回旧库。若 ajax/eval 很快而 importScript/cache.get 挂住，用只读线程投影确认 CacheManager 锁；不要添加掩盖故障的回退。
- `importScript` 按 URL 缓存下载文件，和原生 `jsLib` 的 ACache 不是同一份缓存；升级要发布新 commit 并更换固定 URL，不依赖移动分支覆盖缓存。

`ruleContent.webJs` / URL 选项的 webJs 是普通浏览器环境，不注入 Rhino 的 `java`。33 个已审计的大脚本现用两行浏览器加载器：同步 CORS XMLHttpRequest 读取同一固定 SHA，成功 eval 后缓存 API，再调用 `webClean(document,options)`。HTTP 非 200、脚本/DOM 错误不静默回退。不要再次写 `java.importScript`；只有 `<webjs>` 正文规则的另一条 `isRule=true` 路径有 Java bridge。实际站点的 CSP/connect-src/unsafe-eval、网络和 Android WebView 可用性仍须验收；浏览器本地测试不能代替手机结果。

PMA search 的已审计 `auto_clean_up` 保留手动入口，但不再内联 43 KB Readability；浏览器加载器后调用 `window.legadoCommon.browserReadable(document,true)`，再更新 body。`true` 保留原 JS 精简后的严格异常和 module.exports 行为；普通 webClean 仍保留第三方 Readability 对畸形页面属性的兼容处理。只匹配原始/精简后完整 AST 指纹及本次生成的完整委托函数；用户编辑过的 helper 不猜测替换。

### 8.3 IEEE HTML 与 SVG 规则

IEEE 保持默认 HTML，并尊重显式 TEXT；只包装不含图片的 h1–h6/blockquote，公式留在原位置，不整篇包装/拆行/转 PNG。调用为 `common(java).ltUseHtmlBlocks(html,java,options)`，不再传 pageUrl，不生成嵌套包装。

Nature 用一次 TH，提取选择器明确传入；求是只调用图片 helper，不翻译/强制 HTML。图片相对地址交给原生 Formatter；保留明确的站点图片锚点选项，不再重复清理属性。

包含 TeX 的请求选项用安全 JSON 编码，避免 `{{d\mathrm{snr}…}}` 被规则分析器误当 JavaScript。只转义 JSON 字符串中的规则标记，解码后的正文、TeX、请求头和 body 必须逐字一致；禁止替换或删除原始反斜杠。

CodeCogs 公式图片使用如下别名：

```text
https://latex.codecogs.com/svg.latex.svg?ENCODED_TEX,{"js":"String(result).replace('/svg.latex.svg?', '/svg.latex?')"}
```

缓存/导出从 URL 识别 `.svg`，真正网络请求还原为 CodeCogs 的 `svg.latex` 端点。这样不必改 App，就能避免将 SVG 导出成 `.latex`、让 EPUB 的资源类型识别为 `image/svg+xml`。验收时仍须检查完整手机导出的 EPUB，不能仅凭 URL 后缀宣称成功。

2026-11-07 的真实单章手机导出已验证 `.svg` 文件、`image/svg+xml`、原生缓存逐字节一致以及 calibre 6.0 的实际公式显示，记录见 `booksource/common-runtime-validation-report.md`。这不等于 IEEE 整书逐图验收或 EPUBCheck 标准合规：Legado 仍导出 `<usehtml>`/块元素套 `p` 和非自闭合 `img`，calibre 会容错按 HTML 读取，严格 XHTML 阅读器的兼容性应另测。

### 8.4 定向迁移与回滚资料

手机只用 HTTP/WS，不用 MCP/ADB。默认 localhost；若用户授权备用 10.92.24.102，可设 LEGADO_PHONE 做独立测试，不能拿原设备备份跨设备覆盖。全量部署仍绑定原备份 host；修改前完整备份。发布只改变 common runtime，不推工作分支/手机源；raw 文件逐字节一致后生成候选。私有目录/文件保持 700/600，且 Git ignored：

```sh
node tools/shared_common_phone.js snapshot booksource/.usehtml-validation-phone/<new-run>
node tools/simplify_source_js.js <full-commit-sha> booksource/.usehtml-validation-phone/<new-run> --dry-run
node tools/simplify_source_js.js <full-commit-sha> booksource/.usehtml-validation-phone/<new-run> --write
python3 tools/validate_translation_sources.py
node tools/shared_common_phone.js deploy booksource/.usehtml-validation-phone/<new-run> booksource/.usehtml-validation-phone/<new-run>/phone-priority-candidate.json
# Nature / 求是 / IEEE 验证后，分批继续全部候选（已部署对象只核对，不重复覆盖）
node tools/shared_common_phone.js deploy booksource/.usehtml-validation-phone/<new-run> booksource/.usehtml-validation-phone/<new-run>/phone-targets-candidate.json
node tools/shared_common_phone.js verify booksource/.usehtml-validation-phone/<new-run>
```

迁移按 AST 拆分所有内联/网络 common，保留标记前后站点代码，拒绝混合声明/未知猴补丁。无 common 的可选 TH 分支只接入图片处理，不意外开启翻译。候选基于最新手机对象，保留手机登录、名称、非正文规则、启用状态等用户差异；本地 canonical 的无关字段也不改。部署前比较当前源与完整备份，发现用户改动就停止；保存后完整读回并为每源写私有 journal。只读连接重置可有限重试，写入错误须先读回，不盲目重发。不要重复同一目录的 `--write`。

`phone-priority-candidate.json` 是从全量候选精确筛选上述三个身份的私有文件；不是完整验收。`verify` 必须核对全部 canonical 候选和未迁移的实验源。回滚只恢复 `phone-targets-before.json` 中实际部署的对象，先确认当前源仍等于本次部署版本；不要导入整个备份覆盖其他源，不清除原书缓存。

### 8.5 回归与手机验收

本地回归：

```sh
node --test tools/tests/*_test.js
python3 tools/test_runtime_only_sync.py
python3 tools/validate_translation_sources.py
```

真实引擎测试还需配置 `USEHTML_JAVA_HOME`、`USEHTML_ENGINE_JAR`、`USEHTML_JSOUP_JAR`、`USEHTML_KOTLIN_LIB` 和 `USEHTML_IEEE_CAPTURE`；真实浏览器回归配置 `USEHTML_CHROME_BIN` 指向已验证的 Chrome 可执行文件，使用新临时 profile 和两端口 CORS 测试服务器，不借用登录会话。未配置或测试 skipped 不代表已通过 Android 验收。

`shared_common_smoke.js webview` 通过真实 URL `webView:true` / `webJs` 路径访问手机自身的健康端点，只替换这次独立页面的 DOM，并读取固定 SHA 公共库；错误以失败 metrics 返回，不冒充可读正文。`diagnostic ... webview-control` 不加载库、不访问外网。不要用 AnalyzeUrl bodyJs 内嵌的阻塞 `java.webView` 调用作为该生产路径的验收。AnalyzeUrl 的 timeout 仅约束 HTTP 读取，不覆盖 BackstageWebView 默认 60 秒期限；WS 客户端现留 75 秒收取真实原生错误，不能用先前 25 秒客户端取消诊断具体 Native 根因。2026-11-08 已收取最小原生对照的 `TimeoutCancellationException: Timed out waiting for 60000 ms`，无 browser metrics。最新 SHA 的原机 importScript 短样本 1,349 ms、全部指标通过；旧缓存/SVG 证据与新发布区分记录。备用机旧 CacheManager 锁未解，不向它重复追加需缓存的探测。Native 未通过前不批量部署。

先用 `tools/shared_common_smoke.js` 建立新版本的独立短样本，覆盖真实 `importScript`、调用者隔离、原始公式编码、图片 `.svg`、图片 URI、HTML 解包和重复处理。优先部署 Nature、求是、IEEE，验证实际规则后继续全部源并全量读回。检查 IEEE `document/9737357` 的 HTML/TEXT、独立缓存重读、图片渲染；WAF、认证、服务超时单独记录为 BLOCKED，不算网站全流程通过。测试结束用 `cleanup` 只删除本次拥有且未被用户修改的短源/测试书，保留旧验证源、原书和原缓存。

严格区分 108 源字段保全、54 源翻译结构、实机与站点可用性。当前 v3 本地记录见 `booksource/source-js-simplification-report.md`；v2 全量部署见 `booksource/shared-common-all-sources-report.md`，旧 v1 EPUB/calibre 见 `booksource/common-runtime-validation-report.md`。缓存锁阻塞、WAF/认证均不算通过，不把旧证据当作新版本验收。

`tools/shared_common_epub.js cache` 可用受支持的 `java.getFile/readFile` 读回**本次独立书籍**的 SVG 缓存。当前 HTTP 没有 EPUB 导出端点，RhinoClassShutter 明确屏蔽 `android.content.Intent`、`android.app.ActivityThread`、App Context 和数据库入口；不得通过反射绕过限制来启动 `ExportBookService`。需要本人在 App 导出独立验证书并提供完整 EPUB，再验收 ZIP/图片/OPF 和 calibre。旧附件缺 ZIP 尾目录或本地模拟 EPUB 都不能代替手机导出的完整文件。
