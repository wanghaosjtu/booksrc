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
assert "https://edge.microsoft.com/translate/auth" not in runtime
assert "function _ltAuth(" not in runtime
assert 'Authorization:\"Bearer \"' in runtime
assert "if (!token) return scalar ? output[0] : output;" not in runtime
network_marker = "/* legado-common-loader v1"
loader_template = (root / "booksource/runtime/legado-common-loader.js").read_text(encoding="utf-8")
shared_runtime = (root / "booksource/runtime/legado-shared-runtime.js").read_text(encoding="utf-8")
assert 'var LEGADO_SHARED_RUNTIME="1";' in shared_runtime
assert "function useHtmlRuleJson(" in shared_runtime and "function ltUseHtmlBlocks(" in shared_runtime
assert "svg.latex.svg?" in shared_runtime
# Detect network sources by their loader, not by an embedded translation URL.
sources = [s for s in data if s.get("toc_mode") in ("html", "json")
           and s.get("bookSourceName") != "Test"
           and ("/* legado-translation-runtime v1" in s.get("jsLib", "")
                or network_marker in s.get("jsLib", ""))]
network = [s for s in sources if network_marker in s.get("jsLib", "")]
if network:
    assert {s.get("bookSourceUrl") for s in network} == {
        "https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=",
        "https://www.state.gov", "https://carnegieendowment.org/"}, "only the three common pilots may migrate"
assert sources, "no formal translated sources"
assert len({s.get("bookSourceUrl") for s in sources}) == len(sources), "duplicate formal source URL"
for s in sources:
    js_lib = s.get("jsLib", "")
    if network_marker in js_lib:
        import re
        match = re.search(r'var LEGADO_COMMON_URL = "https://raw\.githubusercontent\.com/wanghaosjtu/booksrc/([0-9a-f]{40})/booksource/runtime/legado-shared-runtime\.js";', js_lib)
        assert match, "immutable common URL missing: " + str(s.get("bookSourceName"))
        assert js_lib.endswith(loader_template.replace("__COMMON_COMMIT__", match.group(1)))
        assert "/* legado-translation-runtime v1" not in js_lib
        assert "/runtime/sites/" not in js_lib
        assert "j.importScript(LEGADO_COMMON_URL)" in js_lib
    else:
        assert "/* legado-translation-runtime v1" in js_lib
        embedded_runtime = js_lib[js_lib.index("/* legado-translation-runtime v1"): ]
        assert embedded_runtime == runtime, s.get("bookSourceName")
        assert js_lib.count("/* legado-translation-runtime v1") == 1
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
journal_cover_rule = str(journal_all.get("ruleBookInfo", {}).get("coverUrl", ""))
assert "sk_logo_sscp.png" not in journal_cover_rule
assert "sk02-zgxp-book0.png" in journal_cover_rule and ".list_text_left .list_img" in journal_cover_rule
cas_all = all_by_name["中国科学院"]
assert "list.sort" in str(cas_all.get("ruleExplore", {}).get("bookList", ""))
assert "webView" not in cas_all["ruleToc"]["chapterUrl"]
assert "/doi/getFulltext" in cas_all["ruleContent"]["content"]
assert "article.baseId" in cas_all["ruleContent"]["content"]
assert len(all_by_name["МИД России (mid.ru)"]["exploreUrl"].splitlines()) == 1
assert "TT(result,java,cache)" in str(all_by_name["МИД России (mid.ru)"].get("ruleToc", {}).get("chapterName", ""))
assert "img[data-srcset]" in str(all_by_name["inc.com"].get("ruleContent", {}).get("content", ""))
assert "read-more" in str(all_by_name["inc.com"].get("ruleContent", {}).get("content", ""))
annual = all_by_name["Annual Review\u00a0"]
assert "http://www.annualreviews.org" in str(annual.get("exploreUrl", ""))
assert "http://www.annualreviews.org" in str(annual.get("searchUrl", ""))
assert "annualPrefix" in str(annual.get("ruleToc", {}).get("chapterUrl", ""))
assert "webView" not in annual["ruleContent"]["content"]
assert "#html_fulltext" in annual["ruleContent"]["content"]
assert "#itemFullTextId[data-fulltexturl]" in annual["ruleContent"]["content"]
assert r"\/deliver\/fulltext\/" in annual["ruleContent"]["content"]
assert "sixResponse=java.connect" in annual["loginCheckJs"]
assert "startBrowserAwait" in str(all_by_name["inc.com"].get("ruleContent", {}).get("content", ""))
assert "java.webView" in str(all_by_name["inc.com"].get("ruleContent", {}).get("content", ""))
assert all("java.getStrResponse" not in str(x.get("loginCheckJs", "")) for x in data)
assert all("cfResponse=java.startBrowserAwait(cfUrl,\"Cloudflare人工验证\",true)" not in str(x.get("loginCheckJs", "")) for x in data)
ieee_rule = all_by_name["IEEE"]
assert str(ieee_rule.get("ruleToc", {}).get("chapterUrl", "")) == "$.htmlLink"
assert "webView" not in str(ieee_rule.get("ruleToc", {}).get("chapterUrl", ""))
assert "/rest/document/" in str(ieee_rule.get("ruleContent", {}).get("content", ""))
assert "startBrowserAwait" not in str(ieee_rule.get("loginCheckJs", ""))
assert "TH(result, java, cache" in str(by_name["Carnegie Mosco"].get("ruleToc", {}).get("chapterList", ""))
assert "TT(result, java, cache)" in str(by_name["Carnegie Mosco"].get("ruleToc", {}).get("chapterName", ""))
carnegie = by_name["Carnegie Mosco"]
assert "http://carnegie.ru/" in str(carnegie.get("exploreUrl", ""))
assert "https://carnegie.ru" not in str(carnegie.get("exploreUrl", ""))
assert "https://carnegie.ru" not in str(carnegie.get("ruleToc", {}))
assert "notranslate_selector" in str(by_name["Nature"].get("ruleContent", {}).get("content", ""))
assert "image_anchor_mode" in str(by_name["ScienceDirect"].get("ruleContent", {}).get("content", ""))
assert "image_alt_selector" in str(by_name["Wiley"].get("ruleContent", {}).get("content", ""))
assert "https://mid.ru/" in str(by_name["МИД России (mid.ru)"].get("ruleContent", {}).get("content", ""))
assert "https://riss.ru/upload/" in str(by_name["俄罗斯战略研究所(RISS)"].get("ruleContent", {}).get("content", ""))
assert "ieeeBlocked" in str(by_name["IEEE"].get("loginCheckJs", ""))
assert "TH(String(ieeeRawDoc.body().html()), java, cache" in str(by_name["IEEE"].get("ruleContent", {}).get("content", ""))
content_abstracted = [s for s in sources if any(marker in str(s.get("ruleContent", {}).get("content", "")) for marker in ("TH(result", "TC(", "sixFinish(out"))]
assert len(content_abstracted) >= 50
assert all("translatetext" not in str(s.get("ruleContent", {}).get("content", "")) for s in sources)
state = next(s for s in sources if str(s.get("bookSourceName", "")).strip() == "State.gov")
assert ".wp-block-default-hero-container" in state.get("remove_selector", [])
assert ".bc_hide" in state.get("remove_selector", [])
assert "TT(result, java, cache)" in str(state.get("ruleToc", {}).get("chapterName", ""))
assert "TH(result,java,cache" in str(state.get("ruleContent", {}).get("content", ""))
print("validated", len(sources), "formal translated sources;", len(html), "HTML TOCs;", len(json_toc), "JSON TOCs;", len(content_abstracted), "abstracted content rules;", len(network), "network common pilots")
