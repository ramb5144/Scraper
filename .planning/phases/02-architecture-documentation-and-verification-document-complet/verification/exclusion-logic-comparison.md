# Exclusion Logic Comparison

**Purpose:** Verify that SDK and decrypt-interceptor exclude the same set of elements from encryption and position mapping. Any mismatch causes position calculation errors and copy/paste failures.

**Date:** 2026-01-23
**Status:** VERIFIED - MINOR DIFFERENCES FOUND

---

## Function Signatures Comparison

| Component | Function Name | Input | Lines | Purpose |
|-----------|--------------|-------|-------|---------|
| SDK | `shouldExcludeNode(node)` | TEXT_NODE or ELEMENT_NODE | 136-242 | Check if node should be excluded from encryption |
| decrypt-interceptor | `shouldExcludeTextNode(textNode)` | TEXT_NODE only | 225-283 | Check if text node should be excluded from position mapping |

**Key Difference:** SDK function handles both TEXT and ELEMENT nodes, decrypt-interceptor only handles TEXT nodes. This is acceptable since decrypt-interceptor only walks text nodes.

---

## Excluded Tags Comparison

### SDK Configuration (DEFAULT_CONFIG line 67-75)

**Base exclusion selectors (line 70):**
```javascript
excludeSelectors: ['script', 'style', 'noscript', 'meta', 'link', 'head']
```

**Note:** SDK's `excludeSelectors` is configurable - users can add more via config. The comparison below uses DEFAULT values.

### decrypt-interceptor Configuration (lines 217-218)

**Hardcoded exclusion selectors (line 217):**
```javascript
const EXCLUDE_SELECTORS = ['script', 'style', 'noscript', 'meta', 'link', 'head',
                           'svg', 'path', 'code', 'pre', 'kbd', 'samp', 'var',
                           'textarea', 'input'];
```

### Comparison Table

| Tag | SDK excludeSelectors (default) | DI EXCLUDE_SELECTORS | Match? | Impact |
|-----|-------------------------------|---------------------|--------|--------|
| `script` | ✓ | ✓ | ✅ | - |
| `style` | ✓ | ✓ | ✅ | - |
| `noscript` | ✓ | ✓ | ✅ | - |
| `meta` | ✓ | ✓ | ✅ | - |
| `link` | ✓ | ✓ | ✅ | - |
| `head` | ✓ | ✓ | ✅ | - |
| `svg` | ✗ | ✓ | ⚠️ | DI excludes SVG text, SDK doesn't |
| `path` | ✗ | ✓ | ⚠️ | DI excludes SVG paths, SDK doesn't |
| `code` | ✗ | ✓ | ⚠️ | **MISMATCH** - DI excludes code blocks, SDK encrypts them |
| `pre` | ✗ | ✓ | ⚠️ | **MISMATCH** - DI excludes pre blocks, SDK encrypts them |
| `kbd` | ✗ | ✓ | ⚠️ | **MISMATCH** - DI excludes kbd, SDK encrypts |
| `samp` | ✗ | ✓ | ⚠️ | **MISMATCH** - DI excludes samp, SDK encrypts |
| `var` | ✗ | ✓ | ⚠️ | **MISMATCH** - DI excludes var, SDK encrypts |
| `textarea` | ✗ | ✓ | ⚠️ | DI excludes textarea, SDK doesn't |
| `input` | ✗ | ✓ | ⚠️ | DI excludes input, SDK doesn't |

**Note:** Quick task 007 (2026-01-23) changed SDK behavior to ENCRYPT code/pre/kbd/samp/var elements. This created a deliberate mismatch with decrypt-interceptor.

---

## Excluded Attributes Comparison

### SDK (line 71)
```javascript
excludeAttributes: ['hidden', 'aria-hidden']
```

### decrypt-interceptor (line 218)
```javascript
const EXCLUDE_ATTRIBUTES = ['hidden', 'aria-hidden'];
```

### Comparison Table

| Attribute | SDK excludeAttributes | DI EXCLUDE_ATTRIBUTES | Match? |
|-----------|----------------------|----------------------|--------|
| `hidden` | ✓ | ✓ | ✅ |
| `aria-hidden` | ✓ | ✓ | ✅ |

**Status:** IDENTICAL

---

## Special Cases Comparison

### data-cloak-exclude

**SDK (lines 153-154, 197, 217):**
```javascript
// For text nodes (line 153-154)
if (element.hasAttribute('data-cloak-exclude')) {
    return true;
}

// For element nodes (line 197)
if (node.hasAttribute('data-cloak-exclude')) return true;

// Check parents (line 217)
if (parent.hasAttribute('data-cloak-exclude')) return true;
```

**decrypt-interceptor (lines 243-244):**
```javascript
if (parent.hasAttribute('data-cloak-exclude')) {
    return true;
}
```

**Match:** ✅ Both check for `data-cloak-exclude` attribute

---

### data-nosnippet

**SDK (lines 157-158, 199-200, 218-219):**
```javascript
// For text nodes (line 157-158)
if (element.hasAttribute('data-nosnippet')) return true;

// For element nodes (line 199-200)
if (node.hasAttribute('data-nosnippet')) return true;

// Check parents (line 218-219)
if (parent.hasAttribute('data-nosnippet')) return true;
```

**decrypt-interceptor (lines 247-249):**
```javascript
if (parent.hasAttribute('data-nosnippet')) {
    return true;
}
```

**Match:** ✅ Both check for `data-nosnippet` attribute

**Comment in SDK (line 157):** "MUST MATCH decrypt-interceptor.js" - confirmed!

---

### encrypted-search-highlight

**SDK (lines 161-163, 202-203, 220-221):**
```javascript
// For text nodes (line 161-163)
if (element.classList && element.classList.contains('encrypted-search-highlight')) return true;

// For element nodes (line 202-203)
if (node.classList && node.classList.contains('encrypted-search-highlight')) return true;

// Check parents (line 220-221)
if (parent.classList && parent.classList.contains('encrypted-search-highlight')) return true;
```

**decrypt-interceptor (lines 252-259 - COMMENTED OUT):**
```javascript
// NOTE: We DO NOT exclude encrypted-search-highlight here anymore!
// The server's plaintext includes ALL text, including text that's currently
// highlighted by search. If we excluded highlighted text, position calculations
// would be off by the total length of all highlighted text.
// The <mark> elements are just visual wrappers - the underlying text is unchanged.
// if (parent.classList && parent.classList.contains('encrypted-search-highlight')) {
//     return true;
// }
```

**Match:** ❌ **CRITICAL MISMATCH**

**Analysis:**
- SDK EXCLUDES search highlight elements from encryption
- decrypt-interceptor INCLUDES them in position mapping (as of recent change)
- The comment explains WHY: search highlights are temporary DOM modifications
- Excluding them from position map would cause position calculation errors

**Impact:** This is INTENTIONAL and CORRECT:
1. SDK excludes highlights to prevent double-encryption
2. decrypt-interceptor includes them because they're already encrypted text (just wrapped in `<mark>`)
3. Position mapping must count ALL text, including highlighted portions

---

### encrypted-search-overlay

**SDK (lines 165-166, 205-206, 222-223):**
```javascript
// For text nodes (line 165-166)
if (element.id === 'encrypted-search-overlay') return true;

// For element nodes (line 205-206)
if (node.id === 'encrypted-search-overlay') return true;

// Check parents (line 222-223)
if (parent.id === 'encrypted-search-overlay') return true;
```

**decrypt-interceptor (lines 261-263):**
```javascript
if (parent.id === 'encrypted-search-overlay') {
    return true;
}
```

**Match:** ✅ Both exclude the search overlay UI

**Comment in SDK (line 165):** "CRITICAL: Exclude the search overlay UI entirely"

---

### Custom Selectors from Config

**SDK (lines 169-179, 225-235):**
```javascript
const customSelectors = config.excludeSelectors.filter(s =>
    s.includes('.') || s.includes('#') || s.includes('[')
);
for (const selector of customSelectors) {
    try {
        if (element.matches(selector)) return true;
    } catch (e) {
        // Invalid selector, skip
    }
}
```

**decrypt-interceptor (lines 266-278):**
```javascript
if (window.encryptionConfig?.excludeSelectors) {
    const customSelectors = window.encryptionConfig.excludeSelectors.filter(s =>
        s.includes('.') || s.includes('#') || s.includes('[')
    );
    for (const selector of customSelectors) {
        try {
            if (parent.matches(selector)) return true;
        } catch (e) {
            // Invalid selector, skip
        }
    }
}
```

**Match:** ✅ Both support custom CSS selectors from config

**Note:** decrypt-interceptor reads from `window.encryptionConfig` which is set by SDK during init (cloak-sdk.js:1716-1723)

---

## Logic Flow Comparison

### SDK shouldExcludeNode() Flow

```
1. Check if node is null → exclude
2. If TEXT_NODE:
   a. Get parent element
   b. Walk up ancestors:
      - Check tag name in excludeSelectors → exclude
      - Check excludeAttributes → exclude
      - Check data-cloak-exclude → exclude
      - Check data-nosnippet → exclude
      - Check encrypted-search-highlight → exclude
      - Check encrypted-search-overlay → exclude
      - Check custom selectors → exclude
3. If ELEMENT_NODE:
   a. Check tag name in excludeSelectors → exclude
   b. Check excludeAttributes → exclude
   c. Check data-cloak-exclude → exclude
   d. Check data-nosnippet → exclude
   e. Check encrypted-search-highlight → exclude
   f. Check encrypted-search-overlay → exclude
   g. Walk up parents with same checks
4. Return false (not excluded)
```

### decrypt-interceptor shouldExcludeTextNode() Flow

```
1. Get parent element from textNode
2. Walk up ancestors:
   - Check tag name in EXCLUDE_SELECTORS → exclude
   - Check EXCLUDE_ATTRIBUTES → exclude
   - Check data-cloak-exclude → exclude
   - Check data-nosnippet → exclude
   - Check encrypted-search-overlay → exclude
   - Check custom selectors (if config exists) → exclude
3. Return false (not excluded)
```

**Differences:**
- SDK handles both TEXT and ELEMENT nodes, decrypt-interceptor only TEXT nodes
- SDK excludes `encrypted-search-highlight`, decrypt-interceptor doesn't (intentional)
- decrypt-interceptor has MORE hardcoded tags (code, pre, svg, etc.)

---

## Issues Found

### Issue 1: Code/Pre Elements Mismatch
**Severity:** MEDIUM
**Confidence:** HIGH

**Current state:**
- SDK encrypts code/pre/kbd/samp/var elements (as of quick task 007)
- decrypt-interceptor EXCLUDES them from position mapping

**Impact:**
If a page has:
```html
<p>Regular text</p>
<code>code block text</code>
<p>More text</p>
```

**SDK behavior:**
- Encrypts "Regular text" → position 0-12
- Encrypts "code block text" → position 13-29
- Encrypts "More text" → position 30-39

**decrypt-interceptor behavior:**
- Maps "Regular text" → position 0-12
- SKIPS "code block text" (excluded)
- Maps "More text" → position 13-22

**Result:** Position mismatch of 16 characters (length of "code block text")

**Root cause:** Quick task 007 changed SDK to encrypt code blocks, but didn't update decrypt-interceptor's EXCLUDE_SELECTORS

**Fix required:** Remove code/pre/kbd/samp/var from decrypt-interceptor's EXCLUDE_SELECTORS

---

### Issue 2: SVG Text Mismatch
**Severity:** LOW
**Confidence:** MEDIUM

**Current state:**
- SDK does NOT exclude svg/path by default
- decrypt-interceptor EXCLUDES them

**Impact:**
If SVG contains `<text>` elements with actual text content, SDK will encrypt it but decrypt-interceptor won't include it in position mapping.

**Likelihood:** LOW - most SVGs use `<path>` elements (no text content) or are excluded via other rules

**Recommendation:** Consider adding svg/path to SDK's default excludeSelectors for consistency

---

### Issue 3: Textarea/Input Mismatch
**Severity:** LOW
**Confidence:** HIGH

**Current state:**
- SDK does NOT exclude textarea/input by default
- decrypt-interceptor EXCLUDES them

**Impact:**
If a page has `<textarea>` or `<input>` elements with text content in the DOM, SDK might try to encrypt them but decrypt-interceptor won't map positions.

**Likelihood:** LOW - textarea/input text is in the `value` property, not textContent, so TreeWalker doesn't see it anyway

**Recommendation:** No action needed - this is defensive coding in decrypt-interceptor

---

## Verification Status

**Overall status:** VERIFIED - CRITICAL ISSUE FOUND (code/pre mismatch)
**Confidence:** HIGH

### Verified Matching (High Confidence)
- ✅ Base excluded tags (script, style, noscript, meta, link, head)
- ✅ Excluded attributes (hidden, aria-hidden)
- ✅ data-cloak-exclude attribute
- ✅ data-nosnippet attribute
- ✅ encrypted-search-overlay exclusion
- ✅ Custom CSS selector support

### Intentional Differences (Documented)
- ⚠️ encrypted-search-highlight - SDK excludes, DI includes (correct behavior)
- ⚠️ textarea/input - DI excludes defensively (no impact)
- ⚠️ svg/path - DI excludes, SDK doesn't (low impact)

### Critical Mismatches (Requires Fix)
- ❌ code/pre/kbd/samp/var - SDK encrypts (as of quick-007), DI excludes

---

## Impact on Position Mapping

The code/pre mismatch causes **position calculation errors**:

1. SDK encrypts code blocks and includes them in plaintext upload
2. Server stores full plaintext including code blocks
3. decrypt-interceptor builds position map EXCLUDING code blocks
4. Result: All positions after first code block are offset by code block length

**Example:**
```
Page structure:
  <p>Para 1</p>     <- 6 chars
  <code>CODE</code> <- 4 chars
  <p>Para 2</p>     <- 6 chars

SDK plaintext upload: "Para 1\nCODE\nPara 2"  (positions: 0-6, 7-11, 12-18)
DI position map:      "Para 1\nPara 2"        (positions: 0-6, 7-13)

Server position 12 (start of "Para 2") → DI thinks it's position 7
Copy/paste at position 12-18 returns wrong text!
```

---

## Recommended Action

**Immediate fix required:**

Update `client/decrypt/src/position.js` line 217:
```javascript
// BEFORE
const EXCLUDE_SELECTORS = ['script', 'style', 'noscript', 'meta', 'link', 'head',
                           'svg', 'path', 'code', 'pre', 'kbd', 'samp', 'var',
                           'textarea', 'input'];

// AFTER (remove code/pre/kbd/samp/var to match SDK)
const EXCLUDE_SELECTORS = ['script', 'style', 'noscript', 'meta', 'link', 'head',
                           'svg', 'path', 'textarea', 'input'];
```

**Rationale:**
- Quick task 007 deliberately changed SDK to encrypt code blocks
- decrypt-interceptor must match to maintain position consistency
- SVG elements can stay excluded (low impact)
- textarea/input can stay excluded (defensive, no actual impact)

---

## References

**SDK Source:**
- `client/cloak-sdk.js:67-75` - DEFAULT_CONFIG with excludeSelectors and excludeAttributes
- `client/cloak-sdk.js:136-242` - shouldExcludeNode() implementation

**decrypt-interceptor Source:**
- `client/decrypt/src/position.js:217-218` - EXCLUDE_SELECTORS and EXCLUDE_ATTRIBUTES constants
- `client/decrypt/src/position.js:225-283` - shouldExcludeTextNode() implementation

**Related Changes:**
- `.planning/quick/007-fix-code-blocks-showing-encrypted-text-e/` - Quick task that changed SDK to encrypt code blocks

**Related Documentation:**
- See `position-mapping-comparison.md` for how exclusion affects position calculation
- See `block-detection-comparison.md` for BLOCK_ELEMENTS arrays comparison
