# IEEE AWS WAF Source-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent AWS WAF challenge/error pages from being processed as IEEE article content, with at most two manual-confirmation WebView verification/refetch cycles.

**Architecture:** Add a small response classifier and a bounded `deferWafVerification` loop inside `ruleContent.content` in `ieee_back.json`. The loop is invoked immediately before the existing `prepareContent` pipeline, opens `startBrowserAwait(..., true)` only for positive WAF/error detections, and accepts only a fresh refetch containing expected IEEE content.

**Tech Stack:** Legado JavaScript rule engine (Rhino), Jsoup, Android native verification WebView, local WebSocket debugger at `ws://localhost:1123/bookSourceDebug`.

## Global Constraints

- Modify only `ieee_back.json` under `ruleContent.content` and add the temporary validator under `/tmp/opencode/`.
- Do not modify `jsLib`, `ruleContent.webJs`, `prepareContent`, TOC/search/explore rules, or Legado-E Kotlin.
- The source-only flow requires the reader to tap the verification browser's `✓` after a real IEEE page is visible.
- Use exactly `java.startBrowserAwait(baseUrl, "IEEE 验证", true)`; it refetches using persisted WebView cookies rather than accepting a transient DOM snapshot.
- Use only explicit WAF/error markers plus absent expected IEEE markup for block detection. Never decide from body length, a blind delay, URL shape, or browser close.
- Permit at most two verification/refetch cycles. Terminal failure returns `""` and logs the reason; it must not pass a known block page to `prepareContent`.
- Do not save the source to the phone or create a git commit during local contract testing. Phone deployment is a separate, explicit verification task.

---

### Task 1: Lock the WAF classifier and retry contract

**Files:**
- Create: `/tmp/opencode/validate_ieee_waf_contract.py`
- Test: `/tmp/opencode/validate_ieee_waf_contract.py`

**Interfaces:**
- Consumes: `ruleContent.content` from `ieee_back.json`.
- Produces: a zero-exit structural contract check for the active fallback call, marker-based classification, cookie refetch, and two-cycle limit.

- [ ] **Step 1: Write the failing contract validator**

```python
import json
from pathlib import Path

source = json.loads(Path("ieee_back.json").read_text(encoding="utf-8"))
content = source["ruleContent"]["content"]

required = [
    "function classifyIeeeResponse(body)",
    "div.document-text",
    "div.abstract-text",
    "max challenge attempts exceeded",
    "aws waf",
    "awswaf",
    "access denied",
    "the request could not be satisfied",
    "java.startBrowserAwait(baseUrl, \"IEEE 验证\", true)",
    "for (var attempt = 1; attempt <= 2; attempt++)",
    "result = deferWafVerification(result);",
    "result = prepareContent(result);",
]

for token in required:
    assert token in content, f"missing WAF contract token: {token}"

assert content.index("result = deferWafVerification(result);") < content.index(
    "result = prepareContent(result);"
), "verification must run before content processing"
assert "rawLen < 3000" not in content, "length-based WAF trigger must be removed"
print("IEEE WAF contract passed")
```

- [ ] **Step 2: Run the validator and confirm the current rule fails**

Run: `python3 /tmp/opencode/validate_ieee_waf_contract.py`

Expected: `AssertionError` for the missing active `classifyIeeeResponse` or active `deferWafVerification(result)` call, because the current fallback is unreachable.

### Task 2: Activate bounded WAF verification before content processing

**Files:**
- Modify: `ieee_back.json` — `ruleContent.content`, replacing the current dormant `deferWafVerification(content)` helper and changing the final call site before `prepareContent`.
- Test: `/tmp/opencode/validate_ieee_waf_contract.py`

**Interfaces:**
- Consumes: `content` as the fetched article HTML, source `baseUrl`, `java.startBrowserAwait`, and Jsoup.
- Produces: `classifyIeeeResponse(body)` returning `"CONTENT"`, `"BLOCKED"`, or `"UNKNOWN"`; `deferWafVerification(content)` returning acceptable article HTML or `""` after exhausted verification.

- [ ] **Step 1: Replace the dormant helper with the classifier and bounded retry loop**

Replace the current length-based `deferWafVerification` implementation with this code, retaining the surrounding content-rule structure:

```javascript
function classifyIeeeResponse(body) {
    var html = body == null ? '' : String(body);
    var lower = html.toLowerCase();
    var doc = org.jsoup.Jsoup.parse(html);
    var hasExpectedContent =
        String(doc.select('div.document-text').text()).trim().length > 0 ||
        String(doc.select('div.abstract-text').text()).trim().length > 0;
    var blockMarkers = [
        'max challenge attempts exceeded',
        'aws waf',
        'awswaf',
        'access denied',
        'the request could not be satisfied'
    ];
    var hasBlockMarker = false;
    for (var i = 0; i < blockMarkers.length; i++) {
        if (lower.indexOf(blockMarkers[i]) >= 0) {
            hasBlockMarker = true;
            break;
        }
    }
    if (hasExpectedContent && !hasBlockMarker) return 'CONTENT';
    if (hasBlockMarker && !hasExpectedContent) return 'BLOCKED';
    return 'UNKNOWN';
}

function deferWafVerification(content) {
    var current = content == null ? '' : String(content);
    if (classifyIeeeResponse(current) !== 'BLOCKED') return current;

    for (var attempt = 1; attempt <= 2; attempt++) {
        try {
            java.log('IEEE WAF 验证第' + attempt + '次：请在真实正文显示后点击确认');
            var response = java.startBrowserAwait(baseUrl, "IEEE 验证", true);
            current = response == null ? '' : String(response.body() || '');
            var state = classifyIeeeResponse(current);
            if (state === 'CONTENT') {
                java.log('IEEE WAF 验证第' + attempt + '次成功');
                return current;
            }
            if (state !== 'BLOCKED') {
                java.log('IEEE WAF 验证第' + attempt + '次返回未知页面，终止');
                return '';
            }
            java.log('IEEE WAF 验证第' + attempt + '次仍被拦截');
        } catch (e) {
            java.log('IEEE WAF 验证第' + attempt + '次失败: ' + e);
        }
    }
    java.log('IEEE WAF 验证已达到两次上限');
    return '';
}
```

- [ ] **Step 2: Activate the helper at the existing content pipeline boundary**

Replace the existing direct content-preparation call:

```javascript
result = prepareContent(result);
```

with:

```javascript
result = deferWafVerification(result);
result = prepareContent(result);
```

Do not change any code inside `prepareContent`, including formula conversion, cleanup, or translation.

- [ ] **Step 3: Run the contract validator**

Run: `python3 /tmp/opencode/validate_ieee_waf_contract.py`

Expected: `IEEE WAF contract passed`.

### Task 3: Verify local source integrity and rule scope

**Files:**
- Modify: none.
- Test: `ieee_back.json`, `/tmp/opencode/validate_ieee_waf_contract.py`

**Interfaces:**
- Consumes: the modified IEEE rule and static contract validator.
- Produces: syntactically valid JSON whose only source-rule changes are the WAF classifier, bounded verifier, and active invocation.

- [ ] **Step 1: Parse the book source JSON**

Run: `python3 -m json.tool ieee_back.json >/dev/null`

Expected: exit code `0`.

- [ ] **Step 2: Re-run the WAF contract validator**

Run: `python3 /tmp/opencode/validate_ieee_waf_contract.py`

Expected: `IEEE WAF contract passed`.

- [ ] **Step 3: Inspect only the intended diff**

Run: `git diff -- ieee_back.json docs/superpowers/specs/2026-10-02-ieee-waf-source-only-design.md docs/superpowers/plans/2026-10-02-ieee-waf-source-only.md`

Expected: the IEEE rule diff activates only the bounded WAF handling; documentation files describe the same source-only contract. Do not commit.

### Task 4: Perform bounded phone verification through WebSocket debugging

**Files:**
- Modify: none during this task; save the validated source to the phone only when device deployment is authorized.
- Test: `ws://localhost:1123/bookSourceDebug` with `https://ieeexplore.ieee.org/document/9390169/` and a known normal IEEE document.

**Interfaces:**
- Consumes: phone WebSocket debug bridge on port `1123`, deployed IEEE source, and the native verification browser.
- Produces: debug evidence that normal documents bypass verification and challenged documents stop after one successful or two failed verification cycles.

- [ ] **Step 1: Confirm the phone debug service is reachable**

Run: `nc -zv 127.0.0.1 1123`

Expected: successful TCP connection. Keep the phone awake while testing.

- [ ] **Step 2: Run a normal-body control request**

Send this WebSocket payload using the existing debug client:

```json
{
  "tag": "https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=",
  "key": "--https://ieeexplore.ieee.org/document/11354146"
}
```

Expected: no `IEEE WAF 验证第` log line; existing title, abstract/body, translation, and formula processing continue.

- [ ] **Step 3: Reproduce the challenged document and confirm first-cycle success**

Send:

```json
{
  "tag": "https://ieeexplore.ieee.org/xpl/mostRecentIssue.jsp?punumber=",
  "key": "--https://ieeexplore.ieee.org/document/9390169/"
}
```

When `IEEE 验证` opens, wait until the real IEEE document is visible and tap `✓` once.

Expected: a single `IEEE WAF 验证第1次成功` log line and readable extracted content. A WAF/error page must not appear in the final content.

- [ ] **Step 4: Confirm the retry ceiling**

Repeat the challenged request and close/confirm the browser while it remains blocked, or use a network state that keeps the WAF response blocked.

Expected: at most two `IEEE WAF 验证第N次` log entries, then `IEEE WAF 验证已达到两次上限`; no third browser opens and no challenge markup is processed as article content.

- [ ] **Step 5: Record the result without committing**

Record the document URL, whether verification succeeded on the first or second cycle, and the terminal log lines in the task report. Keep the local source and phone deployment changes uncommitted unless a separate explicit request authorizes a commit.

## Self-Review

- **Spec coverage:** Tasks 1–2 implement marker-plus-structure classification, the active invocation, `refetchAfterSuccess=true`, and the two-cycle fail-closed state machine. Task 3 validates JSON and source scope. Task 4 validates normal, first-success, and exhausted-retry behavior on the actual phone bridge.
- **Placeholder scan:** The plan has no TBDs or implied implementation steps; each source change and validation command is explicit.
- **Consistency:** `classifyIeeeResponse(body)` and `deferWafVerification(content)` are introduced in Task 2 and used under those exact names in Tasks 1–4. The verifier call consistently uses `startBrowserAwait(baseUrl, "IEEE 验证", true)`.
