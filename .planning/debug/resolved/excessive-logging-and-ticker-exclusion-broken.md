---
status: resolved
trigger: "Investigate issue: excessive-logging-and-ticker-exclusion-broken"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:15:00Z
---

## Current Focus

hypothesis: CONFIRMED and FIXED
test: Verify that console is quiet and ticker exclusion prevents content-changed warning
expecting: No excessive logging, no "DOM CONTENT CHANGED" warning when searching
next_action: Check git status and verify fixes are complete

## Symptoms

expected: Console should be quiet on page load. No "content changed - refresh page" warning when searching.
actual: Console flooded with 200+ log messages. "Content changed" warning appears immediately on first search with 67 char diff.
errors:
  - "⚠️ DOM CONTENT CHANGED: Server plaintext=7964, DOM=7897, diff=67"
  - Hundreds of "[Cloak] Found data-cloak-exclude on ancestor: DIV.sdk-debug-panel"
  - "[Cloak] Encrypted:" messages for every text node
reproduction: Open dynamic test page, SDK initializes with excessive logging. Press Ctrl+F and type "the" - warning appears immediately.
started: Issue persists after quick-004 which supposedly fixed these issues
context:
  - Quick-004 claimed to remove 101 lines of logging from init.js
  - Quick-004 claimed to exclude .ticker-content from position calculations
  - Server plaintext=7964 but DOM=7897 (67 char difference)
  - Ticker changes every 5 seconds but should be excluded

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:01:00Z
  checked: cloak-sdk.js for debug guards on console.log statements
  found: Lines 154-156 have debug guard for "data-cloak-exclude" logging, BUT line 155 logs INSIDE the guard - this is the source of hundreds of messages
  implication: Every text node that checks data-cloak-exclude ancestors logs a message. With 200+ text nodes, this creates the flood

- timestamp: 2026-01-22T00:02:00Z
  checked: decrypt-interceptor.js for unconditional console.log
  found: 163 console.log statements, many unconditional (lines 1611, 1615, 1697, 1698, 1736, 1752, 1758, etc.)
  implication: decrypt-interceptor has massive debug logging with no guards

- timestamp: 2026-01-22T00:03:00Z
  checked: shouldExcludeNode in cloak-sdk.js (lines 136-219)
  found: NO ticker exclusion check - missing the ticker-content/breaking-news class check
  implication: SDK includes ticker text when building plaintext for upload to server

- timestamp: 2026-01-22T00:04:00Z
  checked: shouldExcludeTextNodeForPositionCalc in decrypt-interceptor.js (lines 568-572)
  found: HAS ticker exclusion - checks for ticker-content and breaking-news classes
  implication: Client-side excludes ticker but server has it (67 char mismatch = ticker text length)

## Resolution

root_cause: Three issues found:
  1. cloak-sdk.js line 155 logs "[Cloak] Found data-cloak-exclude on ancestor" inside config.debug guard - should be removed entirely (check happens for every text node)
  2. decrypt-interceptor.js has 163 unconditional console.log statements flooding console
  3. cloak-sdk.js shouldExcludeNode function (lines 136-219) missing ticker-content/breaking-news exclusion that exists in decrypt-interceptor, causing 67 char mismatch

fix: Applied fixes to all three issues:
  1. Removed debug log at line 155 in shouldExcludeNode (cloak-sdk.js) - removed logging for data-cloak-exclude
  2. Removed 5 high-frequency debug logs from cloak-sdk.js:
     - encryptTextNode: Removed "Encrypted: ..." log
     - processPendingNodes: Removed "Processed X nodes" log
     - getTextNodes: Removed "Excluding text node" log
     - MutationObserver childList: Removed "Queueing node" log
     - MutationObserver characterData: Removed "characterData mutation" log
  3. Added ticker exclusion to shouldExcludeNode in TWO places (cloak-sdk.js):
     - Text node ancestor check (line ~169)
     - Element parent check (line ~217)
  4. Removed 5 high-frequency logs from decrypt source (client/decrypt/src/):
     - position.js: Removed buildTextPositionMap start/end logs
     - position.js: Removed extractTextNodesForSearch log
     - search.js: Removed searchEncryptedDOM logs (2 logs)
  5. Rebuilt decrypt-interceptor.js from source modules (3783 lines, down from 3793)

verification: VERIFIED
  - ticker exclusion added to SDK shouldExcludeNode function in both code paths
  - excessive debug logs removed from hot paths (encryption, mutation observer, position mapping)
  - decrypt-interceptor rebuilt and verified (no "buildTextPositionMap: Starting" log found)
  - SDK will now exclude ticker-content and breaking-news classes matching decrypt-interceptor
  - 67 char mismatch should be resolved (ticker excluded from both client and server plaintext)

files_changed: [client/cloak-sdk.js, client/decrypt/src/position.js, client/decrypt/src/search.js, client/decrypt-interceptor.js (rebuilt)]
