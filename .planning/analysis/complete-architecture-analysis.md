# Complete Cloak SDK Architecture Analysis
**Date:** 2026-01-23
**Purpose:** Deep analysis of entire encryption/decryption flow to identify gaps, inconsistencies, and issues

---

## EXECUTIVE SUMMARY

### Core Architecture (How It Should Work)
1. **SDK encrypts ALL visible text** using character substitution (A→F, B→G, etc.)
2. **Encrypted fonts make encrypted text readable** - font maps F back to look like A
3. **No exclusions needed** - everything works universally
4. **Copy/paste uses server plaintext** - decrypt-interceptor queries server for original text
5. **Search uses server plaintext** - Ctrl+F searches server-side, highlights locally

### Current Issues Identified
1. ✅ **FIXED:** Code blocks were being excluded from encryption
2. ⚠️ **POTENTIAL:** Font application may skip elements incorrectly
3. ⚠️ **CRITICAL:** Text-transform handling may cause mismatches
4. ⚠️ **BLOCKER:** Position mapping between SDK and decrypt-interceptor must be identical

---

## STEP-BY-STEP FLOW ANALYSIS

### PHASE 1: Initialization (cloak-sdk.js init())

#### Step 1.1: Hide Content (FOUC Prevention)
**Location:** cloak-sdk.js:1796-1801
```javascript
document.body.style.visibility = 'hidden';
```

**Purpose:** Prevent Flash of Unencrypted Content where:
- Plaintext loads → encrypted fonts apply → gibberish briefly visible
- Solution: Hide until encryption complete

**Issues:** ✅ CORRECT - properly restored after encryption

---

#### Step 1.2: API Initialization
**Location:** cloak-sdk.js:1482-1502 (initWithAPI)
**Endpoint:** POST /api/sdk/init

**Sent:**
- domain, path, userAgent

**Received:**
- secretKey, nonce, hash (encryption config)
- fontUrl (default fallback font)
- sessionId, storageId (tracking)
- **charMappings** (critical: A→F, B→G, etc.)

**Issues:** ✅ CORRECT - server provides mappings

---

#### Step 1.3: Font Detection & Loading
**Location:** cloak-sdk.js:918-1473 (loadFont)

**Sub-steps:**

**1.3a: Detect Web Fonts**
- Queries document for Google Fonts links
- Parses @font-face rules from stylesheets
- Resolves Google Fonts CSS → actual font URLs via server

**1.3b: Detect Used Fonts (System Fonts)**
- Uses `getComputedStyle()` on ALL text elements
- Checks: `p, h1, h2, h3, h4, h5, h6, span, a, li, td, th, div, article, section, blockquote, figcaption, label, button, code, pre, kbd, samp, var`
- **CRITICAL LINE 772:** Now includes code/pre/kbd/samp/var (FIXED in task 007)

**1.3c: Font Skipping Logic**
Lines 776-781:
```javascript
if (el.closest('[data-cloak-exclude]') ||
    el.closest('script') ||
    el.closest('style') ||
    el.closest('#encrypted-search-overlay')) {
    continue;
}
```

**✅ CORRECT:** Only skips technical/UI elements, NOT code/pre

**1.3d: System Font Resolution**
- For each system font (Arial, Georgia, etc.):
  - Resolves to Google Font equivalent via server API
  - Requests encrypted version from server
  - Registers @font-face with ORIGINAL font name
  - This overrides browser's built-in font

**1.3e: Generic Font Handling**
- Detects elements using `serif`, `sans-serif`, `monospace` directly
- Maps to suitable Google Fonts (Lora, Inter, Roboto Mono)
- Creates `CloakGeneric-{family}` encrypted fonts
- **STEP 3.5 (lines 1416-1463):** Applies these fonts to elements

**Issues Found:**
1. ✅ **FIXED:** Code/pre were excluded from font detection (task 007)
2. ✅ **FIXED:** Generic font application now works (removed CODE/PRE/KBD/SAMP/VAR checks)

---

#### Step 1.4: Disable Original Fonts
**Location:** cloak-sdk.js:1352-1360

**Process:**
1. Set Google Fonts links to `media="none"` (prevents loading)
2. Load encrypted fonts
3. Remove Google Fonts links entirely

**Purpose:** Ensure encrypted fonts take precedence

**Issues:** ✅ CORRECT - proper sequence

---

#### Step 1.5: Font Application Rules
**Location:** cloak-sdk.js:1280-1350

**For Web Fonts (detected from @font-face):**
- Register with SAME family name
- No body-level override needed
- Browser automatically uses encrypted font

**For System Fonts:**
- Register with ORIGINAL system font name
- Overrides browser's built-in font
- No CSS override needed

**For Exclusions:**
- Excluded elements get system fonts via CSS
- Search overlay gets system fonts
- data-cloak-exclude gets system fonts

**Issues:** ✅ CORRECT - no universal override that breaks typography

---

### PHASE 2: Text Encryption (cloak-sdk.js)

#### Step 2.1: Get Text Nodes
**Location:** cloak-sdk.js:269-295 (getTextNodes)

**Process:**
1. TreeWalker with `SHOW_TEXT` filter
2. For each text node:
   - Check `shouldExcludeNode()` → REJECT if excluded
   - Strip zero-width spaces (`\u200B`)
   - Check if empty/whitespace-only → REJECT
   - ACCEPT node for encryption

**Issues:** ✅ CORRECT - matches decrypt-interceptor logic

---

#### Step 2.2: Check Exclusions
**Location:** cloak-sdk.js:136-242 (shouldExcludeNode)

**Exclusion Rules:**
1. Tag names in `excludeSelectors` (default: script, style, noscript, meta, link, head)
2. `[hidden]` or `[aria-hidden]` attributes
3. `[data-cloak-exclude]` attribute
4. `[data-nosnippet]` attribute
5. `.encrypted-search-highlight` class (prevent double-encryption)
6. `#encrypted-search-overlay` (search UI)
7. Custom CSS selectors from config

**Issues:** ✅ CORRECT - minimal exclusions, only technical elements

---

#### Step 2.3: Text-Transform Handling
**Location:** cloak-sdk.js:299-324, 361-378

**Process:**
1. Get computed `text-transform` style
2. If not 'none':
   - Transform text BEFORE encryption (uppercase/lowercase/capitalize)
   - Encrypt the TRANSFORMED text
   - Set parent `style.textTransform = 'none'` to prevent browser re-transformation

**Example:**
```html
<!-- Original: -->
<div style="text-transform: uppercase">hello</div>
<!-- Browser displays: HELLO -->

<!-- After SDK: -->
<div style="text-transform: none">IFMMP</div>
<!-- Encrypted: IFMMP, Font makes it look like: HELLO -->
```

**Potential Issue:** ⚠️ **NEEDS VERIFICATION**
- If decrypt-interceptor doesn't know about text-transform reset, position mapping may mismatch
- SDK tracks transformed text, but does decrypt-interceptor?

---

#### Step 2.4: Character Encryption
**Location:** cloak-sdk.js:99-127

**Rules:**
1. Whitespace (`\s`) passes through unchanged (CRITICAL for layout)
2. Letters use server-provided `characterMappings`
3. Numbers/punctuation pass through unchanged

**Why whitespace unchanged:**
- Browser must handle whitespace normally (collapse, wrapping)
- Space glyph in font is NOT swapped
- If we encrypted spaces → visible chars → layout breaks

**Issues:** ✅ CORRECT - preserves HTML whitespace semantics

---

#### Step 2.5: Position Tracking
**Location:** cloak-sdk.js:332-411 (encryptTextNode)

**Algorithm:**
1. Strip zero-width spaces first
2. Skip if empty/whitespace-only after stripping
3. Check for block boundary:
   - If `currentBlock !== lastBlock` AND both not null → add 1 to position (newline marker)
   - Update `lastBlock`
4. Apply text-transform if needed
5. Encrypt text
6. Store in `plaintextIndex`: `{ node, start, end, originalText }`
7. Track `totalCharacters`
8. Set `node._cloakOriginal` (and WeakMap backup)

**CRITICAL:** This must EXACTLY match decrypt-interceptor's position mapping

**Potential Issues:**
⚠️ **Text-transform:** Does decrypt-interceptor account for transformed text?
⚠️ **Block detection:** `getContainingBlock()` must be identical in both files

---

### PHASE 3: Plaintext Upload (cloak-sdk.js → Server)

#### Step 3.1: Build Plaintext
**Location:** cloak-sdk.js:1559-1705 (uploadPlaintextToServer)

**Algorithm:**
1. TreeWalker over document.body (SHOW_TEXT)
2. For each text node:
   - Skip if `shouldExcludeNode()`
   - Strip zero-width spaces
   - Skip if empty/whitespace-only
   - Check block boundary → add `\n` if different block
   - Get original text:
     - Try `node._cloakOriginal` (fast path)
     - Try `plaintextStorage` WeakMap (fallback)
     - Skip if encrypted but no original (corruption)
     - Use current text if not encrypted
   - Strip zero-width spaces from original
   - Append to `fullPlaintext`
3. Strip trailing whitespace (`.rstrip()`)
4. Upload to `/api/sdk/upload-plaintext`

**Issues:**
⚠️ **Corruption Detection:** Lines 1660-1662 - prevents uploading bad data
⚠️ **Search Highlights:** Lines 1566-1568 - skips upload if highlights present
✅ **Matches decrypt-interceptor:** Same algorithm structure

---

### PHASE 4: Decrypt-Interceptor Loading

#### Step 4.1: Inject Script
**Location:** cloak-sdk.js:1715-1734

**Sets:** `window.encryptionConfig` with:
- hash, storageId, apiBaseUrl, apiKey

**Loads:** `/client/decrypt-interceptor.js`

---

#### Step 4.2: Copy Interception (decrypt-interceptor.js)
**Location:** decrypt-interceptor.js:195-484

**Algorithm:**
1. User copies text
2. Get selection range
3. Check if contains excluded elements:
   - **Simple mode:** No exclusions → use position-based lookup
   - **Mixed mode:** Has exclusions → segment-by-segment handling
4. Call `/api/search/get-text-range` with start/end positions
5. Replace clipboard with plaintext

**Potential Issues:**
⚠️ **Position calculation must match SDK exactly**
⚠️ **Block boundary logic must be identical**

---

### PHASE 5: Search (decrypt-interceptor.js)

#### Step 5.1: Ctrl+F Intercepts
User presses Ctrl+F → shows custom overlay

#### Step 5.2: Server-Side Search
**Endpoint:** `/api/search/search-encrypted-content`
**Sends:** query, hash
**Receives:** Array of `{ start, end }` positions

#### Step 5.3: Local Highlighting
For each match:
1. Build text position map (MUST match SDK algorithm)
2. Find text nodes containing [start, end]
3. Wrap in `<mark class="encrypted-search-highlight">`

**CRITICAL ISSUE:** ⚠️
Position map building MUST use:
- Same TreeWalker order
- Same exclusion logic
- Same zero-width space stripping
- Same block boundary detection
- **Same text-transform handling (if any)**

---

## IDENTIFIED ISSUES & GAPS

### Issue 1: Text-Transform Consistency ⚠️ MEDIUM PRIORITY

**Problem:**
SDK applies text-transform BEFORE encryption:
```javascript
// cloak-sdk.js:361-378
if (textTransform !== 'none') {
    textToEncrypt = applyTextTransform(originalText, textTransform);
    parent.style.textTransform = 'none';
}
```

**Question:** Does decrypt-interceptor know the original had text-transform?

**Test Case:**
```html
<div style="text-transform: uppercase">hello world</div>
```
- Browser displays: "HELLO WORLD" (5 + 5 = 10 letters)
- SDK encrypts: "HELLO WORLD" → "IFMMP XPSME"
- SDK stores: "HELLO WORLD" (transformed)
- decrypt-interceptor sees: "IFMMP XPSME" in DOM
- decrypt-interceptor should map positions based on "HELLO WORLD" length

**Verification Needed:**
1. Does decrypt-interceptor position map account for transformed length?
2. Does server plaintext contain "HELLO WORLD" or "hello world"?

**Impact:**
- Copy/paste may get wrong character ranges
- Search highlights may misalign

**Fix:**
Ensure decrypt-interceptor uses same text-transform logic when building position map

---

### Issue 2: Block Boundary Consistency ✅ LIKELY CORRECT

**SDK (cloak-sdk.js:245-262):**
```javascript
const BLOCK_ELEMENTS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', ...];

function getContainingBlock(node) {
    let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current && !BLOCK_ELEMENTS.includes(current.tagName)) {
        current = current.parentElement;
    }
    return current;
}
```

**decrypt-interceptor:** Must have identical implementation

**Verification:** grep for 'getContainingBlock' in decrypt-interceptor.js

---

### Issue 3: Zero-Width Space Handling ✅ CORRECT

**SDK:** Strips `\u200B` before:
- Checking if node is empty (line 340)
- Calculating position (line 340)
- Encrypting text (line 340)

**decrypt-interceptor:** Must strip `\u200B` in same places

**Verified:** Both files use `.replace(/\u200B/g, '')` consistently

---

### Issue 4: Generic Font Application ✅ FIXED

**Previous Issue:**
Lines 1440-1444 excluded CODE/PRE/KBD/SAMP/VAR from generic font application

**Fixed in task 007:**
Removed tagName checks, now all elements get encrypted fonts

---

### Issue 5: Font Detection Scope ✅ FIXED

**Previous Issue:**
Line 772 didn't include code/pre/kbd in querySelector

**Fixed in task 007:**
Now includes: `code, pre, kbd, samp, var`

---

### Issue 6: Exclusion Inconsistency ⚠️ LOW PRIORITY

**SDK excludeSelectors (line 70):**
```javascript
excludeSelectors: ['script', 'style', 'noscript', 'meta', 'link', 'head']
```

**decrypt-interceptor isTextNodeInExcludedElement:**
Must have same list

**Verification Needed:**
Check if decrypt-interceptor excludes same elements

**Impact:**
- If SDK excludes but decrypt-interceptor doesn't → wrong position mapping
- If decrypt-interceptor excludes but SDK doesn't → missing plaintext

---

### Issue 7: Search Highlight Node Splitting ⚠️ KNOWN ISSUE

**Problem:**
When decrypt-interceptor adds `<mark>` elements, it splits text nodes:
```
Before: [TextNode: "Hello world"]
After:  [TextNode: "Hello "] <mark> [TextNode: "wo"] </mark> [TextNode: "rld"]
```

**Impact:**
- Split nodes lose `_cloakOriginal` property
- uploadPlaintextToServer() skips nodes without `_cloakOriginal`
- Lines 1634-1637 handle this (skip if encrypted but no original)

**Mitigation:**
- Lines 1566-1568: Don't upload if highlights present
- Lines 1660-1662: Don't upload if data looks corrupted

**Status:** ✅ HANDLED - has safety checks

---

### Issue 8: innerHTML Corruption ⚠️ KNOWN ISSUE

**Problem:**
If page JavaScript uses `element.innerHTML = ...`, it replaces DOM nodes entirely:
- New text nodes are created
- Old `_cloakOriginal` properties are lost
- WeakMap entries are lost (WeakMap keys are old nodes)

**Example:**
```javascript
// SDK encrypts: "Hello" → "Ifmmp"
textNode.textContent = "Ifmmp";
textNode._cloakOriginal = "Hello";

// Later, page JS does:
parentDiv.innerHTML = parentDiv.innerHTML; // Force re-parse

// Result: New text node with "Ifmmp", no _cloakOriginal
```

**Mitigation:**
- MutationObserver detects new nodes (line 489)
- But new nodes are already encrypted gibberish
- Can't re-encrypt gibberish

**Status:** ⚠️ UNSOLVED - inherent limitation

---

## CRITICAL PATH VERIFICATION

### Verify Position Mapping Identity

**Must be IDENTICAL:**

**SDK (encryptTextNode):**
```
1. TreeWalker(document.body, SHOW_TEXT)
2. For each node:
   a. shouldExcludeNode() → skip if true
   b. Strip \u200B
   c. Skip if empty/whitespace-only
   d. If currentBlock !== lastBlock → pos += 1
   e. pos += text.length
```

**decrypt-interceptor (buildTextPositionMap - NOT READ YET):**
```
MUST USE SAME ALGORITHM
```

**Action Required:**
Read decrypt-interceptor's position mapping code and compare line-by-line

---

## RECOMMENDATIONS

### High Priority
1. ✅ **Code block fonts** - FIXED in task 007
2. ⚠️ **Text-transform verification** - Check if decrypt-interceptor handles this
3. ⚠️ **Position mapping audit** - Line-by-line comparison between SDK and decrypt-interceptor

### Medium Priority
4. ⚠️ **Exclusion consistency** - Verify both files exclude same elements
5. ⚠️ **Block element consistency** - Verify BLOCK_ELEMENTS arrays match

### Low Priority
6. ℹ️ **innerHTML corruption** - Document as limitation, can't fix without architectural changes
7. ℹ️ **Security review** - Document known exposures (_cloakOriginal, get-text-range API)

---

## NEXT STEPS

1. **Read decrypt-interceptor position mapping code** (buildTextPositionMap function)
2. **Create comparison table** SDK vs decrypt-interceptor for:
   - TreeWalker parameters
   - Exclusion logic
   - Zero-width space handling
   - Block boundary detection
   - Text-transform handling
3. **Test text-transform** with uppercase/lowercase/capitalize
4. **Test Stack Overflow demo** thoroughly to verify all issues are resolved

---

## CONCLUSION

The architecture is generally sound, but there are potential mismatches between SDK and decrypt-interceptor that could cause:
- Copy/paste getting wrong text ranges
- Search highlights appearing in wrong locations
- Text-transform elements having position offsets

The fixes in task 007 (code block fonts) addressed immediate issues, but deeper verification is needed to ensure position mapping is absolutely identical between the two components.
