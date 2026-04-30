---
phase: quick
plan: 004
type: execute
wave: 1
depends_on: []
files_modified:
  - client/decrypt/src/search.js
  - client/decrypt/src/init.js
  - client/cloak-sdk.js
  - templates/dynamic_test.html
autonomous: true

must_haves:
  truths:
    - "Content-changed warning does not appear for ticker text updates"
    - "decrypt-interceptor.js loads and runs correctly"
    - "Debug logging is minimal unless debug flag is enabled"
    - "FAQ section renders correctly with accordion functionality"
  artifacts:
    - path: "client/decrypt/src/search.js"
      provides: "Exclude ticker from plaintext length calculation"
    - path: "client/decrypt/src/init.js"
      provides: "Reduced debug logging"
    - path: "client/cloak-sdk.js"
      provides: "Reduced debug logging"
---

<objective>
Fix four issues affecting the Cloak SDK and decrypt-interceptor functionality:

1. **Content-changed warning from ticker** - The breaking news ticker changes every 5 seconds, causing server plaintext length (7964) to differ from DOM plaintext length (7955), triggering "Content changed - refresh page" warning
2. **decrypt-interceptor.js loading** - Verify modules are built and script loads correctly
3. **Excessive debug logging** - Both cloak-sdk.js and decrypt-interceptor init.js output verbose logs unconditionally
4. **FAQ accordion rendering** - Investigate and fix any accordion rendering issues

Purpose: Restore clean user experience without false warnings or excessive console noise
Output: Fixed files, verified functionality
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@client/decrypt/src/search.js (DOM change detection at lines 1150-1177)
@client/decrypt/src/init.js (debug logging)
@client/cloak-sdk.js (debug logging pattern)
@templates/dynamic_test.html (ticker implementation at lines 1639-1652)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix content-changed false positive from ticker</name>
  <files>
    client/decrypt/src/search.js
    client/decrypt/src/position.js
  </files>
  <action>
The ticker content changes dynamically, but the server's plaintext was captured at initial page load. When DOM changes (ticker updates), the length mismatch triggers a false "content changed" warning.

**Solution: Exclude ticker from position calculation**

In `client/decrypt/src/position.js`, update `shouldExcludeTextNodeForPositionCalc()` to exclude elements with class `ticker-content` or inside `.breaking-news`:

```javascript
// Add check for ticker/breaking news elements (dynamic content that changes client-side only)
if (parent.classList && (parent.classList.contains('ticker-content') || parent.classList.contains('breaking-news'))) {
    return true;
}
```

Also update `EXCLUDE_SELECTORS` comment to document this exclusion.

In `client/decrypt/src/search.js`, the DOM change detection (lines 1150-1177) compares `mapData.totalLength` with `serverPlaintextLength`. The fix in position.js will exclude ticker from both, making lengths match.

**Alternative approach if the above doesn't work:** Increase TOLERANCE from 5 to 50 to accommodate ticker variations. But the proper fix is excluding dynamic content.

After editing modules, rebuild:
```bash
node client/decrypt/build.js
```
  </action>
  <verify>
1. Run `node client/decrypt/build.js` - should complete without errors
2. Open dynamic_test.html, initialize SDK
3. Wait for ticker to update (5 seconds)
4. Open search (Cmd+F)
5. Type a search term
6. Should NOT see "Content changed - refresh page" warning
  </verify>
  <done>Search works without false "content changed" warning when ticker updates</done>
</task>

<task type="auto">
  <name>Task 2: Reduce excessive debug logging</name>
  <files>
    client/decrypt/src/init.js
    client/cloak-sdk.js
  </files>
  <action>
**Fix init.js debug logging:**

The init.js module outputs verbose debug info unconditionally. Wrap all console.log statements in a debug check or remove them entirely. The file has ~29 console.log calls.

Replace the entire init.js content with a minimal version that:
1. Exposes `window.debugEncryption()` function (keep this for manual debugging)
2. Removes all automatic console.log output
3. Only logs errors, not informational messages

```javascript
// Debug helper - only runs when explicitly called
window.debugEncryption = function() {
    console.log('%c Encryption Debug Information', 'color: #4CAF50; font-weight: bold; font-size: 16px;');
    console.table(window.encryptionConfig || { error: 'Not set' });

    console.log('%c Available Functions', 'color: #9C27B0; font-weight: bold;');
    console.log({
        'decryptText': typeof window.decryptText,
        'encryptLazyContent': typeof window.encryptLazyContent,
        'searchEncryptedContent': typeof window.searchEncryptedContent,
        'showSearchOverlay': typeof window.showSearchOverlay
    });
};
```

**Fix cloak-sdk.js debug logging:**

The SDK already has `config.debug` flag but has redundant checks like:
```javascript
if (config.debug) {
    if (config.debug) console.log(...);  // Double check!
}
```

Search for `if (config.debug) {` followed by another `if (config.debug)` and remove the outer check, keeping only the inner one.

Also clean up any unconditional console.log calls (keep console.warn and console.error).

Rebuild after editing:
```bash
node client/decrypt/build.js
```
  </action>
  <verify>
1. Run `node client/decrypt/build.js`
2. Open dynamic_test.html in browser
3. Open console
4. Initialize SDK (without debug flag)
5. Console should be quiet - no verbose logging
6. Run `debugEncryption()` in console - should output debug info
  </verify>
  <done>Console is quiet by default; debug info available via debugEncryption()</done>
</task>

<task type="auto">
  <name>Task 3: Verify FAQ accordion functionality</name>
  <files>templates/dynamic_test.html</files>
  <action>
The FAQ section uses accordion functionality with JavaScript (`toggleAccordion` function at line 1762-1778).

**Investigation steps:**
1. Open dynamic_test.html in browser
2. Scroll to FAQ section
3. Click each accordion header
4. Verify content expands/collapses correctly

**Potential issues to check:**
- CSS `max-height: 0` might not be getting set
- `scrollHeight` calculation might be wrong after SDK encryption
- The accordion content text might have been encrypted improperly

**If accordion is broken after SDK initialization:**
Add `data-cloak-exclude` attribute to the accordion headers (not content) if the JavaScript selectors are breaking due to encrypted text:
```html
<div class="accordion-header" onclick="toggleAccordion(this)" data-cloak-exclude>
```

OR investigate if the issue is CSS-related and the content is simply hidden due to styling conflicts.

Document findings - if accordion works correctly, no changes needed.
  </action>
  <verify>
1. Open dynamic_test.html
2. Initialize SDK
3. Scroll to "Frequently Asked Questions" section
4. Click "How can I access premium content?" header
5. Content should expand smoothly
6. Click again - should collapse
7. Try other accordion items
  </verify>
  <done>FAQ accordion expands/collapses correctly after SDK initialization</done>
</task>

</tasks>

<verification>
After all tasks:
1. `node client/decrypt/build.js` completes successfully
2. dynamic_test.html loads without console errors
3. SDK initializes cleanly (no verbose logging unless debug:true)
4. Ticker updates don't trigger content-changed warnings
5. Search works correctly after ticker updates
6. FAQ accordion functions properly
7. Copy/paste still works (regression test)
</verification>

<success_criteria>
- No false "Content changed - refresh page" warnings from ticker updates
- Console is quiet by default (no verbose debug output)
- FAQ accordion works correctly
- All existing functionality preserved (search, copy, selection)
</success_criteria>

<output>
After completion, create `.planning/quick/004-fix-multiple-issues/004-SUMMARY.md`
</output>
