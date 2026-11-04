# 六个书源修复与验证

日期：2026-11-02。手机：10.92.27.92:1122。

六源已同步到手机并回读。活动规则保存在
[legado-book-sources-current.json](../booksource/legado-book-sources-current.json)，
本次六源导入文件为
[legado-six-source-repairs.json](../booksource/legado-six-source-repairs.json)。

## 六项结果

| 书源 | 已实现 | 手机实测 |
| --- | --- | --- |
| Carnegie Moscow | 保留可选代理；HTTP 目录、分页与正文；空下一页不再回到首页；删除相关推荐；CSS 主图转为正文图片 | 俄语目录两页各 20 条，三篇正文可翻译。最终 /commentary/86147 为 5,640 字、35 段、1 张主图 |
| 中国社会科学期刊 | 详情自身封面优先，再匹配期刊门户封面；缺失时使用 sk02-zgxp-book0.png，不再使用网站 Logo | 三种期刊取得不同实际封面；另外三个旧路径使用已验证的 PNG 期刊封面回退 |
| mid.ru | 一个发现入口，下设原有六本分类书；保留书籍 URL 身份、正文及登录规则；详情名称保留分类书名 | 手机规则引擎验证六本、六个唯一 URL；早期新闻/发言人/部长讲话目录为 20/20/10 条。最新联网复测出现连接中断，记为 BLOCKED |
| 中国科学院 | DOI 页面取得 articleBaseId，经基本信息 API 使用 article.baseId 请求 HTML 全文；补充图表；删除章节 WebView 配置 | 第 41/40 卷第 10 期分别 21/27 条。四篇 HTML 正文约 5,211～11,360 字，其中一篇有 2 图、1 表。当前及旧小写 catalog 条目明确显示 PDF-only 提示与原 PDF 链接 |
| Annual Reviews | 页面 → data-fulltexturl → 临时 docserver HTML 地址，全程 HTTP；验证浏览器仅用于验证，随后 HTTP 重取，不使用浏览器 DOM 作正文 | 两种期刊有 13/29 卷，最新一期各 20 篇；六篇真正中文正文约 1,672～22,270 字，图片保留，无脚本及 iframe 混入 |
| ProductPlan | 从 Resources 导航提取 Blog、Case Studies、Videos、Webinars、Templates、Glossary；真实资源卡片、去重、真实下一页；提取正文或媒体说明 | 六本唯一分类。首目录分别 21/8/30/77/30/27 条；Blog 下一页 20 条；Glossary 有真实分页；无下一页的栏目返回空。视频/Webinar 保留真实说明和原站链接，不生成转录 |

## 原站与网络限制

- 两台现有代理 dept-haow:9090、secure-proxy4.qualcomm.com:9090 的显式目录/正文请求在手机上出现超时或 DNS 失败；未计为代理成功。Carnegie 俄语内容可直接获取。
- Carnegie 英文目录抽样旧文章 85649、85669、85679 均跳转到首页，未取得原文；规则会报正文缺失，不把首页当文章。
- MID 最新新闻页及第二页返回 unexpected end of stream，重试仍受阻。旧 press_service/ 根目录、minister_meetings/、telephone_conversations/ 目录此前均为空；本次去重没有猜测替代分类地址。
- 社科期刊旧路径 zgxp_zgwxpp/、zgxp_zgshkxpj/、mxyj/ 未返回有效期刊页面。此次只修复封面回退，未声称修复其目录。
- PDF-only 条目和仅有媒体说明的资源均单独标记，不计作完整 HTML 正文。

## 回归与保护

- 本地规则测试：7/7 通过，包括幂等性、JavaScript 语法、非 WebView、并发修改拒绝及保护字段保留。
- 手机规则边界测试：16/16 通过，包括加载占位、docserver 二阶段请求、真实分页、封面优先级、主图及安全清理。
- 正式翻译源校验：54 个源，48 个 HTML 目录、6 个 JSON 目录、52 个统一正文规则，通过。
- IEEE 非 WebView 正文契约通过；共享翻译运行时和 App 本体未修改。
- 手机与本地均为 108 个源；未涉及的 102 个源与修改前备份逐源相同。六源名称、排序、启用状态、代理参数、登录入口与登录界面保留。
- 六源规则已接入现有两个重建脚本的最后阶段，避免旧模板重建时覆盖此次修复。
- 全量修改前备份和部署快照仅保存在私有临时目录，未放入导入文件或仓库。

## 复验命令

以下手机测试需要保留本次私有基线；导入文件可独立使用。

    node --test tools/test_six_source_repairs.js
    python3 tools/validate_translation_sources.py
    python3 tools/validate_ieee_direct_content.py
    node tools/test_six_sources_phone.js fixtures
    node tools/test_six_sources_phone.js annual
    node tools/test_six_sources_phone.js verify
    node tools/repair_six_sources.js bundle
