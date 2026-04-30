---
id: quick-009
type: execute
status: pending
files_modified:
  - tests/pages/sdk-test-page.ts
  - client/decrypt/src/copy.js
autonomous: true

must_haves:
  truths:
    - "Playwright tests receive plaintext from copy operations"
    - "Copy handler sets plaintext on system clipboard"
    - "All 8 skipped copy/paste tests pass"
  artifacts:
    - path: "tests/pages/sdk-test-page.ts"
      provides: "Updated copySelectedText that works with clipboard API"
    - path: "client/decrypt/src/copy.js"
      provides: "Copy handler that writes to system clipboard"
  key_links:
    - from: "client/decrypt/src/copy.js"
      to: "navigator.clipboard.writeText"
      via: "Async clipboard API call after setData"
---

<objective>
Fix clipboard copy/paste tests - Playwright not receiving plaintext from decrypt-interceptor

**Problem:** The copy handler uses `e.clipboardData.setData('text/plain', finalText)` which sets data on the copy event object, but Playwright's `navigator.clipboard.readText()` reads from the system clipboard. In automated browser contexts, these may not be synchronized.

**Solution:** Add `navigator.clipboard.writeText(finalText)` call in the copy handler to explicitly write to the system clipboard, ensuring Playwright can read the decrypted text.

**Why this approach:**
- `e.clipboardData.setData()` is synchronous and required for browser copy event interception
- `navigator.clipboard.writeText()` is async but ensures system clipboard is updated
- Both can coexist - setData handles the event, writeText ensures system clipboard sync
</objective>

<context>
@.planning/STATE.md
@client/decrypt/src/copy.js
@tests/pages/sdk-test-page.ts
@tests/specs/copy-paste.spec.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add system clipboard write to copy handler</name>
  <files>client/decrypt/src/copy.js</files>
  <action>
After the existing `e.clipboardData.setData('text/plain', finalText)` call (around line 286), add:

```javascript
// Also write to system clipboard for automated test compatibility
// This ensures Playwright and other automation tools can read the decrypted text
// Note: This is async but we don't need to await it - the sync setData handles the event
navigator.clipboard.writeText(finalText).catch(err => {
    console.warn('[Decrypt Interceptor] Failed to write to system clipboard:', err);
});
```

This is a minimal, non-breaking change:
- The synchronous `setData()` still handles the copy event for normal browser use
- The async `writeText()` ensures the system clipboard gets the plaintext
- Errors are caught and logged (won't break copy if clipboard API unavailable)
  </action>
  <verify>
Run `grep -n "writeText" client/decrypt/src/copy.js` shows the new clipboard write call
  </verify>
  <done>Copy handler writes decrypted text to both event clipboardData and system clipboard</done>
</task>

<task type="auto">
  <name>Task 2: Unskip copy/paste tests and verify they pass</name>
  <files>tests/specs/copy-paste.spec.ts</files>
  <action>
1. Check if any tests are marked with `test.skip()` - if so, remove the skip annotations
2. Run the copy/paste test suite: `npx playwright test tests/specs/copy-paste.spec.ts`
3. All 11 tests should now pass (including the 8 that were previously skipped/failing)

If tests still fail:
- Check console output for "Failed to write to system clipboard" warnings
- Verify clipboard permissions are granted in playwright.config.ts (already present)
- Check if the copy handler is being triggered (look for "[Decrypt Interceptor] Copy event triggered" logs)
  </action>
  <verify>
`npx playwright test tests/specs/copy-paste.spec.ts` shows 11 tests passing (0 skipped, 0 failed)
  </verify>
  <done>All copy/paste tests pass, validating that Playwright receives decrypted plaintext</done>
</task>

</tasks>

<verification>
1. Run full copy/paste test suite:
   ```bash
   npx playwright test tests/specs/copy-paste.spec.ts --reporter=list
   ```
   Expected: 11 tests passing

2. Verify no regressions in other tests:
   ```bash
   npx playwright test --reporter=list
   ```
   Expected: All tests pass (no new failures)

3. Manual verification (optional):
   - Open http://localhost:8001/sdk-test
   - Initialize SDK
   - Select text and copy (Cmd/Ctrl+C)
   - Paste in external app - should show plaintext, not encrypted
</verification>

<success_criteria>
- Copy handler writes to system clipboard via navigator.clipboard.writeText()
- All 11 copy/paste tests pass
- No regressions in other tests
- Console shows no errors during copy operations
</success_criteria>

<output>
After completion, update `.planning/STATE.md`:
- Remove "ACTIVE: Clipboard tests getting encrypted text" blocker
- Add quick task 009 to completed table
</output>
