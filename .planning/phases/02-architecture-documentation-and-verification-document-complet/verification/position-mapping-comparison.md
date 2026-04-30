# Position Mapping Algorithm Comparison

**Purpose:** Verify that SDK and decrypt-interceptor use identical algorithms for calculating character positions in the encrypted document. Position mapping is critical for copy/paste and search functionality - any mismatch causes text selection to return wrong characters.

**Date:** 2026-01-23
**Status:** VERIFIED WITH ISSUES FOUND

---

## Algorithm Comparison Table

| Step | SDK (cloak-sdk.js) | decrypt-interceptor (position.js) | Match? | Notes |
|------|-------------------|-----------------------------------|--------|-------|
| **TreeWalker creation** | `createTreeWalker(element, SHOW_TEXT, {acceptNode: ...})` line 272-288 | `createTreeWalker(document.body, SHOW_TEXT, null)` line 425-428 | ⚠️ | SDK has filter function in acceptNode, DI filters manually in loop |
| **Exclusion check** | `shouldExcludeNode(node)` via acceptNode line 277 | `shouldExcludeTextNodeForPositionCalc(textNode)` line 437 | ⚠️ | Different function names - requires internal comparison (see exclusion-logic-comparison.md) |
| **Zero-width strip** | `text.replace(/\u200B/g, '')` line 283 | `text.replace(/\u200B/g, '')` line 445 | ✅ | Identical regex and application |
| **Empty check** | `text.length === 0 \|\| !text.trim()` line 284 | `text.length === 0 \|\| !text.trim()` line 448-449 | ✅ | Identical logic |
| **Block detection** | `getContainingBlock(node)` line 347 | `getContainingBlockSkippingHighlights(textNode)` line 460 | ⚠️ | DI skips highlights - intentional for search, but may cause divergence |
| **Block boundary check** | `lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock` line 350 | `lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock` line 462 | ✅ | Identical condition |
| **Position increment (newline)** | `totalCharacters += 1` line 351 | `globalCharIndex += 1` line 463 | ✅ | Same logic, variable name differs only |
| **Text length addition** | `totalCharacters += transformedCleanText.length` line 387 | `globalCharIndex += text.length` line 479 | ❌ | **CRITICAL**: SDK uses TRANSFORMED text length, DI uses raw text length |
| **Trailing whitespace** | Not explicitly stripped in encryption flow | `fullEncryptedText.replace(/\s+$/, '')` line 485 | ⚠️ | DI strips trailing whitespace to match server `.rstrip()`, SDK doesn't |

---

## Issues Found

### Issue 1: Text-Transform Length Mismatch
**Severity:** CRITICAL
**Confidence:** HIGH

**SDK behavior (lines 357-387):**
```javascript
const textTransform = getTextTransform(textNode);  // line 361
let textToEncrypt = originalText;

if (textTransform !== 'none') {
    textToEncrypt = applyTextTransform(originalText, textTransform);  // line 366
    // ... reset text-transform CSS to 'none' ...
}

const transformedCleanText = applyTextTransform(cleanText, textTransform);  // line 385
totalCharacters += transformedCleanText.length;  // line 387 - uses TRANSFORMED length
```

**decrypt-interceptor behavior (lines 442-479):**
```javascript
let text = textNode.textContent;
text = text.replace(/\u200B/g, '');  // line 445

// ... no text-transform handling ...

globalCharIndex += text.length;  // line 479 - uses RAW text length
```

**Impact:**
- If an element has `text-transform: uppercase`, "hello" (5 chars) becomes "HELLO" (5 chars) - same length
- BUT if an element has `text-transform: capitalize`, "HELLO world" becomes "Hello World" - same length
- This appears to NOT cause length mismatch (text-transform doesn't change character count in most cases)
- **However**, the SDK stores TRANSFORMED text in `_cloakOriginal`, which the server receives
- The decrypt-interceptor builds position map from DOM text (which may not be transformed yet)

**Verification needed:**
1. Does the SDK's CSS reset (`parent.style.textTransform = 'none'`) happen BEFORE decrypt-interceptor builds position map?
2. If yes, then both use the same text (transformed) - positions match
3. If no, then there's a timing issue - positions mismatch

**Current status:** NEEDS RUNTIME TESTING - code inspection inconclusive

---

### Issue 2: Block Detection Function Differences
**Severity:** MEDIUM
**Confidence:** HIGH

**SDK:**
```javascript
function getContainingBlock(node) {
    let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current && !BLOCK_ELEMENTS.includes(current.tagName)) {
        current = current.parentElement;
    }
    return current;
}
```

**decrypt-interceptor (position.js):**
```javascript
function getContainingBlockForSearch(node) {
    let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current && !BLOCK_ELEMENTS_SEARCH.includes(current.tagName)) {
        current = current.parentElement;
    }
    return current;
}

// AND ALSO:
function getContainingBlockSkippingHighlights(textNode) {
    // ... special handling for <mark class="encrypted-search-highlight"> ...
}
```

**Analysis:**
- SDK uses simple `getContainingBlock()`
- decrypt-interceptor has TWO functions:
  - `getContainingBlockForSearch()` - similar to SDK
  - `getContainingBlockSkippingHighlights()` - used in `buildTextPositionMap()` line 460
- The "SkippingHighlights" variant skips `<mark>` elements to prevent search highlights from creating false block boundaries
- This is INTENTIONAL and CORRECT - when search adds `<mark>` wrappers, they shouldn't trigger newline markers

**Impact:** Minimal - the difference is intentional. Search highlights don't exist during initial encryption, and when they DO exist, skipping them maintains correct positions.

**Recommendation:** Document this as intentional design, not a bug.

---

### Issue 3: Trailing Whitespace Handling
**Severity:** LOW
**Confidence:** HIGH

**SDK behavior:**
- No explicit trailing whitespace stripping in encryption flow
- Text is encrypted and uploaded as-is

**decrypt-interceptor behavior (line 485):**
```javascript
fullEncryptedText = fullEncryptedText.replace(/\s+$/, '');
```

**Analysis:**
- The decrypt-interceptor strips trailing whitespace to match server behavior
- Server-side Python uses `.rstrip()` which removes trailing whitespace
- SDK doesn't strip, but server does when storing plaintext
- This means: SDK uploads "text   ", server stores "text", decrypt-interceptor builds "text"
- Positions match because the SERVER is the source of truth for search/copy

**Impact:** None - positions match because both decrypt-interceptor and server strip trailing whitespace.

**Recommendation:** Document this as correct behavior.

---

## Text-Transform Critical Analysis

### SDK Implementation (lines 357-387)

**Step 1: Detect text-transform**
```javascript
const textTransform = getTextTransform(textNode);  // line 361
// Returns: 'uppercase' | 'lowercase' | 'capitalize' | 'none'
```

**Step 2: Apply transform to get displayed text**
```javascript
if (textTransform !== 'none') {
    textToEncrypt = applyTextTransform(originalText, textTransform);  // line 366
}
```

**Step 3: Reset CSS so browser doesn't re-transform encrypted text**
```javascript
if (parent && !parent._cloakTextTransformReset) {
    parent.style.textTransform = 'none';  // line 371
    parent._cloakTextTransformReset = true;
}
```

**Step 4: Encrypt the TRANSFORMED text**
```javascript
const encryptedText = encryptText(textToEncrypt);  // line 381
```

**Step 5: Calculate positions using TRANSFORMED text length**
```javascript
const transformedCleanText = applyTextTransform(cleanText, textTransform);  // line 385
totalCharacters += transformedCleanText.length;  // line 387
```

### decrypt-interceptor Implementation (lines 417-505)

**Position calculation (line 479):**
```javascript
globalCharIndex += text.length;  // Uses RAW text.length
```

**NO text-transform detection or handling found.**

### Critical Question

**Does the SDK's CSS reset happen BEFORE or AFTER decrypt-interceptor builds position map?**

**SDK initialization sequence (lines 1804-1827):**
```javascript
// Load fonts
await loadFont(encryptionConfig.fontUrl);  // line 1804

// Encrypt existing content
const existingNodes = getTextNodes(document.body);
existingNodes.forEach(encryptTextNode);  // line 1810-1811
// ^ This applies text-transform reset

// Restore visibility
document.body.style.visibility = originalBodyVisibility || '';  // line 1815

// Upload plaintext
await uploadPlaintextToServer();  // line 1823

// Inject decrypt-interceptor
injectDecryptInterceptor();  // line 1827
// ^ This loads the script that will call buildTextPositionMap()
```

**Analysis:**
1. SDK encrypts and resets text-transform CSS (line 1811)
2. SDK uploads plaintext to server (line 1823)
3. SDK injects decrypt-interceptor script (line 1827)
4. decrypt-interceptor loads asynchronously and builds position map AFTER SDK completes

**Conclusion:**
- By the time decrypt-interceptor builds position map, the SDK has ALREADY reset `text-transform` to `none`
- Therefore, `textNode.textContent` returns the TRANSFORMED text (not the original)
- Both SDK and decrypt-interceptor use the SAME text (transformed)
- **Positions SHOULD match**

**However:** There's a potential race condition if:
- DOM changes after SDK encryption but before decrypt-interceptor loads
- New content added with text-transform CSS
- decrypt-interceptor builds position map before SDK re-encrypts new content

**Verification Status:** LIKELY CORRECT, but edge cases possible

---

## Verification Status

**Overall status:** ISSUES FOUND
**Confidence:** MEDIUM (needs runtime testing)

### Verified Matching (High Confidence)
- ✅ Zero-width space stripping - identical regex
- ✅ Empty text node check - identical logic
- ✅ Block boundary condition - identical
- ✅ Newline marker increment - identical logic
- ✅ Trailing whitespace - both strip to match server

### Requires Further Verification (Medium Confidence)
- ⚠️ Text-transform timing - SDK resets before decrypt-interceptor loads, SHOULD match
- ⚠️ Block detection - Different functions, but intentional (highlight skipping)
- ⚠️ Exclusion logic - Function names differ, need internal comparison

### Critical Issues (Low Confidence - Needs Testing)
- ❌ Position calculation with text-transform - Code suggests it works, but runtime testing needed to confirm

---

## Recommended Tests

1. **Text-transform test:**
   - Page with `<h1 style="text-transform: uppercase">hello world</h1>`
   - Verify: Copy/paste returns "HELLO WORLD" not "hello world"
   - Verify: Search for "HELLO" highlights correctly

2. **Block boundary test:**
   - Page with nested blocks: `<div><p>text1</p><p>text2</p></div>`
   - Verify: Position map has newline marker between "text1" and "text2"
   - Verify: Positions match server plaintext structure

3. **Search highlight test:**
   - Encrypt page, perform search, verify highlights
   - Verify: Second search still works (position map not corrupted by `<mark>` elements)

---

## References

**SDK Source:**
- `client/cloak-sdk.js:270-411` - Position mapping and encryption
- `client/cloak-sdk.js:299-324` - Text-transform detection and application

**decrypt-interceptor Source:**
- `client/decrypt/src/position.js:417-505` - buildTextPositionMap()
- `client/decrypt/src/position.js:305-311` - getContainingBlockForSearch()

**Related Documentation:**
- See `exclusion-logic-comparison.md` for shouldExcludeNode vs shouldExcludeTextNode comparison
- See `block-detection-comparison.md` for BLOCK_ELEMENTS arrays comparison
