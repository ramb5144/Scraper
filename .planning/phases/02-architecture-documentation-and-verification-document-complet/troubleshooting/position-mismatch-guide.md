# Troubleshooting Guide: Position Mismatch Issues

**Purpose:** Systematic diagnosis of copy/paste and search position issues where selected text returns wrong characters or search highlights appear in the wrong location.

**When to use this guide:**
- Copy/paste returns text offset from what was selected
- Search finds matches but highlights wrong text
- Search highlights appear in completely wrong location
- `debugPositionMapping()` shows length mismatches

---

## Symptom: Copy/Paste Returns Wrong Text

**Example:** User selects "Hello world" but paste returns "world this" or text offset by N characters.

### Decision Tree

```
├─ Check 1: Is position map built correctly?
│  ├─ How to check:
│  │  1. Open DevTools Console
│  │  2. Run: window.debugPositionMapping()
│  │  3. Compare output:
│  │     "Decrypt-interceptor encrypted text length: X"
│  │     "Server plaintext length: Y"
│  │  4. Do X and Y match?
│  │
│  ├─ Lengths match (X == Y) → Check 2
│  └─ Lengths differ (X != Y) → Root cause: Position map mismatch
│     └─ Diagnose:
│        ├─ Check block count:
│        │  "Server has X blocks, interceptor has Y blocks"
│        │  If different → Block detection algorithm divergence
│        │
│        ├─ Find diverging block:
│        │  Look at block-by-block comparison in debug output
│        │  Identify first block where lengths differ
│        │  Example output:
│        │    "Block 5 length mismatch: SDK=45, Server=42"
│        │
│        └─ Common causes:
│           ├─ Block boundary mismatch
│           │  → BLOCK_ELEMENTS arrays differ between SDK and DI
│           │  → Check: client/cloak-sdk.js line 244-247
│           │  → Check: client/decrypt/src/position.js BLOCK_ELEMENTS_SEARCH
│           │
│           ├─ Extra/missing newlines
│           │  → Newline markers added at different points
│           │  → Verify: Both use same block boundary check
│           │  → SDK: lines 350-351, DI: lines 462-463
│           │
│           ├─ Text-transform mismatch (see Issue 1 below)
│           │  → SDK uses transformed text length
│           │  → DI uses raw text length
│           │  → Verify: SDK reset text-transform before DI builds map?
│           │
│           └─ Exclusion logic mismatch (see Issue 2 below)
│              → SDK excludes different nodes than DI
│              → Check: shouldExcludeNode vs shouldExcludeTextNodeForPositionCalc
│
├─ Check 2: Is selection position calculated correctly?
│  ├─ How to check:
│  │  1. Select some text on the page
│  │  2. In Console, run:
│  │     const pos = getSelectionPositions();
│  │     console.log('Selection:', pos);
│  │  3. Verify start/end match expected character indices in the encrypted text
│  │  4. Manually count characters from start of page to your selection
│  │
│  ├─ Positions correct (match manual count) → Check 3
│  └─ Positions wrong (offset from expected) →
│     Root cause: Selection calculation issue
│     └─ Check:
│        ├─ getContainingBlockSkippingHighlights() for highlight interference
│        │  → If search highlights exist, they might split text nodes
│        │  → Verify: Function skips <mark> elements when finding blocks
│        │  → Code: client/decrypt/src/position.js line 460
│        │
│        ├─ Text node traversal order
│        │  → TreeWalker must traverse in same order as SDK
│        │  → Both use document.createTreeWalker(document.body, SHOW_TEXT)
│        │  → Order should be identical
│        │
│        └─ Position calculation with excluded nodes
│           → If selection crosses excluded nodes, positions might be wrong
│           → Excluded nodes shouldn't be counted in position
│
└─ Check 3: Is server returning correct text for positions?
   ├─ How to check:
   │  1. Get selection positions from Check 2
   │  2. Manually call API:
   │     fetch('/api/search/get-text-range', {
   │       method: 'POST',
   │       headers: { 'Content-Type': 'application/json' },
   │       body: JSON.stringify({
   │         hash: encryptionConfig.hash,
   │         start: START_POS,
   │         end: END_POS
   │       })
   │     }).then(r => r.json()).then(console.log);
   │  3. Does returned text match what you selected?
   │
   ├─ Text correct → Bug elsewhere (clipboard API implementation?)
   └─ Text wrong → Root cause: Server-side plaintext index mismatch
      └─ Check:
         ├─ R2 stored plaintext vs expected
         │  → Server stores plaintext in R2 after SDK uploads it
         │  → Verify: SDK uploaded correct plaintext (check upload payload)
         │  → Verify: Server stored it correctly (check R2 object)
         │
         ├─ Server position calculation
         │  → Server uses Python string slicing: plaintext[start:end]
         │  → Verify: start/end indices are correct for Python (0-based)
         │
         └─ Encoding issues
            → Server uses .rstrip() which removes trailing whitespace
            → Verify: DI also strips trailing whitespace (line 485)
            → Check: Unicode characters handled consistently
```

---

## Symptom: Search Highlights Wrong Location

**Example:** Search for "hello" highlights "world" or highlights appear N characters offset.

### Decision Tree

```
├─ Check 1: Are server match positions correct?
│  ├─ How to check:
│  │  1. Open DevTools Console
│  │  2. Search for a term (e.g., "hello")
│  │  3. Check Console for: "🔍 SERVER RESPONSE: matches = N"
│  │  4. Inspect the matches array:
│  │     Look at browser Network tab → find-matches response
│  │     Example: {"matches": [{"start": 42, "end": 47}]}
│  │  5. Manually verify positions:
│  │     - Run: window.debugPositionMapping()
│  │     - Count to character 42 in the encrypted text
│  │     - Does it match the search term location?
│  │
│  ├─ Positions correct (manual count matches search term) → Check 2
│  └─ Positions wrong (manual count shows different text) →
│     Root cause: Server search issue
│     └─ Diagnose:
│        ├─ Server searching wrong plaintext
│        │  → Check: Hash parameter sent to server
│        │  → Verify: Server retrieved correct plaintext from R2
│        │  → Debug: Server logs should show plaintext length and content
│        │
│        ├─ Case sensitivity mismatch
│        │  → Server does case-insensitive search by default
│        │  → Client expects case-sensitive positions
│        │  → Check: Search API parameters
│        │
│        └─ Unicode/encoding issues
│           → Server uses Python .find() which counts characters
│           → Verify: Multi-byte characters counted correctly
│
├─ Check 2: Is mapPositionsToDOMNodes mapping correctly?
│  ├─ How to check:
│  │  1. After search, in Console run:
│  │     // This shows the DOM mapping results
│  │     console.log('Position map:', window.currentPositionMap);
│  │  2. For each match, check:
│  │     - node: Should be the text node containing the match
│  │     - startIndex: Node-relative start position
│  │     - endIndex: Node-relative end position
│  │  3. Manually verify:
│  │     const node = MATCH.node;
│  │     const text = node.textContent.substring(MATCH.startIndex, MATCH.endIndex);
│  │     console.log('Match text:', text);
│  │     // Should match search query
│  │
│  ├─ Mapping correct (extracted text matches query) → Check 3
│  └─ Mapping wrong (extracted text doesn't match query) →
│     Root cause: Position map doesn't match server plaintext
│     └─ Diagnose:
│        ├─ Check buildTextPositionMap() output
│        │  → Run: const mapData = buildTextPositionMap();
│        │  → Compare: mapData.totalLength vs server plaintext_length
│        │  → If different: See Check 1 above (position map mismatch)
│        │
│        ├─ Verify node startIndex/endIndex in position map
│        │  → Each position map entry: {node, startIndex, endIndex}
│        │  → Verify: endIndex - startIndex == node.textContent.length
│        │  → If wrong: Position map construction bug
│        │
│        └─ Check for position map rebuild timing
│           → Position map should be rebuilt if DOM changes
│           → Verify: No DOM mutations after position map built
│           → Debug: Log position map build timestamp
│
└─ Check 3: Are highlights being applied to correct nodes?
   ├─ How to check:
   │  1. After search, inspect DOM
   │  2. Find: <mark class="encrypted-search-highlight"> elements
   │  3. Check:
   │     - Are they wrapping the correct text?
   │     - Are they in the correct parent elements?
   │     - Do they match the search query?
   │  4. In Console:
   │     const highlights = document.querySelectorAll('.encrypted-search-highlight');
   │     highlights.forEach(h => console.log(h.textContent));
   │
   ├─ Correct nodes highlighted → Visual/styling issue (CSS problem, not position)
   └─ Wrong nodes highlighted →
      Root cause: DOM changed after position map built
      └─ Fix:
         ├─ Rebuild position map before highlighting
         │  → Position map must be current with DOM state
         │  → Check: Is MutationObserver invalidating cached position map?
         │
         ├─ Verify highlight application logic
         │  → Code: client/decrypt/src/search.js highlightMatches()
         │  → Check: splitTextNode() function correctness
         │  → Verify: Highlight <mark> inserted at correct offsets
         │
         └─ Check for race condition
            → If DOM changes while highlighting is in progress
            → Highlights might be applied to stale node references
            → Fix: Lock DOM during highlighting
```

---

## Using debugPositionMapping()

The `debugPositionMapping()` function is your primary diagnostic tool for position issues. It compares the decrypt-interceptor's position map with the server's plaintext.

### How to use

```javascript
// In DevTools Console:
window.debugPositionMapping();
```

### Understanding the output

**Header section:**
```
=== POSITION MAPPING DEBUG ===
Decrypt-interceptor encrypted text length: 2847
Server plaintext length: 2847
✅ Lengths match!
```
- **Encrypted text length:** Total characters in DOM position map
- **Server plaintext length:** Total characters in R2-stored plaintext
- **✅ Lengths match:** Good - position map is likely correct
- **❌ Lengths differ:** Problem - position map diverged from server

**Block comparison:**
```
Block-by-block comparison:
Block 1: DI=245, Server=245 ✅
Block 2: DI=123, Server=123 ✅
Block 3: DI=456, Server=450 ❌ MISMATCH (DI has 6 extra chars)
Block 4: DI=189, Server=189 ✅
```
- Each block corresponds to a BLOCK_ELEMENT (P, DIV, H1, etc.)
- **✅**: Block lengths match - this block is fine
- **❌ MISMATCH**: Block lengths differ - this block has the divergence
- **"DI has X extra chars"**: Decrypt-interceptor counted more characters than server
- **"Server has X extra chars"**: Server counted more characters than DI

### Common divergence patterns

| Pattern | Meaning | Likely Cause |
|---------|---------|--------------|
| **DI consistently has fewer chars** | DI is excluding more than server | `shouldExcludeTextNodeForPositionCalc` excludes nodes that server's `get_text()` includes |
| **Server consistently has fewer chars** | Server is excluding more than DI | Server's exclusion logic strips more content |
| **Single block has extra chars** | Specific block has different content | Check that block for: extra whitespace, hidden elements, dynamic content |
| **Multiple blocks after a point diverge** | Cascading error from earlier mismatch | Find the FIRST diverging block - that's the root cause |
| **Newline count differs** | Block boundary mismatch | BLOCK_ELEMENTS arrays differ, or block detection logic differs |

### Interpreting specific mismatches

**Example 1: Text-transform mismatch**
```
Block 5: DI=45, Server=50 ❌ MISMATCH (Server has 5 extra chars)
```
**Diagnosis:**
- Block 5 might have `text-transform: uppercase` on "hello" → "HELLO"
- If SDK transformed it to "HELLO" (5 chars) but DI counted "hello" (5 chars), lengths match
- But if original was "hi" (2 chars) → "HI" (2 chars), transform doesn't change length
- This specific pattern is rare - text-transform usually doesn't change character count

**Example 2: Extra exclusions in DI**
```
Block 3: DI=100, Server=125 ❌ MISMATCH (Server has 25 extra chars)
```
**Diagnosis:**
- DI excluded 25 characters that server included
- Check: Does block contain `<code>`, `<pre>`, or other elements?
- SDK excludes: `config.excludeSelectors` (default: script, style, noscript, meta, link, head)
- DI might exclude additional elements for position calculation
- Compare: `shouldExcludeNode()` in SDK vs `shouldExcludeTextNodeForPositionCalc()` in DI

**Example 3: Search highlight splits nodes**
```
Before search: DI=2847, Server=2847 ✅
After search:  DI=2850, Server=2847 ❌ MISMATCH (DI has 3 extra chars)
```
**Diagnosis:**
- Search creates `<mark class="encrypted-search-highlight">` elements
- These `<mark>` elements split text nodes
- If DI doesn't skip highlights in position calculation, it counts them as separate nodes
- Fix: `shouldExcludeTextNodeForPositionCalc` should exclude `.encrypted-search-highlight`
- Also: `getContainingBlockSkippingHighlights()` should skip `<mark>` when finding blocks

---

## Known Position Issues

Based on findings from `verification/position-mapping-comparison.md`:

| Issue | Symptom | Cause | Fix | Status |
|-------|---------|-------|-----|--------|
| **Text-transform mismatch** | Positions off on uppercase/capitalized text | SDK uses transformed text length, DI uses raw text length | Apply same transform in DI before position calculation | ⚠️ Likely not an issue (SDK resets CSS before DI loads) |
| **Extra exclusions in DI** | DI has fewer chars than server | DI excludes code/pre/etc that server included | Sync `shouldExcludeTextNodeForPositionCalc` with server's `get_text()` | ⚠️ Verify exclusion logic matches |
| **Search highlight splits nodes** | Positions wrong after search | `<mark>` creates new text nodes, affects block detection | Use `shouldExcludeTextNodeForPositionCalc` to exclude highlights | ✅ Implemented (line 437) |
| **Trailing whitespace** | Last block length differs by 1-2 chars | Server uses `.rstrip()`, DI might not | DI strips trailing whitespace to match server (line 485) | ✅ Implemented |
| **Block detection differs** | Newline markers in different places | BLOCK_ELEMENTS arrays differ or skip logic differs | Ensure `getContainingBlockSkippingHighlights` matches SDK `getContainingBlock` | ✅ Should match (verify arrays) |
| **Zero-width space handling** | Positions off by N chars where N = count of &#8203; | SDK/DI strip differently, or server doesn't strip | All three strip: SDK line 340, DI line 445, server strips in Python | ✅ Implemented |

---

## Prevention Checklist

Position map consistency requires SDK, decrypt-interceptor, and server all using identical algorithms.

### Before deployment

- [ ] **Verify BLOCK_ELEMENTS arrays match**
  - SDK: `client/cloak-sdk.js` line 244-247
  - DI: `client/decrypt/src/position.js` BLOCK_ELEMENTS_SEARCH
  - Server: Python `BLOCK_ELEMENTS` constant
  - All three should have identical tag lists

- [ ] **Verify exclusion logic matches**
  - SDK: `shouldExcludeNode()` line 136-242
  - DI: `shouldExcludeTextNodeForPositionCalc()` line 437
  - Server: `get_text()` exclusion logic
  - Compare tag-by-tag, attribute-by-attribute

- [ ] **Verify text-transform handling**
  - SDK: Applies transform before encryption (line 366)
  - SDK: Resets CSS to `none` (line 371)
  - DI: Builds position map AFTER SDK init (so CSS already reset)
  - Result: Both should see transformed text

- [ ] **Test position mapping after page mutations**
  - Add content dynamically
  - Remove content
  - Modify existing content
  - Verify: Position map stays synchronized

- [ ] **Test with search highlights active**
  - Perform search
  - Verify: Highlights don't corrupt position map
  - Verify: Second search still works
  - Verify: Copy/paste still works after search

### Runtime debugging

- [ ] **Run debugPositionMapping() on every page**
  - Check: Lengths match between DI and server
  - Check: No block-level divergence
  - If mismatches: Investigate specific blocks

- [ ] **Test copy/paste on various content types**
  - Plain paragraphs
  - Lists (ordered/unordered)
  - Tables
  - Nested divs
  - Text with `text-transform` CSS
  - Code blocks
  - Verify: Pasted text matches selection

- [ ] **Test search with various queries**
  - Single word
  - Multi-word phrase
  - Case-sensitive vs case-insensitive
  - Special characters
  - Unicode characters
  - Verify: Highlights appear on correct text

---

## Diagnostic Code Snippets

### Manual position map verification

```javascript
// Build position map and inspect
const mapData = buildTextPositionMap();
console.log('Total length:', mapData.totalLength);
console.log('Position map entries:', mapData.positionMap.length);

// Check first few entries
mapData.positionMap.slice(0, 5).forEach((entry, i) => {
    console.log(`Entry ${i}:`, {
        text: entry.node.textContent.slice(0, 30),
        startIndex: entry.startIndex,
        endIndex: entry.endIndex,
        length: entry.length,
        parent: entry.parent.tagName
    });
});
```

### Compare selection positions

```javascript
// Get current selection
const selection = window.getSelection();
if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    console.log('Selected text:', selection.toString());

    // Get positions
    const positions = getSelectionPositions(range);
    console.log('Positions:', positions);

    // Verify with position map
    const mapData = buildTextPositionMap();
    const expectedText = mapData.encryptedText.substring(
        positions.start,
        positions.end
    );
    console.log('Expected from map:', expectedText.slice(0, 50));

    // Call server to get actual text
    fetch('/api/search/get-text-range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            hash: encryptionConfig.hash,
            start: positions.start,
            end: positions.end
        })
    })
    .then(r => r.json())
    .then(data => {
        console.log('Server returned:', data.text);
        console.log('Match?', data.text === selection.toString());
    });
}
```

### Check for excluded nodes in selection

```javascript
// Find nodes that are excluded from position calculation
function findExcludedInRange(range) {
    const excluded = [];
    const walker = document.createTreeWalker(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT
    );

    let node;
    while (node = walker.nextNode()) {
        if (shouldExcludeTextNodeForPositionCalc(node)) {
            excluded.push({
                text: node.textContent.slice(0, 30),
                reason: getExclusionReason(node),
                parent: node.parentElement.tagName
            });
        }
    }

    return excluded;
}

function getExclusionReason(node) {
    const el = node.parentElement;
    if (!el) return 'No parent';
    if (el.closest('[data-cloak-exclude]')) return 'data-cloak-exclude';
    if (el.closest('[data-nosnippet]')) return 'data-nosnippet';
    if (el.closest('.encrypted-search-highlight')) return 'search highlight';
    if (el.closest('#encrypted-search-overlay')) return 'search overlay';

    const excludedTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK'];
    if (excludedTags.includes(el.tagName)) return `Excluded tag: ${el.tagName}`;

    return 'Unknown';
}

// Usage:
const selection = window.getSelection();
if (selection.rangeCount > 0) {
    const excluded = findExcludedInRange(selection.getRangeAt(0));
    if (excluded.length > 0) {
        console.warn('Selection contains excluded nodes:', excluded);
    } else {
        console.log('✅ No excluded nodes in selection');
    }
}
```

### Verify block detection

```javascript
// Compare block detection between SDK and DI approaches
function compareBlockDetection() {
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT
    );

    const results = [];
    let node;
    while (node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;

        // SDK approach
        const sdkBlock = getContainingBlock(node);

        // DI approach
        const diBlock = getContainingBlockSkippingHighlights(node);

        if (sdkBlock !== diBlock) {
            results.push({
                text: node.textContent.slice(0, 30),
                sdkBlock: sdkBlock?.tagName,
                diBlock: diBlock?.tagName,
                parent: node.parentElement.tagName
            });
        }
    }

    if (results.length === 0) {
        console.log('✅ All nodes have matching block detection');
    } else {
        console.warn('❌ Block detection differs for some nodes:');
        console.table(results);
    }

    return results;
}

// Note: You'll need to define getContainingBlock if it's not available
function getContainingBlock(node) {
    const BLOCK_ELEMENTS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                            'LI', 'OL', 'UL', 'BLOCKQUOTE', 'PRE', 'SECTION',
                            'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE'];
    let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current && !BLOCK_ELEMENTS.includes(current.tagName)) {
        current = current.parentElement;
    }
    return current;
}
```

---

## Related Documentation

- **Position Mapping Verification:** `.planning/phases/02-architecture-documentation-and-verification-document-complet/verification/position-mapping-comparison.md` - Detailed algorithm comparison and issues found
- **Encryption Flow:** `.planning/phases/02-architecture-documentation-and-verification-document-complet/flows/encryption-flow.md` - How SDK builds position index during encryption
- **SDK Source:** `client/cloak-sdk.js:270-411` - Position mapping and encryption
- **DI Source:** `client/decrypt/src/position.js:417-505` - buildTextPositionMap()

---

**Last Updated:** 2026-01-24
**Status:** Active troubleshooting guide
