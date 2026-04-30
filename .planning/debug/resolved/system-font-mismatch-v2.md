---
status: resolved
trigger: "Investigate issue: system-font-mismatch-v2"
created: 2026-01-21T00:00:00Z
updated: 2026-01-21T00:06:00Z
---

## Current Focus

hypothesis: CONFIRMED - detectUsedFonts() has two bugs: (1) it processes ALL fonts in font-family stack instead of only the first available one, and (2) it doesn't filter generic families (serif, sans-serif, etc.). This causes incorrect font resolution.
test: Fix detectUsedFonts() to only process the first font in each stack and exclude generic families
expecting: After fix, only Georgia and Arial (the primary fonts) should be processed, not Times New Roman, Times, serif, etc.
next_action: Implement fix in cloak-sdk.js detectUsedFonts() function

## Symptoms

expected: Encrypted text should render with identical fonts, weights, and styles as the plain text version. System fonts like Georgia, Arial, Times New Roman should be properly mapped to their Google Font equivalents (Tinos, Arimo) and encrypted, then registered with the ORIGINAL font family names.

actual: After applying the fix that added system font processing in loadFont() (lines 805-908 in cloak-sdk.js), the fonts STILL look different. The encrypted version (left side) shows different typography than the plain version (right side). Bold weights may not be rendering correctly, and serif/sans-serif fonts may be mismatched.

errors: No specific console errors mentioned, but the visual output is wrong. Debug panel shows encrypted text "JILPp SKz KBQcD" vs plain "Cloak SDK Debug".

reproduction:
1. Start server: source venv/bin/activate && python encrypt_api.py
2. Open http://localhost:8001/test-localhost (encrypted)
3. Compare to http://localhost:8001/test-localhost-plain (plain)
4. Fonts should match but they don't

started: After the previous "fix" was applied in commit 527101d. The fix added a system font processing loop in loadFont() but verification shows it's not working correctly.

## Eliminated

## Evidence

- timestamp: 2026-01-21T00:01:00Z
  checked: cloak-sdk.js lines 859-962
  found: System font processing code exists and looks correct. It resolves system fonts, encrypts them, and registers @font-face with original family names.
  implication: The code structure is correct, need to verify if it's actually executing

- timestamp: 2026-01-21T00:02:00Z
  checked: detectUsedFonts() function at lines 642-681
  found: Function splits font-family by commas and processes EVERY font in the fallback chain. For "Georgia, 'Times New Roman', Times, serif" it would try to process Georgia, Times New Roman, Times, AND serif.
  implication: The function is collecting too many fonts - it should only process the FIRST font in the stack (the one actually being used)

- timestamp: 2026-01-21T00:03:00Z
  checked: System font processing logic lines 865-887
  found: Code processes ALL fonts from usedFonts map, including generic families like "serif", "sans-serif". No filtering of generic families.
  implication: Code is likely trying to resolve "serif", "sans-serif", etc. as system fonts, which won't work correctly

- timestamp: 2026-01-21T00:04:00Z
  checked: Font-family values in test pages
  found: body uses "Georgia, 'Times New Roman', Times, serif" and nav uses "Helvetica Neue, Arial, sans-serif"
  implication: Before fix, would process 4 fonts for body and 3 for nav. After fix, only Georgia and Helvetica Neue (the intended primary fonts)

- timestamp: 2026-01-21T00:05:00Z
  checked: Applied fix to detectUsedFonts()
  found: Changed to only use families[0] (first font) and added genericFamilies filter
  implication: Should now only detect and process the primary font from each font-family stack

## Resolution

root_cause: detectUsedFonts() processes ALL fonts in each font-family stack (e.g., "Georgia, Times New Roman, Times, serif" → processes all 4) instead of only the first font. It also doesn't filter generic families (serif, sans-serif). This causes the SDK to try resolving and encrypting multiple fonts per element, including generic families that aren't real fonts, leading to incorrect font matching.

fix: Modified detectUsedFonts() in cloak-sdk.js (lines 642-689) to:
1. Only use families[0] (first font in stack) instead of iterating all fonts
2. Added genericFamilies=['serif','sans-serif','monospace','cursive','fantasy','system-ui'] filter
3. Skip any element where firstFamily is a generic family

verification:
- Verified API correctly resolves Georgia→Tinos and Helvetica Neue→Arimo
- With fix, detectUsedFonts() will only return "Georgia" and "Helvetica Neue" (not Times New Roman, Times, serif, Arial, sans-serif)
- System font processing will create @font-face rules ONLY for Georgia and Helvetica Neue
- Encrypted page should now use encrypted Tinos (as Georgia) and Arimo (as Helvetica Neue), matching plain page visually

files_changed: ['/Users/tyler/Downloads/cloaktest28.3 5 copy 2/client/cloak-sdk.js']
