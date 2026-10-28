# book_source_debug_tool.ps1 使用说明

## 简介

`book_source_debug_tool.ps1` 是一个通过 WebSocket 连接调试 Legado-E 书源的 PowerShell 脚本。

## 位置

```
D:\workspace\booksrc\book_source_debug_tool.ps1
```

## 快速使用

```powershell
cd D:\workspace\booksrc
powershell -ExecutionPolicy Bypass -File .\book_source_debug_tool.ps1 -Mode <模式> -BookSourceUrl <书源URL> -Url <调试目标>
```

## 调试模式

| 模式 | 说明 | 输入格式 | 示例 |
|------|------|----------|------|
| `explore` | 调试发现页 | `分类名::URL` | `Analytics::https://russtrat.ru/analytics` |
| `info` | 调试详情页 | 裸 URL | `https://russtrat.ru/analytics/1782826463-13375` |
| `toc` | 调试目录页 | `++URL` | `++https://russtrat.ru/analytics/1782826463-13375` |
| `content` | 调试正文页 | `--URL` | `--https://russtrat.ru/chapter/20940996` |
| `search` | 搜索调试 | 关键词 | `关键词` |

## 示例

### 1. 调试详情页（最常用）

```powershell
powershell -ExecutionPolicy Bypass -File .\book_source_debug_tool.ps1 `
    -Mode info `
    -BookSourceUrl "https://russtrat.ru" `
    -Url "https://russtrat.ru/analytics/1782826463-13375"
```

输出：
```
========================================
 Legado-E Book Source Debug Tool
========================================

[INFO] Debug Mode: Info Page
[INFO] BookSource URL: https://russtrat.ru
[INFO] Debug URL: https://russtrat.ru/analytics/1782826463-13375
[INFO] WebSocket: ws://192.168.31.163:1123/bookSourceDebug

[1/4] Checking book source...
[+] Book source found: РУССТРАТ

[2/4] Connecting to WebSocket...
[+] WebSocket connected

[3/4] Sending debug request...
[+] Debug request sent
[*] Waiting for response...

[4/4] Receiving debug results:
----------------------------------------
[00:02.345] ⇒开始访问详情页:https://russtrat.ru/analytics/1782826463-13375
[00:02.456] ⇒开始解析详情页
[00:03.123] ︽详情页解析完成
[00:03.234] ≡已获取目录链接,跳过详情页
[00:03.345] ⇒开始访目录页:https://russtrat.ru/analytics/1782826463-13375
[00:03.456] ︾开始解析目录页
[00:04.567] ︽目录页解析完成
[00:04.678] ≡没有正文章节

========================================
[+] Debug Complete!
========================================
```

### 2. 调试正文页

```powershell
powershell -ExecutionPolicy Bypass -File .\book_source_debug_tool.ps1 `
    -Mode content `
    -BookSourceUrl "https://russtrat.ru" `
    -Url "https://russtrat.ru/analytics/1782826463-13375/20940996"
```

### 3. 调试发现页

```powershell
powershell -ExecutionPolicy Bypass -File .\book_source_debug_tool.ps1 `
    -Mode explore `
    -BookSourceUrl "https://russtrat.ru" `
    -Url "Analytics::https://russtrat.ru/analytics"
```

### 4. 跳过书源检查（书源未保存时）

```powershell
powershell -ExecutionPolicy Bypass -File .\book_source_debug_tool.ps1 `
    -Mode info `
    -BookSourceUrl "https://russtrat.ru" `
    -Url "https://russtrat.ru/..." `
    -SkipSourceCheck
```

## 参数说明

| 参数 | 类型 | 必填 | 说明 | 默认值 |
|------|------|------|------|--------|
| `-Mode` | string | 是 | 调试模式 | - |
| `-BookSourceUrl` | string | 是 | 书源 URL（完整 URL） | - |
| `-Url` | string | 是 | 调试目标（URL 或关键词） | - |
| `-ServerHost` | string | 否 | Legado-E 服务器 IP | 192.168.31.163 |
| `-WsPort` | int | 否 | WebSocket 端口 | 1123 |
| `-HttpPort` | int | 否 | HTTP API 端口 | 1122 |
| `-SkipSourceCheck` | switch | 否 | 跳过书源存在性检查 | false |

## 常见问题

### Q: 连接超时

**原因**：手机进入休眠模式或 Web 服务未开启

**解决**：
1. 确保 Legado-E 的「Web 服务」已开启
2. 保持手机亮屏或连接充电器
3. 检查 IP 地址是否正确

### Q: 书源未找到

**原因**：书源尚未保存到手机

**解决**：
1. 先通过 HTTP API 上传书源：
   ```powershell
   $json = Get-Content "书源.json" -Raw
   Invoke-WebRequest -Uri "http://192.168.31.163:1122/saveBookSource" -Method POST -Body $json -ContentType "application/json"
   ```
2. 或使用 `-SkipSourceCheck` 跳过检查

### Q: WebSocket 连接失败

**原因**：WebSocket 端口未开启

**解决**：
1. 在 Legado-E 设置中开启「Web 服务」
2. 检查端口配置（HTTP 端口 + 1 = WebSocket 端口）

## 工作原理

脚本通过 WebSocket 连接 Legado-E 的 `bookSourceDebug` 端点：

1. 发送 JSON 消息：`{"tag": "书源URL", "key": "调试目标"}`
2. Legado-E 执行对应的调试流程
3. 实时接收调试日志并显示

根据 `key` 的不同前缀，自动路由到不同的调试函数：

| key 格式 | 调试函数 |
|----------|----------|
| 裸 URL | `infoDebug` - 详情页 |
| `++` 前缀 | `tocDebug` - 目录页 |
| `--` 前缀 | `contentDebug` - 正文页 |
| `分类名::` 前缀 | `exploreDebug` - 发现页 |
| 无特殊前缀 | `searchDebug` - 搜索 |

## 相关文件

| 文件 | 说明 |
|------|------|
| `book_source_debug_tool.ps1` | WebSocket 调试工具 |
| `api_debug_tool.ps1` | HTTP API 调试工具 |
| `Legado-skills.md` | 书源编写完整指南 |
