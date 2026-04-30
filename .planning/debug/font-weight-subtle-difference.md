---
status: verifying
trigger: "font-weight-subtle-difference"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:00:00Z
symptoms_prefilled: true
goal: find_and_fix
---

## Current Focus

hypothesis: CONFIRMED - Tinos weight 400 renders lighter than Georgia weight 400. Solution: Register Tinos 400 font file with font-weight: 350 descriptor in @font-face, so browser applies synthetic bolding when rendering weight 400 text
test: Modify routes_sdk.py to adjust the font-weight descriptor when registering system font replacements
expecting: Registering with lower weight descriptor will trigger browser's synthetic bolding, making Tinos appear closer to Georgia's visual weight
next_action: Modify the font-from-url endpoint to allow weight descriptor adjustment for system fonts

## Symptoms

expected: Encrypted text should be visually IDENTICAL to plain text - same font weight, same typographic "color" (density), same letter spacing.

actual: Looking at the screenshot comparison:
- LEFT (encrypted): Text appears slightly lighter/thinner
- RIGHT (plain): Text has normal Georgia weight, looks slightly heavier
- The difference is subtle but noticeable when viewing side-by-side
- Bold text ("automated manufacturing processes", "78% of Fortune 500 companies") works on both but the encrypted bold might also be slightly lighter

errors: No console errors - this is a visual rendering difference.

reproduction:
1. Server running on localhost:8001
2. Open http://localhost:8001/test-localhost (encrypted)
3. Open http://localhost:8001/test-localhost-plain (plain)
4. Compare side-by-side - encrypted text is slightly thinner/lighter

started: This subtle difference may have always been there, but it's more noticeable now that the italic issue is fixed. The encrypted version uses Tinos (Google Font equivalent of Georgia) while plain uses actual Georgia.

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:05:00Z
  checked: cloak-sdk.js font loading logic (lines 792-1098)
  found: System font Georgia is mapped to Tinos (Google Font) in system_fonts.py line 55-58. The SDK resolves system fonts via /api/sdk/resolve-system-font endpoint, which returns Google Font CSS with weight/style variants
  implication: The weight difference could be caused by: (1) Tinos weight 400 rendering lighter than Georgia weight 400, or (2) Wrong weight variant being requested/returned from Google Fonts API

- timestamp: 2026-01-22T00:05:00Z
  checked: routes_sdk.py resolve-system-font endpoint (lines 679-822)
  found: Uses Firefox 40 User-Agent to get STATIC fonts (not variable fonts) from Google. Has "bestMatch" logic to find exact weight/style match (lines 788-804). If exact match not found, falls back to "same style any weight" or first available font
  implication: The bestMatch logic might be returning a font with different weight than requested. Need to verify what weight is actually being returned for Georgia weight 400

- timestamp: 2026-01-22T00:10:00Z
  checked: Google Fonts API response for Tinos
  found: Tinos only has 2 weights available: 400 and 700. Weight 400 is being correctly requested and returned. The URL is https://fonts.gstatic.com/s/tinos/v25/buE4poGnedXvwgX5.woff2 for normal weight 400
  implication: The correct weight file is being fetched. The issue is likely that Tinos weight 400 INHERENTLY renders lighter than Georgia weight 400 - they're not perfectly matched despite being "metrically compatible"

- timestamp: 2026-01-22T00:15:00Z
  checked: Possible solutions for weight mismatch
  found: Tinos only has weights 400 and 700, so we can't request weight 500. Options: (1) Apply font-weight CSS property to elements, (2) Use text-stroke for faux weight, (3) Switch to different font substitute, (4) Use font-weight descriptor range trick in @font-face
  implication: Best approach is likely to register the Tinos weight 400 font with a lighter font-weight descriptor (e.g., 300) so browser applies synthetic bolding to reach visual weight 400

- timestamp: 2026-01-22T00:20:00Z
  checked: Font metadata for both Tinos and Georgia
  found: Both fonts report OS/2 usWeightClass=400. Neither is a variable font. Tinos is a static font with correct weight metadata
  implication: The visual weight difference is INTRINSIC to the glyph outlines themselves - Tinos strokes are thinner than Georgia strokes at the same nominal weight. This is a design choice by the Tinos font creator

- timestamp: 2026-01-22T00:22:00Z
  checked: Possible solutions for visual weight mismatch
  found: Options include CSS text-stroke, font-weight override, or @font-face descriptor adjustment. The cleanest solution is to add a subtle text-stroke or use font-weight: 500 to trigger synthetic bolding
  implication: Need to apply CSS fix in cloak-sdk.js when Georgia is mapped to Tinos

## Resolution

root_cause: Tinos and Georgia both report OS/2 usWeightClass=400, but Tinos glyph outlines are drawn with thinner strokes than Georgia. This is a design difference between the fonts - Tinos was created to be metrically compatible (same widths) but not visually identical. The encrypted version uses Tinos while plain uses Georgia, causing the subtle weight difference.

fix: Modified cloak-sdk.js to apply font-weight: 500 to body when Tinos is used as Georgia substitute. Since Tinos only has weights 400 and 700 (no 500), the browser applies synthetic bolding to the weight 400 font, making it appear heavier and closer to Georgia's visual weight. Bold elements (h1-h6, strong, b) explicitly use font-weight: 700 to maintain proper bold appearance.

Changes made:
1. Lines 1000-1036: Added check for Tinos/Georgia substitution
2. Lines 1017-1028: Apply font-weight: 500 to body, font-weight: 700 to bold elements
3. This triggers browser synthetic bolding for normal text while preserving real bold for headings

verification: READY TO TEST - User needs to verify visually:
1. Hard reload http://localhost:8001/test-localhost (Cmd+Shift+R)
2. Open DevTools Console - should see: "[Cloak] Applied font-weight: 500 compensation for Tinos"
3. Inspect body element - should have CSS rule: font-weight: 500
4. Visual comparison: encrypted text (left) should now appear heavier, closer to plain (right)
5. Check bold text (h1-h6, strong) still appears properly bold (should use font-weight: 700)

How it works: font-weight: 500 triggers synthetic bolding because Tinos only has 400 and 700. Browser interpolates/bolds the 400 font to reach 500, compensating for Tinos being lighter than Georgia.

files_changed:
- client/cloak-sdk.js: Added displayWeight variable and conditional adjustment for Georgia->Tinos mapping (lines 950-960)
