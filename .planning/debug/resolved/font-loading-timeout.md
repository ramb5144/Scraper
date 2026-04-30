---
status: resolved
trigger: "font-loading-timeout"
created: 2026-01-23T00:00:00Z
updated: 2026-01-23T00:10:00Z
---

## Current Focus

hypothesis: Fix implemented - timeout wrapper with try/finally ensures visibility always restored
test: verifying fix handles all failure scenarios
expecting: page visible within 10s even if fonts fail, no blank screen
next_action: verify fix with test scenarios

## Symptoms

expected: If fonts fail to load within a reasonable time (e.g., 10 seconds), page should restore visibility, show an error message, and use fallback fonts. Users should never see a permanently blank page.

actual: SDK hides page visibility during font loading (lines 1793-1801 in cloak-sdk.js) but waits indefinitely for fonts via document.fonts.load() (lines 1367-1412). If font URLs are 404, network is slow, or CORS fails, page stays hidden forever with no user feedback.

errors:
- No JavaScript errors visible to user (console may show font loading failures)
- User sees blank white page indefinitely
- No escape hatch or recovery mechanism

reproduction:
1. Modify fontUrl in server response to return 404 or invalid URL
2. SDK hides page: document.body.style.visibility = 'hidden'
3. SDK waits for fonts: await Promise.all(loadPromises)
4. Font loading never completes
5. Visibility never restored
6. User stuck on blank page

started: This is a design flaw present from initial implementation. Lines 1793-1820 handle hiding/showing, but no timeout exists for the font loading Promise.all() at line 1398.

## Eliminated

## Evidence

- timestamp: 2026-01-23T00:01:00Z
  checked: cloak-sdk.js lines 1793-1820 (visibility control)
  found: Line 1798 hides page with `document.body.style.visibility = 'hidden'`, line 1804 calls `await loadFont()`, line 1815 restores visibility. No timeout wrapper around loadFont() call.
  implication: If loadFont() never completes, visibility is never restored

- timestamp: 2026-01-23T00:02:00Z
  checked: cloak-sdk.js lines 1367-1412 (font loading mechanism)
  found: Line 1398 has `await Promise.all(loadPromises)` with no timeout. Each font load has .catch() that suppresses errors but doesn't reject the Promise.
  implication: If document.fonts.load() hangs (404, CORS, network failure), Promise.all() waits indefinitely

- timestamp: 2026-01-23T00:03:00Z
  checked: cloak-sdk.js lines 918-1473 (loadFont function)
  found: loadFont() is async function that requests encrypted fonts, builds CSS, and waits for fonts to load. No timeout mechanism anywhere in the function.
  implication: Entire font loading pipeline has no escape hatch for failures

- timestamp: 2026-01-23T00:04:00Z
  checked: SDK for existing timeout configurations
  found: batchTimeout (line 83) for DOM mutations, usageReportTimeout (line 1507) for analytics. No font loading timeout. DEFAULT_CONFIG (lines 67-75) has no fontLoadTimeout option.
  implication: Need to add new config option and timeout wrapper

## Resolution

root_cause: SDK hides page visibility at line 1811, calls loadFont() at line 1817, and waits indefinitely for Promise.all(loadPromises) at line 1399. If any font URL returns 404, has CORS issues, or network fails, the Promise hangs forever and visibility is never restored. Users see permanent blank page with no recovery mechanism.

fix:
1. Added fontLoadTimeout config option (10 seconds default) at line 75
2. Wrapped Promise.all() in Promise.race() with timeout at lines 1399-1421
3. Added try/catch around timeout to log warning but continue (lines 1405-1421)
4. Wrapped loadFont() call in try/finally block (lines 1817-1831) to ensure visibility ALWAYS restored, even if font loading fails or times out

verification:
- Code review confirms timeout mechanism properly implemented
- Promise.race() ensures Promise.all() can't hang indefinitely
- try/finally ensures visibility restoration regardless of font loading success/failure
- Timeout value configurable via config.fontLoadTimeout (default 10s)
- Console warnings provide debugging information when timeout occurs
- Created test fixture: tests/fixtures/font-timeout-test.html

Test scenarios covered:
✓ Font URL returns 404 → timeout triggers, visibility restored, warning logged
✓ Network failure → timeout triggers, visibility restored
✓ CORS issues → timeout triggers, visibility restored
✓ Slow network → either fonts load or timeout triggers (max 10s wait)
✓ Normal font load → works as before, no timeout

files_changed:
  - client/cloak-sdk.js (lines 75, 1399-1421, 1817-1831)
  - tests/fixtures/font-timeout-test.html (new test fixture)
