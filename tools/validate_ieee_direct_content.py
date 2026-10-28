#!/usr/bin/env python3
"""Structural contract for IEEE non-WebView full-text rules."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = json.loads((root / "booksource/legado-book-sources-current.json").read_text(encoding="utf-8"))
source = next(item for item in data if item.get("bookSourceName") == "IEEE")
chapter_url = source["ruleToc"]["chapterUrl"]
content = source["ruleContent"]["content"]
login = source["loginCheckJs"]
login_ui = json.loads(source["loginUi"])
assert chapter_url == "$.htmlLink"
assert "webView" not in chapter_url
assert "var ieeeFullTextUrl = 'https://ieeexplore.ieee.org/rest/document/' + ieeeDocumentId + '/?logAccess=true';" in content
assert "var ieeePageFailure = !ieeePageHtml.trim();" in content
assert "var ieeePageLower" not in content
assert "var ieeePageDoc = ieeePageFailure ? org.jsoup.Jsoup.parse('') : org.jsoup.Jsoup.parse(ieeePageHtml);" in content
assert "function ieeeArticleMetadata()" in content
assert "ieeeMetadataAbstractAdded" in content
assert "ieeeFallbackTocEntries" in content
assert "function ieeeInsertAbstract(block)" in content
assert "function ieeeInsertToc(block)" in content
assert "ieeeInsertBeforeFull" not in content
assert "h1.document-title, div.toc-container, div.abstract-text" in content
assert "var ieeeFullBody = ieeeFullDoc.select('div.document-text').first();" in content
assert "ieeeRawDoc = org.jsoup.Jsoup.parseBodyFragment('<div class=\"ieee-merged-content\"></div>');" in content
assert "ieeePageParts.get(ieeePageIndex).outerHtml()" in content
assert "ieeeFullBody.outerHtml()" in content
assert "ieee:article-metadata:v1:" not in content
assert "ieee-article-preamble" not in content
assert "'div.toc-container'" not in content[content.index("remove_selector:"):content.index("formula_mode:")]
assert "a.toc-link" not in content[content.index("remove_selector:"):content.index("formula_mode:")]
assert "formula_mode: 'codecogs'" in content
assert "image_anchor_mode: 'href'" in content
assert "image_anchor_options: {headers:{Referer:ieeeReferer}}" in content
assert "ieeexplore.ieee.org/mediastore/" in content and '"webView"' not in content
assert source["ruleContent"].get("webJs") == ""
assert "startBrowserAwait" not in login and "SourceUrl" in login
assert "IEEE 需要手动认证" in login
assert all(item.get("name") != "IEEE认证文章" for item in login_ui)
print("IEEE direct content contract passed")
