---
phase: quick
plan: 003
type: execute
wave: 1
depends_on: []
files_modified:
  - client/decrypt/src/config.js
  - client/decrypt/src/copy.js
  - client/decrypt/src/position.js
  - client/decrypt/src/search.js
  - client/decrypt/src/selection.js
  - client/decrypt/src/init.js
  - client/decrypt/build.js
autonomous: true

must_haves:
  truths:
    - "Each module is a self-contained section with clear boundaries"
    - "build.js concatenates modules into valid IIFE structure"
    - "Output passes validate.js checks"
    - "No code is lost or duplicated during split"
  artifacts:
    - path: "client/decrypt/src/config.js"
      provides: "Configuration proxy, API helpers, decrypt/encrypt functions"
    - path: "client/decrypt/src/copy.js"
      provides: "Copy interception and context menu handling"
    - path: "client/decrypt/src/position.js"
      provides: "Text position mapping and node walking"
    - path: "client/decrypt/src/search.js"
      provides: "Search API, highlighting, overlay UI"
    - path: "client/decrypt/src/selection.js"
      provides: "Word selection, shift-click, triple-click handling"
    - path: "client/decrypt/src/init.js"
      provides: "Initialization calls and debug helpers"
    - path: "client/decrypt/build.js"
      provides: "Build script that concatenates modules"
  key_links:
    - from: "build.js"
      to: "src/*.js"
      via: "fs.readFileSync concatenation"
    - from: "build output"
      to: "validate.js"
      via: "IIFE structure and required functions"
---

<objective>
Split decrypt-interceptor.js (3837 lines) into 6 smaller module files to prevent corruption during editing.

Purpose: The monolithic file keeps getting corrupted during AI editing due to context limits. Smaller files are safer to modify individually.

Output: 6 module files in client/decrypt/src/ plus a build.js script that concatenates them into the original IIFE format.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@client/decrypt/README.md
@client/decrypt/validate.js
@client/decrypt-interceptor.js (reference - do not modify until Task 3)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create module files by extracting sections from decrypt-interceptor.js</name>
  <files>
    client/decrypt/src/config.js
    client/decrypt/src/copy.js
    client/decrypt/src/position.js
    client/decrypt/src/search.js
    client/decrypt/src/selection.js
    client/decrypt/src/init.js
  </files>
  <action>
Create client/decrypt/src/ directory and extract code sections. Each module file should contain ONLY the function bodies (no IIFE wrapper, no 'use strict').

**CRITICAL: Read the backup.js file to extract code. Do NOT read the main decrypt-interceptor.js during extraction to avoid corrupting it.**

Extract these exact sections from client/decrypt/backup.js:

1. **config.js** (lines ~15-171):
   - Start after `'use strict';`
   - Include: encryptionConfig Proxy, console.log initialization, configStatus, getApiHeaders(), setXhrHeaders(), encryptLazyContent(), decryptText()
   - End before setupCopyInterception comment

2. **copy.js** (lines ~172-1180):
   - setupCopyInterception() function
   - setupContextMenuInterception() function
   - All helper functions they use (getClickPositionIfOnText, etc.)
   - encryptQuery() function (around line 1159)

3. **position.js** (lines ~1181-1712):
   - searchServerSide() function
   - positionMapLogger helper and debugPositionMap()
   - buildTextPositionMap() function
   - All position/node walking utilities

4. **search.js** (lines ~1713-3050):
   - searchEncryptedDOM() and searchEncryptedContent()
   - All highlight* functions (highlightMatches, highlightInSingleTextNode, etc.)
   - clearHighlights(), removeAllHighlights()
   - showSearchOverlay(), hideSearchOverlay()
   - Search state object and overlay creation

5. **selection.js** (lines ~3051-3470):
   - setupSearchInterception() (yes, this is in selection because it's keyboard event setup)
   - Actually: setupSearchInterception() is search overlay keyboard handling - include in search.js
   - selection.js: selectionAnchorPosition, shiftDragState
   - setupWordSelectionInterception() and all word/character selection helpers
   - getCharacterPositionFromClick(), selectBetweenPositions(), etc.

6. **init.js** (lines ~3750-3837):
   - DOMContentLoaded listener
   - All setup*() function calls
   - debugEncryption() global function assignment
   - Final console.log

**Module structure rule:** Each module is a code fragment that will be concatenated. No module wrappers needed - just the code.
  </action>
  <verify>
    - ls client/decrypt/src/ shows 6 .js files
    - Each file is non-empty and contains expected function names
    - grep -c "function" client/decrypt/src/*.js shows reasonable counts
  </verify>
  <done>6 module files exist with correct content extracted from backup.js</done>
</task>

<task type="auto">
  <name>Task 2: Create build.js script that concatenates modules into IIFE</name>
  <files>client/decrypt/build.js</files>
  <action>
Create client/decrypt/build.js that:

1. Reads all 6 module files from src/ in correct order:
   - config.js (must be first - defines encryptionConfig and API helpers)
   - copy.js (uses config functions)
   - position.js (uses config, provides map for search)
   - search.js (uses position map, config)
   - selection.js (uses config, position)
   - init.js (must be last - calls all setup functions)

2. Wraps in IIFE structure:
```javascript
/**
 * Decryption Interceptor for Server-Side Encrypted Pages
 * ...header comment from original...
 */
(function() {
    'use strict';

    // === CONFIG ===
    {config.js content}

    // === COPY INTERCEPTION ===
    {copy.js content}

    // === POSITION MAPPING ===
    {position.js content}

    // === SEARCH ===
    {search.js content}

    // === SELECTION ===
    {selection.js content}

    // === INITIALIZATION ===
    {init.js content}

})();
```

3. Adds section comment headers for navigation

4. Writes output to client/decrypt-interceptor.js

5. Runs validation (require and execute validate.js)

Usage: `node client/decrypt/build.js`
  </action>
  <verify>
    - node client/decrypt/build.js runs without error
    - Output shows "VALIDATION PASSED"
  </verify>
  <done>build.js creates valid decrypt-interceptor.js that passes validate.js</done>
</task>

<task type="auto">
  <name>Task 3: Build, validate, and update README</name>
  <files>
    client/decrypt-interceptor.js
    client/decrypt/README.md
  </files>
  <action>
1. Run build: `node client/decrypt/build.js`

2. Verify output:
   - `node client/decrypt/validate.js` passes
   - Line count is similar to original (~3800-3900 lines)
   - Diff against backup to check no major code loss

3. Update client/decrypt/README.md:
   - Document the new modular structure
   - Explain src/ directory and build process
   - Update recovery instructions to include rebuild option
   - Remove "Future: Modular Split" section (it's done!)

4. Verify the built file works (syntax check with Node)
  </action>
  <verify>
    - node client/decrypt/validate.js passes
    - wc -l client/decrypt-interceptor.js shows ~3800-3900 lines
    - node -c client/decrypt-interceptor.js shows "Syntax OK"
    - README.md updated with modular workflow
  </verify>
  <done>decrypt-interceptor.js rebuilt from modules, validates, README updated</done>
</task>

</tasks>

<verification>
1. All module files exist in client/decrypt/src/
2. build.js concatenates them correctly
3. validate.js passes on built output
4. No code lost (diff backup.js vs built output shows only whitespace/comment changes)
5. README documents new workflow
</verification>

<success_criteria>
- 6 module files in client/decrypt/src/ (config, copy, position, search, selection, init)
- build.js creates valid IIFE-wrapped decrypt-interceptor.js
- validate.js passes (line count 3500-4500, all required functions present, valid syntax)
- README.md documents modular structure and build process
- Future edits can target individual small modules instead of 3800-line monolith
</success_criteria>

<output>
After completion, create `.planning/quick/003-split-decrypt-interceptor-modules/003-SUMMARY.md`
</output>
