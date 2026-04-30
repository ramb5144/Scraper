---
phase: quick
plan: 007
type: execute
wave: 1
depends_on: []
files_modified:
  - client/cloak-sdk.js
autonomous: true

must_haves:
  truths:
    - "Code blocks in stackoverflow-demo render readable text (not garbled)"
    - "Pre blocks display with monospace character spacing"
    - "All text in code/pre elements is still encrypted in DOM"
  artifacts:
    - path: "client/cloak-sdk.js"
      provides: "Fixed font detection and application for code elements"
      contains: "detectUsedFonts.*code.*pre"
  key_links:
    - from: "detectUsedFonts()"
      to: "code/pre elements"
      via: "querySelector includes code, pre"
    - from: "encrypted generic fonts application"
      to: "code/pre elements"
      via: "no longer skipped in STEP 3.5"
---

<objective>
Fix code blocks showing garbled encrypted text by ensuring encrypted monospace fonts are properly detected and applied to code/pre elements.

Purpose: Code blocks on Stack Overflow demo (and any page with monospace text) show garbled text because the SDK encrypts the text correctly BUT skips code/pre elements during font detection and font application. The encrypted text needs an encrypted monospace font to render correctly.

Output: Updated cloak-sdk.js that properly handles monospace code blocks.
</objective>

<context>
@.planning/PROJECT.md (critical architecture principles - never use exclusion lists)
@client/cloak-sdk.js (SDK with font detection/application logic)

**Root Cause Analysis:**

The SDK correctly encrypts text in code/pre elements (they are NOT in excludeSelectors). However, the encrypted text renders as garbled because:

1. `detectUsedFonts()` (line 772) queries: `p, h1, h2, h3, h4, h5, h6, span, a, li, td, th, div, article, section, blockquote, figcaption, label, button` - does NOT include `code` or `pre`

2. `detectUsedFonts()` (lines 779-780) explicitly skips `el.closest('code')` and `el.closest('pre')`

3. STEP 3.5 font application (lines 1440-1444) skips `CODE`, `PRE`, `KBD`, `SAMP`, `VAR` elements

This means:
- Text in code blocks IS encrypted (correct)
- But monospace font usage is NOT detected
- And encrypted fonts are NOT applied to code elements
- Result: encrypted text with wrong font = garbled display

**The Fix:**
Remove the code/pre/kbd/samp/var skipping from font detection AND font application. These elements should be treated like any other text element - their fonts should be detected, encrypted alternatives generated, and applied.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix font detection to include code/pre elements</name>
  <files>client/cloak-sdk.js</files>
  <action>
In `detectUsedFonts()` function:

1. Update the querySelector on line 772 to include monospace-typical elements:
   Change from:
   ```javascript
   const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, a, li, td, th, div, article, section, blockquote, figcaption, label, button');
   ```
   To:
   ```javascript
   const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, a, li, td, th, div, article, section, blockquote, figcaption, label, button, code, pre, kbd, samp, var');
   ```

2. Remove the code/pre/etc skipping logic on lines 779-780. Delete these lines from the skip condition:
   ```javascript
   el.closest('code') ||
   el.closest('pre') ||
   ```
   Keep the other skip conditions (data-cloak-exclude, script, style, search overlay).
  </action>
  <verify>
Run grep to confirm:
- querySelector includes 'code, pre, kbd, samp, var'
- No `el.closest('code')` or `el.closest('pre')` in detectUsedFonts skip logic
  </verify>
  <done>detectUsedFonts() now detects fonts from code/pre/kbd/samp/var elements</done>
</task>

<task type="auto">
  <name>Task 2: Fix encrypted font application to include code/pre elements</name>
  <files>client/cloak-sdk.js</files>
  <action>
In the STEP 3.5 font application section (around line 1434-1446):

Remove the tagName checks that skip code-related elements. Delete these lines from the skip condition:
```javascript
el.tagName === 'CODE' ||
el.tagName === 'PRE' ||
el.tagName === 'KBD' ||
el.tagName === 'SAMP' ||
el.tagName === 'VAR') {
```

Keep only:
```javascript
if (el.closest('[data-cloak-exclude]') ||
    el.closest('#encrypted-search-overlay') ||
    el.tagName === 'SCRIPT' ||
    el.tagName === 'STYLE') {
    continue;
}
```

This allows encrypted fonts (including CloakGeneric-monospace) to be applied to code/pre/kbd/samp/var elements.
  </action>
  <verify>
Run grep to confirm no `CODE`, `PRE`, `KBD`, `SAMP`, `VAR` tagName checks in STEP 3.5 section.
  </verify>
  <done>Encrypted monospace fonts can now be applied to code/pre/kbd/samp/var elements</done>
</task>

<task type="auto">
  <name>Task 3: Test fix with Stack Overflow demo</name>
  <files>templates/stackoverflow.html</files>
  <action>
Manual verification steps (execute these):

1. Start the server if not running:
   ```bash
   cd /Users/tyler/Downloads/cloaktest28.3\ 5\ copy\ 2 && python app.py &
   ```

2. Open browser dev tools and visit: http://localhost:8001/stackoverflow-demo

3. Verify in browser:
   - Code blocks should display readable text (Python code should be readable)
   - Text should have monospace character spacing (fixed-width characters)
   - Inspect a code element: DOM should show encrypted characters (not plaintext)

4. Check console for Cloak debug messages showing monospace font detection:
   - Should see "Detected generic fonts in use: ['monospace']" or similar
   - Should see "Applied encrypted fonts to N elements using generic fonts"
  </action>
  <verify>
Visual inspection:
- Code blocks on stackoverflow-demo page render as readable Python code
- Characters have equal width (monospace appearance)
- DOM inspection shows encrypted text (e.g., scrambled letters)
  </verify>
  <done>Code blocks render correctly with encrypted monospace font</done>
</task>

</tasks>

<verification>
1. `grep -n "code, pre, kbd" client/cloak-sdk.js` shows code elements in querySelector
2. `grep -n "el.closest('code')" client/cloak-sdk.js` returns empty (removed from detectUsedFonts)
3. `grep -n "tagName === 'CODE'" client/cloak-sdk.js` returns empty (removed from STEP 3.5)
4. Stack Overflow demo code blocks display readable monospace text
5. DOM inspection confirms text is still encrypted (character substitution visible)
</verification>

<success_criteria>
- Code blocks on stackoverflow-demo render readable Python code
- Monospace character spacing is preserved (fixed-width appearance)
- Text in code/pre elements is encrypted in DOM (inspect shows scrambled chars)
- No exclusions added to excludeSelectors (architecture principle maintained)
</success_criteria>

<output>
After completion, create `.planning/quick/007-fix-code-blocks-showing-encrypted-text-e/007-SUMMARY.md`
</output>
