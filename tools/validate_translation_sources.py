#!/usr/bin/env python3
"""Structural checks for the formal translated source set."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = json.loads((root / "booksource/legado-book-sources-current.json").read_text(encoding="utf-8"))
runtime = (root / "booksource/runtime/legado-translation-runtime.js").read_text(encoding="utf-8")
assert all(token in runtime for token in ("function TT(", "function TJ(", "function TC(", "function TH("))
assert "function _ltPrepareImages(" in runtime
assert "String(attr.getKey()) !== \"src\"" in runtime
assert "if (!token) return scalar ? output[0] : output;" not in runtime
sources = [s for s in data if any(x in json.dumps(s, ensure_ascii=False).lower() for x in ("microsoft", "edge.microsoft.com", "translatetext")) and s.get("bookSourceName") != "Test"]
assert len(sources) == 55, len(sources)
for s in sources:
    assert "/* legado-translation-runtime v1" in s.get("jsLib", "")
    assert s.get("jsLib", "").count("/* legado-translation-runtime v1") == 1
    assert s.get("toc_mode") in ("json", "html")
    assert s.get("formula_mode") in ("none", "codecogs", "wiris")
    assert "formula_selector" in s and "remove_selector" in s and "extract_selector" in s
html = [s for s in sources if s.get("toc_mode") == "html"]
json_toc = [s for s in sources if s.get("toc_mode") == "json"]
assert len(html) == 49 and len(json_toc) == 6
assert sum("TH(result, java, cache" in str(s.get("ruleToc", {}).get("chapterList", "")) for s in html) >= 38
assert all("TARGET_LANG = TARGET_LANG ||" not in str(s.get("ruleToc", {}).get("chapterList", "")) for s in html)
assert all(str(s.get("ruleToc", {}).get("chapterList", "")).count("TH(result") <= 1 for s in html)
assert all("TJ(" in str(s.get("ruleToc", {}).get("chapterList", "")) for s in json_toc)
assert all("TT(" not in str(s.get("ruleToc", {}).get("chapterName", "")) for s in json_toc)
assert ":is(" not in json.dumps(sources, ensure_ascii=False)
expected_selectors = {
    "Science": ("nav", "#backmatter"),
    "ScienceDirect": ("div#publication", "#banner"),
    "Springer": ("#latest-content", ".c-article-header"),
    "IEEE": ("span.formula", "div.toc-container"),
    "Air &Space Forces Magazine": ("div.share-buttons", "main aside"),
    "Wiley": ("section.article-section__references", "mjx-container"),
}
for source_name, selectors in expected_selectors.items():
    source = next(s for s in sources if s.get("bookSourceName") == source_name)
    assert all(selector in source.get("remove_selector", []) for selector in selectors), source_name

by_name = {str(s.get("bookSourceName")): s for s in sources}
assert "notranslate_selector" in str(by_name["Nature"].get("ruleContent", {}).get("content", ""))
assert "image_anchor_mode" in str(by_name["ScienceDirect"].get("ruleContent", {}).get("content", ""))
assert "image_alt_selector" in str(by_name["Wiley"].get("ruleContent", {}).get("content", ""))
assert "https://mid.ru/" in str(by_name["МИД России (mid.ru)"].get("ruleContent", {}).get("content", ""))
assert "https://riss.ru/upload/" in str(by_name["俄罗斯战略研究所(RISS)"].get("ruleContent", {}).get("content", ""))
assert "ieeeBlocked" in str(by_name["IEEE"].get("loginCheckJs", ""))
assert "startBrowserAwait" in str(by_name["IEEE"].get("loginCheckJs", ""))
content_abstracted = [s for s in sources if "TH(result" in str(s.get("ruleContent", {}).get("content", "")) or "TC(" in str(s.get("ruleContent", {}).get("content", ""))]
assert len(content_abstracted) >= 50
assert all("translatetext" not in str(s.get("ruleContent", {}).get("content", "")) for s in sources)
state = next(s for s in sources if str(s.get("bookSourceName", "")).strip() == "State.gov")
assert ".wp-block-default-hero-container" in state.get("remove_selector", [])
assert ".bc_hide" in state.get("remove_selector", [])
assert "TT(result, java, cache)" in str(state.get("ruleToc", {}).get("chapterName", ""))
assert "TH(result,java,cache" in str(state.get("ruleContent", {}).get("content", ""))
print("validated", len(sources), "formal translated sources;", len(html), "HTML TOCs;", len(json_toc), "JSON TOCs;", len(content_abstracted), "abstracted content rules")
