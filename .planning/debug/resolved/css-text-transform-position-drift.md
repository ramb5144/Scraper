---
status: resolved
trigger: "Investigate issue: css-text-transform-position-drift"
created: 2026-01-23T00:00:00Z
updated: 2026-01-23T00:15:00Z
---

## Current Focus

hypothesis: CONFIRMED - decrypt-interceptor needs getTextTransform() and applyTextTransform() functions, and must apply them in both getSelectionPositions() and buildTextPositionMap() to match SDK behavior
test: Implement the missing functions and modify position calculation logic
expecting: After fix, position calculations will use transformed text matching what SDK encrypted
next_action: Implement fix in decrypt-interceptor.js

## Symptoms

expected: When text has CSS text-transform (uppercase, lowercase, capitalize), position calculations should account for the transformed text length and content.

actual: SDK encrypts transformed text (e.g., "HELLO" for "hello" with text-transform: uppercase), but decrypt-interceptor calculates positions based on untransformed textContent, causing position mismatches.

errors: No explicit errors, but copy/paste and search will retrieve wrong text ranges when selections include text-transform elements.

reproduction:
1. Create HTML with text-transform CSS: `<h1 style="text-transform: uppercase">hello world</h1>`
2. SDK encrypts "HELLO WORLD" (transformed)
3. User selects text and copies
4. decrypt-interceptor calculates positions on "hello world" (untransformed)
5. Server lookup uses wrong positions

started: This is a design flaw present from initial implementation. SDK handles text-transform correctly (lines 357-378 in cloak-sdk.js), but decrypt-interceptor was never updated to match.

## Eliminated

## Evidence

- timestamp: 2026-01-23T00:01:00Z
  checked: cloak-sdk.js lines 301-324
  found: SDK has getTextTransform() and applyTextTransform() functions
  implication: SDK is designed to handle text-transform

- timestamp: 2026-01-23T00:02:00Z
  checked: cloak-sdk.js lines 357-378
  found: SDK applies text-transform BEFORE encryption - line 366 transforms text, line 403 stores transformed text in _cloakOriginal
  implication: Encrypted content contains transformed text (e.g., "HELLO" not "hello")

- timestamp: 2026-01-23T00:03:00Z
  checked: decrypt-interceptor.js with grep for text-transform
  found: No matches - decrypt-interceptor has NO text-transform handling functions
  implication: decrypt-interceptor is missing critical transform logic

- timestamp: 2026-01-23T00:04:00Z
  checked: decrypt-interceptor.js lines 738-743 (getSelectionPositions)
  found: Line 739 reads textNode.textContent.replace(/\u200B/g, '') - raw DOM text without transform
  implication: Position calculation uses untransformed text while SDK encrypted transformed text

- timestamp: 2026-01-23T00:05:00Z
  checked: cloak-sdk.js lines 1626-1639 (uploadPlaintextToServer)
  found: Line 1628 uses textNode._cloakOriginal which contains transformed text
  implication: Server plaintext contains transformed text

- timestamp: 2026-01-23T00:06:00Z
  checked: decrypt-interceptor.js lines 1633-1721 (buildTextPositionMap)
  found: Line 1658 reads textNode.textContent without transform, line 1695 uses untransformed text.length
  implication: buildTextPositionMap also has same bug - uses untransformed text

- timestamp: 2026-01-23T00:07:00Z
  checked: Concrete example trace
  found: HTML "<h1 style='text-transform: uppercase'>hello</h1>" - SDK encrypts "HELLO" (5 chars), decrypt-interceptor counts "hello" (5 chars but different content). Next element starts at position 5 in both. But if selection contains "HE", SDK lookup is for positions 0-2 in "HELLO", decrypt finds "he" instead.
  implication: Character positions align by length, but content mismatch causes wrong decryption

## Resolution

root_cause: decrypt-interceptor.js is missing getTextTransform() and applyTextTransform() helper functions that exist in cloak-sdk.js. Both getSelectionPositions() (line 739) and buildTextPositionMap() (line 1658) read raw textNode.textContent without applying CSS text-transform, while SDK applies transform before encryption (cloak-sdk.js line 366). This causes position drift when selections include text-transform elements because positions are calculated on different text content ("hello" vs "HELLO").

fix: Added getTextTransform() and applyTextTransform() functions to decrypt-interceptor.js (after line 995) matching SDK implementation exactly. Modified both getSelectionPositions() (line 750) and buildTextPositionMap() (line 1711) to apply text-transform before using text for position calculations. This ensures decrypt-interceptor counts positions on the same transformed text that SDK encrypted.

verification:
- Created verification script comparing SDK and decrypt-interceptor implementations
- All 5 test cases passed (uppercase, lowercase, capitalize, with numbers, none)
- Implementations match character-for-character
- Text-transform applied in both critical functions:
  * getSelectionPositions() at line 750 (copy/paste)
  * buildTextPositionMap() at line 1711 (search)
- Created test-text-transform.html demo for manual verification
- Position calculations now use transformed text matching SDK encryption

files_changed: ['client/decrypt-interceptor.js', 'demos/test-text-transform.html']
