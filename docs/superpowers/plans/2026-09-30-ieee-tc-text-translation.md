# IEEE TC Text-Node Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `TC` translate all eligible HTML text nodes while preserving the original markup and leaving IEEE body transformations in `prepareContent`.

**Architecture:** `TC(html, java, cache)` will parse its own HTML document, enumerate each element's direct text nodes, skip any node below a `notranslate` ancestor, submit the collected text in one `TT` call, and write translated strings back at the corresponding positions. `TT` and `TA` remain the sole translation transport/cache helpers; `prepareContent` remains the sole owner of formulas, images, node removal, and other body cleanup.

**Tech Stack:** Legado book-source JavaScript, Rhino, Jsoup, Microsoft Translator helper functions, Python 3.6 JSON assertions, Legado-E phone HTTP/WebSocket APIs.

## Global Constraints

- Modify only `ieee_back.json` and this plan's temporary validation artifacts; do not alter book identity, `webJs`, or WAF behavior.
- Keep explicit `java` and `cache` parameters on `TA`, `TT`, and `TC`.
- `TC` must not call `prepareContent`, `deferWafVerification`, `startBrowserAwait`, or any image/formula/removal API.
- Skip text nodes with a self or ancestor element carrying the `notranslate` class.
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Implement isolated TC text-node traversal

**Files:**
- Modify: `ieee_back.json` — `jsLib` `function TC(value,java,cache)`
- Test: `/tmp/opencode/validate_ieee_tc.py`

**Interfaces:**
- Consumes: `TT(texts, java, cache)`; it accepts either a string or array and returns the same shape.
- Produces: `TC(html, java, cache)`; it accepts an HTML string and returns the same document HTML with only eligible text-node values replaced.

- [ ] **Step 1: Write the failing static validator**

Create `/tmp/opencode/validate_ieee_tc.py` with Python 3.6-compatible checks:

```python
import json

source = json.load(open("ieee_back.json"))
lib = source["jsLib"]
content = source["ruleContent"]["content"]

assert "function TC(html,java,cache)" in lib
assert "textNodes()" in lib
assert "hasClass(\"notranslate\")" in lib
assert "TT(texts,java,cache)" in lib
assert "prepareContent(" not in lib[lib.index("function TC("):]
assert "deferWafVerification(" not in lib[lib.index("function TC("):]
assert "function prepareContent(html)" in content
assert "deferWafVerification();" not in content
print("TC structure checks passed")
```

- [ ] **Step 2: Run the validator and verify the pre-change failure**

Run:

```bash
python3 /tmp/opencode/validate_ieee_tc.py
```

Expected: `AssertionError` because current `TC` delegates directly to `TT` and does not traverse Jsoup text nodes.

- [ ] **Step 3: Replace TC with text-node-only translation logic**

Replace the direct `return TT(value,java,cache);` implementation with:

```javascript
function TC(html,java,cache){
    if (html == null || String(html).trim() === "") return html;
    var doc = org.jsoup.Jsoup.parse(String(html));
    var textNodes = [];
    var texts = [];
    var elements = doc.select("*");
    for (var i = 0; i < elements.size(); i++) {
        var element = elements.get(i);
        var ancestor = element;
        var skip = false;
        while (ancestor != null) {
            if (ancestor.hasClass("notranslate")) {
                skip = true;
                break;
            }
            ancestor = ancestor.parent();
        }
        if (skip) continue;
        var directTextNodes = element.textNodes();
        for (var j = 0; j < directTextNodes.size(); j++) {
            var node = directTextNodes.get(j);
            var text = String(node.getWholeText());
            if (text.trim() === "") continue;
            textNodes.push(node);
            texts.push(text);
        }
    }
    if (texts.length === 0) return doc.html();
    var translated = TT(texts,java,cache);
    for (var k = 0; k < textNodes.length; k++) {
        textNodes[k].text(String(translated[k]));
    }
    return doc.html();
}
```

- [ ] **Step 4: Run the static validator and JSON parse check**

Run:

```bash
python3 /tmp/opencode/validate_ieee_tc.py
python3 -c "import json; json.load(open('ieee_back.json')); print('JSON parse passed')"
```

Expected: `TC structure checks passed` followed by `JSON parse passed`.

### Task 2: Deploy and verify phone parity

**Files:**
- Modify: phone-side IEEE source through `POST /saveBookSource`
- Test: `/tmp/opencode/ieee_phone_tc.json`

**Interfaces:**
- Consumes: the verified local `ieee_back.json` object.
- Produces: a phone-side source whose JSON equals local source except for server-managed `lastUpdateTime`.

- [ ] **Step 1: Upload the single source object without proxy variables**

Run:

```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
  curl --fail-with-body --silent --show-error \
  -X POST 'http://10.92.27.11:1122/saveBookSource' \
  -H 'Content-Type: application/json' --data-binary @ieee_back.json
```

Expected: JSON response with `"isSuccess": true`.

- [ ] **Step 2: Read the source back and assert deployment parity**

Run:

```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
  curl --fail-with-body --silent --show-error -G \
  'http://10.92.27.11:1122/getBookSource' \
  --data-urlencode 'url=https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=' \
  -o /tmp/opencode/ieee_phone_tc.json
python3 -c "import json; local=json.load(open('ieee_back.json')); wire=json.load(open('/tmp/opencode/ieee_phone_tc.json')); remote=wire['data'] if 'data' in wire else wire; local.pop('lastUpdateTime',None); remote.pop('lastUpdateTime',None); assert local == remote; print('phone deployment parity passed')"
```

Expected: `phone deployment parity passed`.

- [ ] **Step 3: Run one WebSocket content debug and classify the result honestly**

Use the existing `book_source_debug_tool.ps1` where PowerShell is available, or a Python `websocket-client` script where it is not. Send:

```json
{
  "tag": "https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=",
  "key": "--https://ieeexplore.ieee.org/document/11354146"
}
```

Expected successful-path evidence: the trace reaches content processing with no `Reference Error Cache undefined`. If IEEE returns `ContentEmptyException` before content processing because of WAF, record that as an external WAF limitation; do not claim a successful content translation run and do not re-enable the intentionally inactive WAF helper.

- [ ] **Step 4: Remove temporary validation artifacts**

Run:

```bash
rm -f /tmp/opencode/validate_ieee_tc.py /tmp/opencode/ieee_phone_tc.json
```

Expected: no tracked project files are added beyond `ieee_back.json` and the approved design/plan documents.

## Plan Self-Review

- Spec coverage: Task 1 implements node traversal, `notranslate` skipping, batch translation, and TC isolation. Task 2 verifies deployment and records the WAF-dependent runtime boundary.
- Placeholder scan: no unfinished placeholders or unspecified validation commands remain.
- Interface consistency: all tasks use `TC(html, java, cache)` and `TT(texts, java, cache)` consistently.
