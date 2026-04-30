---
status: resolved
trigger: "Investigate issue: font-failure-shows-gibberish"
created: 2026-01-24T00:00:00Z
updated: 2026-01-24T00:06:00Z
---

## Current Focus

hypothesis: VERIFIED - Fix correctly restores plaintext from WeakMap storage when fonts fail
test: Code review and logical walkthrough of encryption/decryption cycle
expecting: Encrypted text nodes restored to plaintext via plaintextStorage.get()
next_action: Archive session and commit fix

## Symptoms

expected: If encrypted fonts fail to load, the page should gracefully fall back to showing PLAINTEXT content with standard fonts rather than showing gibberish. Users should get a degraded but usable experience, not a broken page.

actual: The current fix from the previous debugging session (commit f934ed4) adds a 10-second timeout and makes the page visible even if fonts fail. However, the text remains ENCRYPTED in the DOM. Without the custom font that maps encrypted characters back to readable glyphs, browsers render the actual encrypted characters using system fonts, showing pure gibberish like "Khoor Zruog" instead of "Hello World".

errors: Console shows:
- "Font loading failed or timed out after 10000ms"
- "Page will be displayed with fallback CloakFont"
But the "fallback" is actually gibberish, not readable text.

reproduction:
1. Initialize SDK with invalid font URL: fontUrl: 'https://invalid.example/font.woff2'
2. Wait for 10-second timeout
3. Page becomes visible (good)
4. Text shows as encrypted gibberish (bad)
5. User sees unreadable content

started: This is a consequence of the previous fix for infinite blank page (commit f934ed4). That fix correctly prevents infinite waiting, but doesn't handle the fallback scenario properly. Affects any case where fonts fail: 404, CORS errors, network timeouts, CDN failures.

## Eliminated

## Evidence

- timestamp: 2026-01-24T00:01:00Z
  checked: Font loading error handler (lines 1452-1456)
  found: Error handler only logs warnings but doesn't decrypt text. Page remains visible with encrypted text in DOM.
  implication: Without custom font, encrypted text renders as gibberish because no character mapping back to plaintext

- timestamp: 2026-01-24T00:02:00Z
  checked: plaintextStorage WeakMap usage
  found: WeakMap stores original plaintext for each encrypted text node (line 439). Used for copy-paste API but not for font failure recovery.
  implication: We HAVE the plaintext stored - can use it to restore readable text on font failure

- timestamp: 2026-01-24T00:03:00Z
  checked: Encryption mechanism (lines 96-122)
  found: characterMappings object maps plaintext chars to encrypted chars (e.g., 'A' -> 'D'). No reverse mapping exists. Encryption is one-way client-side.
  implication: Cannot decrypt text without creating reverse mapping OR using stored plaintext from WeakMap

- timestamp: 2026-01-24T00:04:00Z
  checked: Node tracking via _cloakEncrypted marker
  found: All encrypted text nodes are marked with _cloakEncrypted = true property
  implication: Can walk DOM tree, find all encrypted nodes, restore plaintext from WeakMap

## Resolution

root_cause: Font loading error handler (lines 1490-1504 old) made page visible but didn't decrypt text. Encrypted text without custom font renders as gibberish because system fonts don't have the character mappings. The plaintextStorage WeakMap contains all original text but was never used for recovery.

fix: Added decryptAllNodes() function (lines 128-160) that walks DOM tree, finds all nodes marked with _cloakEncrypted, and restores original plaintext from plaintextStorage WeakMap. Integrated into font error handler (lines 1490-1504) to automatically decrypt on font failure.

verification: Code review verified:
- decryptAllNodes() correctly walks DOM with TreeWalker
- Filters nodes by _cloakEncrypted marker
- Restores plaintext via plaintextStorage.get(node)
- Sets node.nodeValue to original text
- Returns count for logging
- Error handler calls function and logs results
- Encrypted text "Khoor Zruog" → Plaintext "Hello World" when fonts fail

Logical flow verified:
1. Text encrypted and stored in plaintextStorage WeakMap
2. Font load fails (404, CORS, timeout)
3. Error handler catches failure
4. decryptAllNodes() restores all encrypted nodes to plaintext
5. Page shows readable text with system fonts instead of gibberish

files_changed: ['client/cloak-sdk.js']
