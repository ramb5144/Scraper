---
phase: quick
plan: 008
type: execute
wave: 1
depends_on: [007]
files_modified: [client/decrypt/src/position.js]
autonomous: true

must_haves:
  truths:
    - "decrypt-interceptor includes code/pre/kbd/samp/var in position mapping"
    - "Position calculations remain accurate on pages with code blocks"
    - "Copy/paste returns correct plaintext for code block content"
  artifacts:
    - path: "client/decrypt/src/position.js"
      provides: "Updated EXCLUDE_SELECTORS without code/pre elements"
      contains: "EXCLUDE_SELECTORS = ['script', 'style', 'noscript', 'meta', 'link', 'head', 'svg', 'path', 'textarea', 'input']"
  key_links:
    - from: "client/decrypt/src/position.js"
      to: "client/cloak-sdk.js"
      via: "Matching exclusion logic"
      pattern: "Both include code/pre/kbd/samp/var in their processing"
---

<objective>
Sync decrypt-interceptor exclusion logic with SDK after quick-007 changes.

Purpose: Quick task 007 changed the SDK to encrypt code/pre/kbd/samp/var elements (instead of skipping them). The decrypt-interceptor still excludes these tags from position mapping, causing position calculation errors on pages with code blocks. This fix removes those tags from EXCLUDE_SELECTORS to restore consistency.

Output: Updated position.js with matching exclusion logic.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/02-architecture-documentation-and-verification-document-complet/verification/exclusion-logic-comparison.md
@.planning/quick/007-fix-code-blocks-showing-encrypted-text-e/007-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove code/pre elements from EXCLUDE_SELECTORS</name>
  <files>client/decrypt/src/position.js</files>
  <action>
    Update line 217 in position.js to remove 'code', 'pre', 'kbd', 'samp', 'var' from EXCLUDE_SELECTORS.

    BEFORE:
    ```javascript
    const EXCLUDE_SELECTORS = ['script', 'style', 'noscript', 'meta', 'link', 'head', 'svg', 'path', 'code', 'pre', 'kbd', 'samp', 'var', 'textarea', 'input'];
    ```

    AFTER:
    ```javascript
    const EXCLUDE_SELECTORS = ['script', 'style', 'noscript', 'meta', 'link', 'head', 'svg', 'path', 'textarea', 'input'];
    ```

    Add a comment referencing quick-007 for traceability:
    ```javascript
    // Elements to exclude from position mapping (MUST MATCH cloak-sdk.js excludeSelectors)
    // NOTE: code/pre/kbd/samp/var removed in quick-008 to match SDK (see quick-007)
    const EXCLUDE_SELECTORS = ['script', 'style', 'noscript', 'meta', 'link', 'head', 'svg', 'path', 'textarea', 'input'];
    ```
  </action>
  <verify>
    grep -n "EXCLUDE_SELECTORS" client/decrypt/src/position.js
    Confirm: code, pre, kbd, samp, var are NOT in the array
  </verify>
  <done>EXCLUDE_SELECTORS no longer contains code/pre/kbd/samp/var</done>
</task>

<task type="auto">
  <name>Task 2: Verify consistency with SDK</name>
  <files>client/decrypt/src/position.js, client/cloak-sdk.js</files>
  <action>
    Verify that the exclusion logic now matches between SDK and decrypt-interceptor:

    1. Check SDK excludeSelectors in DEFAULT_CONFIG (line ~70):
       - Should NOT contain code/pre/kbd/samp/var (removed in quick-007)

    2. Check decrypt-interceptor EXCLUDE_SELECTORS (line ~217):
       - Should NOT contain code/pre/kbd/samp/var (removed in this task)

    3. Confirm both now match on these base tags:
       script, style, noscript, meta, link, head

    4. Note intentional differences (documented in exclusion-logic-comparison.md):
       - svg, path: DI excludes, SDK doesn't (low impact, acceptable)
       - textarea, input: DI excludes, SDK doesn't (defensive, no impact)
  </action>
  <verify>
    grep "excludeSelectors" client/cloak-sdk.js | head -3
    grep "EXCLUDE_SELECTORS" client/decrypt/src/position.js | head -3
    Confirm: Neither contains code/pre/kbd/samp/var
  </verify>
  <done>SDK and decrypt-interceptor exclusion logic are consistent for code block elements</done>
</task>

</tasks>

<verification>
1. EXCLUDE_SELECTORS in position.js no longer contains code/pre/kbd/samp/var
2. Comment added referencing quick-007/quick-008 for traceability
3. No other changes to position.js logic
</verification>

<success_criteria>
- [ ] code/pre/kbd/samp/var removed from EXCLUDE_SELECTORS
- [ ] Comment added for traceability
- [ ] Grep verification passes
- [ ] Commit created with atomic change
</success_criteria>

<output>
After completion, create `.planning/quick/008-sync-decrypt-interceptor-exclusion-logic/008-SUMMARY.md`
</output>
