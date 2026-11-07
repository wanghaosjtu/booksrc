#!/usr/bin/env python3
"""Structural checks for all common-v3 sources and the formal translation set."""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
filename = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "booksource/legado-book-sources-current.json"
data = json.loads(filename.read_text(encoding="utf-8"))
runtime = (root / "booksource/runtime/legado-shared-runtime.js").read_text(encoding="utf-8")
loader = (root / "booksource/runtime/legado-common-loader.js").read_text(encoding="utf-8")
assert 'var LEGADO_SHARED_RUNTIME="3";' in runtime
assert all("function " + name + "(" in runtime for name in (
    "TT", "TJ", "TC", "TH", "ltExtract", "ltPrepareImages", "ltUseHtmlBlocks",
    "useHtmlRuleJson", "_ltPrepareImages", "_ltMarker", "_ltSplitLabeled",
    "_ltFallbackValues", "_ltLoginUi", "_ltLogin", "_ltCheck", "_ltReadableDocument", "_ltWebClean"))
assert "String(attr.getKey()) !== \"src\"" in runtime
assert 'Authorization:"Bearer "' in runtime
assert "svg.latex.svg?" in runtime
assert "translate/auth" not in runtime
assert "_ltResolveImage" not in runtime and "image_base_url" not in runtime
assert len(loader.strip().splitlines()) == 2
assert "eval(String(importer.importScript(" in loader
assert not any(token in loader for token in ("catch", "__ltCommonApi", "__ltBuildCommon", "LEGADO_COMMON_VERSION"))

network_marker = "/* legado-common-loader v3"
all_network = [s for s in data if network_marker in str(s.get("jsLib") or "")]
assert len(all_network) == len(data), "every canonical source must use common v3"
assert len(data) >= 108, "do not narrow the complete inventory"
assert len({s.get("bookSourceUrl") for s in data}) == len(data), "duplicate source identity"
commits = set()
for s in data:
    lib = s.get("jsLib", "")
    match = re.search(r'https://raw\.githubusercontent\.com/wanghaosjtu/booksrc/([0-9a-f]{40})/booksource/runtime/legado-shared-runtime\.js', lib)
    assert match, "immutable common URL missing: " + str(s.get("bookSourceName"))
    commits.add(match.group(1))
    assert lib.endswith(loader.replace("__COMMON_COMMIT__", match.group(1)))
    assert lib.count(network_marker) == 1
    assert "/* legado-translation-runtime v1" not in lib and "/runtime/sites/" not in lib
    assert "image_base_url" not in lib
    for key, value in s.items():
        if key.startswith("rule"):
            text = json.dumps(value, ensure_ascii=False)
            assert "translatetext" not in text and "translate/auth" not in text, s.get("bookSourceName")
    assert "image_base_url" not in str(s.get("ruleContent", {}).get("content", ""))
assert len(commits) == 1, "all source loaders must pin one full revision"

# Metadata is retained in canonical for inventory/validation. Runtime settings
# are explicit call options or referenced inline variables, not five dead vars.
sources = [s for s in data if s.get("toc_mode") in ("html", "json") and s.get("bookSourceName") != "Test"]
assert len(sources) == 54, "preserve the established formal translation set"
for s in sources:
    assert s.get("formula_mode") in ("none", "codecogs", "wiris")
    assert all(k in s for k in ("formula_selector", "remove_selector", "extract_selector"))
html = [s for s in sources if s.get("toc_mode") == "html"]
json_toc = [s for s in sources if s.get("toc_mode") == "json"]
assert html and json_toc and len(html) + len(json_toc) == len(sources)
compact = lambda value: re.sub(r"\s+", "", str(value))
toc = lambda s: compact(s.get("ruleToc", {}).get("chapterList", ""))
assert sum("common(java).TH(result,java,cache" in toc(s) for s in html) >= 38
assert all(toc(s).count(".TH(result") <= 1 for s in html)
assert all("TARGET_LANG=TARGET_LANG||" not in toc(s) for s in html)
assert all("common(java).TJ(" in toc(s) for s in json_toc)
assert all(".TT(" not in str(s.get("ruleToc", {}).get("chapterName", "")) for s in json_toc)
assert ":is(" not in json.dumps(sources, ensure_ascii=False)
expected_selectors = {
    "Science": ("nav", "#backmatter"),
    "ScienceDirect": ("div#publication", "#banner"),
    "Springer": ("#latest-content", ".c-article-header"),
    "IEEE": ("span.formula", "div.toc-container"),
    "Air &Space Forces Magazine": ("div.share-buttons", "main aside"),
    "Wiley": ("section.article-section__references", "mjx-container"),
}
by_name = {str(s.get("bookSourceName")): s for s in data}
for name, selectors in expected_selectors.items():
    assert all(css in by_name[name].get("remove_selector", []) for css in selectors), name

state = by_name["State.gov "]
assert "countries-areas-archive" in state["ruleExplore"]["bookList"]
assert all(css in state["remove_selector"] for css in (".wp-block-default-hero-container", ".bc_hide"))
assert ".TT(result,java,cache)" in compact(state["ruleToc"]["chapterName"])
assert ".TH(result,java,cache" in compact(state["ruleContent"]["content"])
journal = by_name["中国社会科学期刊"]
assert "sk_logo_sscp.png" not in journal["ruleBookInfo"]["coverUrl"]
assert all(s in journal["ruleBookInfo"]["coverUrl"] for s in ("sk02-zgxp-book0.png", ".list_text_left .list_img"))
assert "function burl(" in journal["jsLib"] and "function datestr(" in by_name["Test"]["jsLib"]
cas = by_name["中国科学院"]
assert "list.sort" in cas["ruleExplore"]["bookList"]
assert "webView" not in cas["ruleToc"]["chapterUrl"]
assert "/doi/getFulltext" in cas["ruleContent"]["content"] and "article.baseId" in cas["ruleContent"]["content"]
mid = by_name["МИД России (mid.ru)"]
assert len(mid["exploreUrl"].splitlines()) == 1
assert ".TT(result,java,cache)" in compact(mid["ruleToc"]["chapterName"])
inc = by_name["inc.com"]["ruleContent"]["content"]
assert "img[data-srcset]" in inc and "read-more" in inc
assert "java.webView" in inc and "startBrowserAwait" in inc
annual = by_name["Annual Review\u00a0"]
assert all("http://www.annualreviews.org" in annual[k] for k in ("exploreUrl", "searchUrl"))
assert "annualPrefix" in annual["ruleToc"]["chapterUrl"]
assert "webView" not in annual["ruleContent"]["content"]
assert all(s in annual["ruleContent"]["content"] for s in ("#html_fulltext", "#itemFullTextId[data-fulltexturl]", r"\/deliver\/fulltext\/"))
assert '"refetch":true' in compact(annual["loginCheckJs"])
assert "verified=j.connect(" in compact(runtime)
assert all("java.getStrResponse" not in str(s.get("loginCheckJs", "")) for s in data)
ieee = by_name["IEEE"]
assert ieee["ruleToc"]["chapterUrl"] == "$.htmlLink"
assert "/rest/document/" in ieee["ruleContent"]["content"]
assert ".TH(String(ieeeRawDoc.body().html()),java,cache" in compact(ieee["ruleContent"]["content"])
assert ".ltUseHtmlBlocks(" in ieee["ruleContent"]["content"]
assert "startBrowserAwait" not in ieee["loginCheckJs"]
assert all(s in ieee["loginCheckJs"] for s in ('"manual":true', "202,403,418"))
carnegie = by_name["Carnegie Mosco"]
assert "http://carnegie.ru/" in carnegie["exploreUrl"]
assert "https://carnegie.ru" not in str(carnegie["ruleToc"])
assert ".TH(result,java,cache" in toc(carnegie)
assert ".TT(result,java,cache)" in compact(carnegie["ruleToc"]["chapterName"])
readable = by_name["Carnegie endowment"]["ruleContent"]["content"]
assert "readable: true" in readable and "function extractReadableContent" not in readable
nature = by_name["Nature"]
assert "notranslate_selector" in nature["ruleContent"]["content"]
assert 'extract_selector: ["inline-formula tex-math"]' in nature["ruleContent"]["content"]
assert nature["loginUi"] == "@js:common(java).loginUi()"
qiushi = by_name["求是网"]["ruleContent"]["content"]
assert "common(java).ltPrepareImages(result, java)" in qiushi
assert not any(s in qiushi for s in (".TH(", ".TC(", "attributes().iterator()", "<usehtml>"))
assert "image_anchor_mode" in by_name["ScienceDirect"]["ruleContent"]["content"]
assert "image_alt_selector" in by_name["Wiley"]["ruleContent"]["content"]
for name in ("Oxford Academy", "Oxford Academy back"):
    text = by_name[name]["ruleToc"]["chapterList"]
    assert text.index("accessAttributesJson") < text.index(".TH(")
abstracted = [s for s in sources if any(t in str(s.get("ruleContent", {}).get("content", "")) for t in (".TH(", ".TC(", ".finish("))]
assert len(abstracted) >= 50
print("validated", len(data), "common-v3 sources;", len(sources), "formal translated sources;",
      len(html), "HTML TOCs;", len(json_toc), "JSON TOCs;", len(abstracted), "common content rules; one immutable revision")
