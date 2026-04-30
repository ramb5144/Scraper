---
status: resolved
trigger: "Investigate issue: double-encryption-on-framework-rerenders"
created: 2026-01-24T00:00:00Z
updated: 2026-01-24T00:08:00Z
---

## Current Focus

hypothesis: ROOT CAUSE CONFIRMED - Framework re-renders create new DOM nodes without _cloakEncrypted marker, causing double-encryption. Solution: maintain a Set of encrypted text strings and check against it before encrypting.
test: implement fix by creating encryptedTextCache Set and checking text against it before encryption
expecting: Fix will prevent double-encryption by detecting already-encrypted text content
next_action: implement fix in encryptTextNode function

## Symptoms

expected: When a framework re-renders a component with the same text content, the SDK should recognize the text is already encrypted and skip re-encrypting it. The text should remain encrypted once with the correct mapping.

actual: Framework re-renders replace DOM nodes, destroying the _cloakEncrypted marker. MutationObserver sees "new" nodes with encrypted text, doesn't recognize it's already encrypted, and encrypts it again. Result: double-encrypted gibberish that doesn't decrypt correctly.

errors: No JavaScript errors, but text displays as wrong gibberish because it's been encrypted twice with the character mapping.

reproduction:
1. Initialize SDK on a page
2. Let initial encryption complete (text shows correctly)
3. Use framework to re-render the same component (e.g., React setState, Vue reactive update)
4. Framework does innerHTML replacement or DOM node replacement
5. MutationObserver sees new nodes with encrypted text
6. SDK encrypts the already-encrypted text again
7. Text now shows as different gibberish

started: This is a theoretical issue identified through code analysis. It would affect any site using React, Vue, Angular, or any framework that does DOM replacements during re-renders. Likely happening in production but undetected.

## Eliminated

## Evidence

- timestamp: 2026-01-24T00:01:00Z
  checked: encryptTextNode function in cloak-sdk.js (lines 340-418)
  found: Function checks `if (textNode._cloakEncrypted) return;` on line 341 to skip already-encrypted nodes
  implication: This protection ONLY works if the same DOM node object persists. Framework re-renders create NEW node objects with encrypted text but no _cloakEncrypted marker.

- timestamp: 2026-01-24T00:02:00Z
  checked: MutationObserver logic in cloak-sdk.js (lines 489-521)
  found: Observer checks `if (node._cloakEncrypted) continue;` for both addedNodes and characterData mutations
  implication: Same problem - relies on object property that doesn't survive DOM replacement. New nodes with encrypted text won't have the marker.

- timestamp: 2026-01-24T00:03:00Z
  checked: plaintextStorage WeakMap usage (line 414)
  found: Original text stored as `plaintextStorage.set(textNode, textToEncrypt);` keyed by node object
  implication: When framework replaces DOM, old node is garbage collected, WeakMap entry is lost. New node has encrypted text but no WeakMap entry, so SDK can't detect it's already encrypted.

- timestamp: 2026-01-24T00:04:00Z
  checked: encryption.py and generate_font.py to understand character mappings
  found: Encrypted text uses same ASCII characters (A-Z, a-z, space, period) just remapped via Feistel cipher. No special character ranges.
  implication: Can't detect encrypted text by character inspection alone. Need a different approach - perhaps check plaintextIndex or attempt to match against known encrypted content.

- timestamp: 2026-01-24T00:05:00Z
  checked: plaintextIndex structure and usage patterns
  found: plaintextIndex stores { node, start, end, originalText } where originalText is the PLAINTEXT before encryption. It doesn't store the encrypted result.
  implication: Can't use plaintextIndex alone to detect encrypted text. Need to track encrypted strings separately.

- timestamp: 2026-01-24T00:06:00Z
  analyzed: possible solutions to detect already-encrypted text
  found: Best approach is to maintain a Set of encrypted text strings. Before encrypting a node, check if its nodeValue is in this Set.
  implication: This prevents double-encryption by recognizing when a "new" node contains text we've already encrypted.

- timestamp: 2026-01-24T00:07:00Z
  implemented: Changed encryptedTextCache from Set to Map(encryptedText -> plaintext)
  found: This allows us to restore plaintextStorage for copy-paste functionality when detecting re-rendered nodes
  implication: Fix maintains full functionality including copy-paste, not just preventing double-encryption.

- timestamp: 2026-01-24T00:08:00Z
  verified: Code review and logic trace-through confirms fix works correctly
  found: Framework re-renders now detected, node marked as encrypted, plaintextStorage restored, no double-encryption occurs
  implication: Issue is fully resolved.

## Resolution

root_cause: Framework re-renders (React, Vue, Angular) replace DOM nodes via innerHTML or similar mechanisms. This creates new DOM node objects with encrypted text content but without the _cloakEncrypted marker or plaintextStorage WeakMap entry. MutationObserver sees these as "new" unencrypted nodes and encrypts them again, causing double-encryption gibberish.

fix: Added encryptedTextCache Map that stores encrypted text -> original plaintext mappings. Before encrypting a text node, check if its nodeValue is already in the cache. If it is, skip re-encryption, mark the node as encrypted, and restore the plaintext to plaintextStorage (preserving copy-paste functionality). This detects when frameworks create new nodes with our already-encrypted content and prevents double-encryption while maintaining full functionality.

verification: Code review confirms the logic prevents double-encryption. When a framework re-renders:
1. New node has encrypted text as nodeValue
2. encryptTextNode checks encryptedTextCache.has(encryptedText) - returns true
3. Retrieves original plaintext from cache
4. Marks node as encrypted, restores plaintextStorage
5. Returns early without re-encrypting

files_changed: [client/cloak-sdk.js]
