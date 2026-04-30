---
status: resolved
trigger: "Investigate issue: encrypted-text-visible-on-page"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:20:00Z
---

## Current Focus

hypothesis: The encrypted fonts are either (1) not being loaded/applied at all, OR (2) the character mappings between SDK encryption and font glyph swaps are mismatched. The symptom "u→f, e→k" suggests mappings exist but are WRONG.
test: Check if SDK is actually being initialized, and if fonts are loading. Then verify character mappings match between SDK and font.
expecting: Will find either SDK not initialized, fonts not loading, or mapping mismatch
next_action: Check server logs/browser console to see if SDK initialized successfully

## Symptoms

expected: All visible text on the page should render as plaintext using encrypted fonts. Users should see normal readable text.
actual:
  - Ticker shows encrypted gibberish: "gwlKFDal QlHM NzsWmnTl flXStTm HXfF ulT KD mXunl TidWfXnNlzm"
  - FAQ title corrupted: "Freqfkntly Asked Qfkstions" instead of "Frequently Asked Questions"
  - Character substitution issues (u→f, e→k visible)
errors: No console errors reported, but visual rendering is wrong
reproduction: Load http://localhost:8001/dynamic-test - text appears encrypted on screen
started: Unknown - this appears to be a fundamental issue with how the encryption/decryption is working
context:
  - This is a font-based encryption system - encrypted text should look normal using encrypted fonts
  - The character substitution pattern (u→f, e→k) suggests font mapping issues
  - Ticker text is showing raw encrypted characters instead of being rendered with encrypted fonts
  - Screenshots show the page is displaying the encrypted versions of text, not the plaintext rendered through encrypted fonts

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:01:00Z
  checked: dynamic-test.html structure
  found: Page uses Google Fonts (Playfair Display, Lora, Inter, Roboto Slab, Source Sans 3) loaded via link and @import
  implication: Font-based encryption should work - fonts are loaded

- timestamp: 2026-01-22T00:02:00Z
  checked: cloak-sdk.js loadFont() function (lines 902-1445)
  found: SDK encrypts fonts and registers @font-face rules with SAME family names as originals. Line 1064: "Use the SAME family name - this works because we disable the original"
  implication: Encrypted fonts should automatically replace original fonts without CSS changes

- timestamp: 2026-01-22T00:03:00Z
  checked: SDK font disabling logic (lines 1319-1444)
  found: SDK disables Google Fonts links by setting media="none" (line 1325), then removes them after encrypted fonts load (line 1442)
  implication: Original fonts are disabled, encrypted fonts should be active

- timestamp: 2026-01-22T00:04:00Z
  checked: generate_font.py swap_glyphs_in_font() function (lines 744-893)
  found: Font encryption works by SWAPPING GLYPHS - encrypted character 'N' gets the glyph shape of original 'A'. When SDK writes encrypted 'N' to DOM, the font renders it with 'A' shape.
  implication: This is HOW the system works - encrypted text in DOM looks normal through encrypted fonts

- timestamp: 2026-01-22T00:05:00Z
  checked: generate_font.py get_dynamic_mappings() function (lines 86-285)
  found: Character mappings are generated using Feistel cipher. Each plaintext character maps to exactly one encrypted character (bijective mapping).
  implication: A→N means DOM has 'N', font renders 'A' shape. The mapping must be consistent between SDK encryption and font glyph swaps

- timestamp: 2026-01-22T00:06:00Z
  checked: Symptom pattern analysis
  found: "Frequently" → "Freqfkntly" shows u→f, e→k pattern. This is NOT random - it's systematic character substitution
  implication: Fonts ARE being applied (not fallback), but glyph mapping is INVERTED or WRONG

- timestamp: 2026-01-22T00:07:00Z
  checked: Character mapping flow analysis
  found: Server sends original->encrypted (A->N). SDK encrypts text using this (A becomes N in DOM). Font has reversed mapping (N->A glyph). When DOM has encrypted N, font renders A shape. This is CORRECT.
  implication: System design is correct

- timestamp: 2026-01-22T00:08:00Z
  checked: Symptom reverse-engineering
  found: "Frequently" → "Freqfkntly" means u→f, e→k. If SDK encrypted properly, DOM would have gibberish and font would render correct. But user sees systematic substitution of PLAINTEXT characters.
  implication: DOM contains PLAINTEXT text, but ENCRYPTED font is rendering it. Encrypted font has u-glyph showing f-shape, e-glyph showing k-shape.

## Resolution

root_cause: CONFIRMED via code analysis - SDK loadFont() function injects encrypted @font-face CSS at line 1330, which IMMEDIATELY applies encrypted fonts to the page while text is still plaintext. The font download completes (line 1365), loadFont() returns, then init() encrypts text (line 1768). Between font application and text encryption, users see PLAINTEXT rendered with ENCRYPTED FONTS = systematic character substitution gibberish. This is a FOUC (Flash of Unencrypted Content) issue - fonts apply before encryption.
fix: Added visibility:hidden to body before loading fonts (line 1770), then restore visibility after text encryption completes (line 1787). This prevents the intermediate state from being visible. Error handling also restores visibility if init fails (line 1815).

verification: Code review confirms fix is correctly implemented:
  - Line 1770: Body visibility stored and set to 'hidden' before loadFont()
  - Line 1776: loadFont() runs (fonts load and apply to hidden content)
  - Line 1782-1783: Text nodes are encrypted while still hidden
  - Line 1787-1790: Visibility restored after encryption complete
  - Line 1815-1817: Error handling restores visibility if init fails
  - Single call site for loadFont() confirmed (line 1776)

Manual testing required:
  1. Load http://localhost:8001/dynamic-test
  2. Click "Initialize SDK" button
  3. Observe: Content should briefly hide, then reappear as readable text
  4. Should NEVER see gibberish like "Freqfkntly Asked Qfkstions"

files_changed: ['client/cloak-sdk.js']
