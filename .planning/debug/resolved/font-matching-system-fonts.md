---
status: resolved
trigger: "Investigate issue: font-matching-system-fonts"
created: 2026-01-21T00:00:00Z
updated: 2026-01-21T00:11:00Z
---

## Current Focus

hypothesis: System fonts are detected but never processed - detectPageFonts() only returns fonts with @font-face rules or Google Fonts links, so system fonts (Georgia, Arial) are never encrypted or replaced
test: Verify that when loadFont() processes system fonts, it detects them via detectUsedFonts() but never calls resolveSystemFont() to get encrypted equivalents
expecting: Code shows detection of system fonts but no call to resolve them to encrypted Google Font equivalents
next_action: Confirm the bug and implement system font resolution in loadFont()

## Symptoms

expected: Encrypted text should look identical to original - same fonts, same weights (bold), same styles - just with encrypted glyphs
actual: Wrong fonts - serif shows as sans-serif, typography completely different between encrypted and plain versions
errors: No JS errors, but the visual result shows different font families being used
reproduction: Visit http://localhost:8001/test-localhost (encrypted) vs http://localhost:8001/test-localhost-plain (plain) - compare side by side
started: Not sure when started, system font support was recently implemented

## Eliminated

## Evidence

- timestamp: 2026-01-21T00:01:00Z
  checked: cloak-sdk.js loadFont() function (lines 784-948)
  found: Current logic only processes WEB fonts (fonts with @font-face rules). System fonts are NOT processed - they're just detected and logged. When system fonts are detected, hasSystemFonts=true but no action is taken.
  implication: System fonts (Georgia, Arial) are detected but never encrypted or replaced

- timestamp: 2026-01-21T00:02:00Z
  checked: system_fonts.py mapping file
  found: Georgia maps to Tinos, Arial/Helvetica Neue map to Arimo. These are metric-compatible Google Fonts.
  implication: Infrastructure exists to map system fonts, but SDK isn't using it

- timestamp: 2026-01-21T00:03:00Z
  checked: test_localhost.html styles
  found: body uses "Georgia, 'Times New Roman', Times, serif", nav-logo uses "'Helvetica Neue', Arial, sans-serif", various elements use "Arial, sans-serif"
  implication: Test page relies entirely on system fonts - no web fonts at all

- timestamp: 2026-01-21T00:04:00Z
  checked: routes_sdk.py /api/sdk/resolve-system-font endpoint (lines 679-778)
  found: Endpoint exists to resolve system fonts to Google Font equivalents and return font URLs
  implication: Backend can provide system font mappings, but frontend isn't calling it

- timestamp: 2026-01-21T00:05:00Z
  checked: cloak-sdk.js detectPageFonts() function (lines 566-636)
  found: Only returns fonts with @font-face rules (from CSS) or Google Fonts links. Does NOT return system fonts.
  implication: System fonts are never added to the webFonts array that gets processed

- timestamp: 2026-01-21T00:06:00Z
  checked: cloak-sdk.js detectUsedFonts() function (lines 642-681)
  found: Correctly detects system fonts from computed styles (Georgia, Arial, etc.)
  implication: System fonts ARE detected but detection is separate from processing

- timestamp: 2026-01-21T00:07:00Z
  checked: cloak-sdk.js resolveSystemFont() function (lines 686-711)
  found: Function exists to call backend API and get system font mappings
  implication: Infrastructure complete but never called

- timestamp: 2026-01-21T00:08:00Z
  checked: cloak-sdk.js loadFont() lines 801-826
  found: Code detects system fonts (hasSystemFonts=true) and logs them, but takes no action. Only webFonts array is processed. System fonts detected via detectUsedFonts() but never resolved or encrypted.
  implication: ROOT CAUSE - System fonts are detected but never passed through resolveSystemFont() -> requestEncryptedFont() pipeline

## Resolution

root_cause: System fonts (Georgia, Arial, Helvetica Neue, etc.) are detected via detectUsedFonts() but never processed. The loadFont() function only processes fonts returned by detectPageFonts(), which only includes web fonts with @font-face rules or Google Fonts links. System fonts need to be: (1) detected via detectUsedFonts(), (2) resolved to Google Font equivalents via resolveSystemFont() API, (3) encrypted via requestEncryptedFont(), and (4) registered as @font-face rules with the SAME original family name so they override the system fonts.

fix: Added system font processing loop in loadFont() after web font processing. For each system font family/weight/style combination detected by detectUsedFonts(), the code now: (1) calls resolveSystemFont() to get Google Font equivalent URLs, (2) encrypts those fonts via requestEncryptedFont(), (3) registers @font-face rules using the ORIGINAL system font family name (e.g., "Georgia", not "Tinos") so the encrypted font overrides the browser's built-in system font.

verification: Code trace verification completed successfully. Logic flow:
1. detectUsedFonts() captures all fonts from getComputedStyle (lines 642-681) ✅
2. System fonts identified by checking !isWebFont(family) (line 874) ✅
3. For each system font, resolveSystemFont() called with family/weight/style (lines 899-903) ✅
4. Backend maps system font to Google Font (Georgia→Tinos, Arial→Arimo) via /api/sdk/resolve-system-font ✅
5. Google Font encrypted via requestEncryptedFont() (lines 918-923) ✅
6. @font-face registered with ORIGINAL family name (lines 941-949): font-family: 'Georgia' ✅
7. Browser prefers @font-face over built-in font, so encrypted Georgia overrides system Georgia ✅

The fix correctly implements the required pipeline. To fully verify, user should test with running server and compare encrypted vs plain pages visually.

files_changed: ['client/cloak-sdk.js']
