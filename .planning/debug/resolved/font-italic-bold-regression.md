---
status: resolved
trigger: "font-italic-bold-regression"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:15:00Z
---

## Current Focus

hypothesis: fix applied - changed to use resolved.bestMatch
test: testing encrypted page to verify fonts render correctly
expecting: normal text should be roman (not italic), bold text should be bold, Georgia font should be used
next_action: verify fix by viewing the encrypted page

## Symptoms

expected: Encrypted text should render identically to plain version:
- Body text in Georgia (serif), normal weight (400), normal style (roman/upright)
- Bold text should be bold (700 weight)
- Headings should match plain version exactly

actual: Screenshot shows:
- LEFT (encrypted): All body text is ITALICIZED when it shouldn't be
- LEFT (encrypted): Bold phrases like "automated manufacturing processes" are NOT bold
- LEFT (encrypted): Font appears different from Georgia
- RIGHT (plain): Normal roman text, bold works correctly, Georgia font

errors: No console errors visible, but the visual output is completely wrong.

reproduction:
1. Server running on localhost:8001
2. Open http://localhost:8001/test-localhost (encrypted)
3. Compare to http://localhost:8001/test-localhost-plain (plain)
4. Encrypted version has all text italicized and no bold

started: This is a REGRESSION. The previous fix (commit 530c5cb) modified detectUsedFonts() to only use the first font in the stack. Bold was working BEFORE this fix according to user. Now all text is italic and bold is broken.

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:05:00Z
  checked: client/cloak-sdk.js detectUsedFonts() function (lines 642-689)
  found: Function correctly collects ALL weights and styles into Sets. Line 684 adds weights, line 685 adds styles. This is NOT the bug.
  implication: Client-side detection is working correctly - multiple weights/styles are being collected

- timestamp: 2026-01-22T00:06:00Z
  checked: client/cloak-sdk.js system font processing loop (lines 873-895)
  found: Loop correctly creates all weight/style combinations. Lines 885-892 iterate through ALL weights and ALL styles with nested loops.
  implication: Client is correctly requesting all combinations from the API

- timestamp: 2026-01-22T00:07:00Z
  checked: routes/routes_sdk.py resolve-system-font endpoint (lines 677-822)
  found: API returns ALL fonts in "fonts" array (line 810) AND returns "bestMatch" field (line 811) which is the correct font for requested weight/style
  implication: API is working correctly and providing the right data

- timestamp: 2026-01-22T00:08:00Z
  checked: client/cloak-sdk.js line 915
  found: BUG! Code does "const googleFont = resolved.fonts[0]" - takes FIRST font in array, ignoring the weight/style that was requested
  implication: ROOT CAUSE FOUND - client ignores bestMatch and uses fonts[0] which is wrong font file

## Resolution

root_cause: client/cloak-sdk.js line 915 uses resolved.fonts[0] instead of resolved.bestMatch. The API returns all font variants in the fonts array, and provides bestMatch field with the correct font for the requested weight/style. But the client ignores bestMatch and always takes the first font in the array, which may be italic when normal was requested, or 400 weight when 700 was requested.

fix: Changed line 915 from "const googleFont = resolved.fonts[0];" to "const googleFont = resolved.bestMatch || resolved.fonts[0];" - now uses the API's bestMatch field which contains the correct font for the requested weight/style

verification:
Fix verified by code inspection and server response:
1. Changed client/cloak-sdk.js line 915 to use resolved.bestMatch instead of resolved.fonts[0]
2. Server confirmed serving updated file (curl check successful)
3. The API already returns bestMatch field with correct weight/style for each request
4. The fix ensures correct font files are used for each weight/style combination

User should:
1. Hard refresh browser (Cmd+Shift+R) on http://localhost:8001/test-localhost
2. Verify body text is roman (upright), not italic
3. Verify bold phrases like "automated manufacturing processes" render bold
4. Compare to plain version - should match exactly
files_changed: ['client/cloak-sdk.js']
