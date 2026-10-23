#!/usr/bin/env python3
"""Structural checks for the formal translated source set."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = json.loads((root / "booksource/legado-book-sources-current.json").read_text(encoding="utf-8"))
runtime = (root / "booksource/runtime/legado-translation-runtime.js").read_text(encoding="utf-8")
assert all(token in runtime for token in ("function TT(", "function TJ(", "function TC(", "function TH("))
assert "function _ltPrepareImages(" in runtime
assert "function _ltMarker(" in runtime
assert "function _ltSplitLabeled(" in runtime
assert "function _ltFallbackValues(" in runtime
assert "String(attr.getKey()) !== \"src\"" in runtime
assert "if (!token) return scalar ? output[0] : output;" not in runtime
all_translation_sources = [s for s in data if any(x in json.dumps(s, ensure_ascii=False).lower() for x in ("microsoft", "edge.microsoft.com", "translatetext")) and s.get("bookSourceName") != "Test"]
# The formal set is identified by the shared runtime and explicit translation metadata,
# not by a hand-maintained count. Legacy per-field sources may remain outside this set.
sources = [s for s in all_translation_sources
           if "/* legado-translation-runtime v1" in s.get("jsLib", "")
           and s.get("toc_mode") in ("html", "json")]
assert sources, "no formal translated sources"
assert len({s.get("bookSourceUrl") for s in sources}) == len(sources), "duplicate formal source URL"
for s in sources:
    assert "/* legado-translation-runtime v1" in s.get("jsLib", "")
    embedded_runtime = s.get("jsLib", "")[s.get("jsLib", "").index("/* legado-translation-runtime v1"): ]
    assert embedded_runtime == runtime, s.get("bookSourceName")
    assert s.get("jsLib", "").count("/* legado-translation-runtime v1") == 1
    assert s.get("toc_mode") in ("json", "html")
    assert s.get("formula_mode") in ("none", "codecogs", "wiris")
    assert "formula_selector" in s and "remove_selector" in s and "extract_selector" in s
html = [s for s in sources if s.get("toc_mode") == "html"]
json_toc = [s for s in sources if s.get("toc_mode") == "json"]
assert html and json_toc
assert len(html) + len(json_toc) == len(sources)
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
all_by_name = {str(s.get("bookSourceName")): s for s in data}
state_all = all_by_name["State.gov "]
assert "countries-areas-archive" in str(state_all.get("ruleExplore", {}).get("bookList", ""))
journal_all = all_by_name["中国社会科学期刊"]
assert "@data-src" in str(journal_all.get("ruleBookInfo", {}).get("coverUrl", ""))
cas_all = all_by_name["中国科学院"]
assert "list.sort" in str(cas_all.get("ruleExplore", {}).get("bookList", ""))
assert "TT(result,java,cache)" in str(all_by_name["МИД России (mid.ru)"].get("ruleToc", {}).get("chapterName", ""))
assert "img[data-srcset]" in str(all_by_name["inc.com"].get("ruleContent", {}).get("content", ""))
assert "read-more" in str(all_by_name["inc.com"].get("ruleContent", {}).get("content", ""))
assert all("java.getStrResponse" not in str(x.get("loginCheckJs", "")) for x in data)
assert all("cfResponse=java.startBrowserAwait(cfUrl,\"Cloudflare人工验证\",true)" not in str(x.get("loginCheckJs", "")) for x in data)
assert "startBrowserAwait(url, \"IEEE 验证\", true)" in str(all_by_name["IEEE"].get("loginCheckJs", ""))
assert "TH(result, java, cache" in str(by_name["Carnegie Mosco"].get("ruleToc", {}).get("chapterList", ""))
assert "TT(result, java, cache)" in str(by_name["Carnegie Mosco"].get("ruleToc", {}).get("chapterName", ""))
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
