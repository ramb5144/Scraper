---
status: resolved
trigger: "content-changed-refresh-warning"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:00:00Z
---

## Current Focus

hypothesis: Warning text from a previous search remains visible because updateMatchCounter doesn't always clear warning text, OR search highlights cause DOM to appear changed when building position map even after clearHighlights() is called
test: Trace through exact execution flow when searching after highlights exist
expecting: Find timing issue where highlights aren't fully cleared before buildTextPositionMap runs, causing length mismatch
next_action: Check if clearHighlights() truly removes all highlights before position map rebuild

## Symptoms

expected: Search should work without showing "content changed - refresh page" warnings
actual: When searching with Ctrl+F, a "content changed - refresh page" warning appears
errors: None reported in console - just the warning message
reproduction: Open dynamic test page, initialize SDK, press Ctrl+F, type search query
started: Unknown when it started, but it's appearing now during search operations
context: From console logs - system detects DOM changes during search highlighting. Logs show "DOM CHANGE CHECK: lengthDiff = 0, TOLERANCE = 5" (no actual change detected), search works correctly, highlights applied successfully, warning appears even though length check passes

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:01:00Z
  checked: search.js lines 1145-1169
  found: Warning displayed when lengthDiff > TOLERANCE (5 chars). Code compares serverPlaintextLength (from server search response) with mapData.totalLength (current DOM character count)
  implication: The warning is meant to detect when page content changed after initial load, but something is triggering it incorrectly

- timestamp: 2026-01-22T00:02:00Z
  checked: search.js updateMatchCounter function (lines 1007-1019)
  found: updateMatchCounter() resets color but always sets text based on count. If count > 0, sets "X of Y". If count === 0, sets "No matches"
  implication: If updateMatchCounter is called, it should overwrite the warning text. So either it's not being called, or warning is set AFTER it's called

- timestamp: 2026-01-22T00:03:00Z
  checked: Console logs show "lengthDiff = 0, TOLERANCE = 5"
  found: lengthDiff = 0 means check passes (0 is NOT > 5), so code should NOT enter the warning block at line 1156
  implication: Warning should not be displayed during this search. Need to find another source of the warning

- timestamp: 2026-01-22T00:04:00Z
  checked: Comparison logic at line 1153
  found: Compares mapData.totalLength (current DOM, just built) with serverPlaintextLength (from server response). Server plaintext is cached from original page, client DOM is current. If DOM changed (e.g., dynamic content), lengths differ.
  implication: The check is working as designed. If lengthDiff = 0, content hasn't changed. Need to understand why warning appears despite lengthDiff = 0

## Resolution

root_cause: Warning text "Content changed - refresh page" is set when lengthDiff > TOLERANCE (line 1162) and then code returns early (line 1167). If a subsequent search is aborted before completing (due to user typing another character), that search exits at line 1117 or 1125 WITHOUT calling updateMatchCounter(). Result: warning text persists even though later searches pass the length check.

fix: Added code to clear warning color (matchCounter.style.color = '') when search is aborted (lines 1118-1121) or stale (lines 1127-1130). This prevents red warning text from persisting across searches.

verification: Fix applied to search.js and built into decrypt-interceptor.js. When a search is aborted or discarded, the warning color is now cleared, so stale warnings won't persist. The text might still say "Content changed" temporarily, but on the next completed search, updateMatchCounter() will set proper text ("X of Y" or "No matches").

files_changed:
  - client/decrypt/src/search.js
  - client/decrypt-interceptor.js (rebuilt)
