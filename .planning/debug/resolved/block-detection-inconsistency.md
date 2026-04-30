---
status: resolved
trigger: "Investigate issue: block-detection-inconsistency"
created: 2026-01-24T00:00:00Z
updated: 2026-01-24T00:00:08Z
---

## Current Focus

hypothesis: CONFIRMED - Fix applied successfully
test: Verify both functions now have identical logic
expecting: Side-by-side comparison shows matching implementation
next_action: Verify fix is complete and archive session

## Symptoms

expected: Both SDK and decrypt-interceptor should use the same block detection logic to ensure consistent \n marker insertion at block boundaries. This ensures position calculations match between encryption and decryption operations.

actual: SDK (cloak-sdk.js) uses getContainingBlock() which walks up the parent chain looking for block elements. decrypt-interceptor.js uses getContainingBlockSkippingHighlights() which additionally skips over <mark class="encrypted-search-highlight"> elements. This means when search highlights are active, the two functions may return different block elements for the same text node.

errors: No explicit errors, but position calculations may drift when:
1. Search highlights are active
2. A highlight spans a block boundary
3. User tries to copy/paste text that includes the boundary

reproduction:
1. Create HTML with nested structure: `<div><mark class="encrypted-search-highlight"><p>text</p></mark></div>`
2. SDK's getContainingBlock() would find <p>
3. decrypt-interceptor's getContainingBlockSkippingHighlights() would also find <p> (skips the <mark>)
4. Edge case: If <mark> is also a block element somehow, results differ
5. More realistic: Highlight wraps text at block boundary, causing adjacent text nodes to be counted differently

started: This inconsistency was introduced when search highlighting was added. The "SkippingHighlights" variant was created to handle search highlights correctly in decrypt-interceptor, but SDK was never updated to match.

## Eliminated

## Evidence

- timestamp: 2026-01-24T00:00:01Z
  checked: client/cloak-sdk.js lines 246-252
  found: getContainingBlock() function with simple logic - walks up parent chain checking BLOCK_ELEMENTS, no highlight skipping
  implication: SDK does not skip <mark class="encrypted-search-highlight"> elements

- timestamp: 2026-01-24T00:00:02Z
  checked: client/decrypt-interceptor.js lines 991-1005
  found: getContainingBlockSkippingHighlights() explicitly skips <mark class="encrypted-search-highlight"> elements before checking BLOCK_ELEMENTS
  implication: decrypt-interceptor has defensive logic that SDK lacks

- timestamp: 2026-01-24T00:00:03Z
  checked: BLOCK_ELEMENTS definitions in both files
  found: Both use identical BLOCK_ELEMENTS array (P, DIV, H1-H6, LI, OL, UL, etc.), neither includes 'MARK'
  implication: Since MARK is not in BLOCK_ELEMENTS, both functions should traverse past it, but decrypt-interceptor's explicit skip is more defensive

- timestamp: 2026-01-24T00:00:04Z
  checked: Comment in SDK line 244
  found: "Must match decrypt-interceptor.js logic exactly"
  implication: The comment claims they match, but they don't - SDK is missing the highlight-skipping logic

- timestamp: 2026-01-24T00:00:07Z
  checked: Call sites of getContainingBlock in SDK (lines 346 and 1621)
  found: Both check `currentBlock !== null` before using the value
  implication: Updated return value (null instead of potentially wrong element) is safe and already handled correctly

## Resolution

root_cause: SDK's getContainingBlock() lacks the highlight-skipping logic present in decrypt-interceptor's getContainingBlockSkippingHighlights(). While both functions should work identically when MARK is not a block element (default), the SDK violates its own comment stating it "must match decrypt-interceptor.js logic exactly". The decrypt-interceptor's explicit skipping is defensive programming against edge cases where search highlights might interfere with block detection.

fix: Updated SDK's getContainingBlock() (lines 247-261) to match decrypt-interceptor's logic by adding:
1. Explicit <mark class="encrypted-search-highlight"> skipping
2. document.body boundary check in while condition
3. Consistent return null when no block found
4. Updated comment to document highlight skipping

verification: Verified both functions now have identical logic (only function names differ). Side-by-side comparison confirms exact match in:
- Initial current assignment
- While loop condition (current && current !== document.body)
- Mark element skipping logic
- BLOCK_ELEMENTS check
- Parent traversal
- Return value (null when no block found)

files_changed: ["client/cloak-sdk.js"]
