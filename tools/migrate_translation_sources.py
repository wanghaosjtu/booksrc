#!/usr/bin/env python3
"""Inline the canonical translation runtime into the formal current source set."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "booksource/legado-book-sources-current.json"
LOGIN_BACKUP = ROOT / "booksource/BookSource_X6_legado-E-2.json"
LOGIN_FIELDS = ("loginUrl", "loginUi", "header", "enabledCookieJar")
# These are the fields owned by the translation abstraction. Every other
# source field must survive a migration byte-for-byte (apart from rule
# fragments that deliberately call TH/TJ).
TRANSLATION_FIELDS = {
    "jsLib", "ruleContent", "ruleToc", "remove_selector", "extract_selector",
    "toc_mode", "formula_mode", "formula_selector",
}
RUNTIME = (ROOT / "booksource/runtime/legado-translation-runtime.js").read_text(encoding="utf-8").rstrip()
MARKER = "/* legado-translation-runtime v1"

def source_identity(source):
    return (source.get("bookSourceName"), source.get("bookSourceUrl"))


def restore_login_fields(data):
    """Restore only user login/request fields; leave all rules and runtime intact."""
    backup = json.loads(LOGIN_BACKUP.read_text(encoding="utf-8"))
    backup_by_id = {source_identity(source): source for source in backup}
    current_ids = {source_identity(source) for source in data}
    if current_ids != set(backup_by_id):
        missing = sorted(set(backup_by_id) - current_ids)
        extra = sorted(current_ids - set(backup_by_id))
        raise SystemExit("login backup identity mismatch: missing=%r extra=%r" % (missing[:5], extra[:5]))
    for source in data:
        saved = backup_by_id[source_identity(source)]
        for field in LOGIN_FIELDS:
            if field in saved:
                source[field] = saved[field]
            else:
                source.pop(field, None)
    return len(backup_by_id)


def restore_nontranslation_fields(source, legacy_source):
    """Restore source metadata and rule branches unrelated to translation."""
    if not legacy_source:
        return

    # These rule objects are not touched by the translation abstraction.
    for key in ("ruleBookInfo", "ruleExplore", "ruleSearch"):
        if key in legacy_source:
            source[key] = legacy_source[key]
        else:
            source.pop(key, None)

    # Preserve every ruleToc branch except the two fields intentionally
    # rewritten below. This includes isVip/isPay, updateTime and pagination.
    old_toc = legacy_source.get("ruleToc")
    if isinstance(old_toc, dict):
        toc = source.get("ruleToc") if isinstance(source.get("ruleToc"), dict) else {}
        for key in list(toc):
            if key not in old_toc and key not in ("chapterList", "chapterName"):
                toc.pop(key, None)
        for key, value in old_toc.items():
            if key not in ("chapterList", "chapterName"):
                toc[key] = value
        source["ruleToc"] = toc

    # ruleContent has site-specific metadata in addition to content/webJs.
    old_content = legacy_source.get("ruleContent")
    if isinstance(old_content, dict):
        content = source.get("ruleContent") if isinstance(source.get("ruleContent"), dict) else {}
        for key in list(content):
            if key not in old_content and key != "content":
                content.pop(key, None)
        for key, value in old_content.items():
            if key != "content":
                content[key] = value
        source["ruleContent"] = content

    # A few non-rule values were changed by the previous bulk rewrite.
    for key in ("lastUpdateTime", "bookSourceComment", "searchUrl",
                "concurrentRate", "exploreUrl", "loginCheckJs", "variableComment"):
        if key in legacy_source:
            source[key] = legacy_source[key]
        else:
            source.pop(key, None)


def translated(source):
    text = json.dumps(source, ensure_ascii=False).lower()
    return "microsoft" in text or "edge.microsoft.com" in text or "translatetext" in text

def mode(source):
    name = str(source.get("bookSourceName", ""))
    if name == "Test":
        return None
    if name in ("Carnegie endowment", "Carnegie endowment back", "China Daily-search", "China Daily"):
        return "json"
    if name == "ScienceDirect":
        return "html-wiris"
    if name in ("IEEE", "Springer", "Springer back", "Springer-Book"):
        return "html-codecogs"
    return "html"

def kept_jslib(value):
    """Keep site/API declarations and remove every old/shared runtime copy."""
    text = value or ""
    if not isinstance(text, str):
        return ""
    marker_pos = text.find(MARKER)
    if marker_pos >= 0:
        return text[:marker_pos].rstrip()
    starts = []
    for needle in ("function TA(", "function TT(", "function TJ(", "function TC(", "function TH(", "function getAUTHkey("):
        pos = text.find(needle)
        if pos >= 0:
            starts.append(pos)
    return text[:min(starts)].rstrip() if starts else text.rstrip()

def rewrite_html_toc(value):
    """Replace the legacy translation-only JS prefix, retaining the selector suffix."""
    text = value or ""
    if not isinstance(text, str):
        return text
    text = text.replace("TARGET_LANG = TARGET_LANG || 'zh-Hans';", "if (typeof TARGET_LANG === 'undefined' || !TARGET_LANG) TARGET_LANG = 'zh-Hans';")
    if re.search(r"TH\s*\(\s*result\s*,\s*java\s*,\s*cache\b", text):
        return text
    start, end = text.find("<js>"), text.find("</js>")
    if start < 0 or end < start:
        return text
    block = text[start:end]
    if "edge.microsoft.com" not in block and "translatetext" not in block:
        return text
    replacement = "<js>\nif (typeof TARGET_LANG === 'undefined' || !TARGET_LANG) TARGET_LANG = 'zh-Hans';\nresult = TH(result, java, cache);\nresult;\n</js>"
    return text[:start] + replacement + text[end + len("</js>"):]

def normalize_toc_th_options(value):
    text = value or ""
    return text.replace(
        "TH(result, java, cache);",
        "TH(result, java, cache, {remove_selector:[], extract_selector:[], formula_mode:'none', formula_selector:''});",
    )


def ensure_html_toc_pipeline(value):
    """Run TH on an HTML TOC before chapter selectors are evaluated."""
    text = value or ""
    if not isinstance(text, str):
        return text
    prefix = ("<js>\n"
              "if (typeof TARGET_LANG === 'undefined' || !TARGET_LANG) TARGET_LANG = 'zh-Hans';\n"
              "result = TH(result, java, cache);\n"
              "result;\n</js>\n")
    # Remove every standard TH prefix from an earlier run, including calls
    # that already carry an options object. Then add exactly one prefix.
    standard = re.compile(
        r"<js>\s*if\s*\(typeof TARGET_LANG\s*===\s*['\"]undefined['\"]"
        r".*?result\s*=\s*TH\s*\(\s*result\s*,\s*java\s*,\s*cache\b.*?"
        r"result\s*;\s*</js>\s*", re.S)
    text = standard.sub("", text)
    # Repair an earlier idempotent run that placed the '-' modifier after JS.
    misplaced = "</js>\n-\n"
    if misplaced in text:
        before, selector = text.split(misplaced, 1)
        text = "-\n" + before + "</js>\n" + selector
    if "TH(result, java, cache)" in text:
        return text
    # A leading '-' belongs before the JS block, not in the CSS selector.
    if text.startswith("-"):
        return "-\n" + prefix + text[1:].lstrip("\n")
    return prefix + text.lstrip("\n")


def strip_chapter_name_translation(value):
    """Remove a redundant per-chapter TT block after the TOC was batched."""
    text = value or ""
    if not isinstance(text, str):
        return text
    start, end = text.find("<js>"), text.find("</js>")
    if start < 0 or end < start:
        return text
    body = text[start:end]
    if "TT(" not in body:
        return text
    return text[:start].rstrip() + text[end + len("</js>"):]


def rewrite_json_toc(value):
    text = value or ""
    if not isinstance(text, str) or re.search(r"TJ\s*\(\s*result\s*,\s*java\s*,\s*cache\b", text):
        return text
    start, end = text.find("<js>"), text.find("</js>")
    if start < 0 or end < start:
        return text
    block = text[start:end]
    if "edge.microsoft.com" not in block and "translatetext" not in block:
        return text
    replacement = "<js>\nresult = TJ(result, java, cache);\nresult;\n</js>"
    return text[:start] + replacement + text[end + len("</js>"):]


def ensure_json_toc_pipeline(value):
    """Run TJ once before JSON chapter selectors are evaluated."""
    text = value or ""
    if not isinstance(text, str) or "TJ(result, java, cache)" in text:
        return text
    prefix = "<js>\nresult = TJ(result, java, cache);\nresult;\n</js>\n"
    if text.startswith("-"):
        return "-\n" + prefix + text[1:].lstrip("\n")
    return prefix + text.lstrip("\n")


def js_array_assignment(text, name):
    """Extract a JavaScript array assigned to name, preserving its source syntax."""
    import re
    match = re.search(r"(?:var\s+)?" + re.escape(name) + r"\s*=\s*\[", text)
    if not match:
        return None
    start = text.find("[", match.start())
    depth = 0
    quote = None
    escape = False
    for index in range(start, len(text)):
        char = text[index]
        if quote:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote:
                quote = None
            continue
        if char in "'\"`":
            quote = char
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
    return None


def _strip_js_comments(value):
    """Remove JS comments while preserving quoted selector strings."""
    out = []
    i = 0
    quote = None
    escape = False
    while i < len(value):
        ch = value[i]
        if quote:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch in "'\"`":
            quote = ch
            out.append(ch)
            i += 1
        elif value.startswith("//", i):
            end = value.find("\n", i + 2)
            if end < 0:
                break
            out.append("\n")
            i = end + 1
        elif value.startswith("/*", i):
            end = value.find("*/", i + 2)
            if end < 0:
                break
            i = end + 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def parse_js_string_array(literal):
    """Parse the simple JS selector arrays used by the legacy sources."""
    import ast
    import re
    if not literal or not literal.startswith("["):
        return []
    body = _strip_js_comments(literal[1:-1])
    result = []
    for match in re.finditer(r"(['\"`])((?:\\.|[^\\])*?)\1", body, re.S):
        token = match.group(0)
        if token[0] == "`":
            value = token[1:-1].replace("\\`", "`").replace("\\\\", "\\")
        else:
            try:
                value = ast.literal_eval(token)
            except Exception:
                value = token[1:-1].replace("\\'", "'").replace('\\\"', '\"').replace("\\\\", "\\")
        if isinstance(value, str) and value.strip() and value not in result:
            result.append(value)
    return result


def selectors_from_text(text, name="remove_selector"):
    return parse_js_string_array(js_array_assignment(text or "", name))


def merge_selectors(*groups):
    result = []
    for group in groups:
        for value in group or []:
            if isinstance(value, str) and value.strip() and value not in result:
                result.append(value)
    return result


def js_array_span(text, name):
    """Return the bracket span for the first JS array assignment."""
    import re
    match = re.search(r"(?:var\s+)?" + re.escape(name) + r"\s*=\s*\[", text or "")
    if not match:
        return None
    start = text.find("[", match.start())
    depth = 0
    quote = None
    escape = False
    for index in range(start, len(text)):
        char = text[index]
        if quote:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote:
                quote = None
            continue
        if char in "'\"`":
            quote = char
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return start, index + 1
    return None


def replace_js_array_assignments(text, name, selectors):
    literal = json.dumps(selectors, ensure_ascii=False)
    value = text or ""
    output = []
    cursor = 0
    while cursor < len(value):
        span = js_array_span(value[cursor:], name)
        if not span:
            output.append(value[cursor:])
            break
        start, end = span
        start += cursor
        end += cursor
        output.append(value[cursor:start])
        output.append(literal)
        cursor = end
    return "".join(output)


def apply_remove_selectors(source, legacy_source):
    """Restore legacy cleanup selectors and apply them to every TH block."""
    legacy = selectors_from_text((legacy_source or {}).get("jsLib", ""))
    current = source.get("remove_selector") or []
    content = str((source.get("ruleContent") or {}).get("content", ""))
    content_current = selectors_from_text(content)
    selectors = merge_selectors(["script", "noscript", "style"], legacy, current, content_current)
    source["remove_selector"] = selectors
    source["jsLib"] = replace_js_array_assignments(source.get("jsLib", ""), "remove_selector", selectors)
    rule = source.get("ruleContent") or {}
    if isinstance(rule.get("content"), str):
        body = replace_js_array_assignments(rule["content"], "remove_selector", selectors)
        import re
        body = re.sub(r"remove_selector\s*:\s*\[\s*\]", "remove_selector:" + json.dumps(selectors, ensure_ascii=False), body)
        rule["content"] = body
        source["ruleContent"] = rule


def current_th_body(content):
    """Return only the current TH declarations/call, never old preprocessing."""
    text = content or ""
    found = None
    for match in re.finditer(r"<js>(.*?)</js>", text, re.S):
        body = match.group(1)
        if "TH(result" not in body:
            continue
        call = body.find("TH(result")
        start = body.rfind("var remove_selector", 0, call)
        if start < 0:
            start = body.rfind("var formula_mode", 0, call)
        if start < 0:
            start = body.rfind("var extract_selector", 0, call)
        if start < 0:
            start = body.rfind("result =", 0, call)
        end = body.find("result;", call)
        if end < 0:
            end = len(body)
        else:
            end += len("result;")
        found = body[start:end].strip()
    return found


def _blank_option_array(text, name):
    """Blank a JS option array while respecting ] characters in CSS strings."""
    value = text or ""
    pattern = re.compile(re.escape(name) + r"\s*:\s*\[")
    cursor = 0
    while True:
        match = pattern.search(value, cursor)
        if not match:
            return value
        start = value.find("[", match.start())
        depth = 0
        quote = None
        escape = False
        end = None
        for index in range(start, len(value)):
            ch = value[index]
            if quote:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == quote:
                    quote = None
                continue
            if ch in "'\"`":
                quote = ch
            elif ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    end = index + 1
                    break
        if end is None:
            return value
        value = value[:start] + "[]" + value[end:]
        cursor = start + 2


def _th_only_after_legacy_dom(th_body):
    """Avoid doing legacy cleanup twice while retaining TH's source options."""
    if not th_body:
        return None
    body = re.sub(r"remove_selector\s*:\s*remove_selector", "remove_selector:[]", th_body)
    body = re.sub(r"extract_selector\s*:\s*extract_selector", "extract_selector:[]", body)
    # The option arrays can contain CSS ] characters and escaped quotes. The
    # following delimiters are outside those strings and are unambiguous.
    body = re.sub(r"remove_selector\s*:\s*\[.*\]\s*,\s*extract_selector\s*:",
                  "remove_selector:[], extract_selector:", body, count=1, flags=re.S)
    body = re.sub(r"extract_selector\s*:\s*\[.*\]\s*,\s*formula_mode\s*:",
                  "extract_selector:[], formula_mode:", body, count=1, flags=re.S)
    return body.strip()


def strip_legacy_image_attribute_cleanup(value):
    """Keep lazy/anchor promotion but do not erase data-src before TH runs."""
    text = value or ""
    for selector in ('img[src]', 'img[loading=lazy]'):
        while True:
            start = text.find('doc.select("' + selector + '")')
            if start < 0:
                break
            open_brace = text.find('{', start)
            if open_brace < 0:
                break
            depth = 0
            quote = None
            escape = False
            end = None
            for index in range(open_brace, len(text)):
                ch = text[index]
                if quote:
                    if escape:
                        escape = False
                    elif ch == "\\":
                        escape = True
                    elif ch == quote:
                        quote = None
                    continue
                if ch in "'\"`":
                    quote = ch
                elif ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        tail = text.find(');', index)
                        if tail >= 0:
                            end = tail + 2
                        break
            if end is None:
                break
            line_start = text.rfind('\n', 0, start) + 1
            # Remove the preceding explanatory comment too, but only when it
            # clearly belongs to this image attribute loop.
            comment_start = text.rfind('// 仅遍历', line_start - 1, start)
            if comment_start >= line_start - 2:
                line_start = comment_start
            text = text[:line_start] + text[end:]
    return text


def preserve_legacy_dom_processing(source, legacy_content, current_content):
    """Replace only the old translation loop, retaining DOM/image/site code.

    The old sources commonly did useful work before constructing ``textNodes``:
    lazy-image promotion, anchor request headers, formula extraction, relative
    URL handling and source-specific cleanup.  Replacing the whole JS block
    erased that work.  This function cuts at the translation loop and inserts
    the canonical TH call after the original preprocessing.
    """
    if not isinstance(legacy_content, str) or not legacy_content:
        return None
    th_body = current_th_body(current_content)
    if not th_body:
        return None
    th_body = _th_only_after_legacy_dom(th_body)
    output = []
    cursor = 0
    changed = False
    for match in re.finditer(r"<js>(.*?)</js>", legacy_content, re.S):
        output.append(legacy_content[cursor:match.start()])
        block = match.group(1)
        is_translation = ("translatetext" in block or "getAUTHkey" in block or
                          ("textNodes" in block and "translate" in block))
        if "classifyIeeeResponse" in block:
            is_translation = False
        if is_translation and "var textNodes" in block:
            doc_match = re.search(r"(?m)^\s*(?:var\s+)?doc\s*=.*?;\s*$", block)
            text_match = re.search(r"(?m)^\s*var\s+textNodes\s*=", block)
            auth_match = re.search(r"(?m)^\s*function\s+getAUTHkey\s*\(", block)
            if doc_match and text_match:
                preamble = block[:auth_match.start() if auth_match else doc_match.start()]
                doc_and_prep = block[doc_match.start():text_match.start()]
                doc_and_prep = strip_legacy_image_attribute_cleanup(doc_and_prep)
                replacement = (
                    "\n" + preamble.rstrip() +
                    "\nvar html = String(result);\nvar Jsoup = org.jsoup.Jsoup;\n" +
                    doc_and_prep.strip() +
                    "\nresult = doc.html();\n" + th_body + "\nresult;\n"
                )
                output.append("<js>" + replacement + "</js>")
                changed = True
            else:
                # A small custom translator without text-node preprocessing is
                # handled by the current TH block; retain it unchanged here.
                output.append(match.group(0))
        elif "processHtml" in block and "remove_selector" in block and not is_translation:
            # 中国工程科学 has no translator in this block, but its cleanup is
            # still required before TH.
            clean = block.rstrip()
            if clean.endswith("cleanedHtml;"):
                clean = clean[:-len("cleanedHtml;")]
                clean += "result = cleanedHtml;\n" + th_body + "\nresult;"
                output.append("<js>" + clean + "</js>")
                changed = True
            else:
                output.append(match.group(0))
        else:
            output.append(match.group(0))
        cursor = match.end()
    output.append(legacy_content[cursor:])
    if not changed:
        return None
    return "".join(output)


def rewrite_embedded_translation(value, source):
    """Abstract legacy translation blocks without replacing sibling JS rules."""
    if not isinstance(value, str) or not ("translatetext" in value or "getAUTHkey" in value):
        return value
    if "<js>" not in value:
        return value

    def replace(match):
        block = match.group(1)
        if "translatetext" not in block and "getAUTHkey" not in block:
            return match.group(0)
        if "var doc" in block or "Jsoup.parse" in block:
            remove = json.dumps(source.get("remove_selector") or ["script", "noscript", "style"], ensure_ascii=False)
            return ("<js>result = TH(result, java, cache, {remove_selector:" + remove +
                    ", extract_selector:[], formula_mode:'none', formula_selector:''}); result;</js>")
        return "<js>result = TT(result, java, cache); result;</js>"

    return re.sub(r"<js>(.*?)</js>", replace, value, flags=re.S)


def rewrite_content(source, legacy_source=None):
    """Replace only copied Microsoft translators; retain site preprocessing."""
    rule = source.get("ruleContent") or {}
    content = rule.get("content")
    if not isinstance(content, str):
        return
    legacy_content = (legacy_source or {}).get("ruleContent", {}).get("content")
    preserved = preserve_legacy_dom_processing(source, legacy_content, content)
    if preserved is not None:
        rule["content"] = preserved
        source["ruleContent"] = rule
        return
    original_content = content
    content = content.replace("result=TC(result,java);", "result=TC(result,java,cache);")
    name = str(source.get("bookSourceName", ""))
    mode_value = source.get("formula_mode") or "none"
    selector_value = source.get("formula_selector") or ""
    blocks = []
    cursor = 0
    changed = content != original_content
    while True:
        start = content.find("<js>", cursor)
        if start < 0:
            break
        end = content.find("</js>", start)
        if end < 0:
            break
        block_end = end + len("</js>")
        block = content[start:block_end]
        body = block[len("<js>"): -len("</js>")]
        is_legacy = ("edge.microsoft.com" in body or "translatetext" in body or
                     ("getAUTHkey" in body and "textNodes" in body and "allTranslated" in body))
        is_cleanup_only = "processHtml" in body and "remove_selector" in body
        already_abstract = "TH(result" in body or "return TC(" in body or "result=TC(" in body
        if (is_legacy or is_cleanup_only) and not already_abstract and "classifyIeeeResponse" not in body:
            remove = js_array_assignment(body, "remove_selector") or str(source.get("remove_selector") or ["script", "noscript", "style"])
            extract = js_array_assignment(body, "extract_selector") or str(source.get("extract_selector") or [])
            formula_mode = mode_value
            if name == "ScienceDirect":
                formula_mode = "wiris"
            elif formula_mode == "none" and ("codecogs" in body.lower() or "formulaToImage" in body):
                formula_mode = "codecogs"
            formula_selector = selector_value
            if not formula_selector and formula_mode == "codecogs":
                formula_selector = "disp-formula, inline-formula, .InlineEquation, .Equation, math"
            if not formula_selector and formula_mode == "wiris":
                formula_selector = "math, mathml, .mathml"
            replacement = "<js>\n" + \
                "var remove_selector = " + remove + ";\n" + \
                "var extract_selector = " + extract + ";\n" + \
                "var formula_mode = " + repr(formula_mode) + ";\n" + \
                "var formula_selector = " + repr(formula_selector) + ";\n" + \
                "result = TH(result, java, cache, {remove_selector:remove_selector, extract_selector:extract_selector, formula_mode:formula_mode, formula_selector:formula_selector});\n" + \
                "result;\n</js>"
            blocks.append(content[cursor:start])
            blocks.append(replacement)
            cursor = block_end
            changed = True
            continue
        blocks.append(content[cursor:block_end])
        cursor = block_end
    if changed:
        blocks.append(content[cursor:])
        content = "".join(blocks)
    if content and "TH(result" not in content and "TC(" not in content:
        content = content.rstrip() + "\n<js>\nresult = TH(result, java, cache, {remove_selector:[], extract_selector:[], formula_mode:'none', formula_selector:''});\nresult;\n</js>\n"
        changed = True
    if changed:
        rule["content"] = content
        source["ruleContent"] = rule

def apply_site_specific_postprocessing(source):
    """Keep non-translation URL cleanup that used to follow old translators."""
    name = str(source.get("bookSourceName", "")).strip()
    rule = source.get("ruleContent") or {}
    content = rule.get("content")
    if not isinstance(content, str):
        return
    if name == "俄罗斯战略研究所(RISS)":
        if "https://riss.ru/upload/" not in content:
            content += ("\n<js>\n"
                        "result=String(result).replace(/src=\"\\/upload\\//g,'src=\"https://riss.ru/upload/')"
                        ".replace(/href=\"\\/news\\//g,'href=\"https://riss.ru/news/')"
                        ".replace(/href=\"\\/analitica\\//g,'href=\"https://riss.ru/analitica/');\n"
                        "result;\n</js>\n")
    elif name == "МИД России (mid.ru)":
        # This selector was part of the original DOM cleanup, not translation.
        remove = source.get("remove_selector") or []
        if ".masha_index" not in remove:
            source["remove_selector"] = list(remove) + [".masha_index"]
    elif name == "US Naval News":
        # A previous migration accidentally copied State.gov's URL rewrite.
        content = content.replace("\n<js>\nresult=String(result).replace(/src=\"\\//g,'src=\"https://www.state.gov/').replace(/href=\"\\//g,'href=\"https://www.state.gov/');\nresult;\n</js>\n", "\n")
    rule["content"] = content
    source["ruleContent"] = rule


def apply_state_special_rules(source):
    """Preserve State.gov's proven cleanup and per-title fallback behavior."""
    if str(source.get("bookSourceName", "")).strip() != "State.gov":
        return
    remove = [
        ".wp-block-default-hero-container", "script", "noscript", "style",
        "svg", ".bc_hide",
    ]
    source["remove_selector"] = remove
    source["extract_selector"] = []
    toc = source.get("ruleToc") or {}
    # TH handles the normal whole-page batch. If a later page's batch request
    # fails, retry only the still-English chapter title as a scalar fallback.
    toc["chapterName"] = ("a@text\n<js>\n"
                           "if (result && !/[\u4e00-\u9fff]/.test(String(result))) "
                           "result = TT(result, java, cache);\n"
                           "result;\n</js>")
    source["ruleToc"] = toc
    rule = source.get("ruleContent") or {}
    content = rule.get("content")
    if isinstance(content, str):
        options = json.dumps(remove, ensure_ascii=False)
        replacement = ("result=TH(result,java,cache,{remove_selector:" + options +
                       ",extract_selector:[],formula_mode:'none',formula_selector:''});")
        content = content.replace("result=TC(result,java,cache);", replacement)
        content = content.replace("result=TC(result,java);", replacement)
        postprocess = ("result=String(result).replace(/src=\"\//g,'src=\"https://www.state.gov/')"
                       ".replace(/href=\"\//g,'href=\"https://www.state.gov/');")
        if postprocess not in content:
            content = content.replace("result;\n</js>", postprocess + "\nresult;\n</js>", 1)
        rule["content"] = content
        source["ruleContent"] = rule


def assert_login_fields(data, backup_data, label):
    """Fail closed if migration changed the E-2 login/header baseline."""
    expected = {source_identity(source): source for source in backup_data}
    actual = {source_identity(source): source for source in data}
    if set(actual) != set(expected):
        raise SystemExit("%s: source identity mismatch" % label)
    errors = []
    for identity, source in actual.items():
        baseline = expected[identity]
        for field in LOGIN_FIELDS:
            if source.get(field) != baseline.get(field):
                errors.append((identity, field))
    if errors:
        raise SystemExit("%s: protected login fields changed: %r" % (label, errors[:10]))

def main():
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    backup_data = json.loads(LOGIN_BACKUP.read_text(encoding="utf-8"))
    backup_by_id = {source_identity(source): source for source in backup_data}
    # E-2 is the authoritative login/header baseline selected for this task.
    restore_login_fields(data)
    changed = 0
    selected = 0
    for source in data:
        if not translated(source):
            continue
        current_mode = mode(source)
        if current_mode is None:
            continue
        legacy_source = backup_by_id.get(source_identity(source))
        restore_nontranslation_fields(source, legacy_source)
        selected += 1
        source["remove_selector"] = source.get("remove_selector") or ["script", "noscript", "style"]
        source["extract_selector"] = source.get("extract_selector") or []
        source["toc_mode"] = "json" if current_mode == "json" else "html"
        source["formula_mode"] = "wiris" if current_mode == "html-wiris" else ("codecogs" if current_mode == "html-codecogs" else "none")
        source["formula_selector"] = ("math, mathml, .mathml" if current_mode == "html-wiris" else
                                       "disp-formula, inline-formula, .InlineEquation, .Equation, math" if current_mode == "html-codecogs" else "")
        old = kept_jslib(source.get("jsLib"))
        source["jsLib"] = (old + "\n\n" if old else "") + RUNTIME
        apply_remove_selectors(source, backup_by_id.get(source_identity(source)))
        toc = source.get("ruleToc") or {}
        if source.get("toc_mode") == "html":
            toc["chapterList"] = rewrite_html_toc(toc.get("chapterList"))
            # HTML TOCs are translated as one DOM batch. IEEE keeps its
            # special response parser and explicit chapter-name fallback.
            chapter_name = str(toc.get("chapterName") or "")
            if source.get("bookSourceName") != "IEEE":
                toc["chapterList"] = ensure_html_toc_pipeline(toc.get("chapterList"))
                toc["chapterList"] = normalize_toc_th_options(toc.get("chapterList"))
                if "TT(" in chapter_name:
                    toc["chapterName"] = strip_chapter_name_translation(chapter_name)
        else:
            toc["chapterList"] = rewrite_json_toc(toc.get("chapterList"))
            if source.get("bookSourceName") == "China Daily-search":
                toc["chapterList"] = ensure_json_toc_pipeline(toc.get("chapterList"))
            if "TJ(result, java, cache)" in str(toc.get("chapterList", "")):
                toc["chapterName"] = strip_chapter_name_translation(toc.get("chapterName"))
        source["ruleToc"] = toc
        rewrite_content(source, legacy_source)
        apply_remove_selectors(source, legacy_source)
        # Init/name/intro scripts can contain a second copy of the old
        # translator. Abstract those snippets too, while keeping their fields.
        for field in ("ruleBookInfo", "ruleExplore", "ruleSearch"):
            obj = source.get(field)
            if isinstance(obj, dict):
                for key, value in list(obj.items()):
                    if isinstance(value, str):
                        obj[key] = rewrite_embedded_translation(value, source)
        apply_state_special_rules(source)
        apply_site_specific_postprocessing(source)
        # Site-specific cleanup added above must also reach every inline TH call.
        apply_remove_selectors(source, legacy_source)
        changed += 1
    if selected != 55:
        raise SystemExit("expected 55 formal translated sources, found %d" % selected)
    restored = restore_login_fields(data)
    assert_login_fields(data, backup_data, "before writing formal source")
    SOURCE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("migrated", changed, "translated sources; restored login fields for", restored, "sources")

if __name__ == "__main__":
    main()
