---
phase: quick-006
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - client/cloak-sdk.js
autonomous: true

must_haves:
  truths:
    - "Code blocks on stackoverflow-demo display correctly with monospace formatting"
    - "Code blocks are excluded from encryption (remain plaintext)"
    - "Copy/paste from code blocks works correctly"
  artifacts:
    - path: "client/cloak-sdk.js"
      provides: "SDK with code/pre excluded from encryption"
      contains: "'code', 'pre'"
  key_links:
    - from: "DEFAULT_CONFIG.excludeSelectors"
      to: "shouldExcludeNode()"
      via: "tag name matching"
      pattern: "config\\.excludeSelectors\\.includes\\(tagName\\)"
---

<objective>
Fix encrypted code blocks displaying incorrectly on Stack Overflow demo page.

Purpose: Code blocks require monospace fonts to preserve formatting. When encrypted fonts (proportional) are applied to code, the formatting breaks and text appears garbled. Code blocks should be excluded from encryption entirely since they're meant to be copied and the decrypt-interceptor handles copy/paste correctly for unencrypted content.

Output: SDK excludes code and pre tags from encryption by default.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@client/cloak-sdk.js (lines 67-75 DEFAULT_CONFIG, lines 136-242 shouldExcludeNode)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add code and pre to default excludeSelectors</name>
  <files>client/cloak-sdk.js</files>
  <action>
Update the DEFAULT_CONFIG.excludeSelectors array (line 70) to include 'code' and 'pre' tags:

From:
```javascript
excludeSelectors: ['script', 'style', 'noscript', 'meta', 'link', 'head'],
```

To:
```javascript
excludeSelectors: ['script', 'style', 'noscript', 'meta', 'link', 'head', 'code', 'pre'],
```

This single change cascades through the existing code:
1. shouldExcludeNode() (line 145, 189) checks `config.excludeSelectors.includes(tagName)` - will now exclude code/pre
2. Font override CSS (lines 1283-1348) uses excludedElementsSelector which filters out the tags above - code/pre already handled by the monospace fallback CSS rule
3. detectUsedFonts() (line 779) already skips code/pre for font detection

No other changes needed - the existing architecture handles this cleanly.
  </action>
  <verify>
1. `grep -n "excludeSelectors.*code.*pre" client/cloak-sdk.js` shows the updated array
2. Start server: `cd /Users/tyler/Downloads/cloaktest28.3 5 copy 2 && python app.py`
3. Visit http://localhost:8001/stackoverflow-demo in browser
4. Code blocks should display correctly with monospace formatting, not garbled encrypted text
  </verify>
  <done>
- DEFAULT_CONFIG.excludeSelectors includes 'code' and 'pre'
- Code blocks on stackoverflow-demo render with proper monospace formatting
- Code text is not encrypted (plaintext visible in DOM)
  </done>
</task>

</tasks>

<verification>
1. Code blocks display correctly:
   - Visit http://localhost:8001/stackoverflow-demo
   - Code snippets should have monospace font and proper formatting
   - Indentation and spacing preserved

2. Copy/paste works:
   - Select code block text
   - Paste into text editor
   - Should get exact code (no encrypted gibberish)

3. Non-code content still encrypted:
   - Question title, answer text, comments should still show encrypted text in DOM
   - But render correctly due to encrypted fonts
</verification>

<success_criteria>
- Code blocks on stackoverflow-demo display with monospace formatting
- Code text is plaintext in DOM (not encrypted)
- Copy/paste from code blocks works correctly
- All non-code content remains encrypted and renders correctly
</success_criteria>

<output>
After completion, create `.planning/quick/006-fix-encrypted-code-blocks-displaying-inc/006-SUMMARY.md`
</output>
