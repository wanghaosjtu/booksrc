# IEEE TC 文本结点翻译设计

## 目标

将 IEEE 书源的 `TC` 恢复为 HTML 文本结点翻译器：遍历 HTML，翻译需要翻译的文本结点，并保留原有标签与结构。

## 责任边界

`TC(html, java, cache)` 只负责：

1. 将输入 HTML 解析为 Jsoup 文档。
2. 遍历非空文本结点。
3. 跳过自身或祖先拥有 `notranslate` class 的文本结点。
4. 将待译文本按原始顺序收集，交给现有 `TT(texts, java, cache)` 批量翻译。
5. 将译文按相同索引回写到对应文本结点，并返回 HTML。

`TC` 不得删除或替换节点，不得处理图片、公式、DOM 清理、选择器移除或 WAF 验证。

## 正文规则边界

`ruleContent.content` 中的 `prepareContent` 继续单独负责正文处理，包括图片、公式、节点移除和其他 IEEE 正文结构调整。它可以调用 `TC` 取得结构不变的翻译 HTML，但不得把上述正文处理逻辑搬入 `TC`。

`deferWafVerification` 继续仅定义、不调用。

## 运行时与缓存

- `TC`、`TT`、`TA` 均显式接受 `java` 和 `cache`，避免共享 `jsLib` scope 中未绑定的 `cache`。
- `TC` 将数组交给 `TT`，沿用已有分批、翻译缓存和失败时保留原文的行为。
- 没有可翻译文本时，直接返回原 HTML。

## 验证标准

1. `TC` 是唯一负责文本节点翻译的 helper，不包含图片、公式、移除或 WAF API 调用。
2. `.notranslate` 内的文本保持原样；其他非空文本节点按文档顺序翻译并回写。
3. 翻译前后的 HTML 标签层级、属性和图片/公式节点保持不变。
4. `ruleContent.content` 仍独立包含 `prepareContent` 与现有正文处理。
5. 本地 JSON 静态断言、手机 API 回读和 WebSocket 规则调试均不再出现 `Cache undefined`。
