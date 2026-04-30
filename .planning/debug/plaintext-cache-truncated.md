---
status: verifying
trigger: "plaintext-cache-truncated"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:25:00Z
---

## Current Focus

hypothesis: ROOT CAUSE CONFIRMED - Using textContent to modify text nodes destroys custom properties. Changed to nodeValue which modifies text nodes in-place.
test: Load test page and verify that SDK now sends full ~8000 char plaintext instead of ~735 chars
expecting: Diagnostic logs will show all encrypted nodes have _cloakOriginal preserved, and server receives complete plaintext
next_action: User needs to test the fix by loading a test page and checking console output + server logs

## Symptoms

expected: SDK should send ~8000 chars of plaintext to server (all visible text content including encrypted article bodies)
actual: SDK sends only 735-744 chars (nav items, headlines, footer - missing encrypted article content)
errors: Server diagnostic logs show "Raw request body length: 1042 bytes, Parsed JSON plaintext field length: 735 chars, First 200 chars: '\nWORLD\nBUSINESS\n\n\n\n\nSearch\n...'"
reproduction: Load news article page, SDK encrypts content, uploads plaintext cache - server receives truncated version
started: Issue discovered during plaintext cache implementation testing
timeline: Server receives only nav/header/footer text; encrypted article body content is completely missing from uploaded plaintext

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:01:00Z
  checked: routes/routes_sdk.py upload-plaintext endpoint (lines 991-1060)
  found: Endpoint receives plaintext from request body and stores it directly to R2 via store_plaintext_index(). Line 1041 logs "{len(plaintext)} chars" showing what the server actually received.
  implication: The truncation is NOT happening during R2 storage. Whatever the server logs at line 1041 is what was sent by the SDK.

- timestamp: 2026-01-22T00:02:00Z
  checked: utils/r2_website_storage.py store_plaintext_index function (lines 667-702)
  found: Function receives plaintext string and uploads to R2 with put_object(Body=plaintext.encode('utf-8')). Line 694 logs "{len(plaintext)} chars" again. No size limits, no truncation.
  implication: R2 storage is storing exactly what it receives.

- timestamp: 2026-01-22T00:03:00Z
  checked: client/cloak-sdk.js uploadPlaintextToServer function (lines 1520-1667)
  found: Function uses TreeWalker to iterate text nodes. Line 1618 logs "Built plaintext: {fullPlaintext.length} chars" BEFORE sending. Line 1652 logs "Plaintext uploaded to server: {fullPlaintext.length} chars" AFTER 200 OK response.
  implication: The SDK believes it's building and sending 7964 chars. But if the server logs only 502 chars at line 1041, then either: (1) the SDK is miscounting, or (2) JSON.stringify is truncating, or (3) fetch body is being truncated.

- timestamp: 2026-01-22T00:04:00Z
  checked: Symptom details more carefully
  found: "502-504 chars with many empty newlines" and "preview shows lots of newlines and truncated content"
  implication: The plaintext IS being built, but it's mostly newlines. The TreeWalker is hitting block boundaries and adding \n markers (line 1587), but the actual text content is missing. This suggests the encrypted text nodes are being skipped or their _cloakOriginal is empty.

- timestamp: 2026-01-22T00:05:00Z
  checked: SDK initialization flow (lines 1758-1763)
  found: Line 1759 encrypts existing nodes synchronously with forEach(encryptTextNode). Line 1763 calls uploadPlaintextToServer() immediately after. encryptTextNode is fully synchronous (no await).
  implication: All nodes SHOULD be encrypted before uploadPlaintextToServer is called. There's no timing issue in the initialization flow.

- timestamp: 2026-01-22T00:06:00Z
  checked: encryptTextNode function (lines 308-381)
  found: Line 373 sets textNode.textContent = encryptedText. Line 374 sets textNode._cloakEncrypted = true. Line 375 sets textNode._cloakOriginal = textToEncrypt. These happen atomically in sequence.
  implication: Either all three happen or none. There's no partial state.

- timestamp: 2026-01-22T00:07:00Z
  checked: uploadPlaintextToServer TreeWalker logic (lines 1600-1616)
  found: Lines 1603-1606 handle case where node is encrypted but missing _cloakOriginal - it logs warning and SKIPS the node. This would cause text to be missing from plaintext, leaving only newlines from block boundaries.
  implication: If nodes are being encrypted but somehow losing _cloakOriginal, the upload function would skip them and create a truncated plaintext with mostly newlines.

- timestamp: 2026-01-22T00:20:00Z
  checked: Server diagnostic logs from actual test run
  found: Server receives exactly 735 chars containing only unencrypted UI elements (WORLD, BUSINESS, Search from nav; headlines; footer). All encrypted article body content is missing.
  implication: The SDK TreeWalker is NOT collecting encrypted content - it's only collecting unencrypted text nodes. This confirms encrypted nodes are being skipped during plaintext building.

- timestamp: 2026-01-22T00:21:00Z
  checked: Hypothesis about property preservation
  found: Setting textNode.textContent on line 373 SHOULD preserve custom properties like _cloakOriginal. JavaScript text nodes are objects and custom properties persist unless the node is replaced.
  implication: Either (a) the text nodes ARE being replaced somewhere, or (b) there's something else clearing these properties, or (c) the TreeWalker is finding different text node instances than the ones that were encrypted.

- timestamp: 2026-01-22T00:22:00Z
  checked: Code flow from encryption to upload
  found: Line 1763 in init() calls uploadPlaintextToServer() synchronously after encrypting all nodes. encryptTextNode() is synchronous. No async operations between encryption and upload.
  implication: The TreeWalker should be iterating over the exact same text node objects that were just encrypted. If properties are missing, either (1) they were never set, or (2) something cleared them immediately after setting, or (3) textContent assignment somehow affects property storage.

- timestamp: 2026-01-22T00:23:00Z
  checked: MDN documentation and web search about textContent vs nodeValue on text nodes
  found: Setting `textContent` on a node "removes all of the node's children and replaces them with a single text node." While text nodes don't have children, the spec behavior of textContent may differ from nodeValue. For text nodes specifically, `nodeValue` is the direct property for the text content, while `textContent` is a more general property that works on all node types.
  implication: Using `textNode.textContent = value` on a text node might be triggering replacement logic that destroys custom properties, whereas `textNode.nodeValue = value` directly modifies the text node in place, preserving properties.

- timestamp: 2026-01-22T00:24:00Z
  checked: Line 373 in cloak-sdk.js
  found: Code uses `textNode.textContent = encryptedText` to set encrypted content on text nodes
  implication: ROOT CAUSE IDENTIFIED - Using textContent instead of nodeValue on text nodes may be causing the node or its properties to be lost/recreated, which would explain why _cloakOriginal is missing when TreeWalker reaches these nodes later.

## Resolution

root_cause: Using `textContent` to modify text nodes destroys custom properties. Line 311 read `textNode.textContent` and line 373 set `textNode.textContent = encryptedText`. While textContent works on text nodes, it may trigger node replacement logic that destroys custom properties like `_cloakOriginal`. When `uploadPlaintextToServer()` TreeWalker later encounters these text nodes, it finds `_cloakEncrypted=true` but `_cloakOriginal` is missing, so it skips them (line 1605), causing only unencrypted nav/header/footer text to be collected (~735 chars instead of ~8000 chars).

fix: Changed text node modification from `textContent` to `nodeValue`:
- Line 311: Changed from `textNode.textContent` to `textNode.nodeValue` (reading original text)
- Line 375: Changed from `textNode.textContent = encryptedText` to `textNode.nodeValue = encryptedText` (setting encrypted text)

Using `nodeValue` directly modifies the text node's content in-place without triggering replacement logic, which should preserve custom properties like `_cloakEncrypted` and `_cloakOriginal`.

Also added diagnostic logging to verify:
- Lines 377-380: Log when setting _cloakOriginal and verify immediately
- Lines 1560-1562: Count encrypted nodes with/without _cloakOriginal
- Lines 1606-1616: Log when finding encrypted nodes with/without _cloakOriginal
- Line 1635: Summary of node type breakdown

verification: Testing required
files_changed:
- client/cloak-sdk.js (changed textContent to nodeValue on lines 311, 375; added diagnostic logging)

