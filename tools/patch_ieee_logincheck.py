#!/usr/bin/env python3
"""Move IEEE WAF handling to loginCheckJs and batch-translate JSON TOCs."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    ROOT / "booksource/legado-book-sources-current.json",
    ROOT / "booksource/BookSource_X6_legado-E-2.json",
]

LOGIN_CHECK = r'''function ieeeBody(response) {
    try { return String(response.body()); } catch (e) { return String(response || ""); }
}

function ieeeHasJsonShape(body) {
    var text = String(body || "").trim();
    if (!text || (text.charAt(0) !== "{" && text.charAt(0) !== "[")) return false;
    try {
        var value = JSON.parse(text);
        return !!value && (value.records !== undefined || value.totalPages !== undefined ||
            (value[0] && (value[0].articleTitle !== undefined || value[0].htmlLink !== undefined)));
    } catch (e) { return false; }
}

function ieeeHasArticle(body) {
    var doc = org.jsoup.Jsoup.parse(String(body || ""));
    return String(doc.select("div.document-text, div.abstract-text").text()).trim().length > 0;
}

function ieeeBlocked(body) {
    var html = String(body || "");
    var lower = html.toLowerCase();
    var markers = ["max challenge attempts exceeded", "aws waf", "awswaf",
        "access denied", "the request could not be satisfied"];
    var marked = false;
    for (var i = 0; i < markers.length; i++) {
        if (lower.indexOf(markers[i]) >= 0) { marked = true; break; }
    }
    if (!marked) return false;
    return !ieeeHasArticle(html) && !ieeeHasJsonShape(html);
}

function ieeeReferer(response) {
    try {
        var request = response.raw().request();
        return String(request.header("Referer") || request.header("Referrer") || "");
    } catch (e) { return ""; }
}

function ieeeVerificationUrl(response, body) {
    var isJson = ieeeHasJsonShape(body);
    var referer = ieeeReferer(response);
    if (isJson) return referer;
    return String(java.url || baseUrl || referer || "");
}

function ieeeRefetchAfterVerification() {
    try { return java.getStrResponse(); } catch (e) {
        java.log("IEEE WAF 原请求重取失败: " + e);
        return null;
    }
}

var ieeeResponse = result;
var ieeeInitialBody = ieeeBody(ieeeResponse);
if (ieeeBlocked(ieeeInitialBody)) {
    for (var ieeeAttempt = 1; ieeeAttempt <= 2; ieeeAttempt++) {
        var ieeeUrl = ieeeVerificationUrl(ieeeResponse, ieeeInitialBody);
        var ieeeDecodedUrl = ieeeUrl;
        try { ieeeDecodedUrl = decodeURIComponent(ieeeDecodedUrl); } catch (e) {}
        if (!/^https?:\/\//i.test(ieeeDecodedUrl) || ieeeDecodedUrl.indexOf("{{") >= 0 || ieeeDecodedUrl.indexOf("}}") >= 0) {
            java.log("IEEE WAF 无可用的人工验证 Referer，终止");
            throw "IEEE WAF 验证地址无效";
        }
        try {
            java.log("IEEE WAF 验证第" + ieeeAttempt + "次: " + ieeeDecodedUrl);
            java.startBrowserAwait(ieeeDecodedUrl, "IEEE 验证", false);
            var ieeeFresh = ieeeRefetchAfterVerification();
            var ieeeFreshBody = ieeeFresh == null ? "" : ieeeBody(ieeeFresh);
            if (ieeeFresh != null && !ieeeBlocked(ieeeFreshBody)) {
                ieeeResponse = ieeeFresh;
                break;
            }
            ieeeResponse = ieeeFresh;
            ieeeInitialBody = ieeeFreshBody;
            java.log("IEEE WAF 验证第" + ieeeAttempt + "次仍被拦截");
        } catch (e) {
            java.log("IEEE WAF 验证第" + ieeeAttempt + "次失败: " + e);
            ieeeResponse = null;
            ieeeInitialBody = "";
        }
        if (ieeeAttempt === 2) throw "IEEE WAF 验证失败";
    }
}
ieeeResponse;
'''


def patch(source):
    if source.get("bookSourceName") != "IEEE":
        return False
    source["loginCheckJs"] = LOGIN_CHECK
    toc = source.get("ruleToc") or {}
    chapter_list = str(toc.get("chapterList") or "")
    prefix = "<js>\nresult = TJ(result, java, cache);\nresult;\n</js>\n"
    if "result = TJ(result, java, cache);" not in chapter_list:
        toc["chapterList"] = prefix + chapter_list
    name = str(toc.get("chapterName") or "")
    if "TT(" in name:
        start = name.find("<js>")
        if start >= 0:
            name = name[:start].rstrip()
        toc["chapterName"] = name
    source["ruleToc"] = toc
    content = str((source.get("ruleContent") or {}).get("content") or "")
    marker = "function classifyIeeeResponse(body)"
    if marker in content and content.startswith("<js>"):
        end = content.find("</js>")
        if end >= 0:
            content = content[end + len("</js>"):]
            source["ruleContent"]["content"] = content
    return True


for path in FILES:
    data = json.loads(path.read_text(encoding="utf-8"))
    matches = [source for source in data if patch(source)]
    if len(matches) != 1:
        raise SystemExit(f"expected one IEEE source in {path}, got {len(matches)}")
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(path, "patched")
