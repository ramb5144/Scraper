---
status: verifying
trigger: "faq-encrypted-fonts-not-applied"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:10:00Z
---

## Current Focus

hypothesis: Original Playfair Display font loads in <head>, gets cached by browser. SDK disables link and adds encrypted Playfair Display, but browser continues using cached original font for encrypted text
test: Verify that browser font cache isn't serving original font despite new @font-face declaration
expecting: If browser font cache is the issue, we need to either clear cache, use different font-family name, or force font reload
next_action: Check if SDK encrypted fonts are actually being downloaded/applied vs cached original

## Symptoms

expected: FAQ text should be encrypted in DOM, then rendered with encrypted fonts to display readable text
actual: FAQ shows encrypted gibberish - "KMkwfkteGj Fdqkg TfkdeoJtd" visible on screen
errors: No console errors
reproduction: Load http://localhost:8001/dynamic-test, initialize SDK, scroll to FAQ section
started: After recent changes to remove hardcoded exclusions
timeline: This appears after the recent changes to remove hardcoded exclusions
context:
  - HTML snippet shows encrypted text IS in the DOM: "KMkwfkteGj Fdqkg TfkdeoJtd"
  - This is DIFFERENT from the ticker issue - ticker was plaintext with encrypted font
  - This is encrypted text that's NOT getting the encrypted font applied
  - Font-family might be falling back to system fonts instead of encrypted fonts
  - Possible causes:
    1. Encrypted fonts have wrong font-family name
    2. CSS specificity issue preventing font override
    3. Inline styles overriding encrypted fonts
    4. Font-family declaration in FAQ section blocking encrypted fonts
  - HTML shows: `style="font-family: 'Playfair Display', serif; font-size: 32px;"`
  - This inline style might be preventing encrypted font from applying

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:01:00Z
  checked: dynamic_test.html FAQ section (line 1267)
  found: FAQ h2 has inline style: `style="font-family: 'Playfair Display', serif; font-size: 32px;"`
  implication: Inline styles have highest CSS specificity - could override encrypted font

- timestamp: 2026-01-22T00:02:00Z
  checked: cloak-sdk.js font loading logic (lines 920-1480)
  found: SDK uses @font-face to register encrypted fonts with SAME family name as original (lines 982-990)
  implication: Encrypted "Playfair Display" should automatically replace original without needing font-family overrides

- timestamp: 2026-01-22T00:03:00Z
  checked: cloak-sdk.js font registration strategy
  found: Lines 1287-1323 - SDK does NOT override font-family on body/elements when web fonts are matched
  implication: Relies on @font-face declarations to automatically override original fonts

- timestamp: 2026-01-22T00:04:00Z
  checked: cloak-sdk.js Google Fonts disabling (lines 1354-1362)
  found: Original Google Fonts links are set to media="none" to disable them
  implication: Original fonts are disabled, encrypted fonts should take over

- timestamp: 2026-01-22T00:05:00Z
  checked: cloak-sdk.js initialization flow (lines 1800-1826)
  found: Body is hidden, fonts loaded, content encrypted, then body revealed
  implication: Fonts should be loaded before text is visible

- timestamp: 2026-01-22T00:06:00Z
  checked: cloak-sdk.js font-display setting (line 988, 1086, 1153, 1251, 1278)
  found: All @font-face declarations use `font-display: swap`
  implication: With swap, browser shows fallback font while loading - but await should prevent this

- timestamp: 2026-01-22T00:07:00Z
  checked: dynamic_test.html Google Fonts loading (line 14)
  found: Google Fonts link is in <head>, loads before SDK runs
  implication: Original Playfair Display font loads and gets cached BEFORE SDK can replace it

- timestamp: 2026-01-22T00:08:00Z
  checked: cloak-sdk.js Google Fonts disabling timing (lines 1356-1362)
  found: SDK sets `media="none"` on Google Fonts link, but this happens AFTER fonts already loaded
  implication: Browser font cache may still serve original Playfair Display despite new @font-face

## Resolution

root_cause: Browser font cache conflict. Original Playfair Display loads from Google Fonts in <head>. SDK later adds encrypted Playfair Display @font-face, but browser font matcher continues using cached original font. With font-display: swap, browser uses cached original Playfair Display as "fallback" while encrypted font loads, resulting in encrypted text (KMkwfkteGj) being rendered with original font (which lacks encrypted character mappings), showing gibberish.

fix: Changed font-display from "swap" to "block" in all @font-face declarations (5 locations in cloak-sdk.js). This forces browser to wait for encrypted font instead of using cached original. Browser will briefly show invisible text (block period) rather than showing gibberish with wrong font.

verification: Ready to test at http://localhost:8001/dynamic-test. Load page, initialize SDK, scroll to FAQ section. Expected: FAQ heading should show "Frequently Asked Questions" (readable) instead of "KMkwfkteGj Fdqkg TfkdeoJtd" (gibberish).

files_changed:
  - client/cloak-sdk.js: Lines 988, 1086, 1153, 1251, 1278 (font-display: swap -> block)
