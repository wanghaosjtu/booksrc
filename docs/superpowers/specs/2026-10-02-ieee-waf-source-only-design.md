# IEEE AWS WAF Source-Only Design

## Goal

Make the IEEE book source reject AWS WAF challenge/error pages before content processing, open the native verification browser only for a positively identified block, and retry the browser-cookie refetch at most twice.

## Scope and boundary

- Modify only `ieee_back.json` under `ruleContent.content`.
- The source-only flow remains manual-confirmation-assisted: the reader taps the native browser's `✓` after the real IEEE document is visible.
- Use `java.startBrowserAwait(baseUrl, "IEEE 验证", true)` so the result is a fresh HTTP refetch using cookies persisted by the verification WebView.
- Do not change `jsLib`, `ruleContent.webJs`, `prepareContent`, TOC/search/explore rules, or Legado-E Kotlin code.
- Do not add arbitrary sleeps, unbounded retry loops, or token/cookie replay code.

## Response classification

`deferWafVerification(content)` classifies each response into one of three states:

| State | Condition | Action |
| --- | --- | --- |
| `CONTENT` | A nonempty `div.document-text` or `div.abstract-text` is present, and no known WAF/error marker is present. | Return the body unchanged. |
| `BLOCKED` | A known WAF/error marker is present and expected IEEE content is absent. | Start a verification/refetch cycle. |
| `UNKNOWN` | Any other body, including empty responses without a known marker. | Return the body unchanged before verification; reject it if it occurs after a verification cycle. |

The fixed case-insensitive block-marker set is:

- `Max Challenge attempts exceeded`
- `AWS WAF`
- `awswaf`
- `Access Denied`
- `The request could not be satisfied`

The classifier must never use body length as an acceptance, block, or retry condition. A response containing a block marker plus valid expected IEEE content is not automatically reverified; this avoids treating valid articles that quote such text as a challenge page.

## Bounded state machine

```text
FETCH
  ├─ CONTENT or UNKNOWN → prepareContent(original body)
  └─ BLOCKED → VERIFY_AND_REFETCH(1)
                  ├─ CONTENT → prepareContent(refetched body)
                  ├─ BLOCKED → VERIFY_AND_REFETCH(2)
                  │              ├─ CONTENT → prepareContent(refetched body)
                  │              └─ BLOCKED, UNKNOWN, exception, or empty → terminal failure
                  └─ UNKNOWN, exception, or empty → terminal failure
```

`VERIFY_AND_REFETCH(n)` means one synchronous `startBrowserAwait(..., true)` call. The source does not accept the WebView DOM snapshot and does not infer success from a URL, delay, or browser close. A browser/refetch failure logs the cycle number and returns an empty result, ensuring challenge/error markup never reaches `prepareContent`.

## Existing content pipeline

The active invocation order becomes:

```javascript
result = deferWafVerification(result);
result = prepareContent(result);
```

The normal page path remains unchanged: `ruleContent.webJs` stamps MathJax metadata, then `prepareContent` performs formula conversion, cleanup, and existing text translation. A verification-refetched page does not run source-specific `webJs`; its existing `prepareContent` fallback may render formula text instead of the normal Codecogs image. This is an accepted source-only limitation.

## Acceptance criteria

1. Normal IEEE documents never open a verification browser.
2. A known WAF/error page with no expected IEEE content opens at most two verification browsers.
3. A successful refetch must contain expected IEEE content and no known block marker before it is processed.
4. Known challenge/error pages never reach `prepareContent`.
5. An unknown initial response does not launch a browser; an unknown post-verification response fails closed.
6. JSON parsing succeeds and existing normal-body formula/translation behavior is unchanged.
7. Phone verification via `ws://localhost:1123/bookSourceDebug` confirms first-cycle success, second-cycle success, and the two-cycle terminal-failure boundary.

## Non-goals

- Fully automatic native WebView success detection or dismissal.
- AWS WAF token extraction, reuse, or direct cookie manipulation.
- Changes to the Legado-E application or its WebView lifecycle.
- Fixing unrelated discovery, TOC, search, translation, or formula behavior.
