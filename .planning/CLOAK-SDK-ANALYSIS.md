# Cloak SDK Complete Flow Analysis

**Date:** 2026-01-24
**Purpose:** Deep analysis of how the Cloak system works step-by-step to identify what's correct, incorrect, missing, or should be removed.

---

## Executive Summary

The Cloak system encrypts text content using font-based character substitution to protect against non-JavaScript scrapers while preserving human readability and browser functionality (copy/paste, search).

**Core Architecture:**
1. Server generates character mappings via Feistel cipher
2. SDK receives mappings and encrypts DOM text client-side
3. SDK uploads plaintext to server (keyed by hash) for copy/paste support
4. Decrypt-interceptor handles Ctrl+F search and copy/paste via server plaintext lookups
5. Custom encrypted fonts render encrypted characters as their plaintext equivalents

**Critical Finding:** The system has **TWO SEPARATE ENCRYPTION MODES** that diverge in their approach:
- **SDK Mode** (client/cloak-sdk.js): Modern, correct - spaces NOT encrypted, no DOM manipulation
- **HTML Mode** (html_encryption.py): Legacy, problematic - spaces encrypted, span wrapping breaks layouts

---

## Part 1: SDK Encryption Flow (Client-Side)

### 1.1 Initialization Sequence

**File:** [client/cloak-sdk.js](client/cloak-sdk.js:1750-1852)

```
User loads page with <script data-api-key="...">
    ↓
CloakSDK.init()
    ↓
POST /api/sdk/init
    ← Returns: { secretKey, nonce, hash, fontUrl, charMappings, sessionId, storageId }
    ↓
document.body.style.visibility = 'hidden'  ← PREVENT FOUC
    ↓
loadFont(fontUrl)
    ├→ detectPageFonts() → finds Google Fonts
    ├→ detectUsedFonts() → finds system fonts via getComputedStyle
    ├→ requestEncryptedFont() → POST /api/sdk/font-from-url (per font)
    └→ Registers @font-face with SAME family names → overrides originals
    ↓
encryptTextNode() for all existing text nodes
    ↓
document.body.style.visibility = '' ← SHOW CONTENT
    ↓
uploadPlaintextToServer() ← Async, non-blocking
    ↓
injectDecryptInterceptor() ← Loads decrypt-interceptor.js
    ↓
startObserver() ← MutationObserver for dynamic content
```

**✓ CORRECT:**
- Hides content during font loading to prevent flash of gibberish
- Uses server-provided character mappings (no client-side crypto logic)
- Font matching preserves page typography
- Single hash identifies encryption parameters (nonce + secret_key)

**✗ INCORRECT:**
- None identified in initialization

**? MISSING:**
- No font preload hints for faster font loading
- No error recovery if font loading fails (content stays hidden forever)

**⊘ SHOULD REMOVE:**
- None identified

---

### 1.2 Character Encryption Algorithm

**File:** [client/cloak-sdk.js](client/cloak-sdk.js:98-127)

```javascript
function encryptChar(char) {
    if (!characterMappings) return char;

    // CRITICAL: Do NOT encrypt ANY whitespace
    if (/\s/.test(char)) {
        return char;  ← SPACES PASS THROUGH UNCHANGED
    }

    // Use flat mapping from server
    if (characterMappings[char]) return characterMappings[char];

    return char;  ← Numbers, punctuation pass through
}
```

**Server-Side Mapping Generation:**
**File:** [utils/encryption.py](utils/encryption.py:17-52)

```python
def remap_text_ultra_fast(text, secret_key, nonce, precomputed_maps=None):
    # Gets dynamic mappings from Feistel cipher
    upper_map, lower_map, space_map = get_dynamic_mappings(secret_key, nonce)
    combined_map = {**upper_map, **lower_map, **space_map}

    result = []
    for char in text:
        if char in combined_map:
            result.append(combined_map[char])
        else:
            result.append(char)  ← Unmapped chars unchanged

    return ''.join(result)
```

**✓ CORRECT:**
- **Spaces NOT encrypted** - This is THE KEY DECISION that makes everything work
- Browser whitespace handling works normally (collapse, line-wrap, etc.)
- Punctuation and numbers pass through unchanged
- Server provides mappings (client doesn't know encryption algorithm)

**✗ INCORRECT:**
- None identified - this is the correct approach

**? MISSING:**
- No handling of Unicode normalization (é vs e+´ could map differently)
- No ligature handling in SDK (but Python has expand_ligatures)

**⊘ SHOULD REMOVE:**
- None

---

### 1.3 DOM Text Node Encryption

**File:** [client/cloak-sdk.js](client/cloak-sdk.js:332-411)

```javascript
function encryptTextNode(textNode) {
    if (textNode._cloakEncrypted) return;

    const originalText = textNode.nodeValue;

    // Strip zero-width spaces FIRST
    const cleanText = originalText.replace(/\u200B/g, '');

    // Skip empty or whitespace-only nodes
    if (cleanText.length === 0 || !cleanText.trim()) return;

    // Check for block boundary - add 1 for \n marker
    const currentBlock = getContainingBlock(textNode);
    if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
        totalCharacters += 1;  ← Count \n marker between blocks
    }
    if (currentBlock !== null) lastBlock = currentBlock;

    // CRITICAL: Handle CSS text-transform
    const textTransform = getTextTransform(textNode);
    let textToEncrypt = originalText;
    if (textTransform !== 'none') {
        // Apply transform BEFORE encryption
        textToEncrypt = applyTextTransform(originalText, textTransform);
        // Reset text-transform to 'none' on parent
        textNode.parentElement.style.textTransform = 'none';
    }

    // Encrypt the text
    const encryptedText = encryptText(textToEncrypt);

    // Track position
    const transformedCleanText = applyTextTransform(cleanText, textTransform);
    const startPos = totalCharacters;
    totalCharacters += transformedCleanText.length;

    plaintextIndex.push({
        node: textNode,
        start: startPos,
        end: totalCharacters,
        originalText: transformedCleanText  ← Store transformed text
    });

    // Replace text with encrypted version
    textNode.nodeValue = encryptedText;
    textNode._cloakEncrypted = true;
    textNode._cloakOriginal = textToEncrypt;  ← Store for copy/paste

    // DUAL STORAGE: Also store in WeakMap
    plaintextStorage.set(textNode, textToEncrypt);
}
```

**Block Elements:** [client/cloak-sdk.js](client/cloak-sdk.js:245-250)
```javascript
const BLOCK_ELEMENTS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                        'LI', 'OL', 'UL', 'BLOCKQUOTE', 'PRE', 'SECTION',
                        'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE',
                        'TABLE', 'TR', 'TD', 'TH', ...];
```

**✓ CORRECT:**
- Zero-width space stripping BEFORE length calculation
- Whitespace-only node skipping (matches browser behavior)
- Block boundary markers (\n) preserve document structure
- CSS text-transform handled before encryption (encrypts displayed text, not source)
- Dual storage (property + WeakMap) for reliability
- Uses nodeValue instead of textContent (modifies text node directly)

**✗ INCORRECT:**
- None identified

**? MISSING:**
- No handling of contenteditable elements (user edits would break encryption)
- No handling of Shadow DOM (text in shadow roots not encrypted)
- No detection of SPA navigation (encrypted text might persist across routes)

**⊘ SHOULD REMOVE:**
- None

---

### 1.4 Plaintext Upload to Server

**File:** [client/cloak-sdk.js](client/cloak-sdk.js:1559-1705)

```javascript
function uploadPlaintextToServer() {
    // Build plaintext by walking ALL text nodes in document order
    // MUST match decrypt-interceptor.js buildTextPositionMap() exactly

    let fullPlaintext = '';
    let lastBlock = null;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);

    let textNode;
    while (textNode = walker.nextNode()) {
        // Skip excluded nodes
        if (shouldExcludeNode(textNode)) continue;

        // Remove zero-width spaces
        let text = textNode.textContent.replace(/\u200B/g, '');

        // Skip empty or whitespace-only
        if (text.length === 0 || !text.trim()) continue;

        // Check for block boundary - add \n marker
        const currentBlock = getContainingBlock(textNode);
        if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
            fullPlaintext += '\n';  ← Block boundary marker
        }
        if (currentBlock !== null) lastBlock = currentBlock;

        // Get original (unencrypted) text
        let originalText;
        if (textNode._cloakEncrypted && textNode._cloakOriginal) {
            originalText = textNode._cloakOriginal;  ← From property
        } else if (textNode._cloakEncrypted && plaintextStorage.has(textNode)) {
            originalText = plaintextStorage.get(textNode);  ← From WeakMap fallback
        } else {
            originalText = text;  ← Not encrypted, use current text
        }

        originalText = originalText.replace(/\u200B/g, '');
        fullPlaintext += originalText;
    }

    // Strip trailing whitespace (matches Python .rstrip())
    fullPlaintext = fullPlaintext.replace(/\s+$/, '');

    // POST to server
    await fetch(`${apiBaseUrl}/api/sdk/upload-plaintext`, {
        method: 'POST',
        body: JSON.stringify({
            storageId: encryptionConfig.storageId,
            hash: encryptionConfig.hash,
            plaintext: fullPlaintext
        })
    });
}
```

**✓ CORRECT:**
- TreeWalker ensures document order (critical for position mapping)
- EXACT same algorithm as position tracking (block boundaries, zero-width spaces, whitespace-only)
- Dual storage retrieval (property → WeakMap → current text)
- Trailing whitespace stripping matches Python backend
- Server stores plaintext in R2 keyed by hash

**✗ INCORRECT:**
- **SECURITY RISK:** Plaintext stored in `node._cloakOriginal` is accessible to any JavaScript
- **SECURITY RISK:** `/api/search/get-text-range` endpoint can retrieve entire plaintext (see line 39-47 in sdk comments)

**? MISSING:**
- No integrity check (hash of uploaded plaintext vs expected)
- No compression (plaintext uploaded uncompressed)
- No chunking for large documents (single POST could fail)
- No retry logic if upload fails

**⊘ SHOULD REMOVE:**
- Consider removing `_cloakOriginal` storage and rebuilding plaintext from encrypted text + reverse mappings server-side (eliminates DOM exposure)

---

## Part 2: Decrypt-Interceptor Flow (Copy/Paste & Search)

### 2.1 Copy/Paste Interception

**File:** [client/decrypt-interceptor.js](client/decrypt-interceptor.js:195-484)

```javascript
document.addEventListener('copy', function(e) {
    // Only intercept if we have hash
    if (!encryptionConfig.hash) return;

    const selection = window.getSelection();
    const selectedText = selection.toString();

    e.preventDefault();  ← Block default copy

    const positions = getSelectionPositions();  ← Calculate start/end

    // Synchronous XHR (required for clipboardData API)
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBaseUrl}/api/search/get-text-range`, false);
    xhr.send(JSON.stringify({
        start: positions.start,
        end: positions.end,
        hash: encryptionConfig.hash
    }));

    const data = JSON.parse(xhr.responseText);
    const plaintext = data.text;

    // Normalize whitespace to match browser rendering
    const finalText = plaintext
        .split('\n')
        .map(line => line.replace(/[ \t]+/g, ' ').trim())
        .filter(line => line.length > 0)
        .join('\n');

    e.clipboardData.setData('text/plain', finalText);
}, true);
```

**✓ CORRECT:**
- Synchronous XHR required (clipboardData only accessible in copy event handler)
- Whitespace normalization matches browser rendering
- Prevents default copy (no encrypted text in clipboard)

**✗ INCORRECT:**
- None identified

**? MISSING:**
- No HTML format preservation (loses bold, links, etc.)
- No rich text clipboard support (only plain text)

**⊘ SHOULD REMOVE:**
- None

---

### 2.2 Position Mapping

**File:** [client/decrypt-interceptor.js](client/decrypt-interceptor.js:595-974)

```javascript
function getSelectionPositions() {
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    // CRITICAL: When search highlights are active, use cached originalEncryptedText
    const highlightsCount = document.querySelectorAll('.encrypted-search-highlight').length;
    if (highlightsCount > 0 && searchState.originalEncryptedText) {
        // DOM has been modified by highlights - can't trust position walk
        // Extract selected text and find it in original pre-highlight text
        const selectedText = range.toString().replace(/\u200B/g, '');
        const startIdx = searchState.originalEncryptedText.indexOf(selectedText);
        return { start: startIdx, end: startIdx + selectedText.length };
    }

    // Build position map using TreeWalker
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);

    let globalPosition = 0;
    let lastBlock = null;
    let startPos = null;
    let endPos = null;

    while (textNode = walker.nextNode()) {
        // MUST MATCH SDK exclusions
        if (shouldExcludeTextNodeForPositionCalc(textNode)) continue;

        const text = textNode.textContent.replace(/\u200B/g, '');

        // MUST MATCH SDK: skip whitespace-only
        if (text.length === 0 || !text.trim()) continue;

        // MUST MATCH SDK: block boundary adds 1
        const currentBlock = getContainingBlockSkippingHighlights(textNode);
        if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
            globalPosition += 1;
        }
        if (currentBlock !== null) lastBlock = currentBlock;

        // Check if this node contains selection start/end
        if (textNode === startContainer) {
            let adjustedOffset = 0;
            for (let i = 0; i < startOffset; i++) {
                if (textNode.textContent[i] !== '\u200B') {
                    adjustedOffset++;
                }
            }
            startPos = globalPosition + adjustedOffset;
        }

        if (textNode === endContainer) {
            let adjustedOffset = 0;
            for (let i = 0; i < endOffset; i++) {
                if (textNode.textContent[i] !== '\u200B') {
                    adjustedOffset++;
                }
            }
            endPos = globalPosition + adjustedOffset;
        }

        globalPosition += text.length;
    }

    return { start: startPos, end: endPos };
}
```

**Exclusion Function:** [client/decrypt-interceptor.js](client/decrypt-interceptor.js:1441-1499)
```javascript
function shouldExcludeTextNode(textNode) {
    let parent = textNode.parentElement;
    while (parent) {
        const tagName = parent.tagName?.toLowerCase();

        // MUST MATCH SDK excludeSelectors
        if (EXCLUDE_SELECTORS.includes(tagName)) return true;

        // MUST MATCH SDK excludeAttributes
        for (const attr of EXCLUDE_ATTRIBUTES) {
            if (parent.hasAttribute(attr)) return true;
        }

        // MUST MATCH SDK
        if (parent.hasAttribute('data-cloak-exclude')) return true;
        if (parent.hasAttribute('data-nosnippet')) return true;
        if (parent.id === 'encrypted-search-overlay') return true;

        parent = parent.parentElement;
    }
    return false;
}

const EXCLUDE_SELECTORS = ['script', 'style', 'noscript', 'meta', 'link', 'head'];
const EXCLUDE_ATTRIBUTES = ['hidden', 'aria-hidden'];
```

**✓ CORRECT:**
- EXACT same algorithm as SDK (critical for position consistency)
- Zero-width space stripping before offset calculation
- Block boundary markers
- Exclusion logic matches SDK
- Special handling for search highlights (uses cached text)

**✗ INCORRECT:**
- **POTENTIAL BUG:** `getContainingBlockSkippingHighlights` skips `<mark>` but `getContainingBlock` (SDK) doesn't
  - If SDK adds highlights in the future, positions could drift

**? MISSING:**
- No CSS text-transform handling (SDK applies transform before encryption, interceptor should account for it)
- No validation that client position map length matches server plaintext length

**⊘ SHOULD REMOVE:**
- None

---

### 2.3 Server-Side Search

**File:** [client/decrypt-interceptor.js](client/decrypt-interceptor.js:1216-1256)

```javascript
async function searchServerSide(query, signal) {
    const response = await fetch(`${apiBaseUrl}/api/search/find-matches`, {
        method: 'POST',
        signal: signal,  ← Cancellation support
        body: JSON.stringify({
            query: query,
            hash: encryptionConfig.hash
        })
    });

    const data = await response.json();
    // Server returns: { matches: [{start, end}, ...], plaintext_length }

    return {
        matches: data.matches || [],
        plaintext_length: data.plaintext_length
    };
}
```

**Backend API:** Server loads plaintext from R2 using hash, searches it, returns match positions.

**✓ CORRECT:**
- Server-side search (no plaintext exposed client-side during search)
- AbortController support for cancellation
- Returns positions that map to encrypted DOM text

**✗ INCORRECT:**
- None identified

**? MISSING:**
- No fuzzy search
- No case-insensitive option
- No regex support

**⊘ SHOULD REMOVE:**
- None

---

## Part 3: Font System

### 3.1 Font Detection & Matching

**File:** [client/cloak-sdk.js](client/cloak-sdk.js:535-875)

```
detectPageFonts()
    ├→ Detect Google Fonts links
    ├→ Resolve via /api/sdk/resolve-google-fonts
    └→ Returns: [{ family, weight, style, url }, ...]

detectUsedFonts()
    ├→ Query all text elements via getComputedStyle
    ├→ Extract first font-family (actually used by browser)
    └→ Returns: { usedFonts: Map, usedGenericFonts: Map }

For each detected font:
    ├→ If web font: requestEncryptedFont({ url, family, weight, style })
    │               POST /api/sdk/font-from-url
    │               ← Returns: { encryptedFontUrl }
    │
    └→ If system font: resolveSystemFont(family, weight, style)
                       POST /api/sdk/resolve-system-font
                       ← Returns: { googleFont, fonts: [{ url, weight, style }] }
                       → Request encrypted version via /api/sdk/font-from-url

Register all encrypted fonts:
    @font-face {
        font-family: 'OriginalFontName';  ← SAME name as original
        src: url('https://.../encrypted-font.woff2');
        font-weight: 400;
        font-style: normal;
        font-display: block;  ← Prevents FOIT/FOUT
    }

Disable original Google Fonts:
    <link media="none" data-cloak-disabled="true">

Result: Browser uses encrypted fonts with SAME family names → preserves typography
```

**✓ CORRECT:**
- Using SAME font-family names (overrides originals, preserves page design)
- `font-display: block` prevents flash of invisible text
- System font resolution to Google Font equivalents
- Disables original Google Fonts (prevents race condition)

**✗ INCORRECT:**
- None identified

**? MISSING:**
- No font subsetting (downloads full fonts even if only a few characters used)
- No fallback if font encryption fails (content encrypted with wrong font = gibberish)
- No variable font support (detects as multiple weights, inefficient)

**⊘ SHOULD REMOVE:**
- None

---

## Part 4: Position Mapping Consistency

### 4.1 The Critical Invariant

**For copy/paste and search to work, these MUST produce identical position counts:**

1. **SDK uploadPlaintextToServer()** - Builds plaintext uploaded to server
2. **SDK encryptTextNode()** - Tracks positions in plaintextIndex
3. **Decrypt-Interceptor getSelectionPositions()** - Calculates positions for copy
4. **Decrypt-Interceptor buildTextPositionMap()** - Maps positions for search

**Common Algorithm Requirements:**
```
for each text node in document order (TreeWalker):
    if shouldExcludeNode(node): skip

    text = node.textContent.replace(/\u200B/g, '')  ← Remove zero-width spaces

    if text.length == 0 or !text.trim(): skip  ← Whitespace-only

    currentBlock = getContainingBlock(node)
    if lastBlock != null and currentBlock != lastBlock:
        position += 1  ← \n marker between blocks
    lastBlock = currentBlock

    position += text.length
```

**✓ CORRECT IMPLEMENTATIONS:**
- SDK uploadPlaintextToServer uses this algorithm ✓
- Decrypt-Interceptor getSelectionPositions uses this algorithm ✓

**✗ INCORRECT / DRIFT RISKS:**
- **CSS text-transform:** SDK applies transform BEFORE encryption (line 361-377), but decrypt-interceptor doesn't account for it in position calculation
  - Example: Source has "hello", CSS has `text-transform: uppercase`
  - SDK encrypts "HELLO" (5 chars), intercept counts "hello" (5 chars) - OK by accident
  - But if source has "hello world" and CSS uppercases first word only - DRIFT

- **Highlight element handling:** SDK uses `getContainingBlock`, interceptor uses `getContainingBlockSkippingHighlights`
  - If SDK ever adds highlights, block boundary detection could differ

**? MISSING:**
- No runtime validation that position maps match
- No error detection if positions drift

**⊘ SHOULD REMOVE:**
- None

---

## Part 5: Security Analysis

### 5.1 Threat Model (from SDK comments)

**File:** [client/cloak-sdk.js](client/cloak-sdk.js:14-58)

```
PROTECTS AGAINST:
✓ Non-JavaScript scrapers (bots parsing HTML)
✓ Casual text extraction

DOES NOT PROTECT AGAINST:
✗ JavaScript execution (can read _cloakOriginal)
✗ Screenshots / screen recording
✗ Manual copy-paste (intentionally allowed)
✗ /api/search/get-text-range abuse (can retrieve entire plaintext)
```

### 5.2 Known Security Issues

**Issue 1: _cloakOriginal Property Exposure**
```javascript
// ANY JS can traverse DOM and read plaintext
document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
// then access node._cloakOriginal on each encrypted node
```

**Why it exists:** Required for dynamic content. When new content loads, SDK must rebuild full plaintext (old + new) to upload. Without `_cloakOriginal`, can't include already-encrypted nodes.

**Mitigation options:**
- Store plaintext server-side only (more round-trips)
- Use WeakMap instead of properties (harder to discover, not truly secure)
- Clear after "settle" delay (risky if more content loads)

**Issue 2: /api/search/get-text-range Endpoint**
```
POST /api/search/get-text-range
{ start: 0, end: 999999, hash: "..." }
→ Returns entire plaintext
```

**Why it exists:** Required for copy-paste. Users must be able to copy selections, need original plaintext.

**Mitigation options:**
- Rate limiting per session/IP
- Maximum range limit (e.g., 1000 chars per request)
- Session-based quotas
- Require proof of user interaction

**Issue 3: Character Mappings in Memory**
```javascript
const characterMappings = initData.charMappings;
// JS can inspect window.CloakSDK or debugger
```

**Impact:** Attacker with JS access can decrypt any encrypted text on page.

---

## Part 6: HTML Encryption Mode (Legacy System)

### 6.1 The Divergence

**SDK Mode** (client/cloak-sdk.js):
- Spaces NOT encrypted ✓
- No DOM manipulation ✓
- Browser whitespace handling works ✓

**HTML Mode** (html_encryption.py):
- Spaces ARE encrypted ✗
- Adds `<span>` wrapping ✗
- Breaks layouts, line wrapping ✗

**File:** html_encryption.py (132KB file, uses old approach)

The user wants to "get rid of the current steps like modernizing the html algorithm because it would just be redundant with the api which is what actually matters."

**Recommendation:** html_encryption.py should be deprecated or refactored to match SDK approach.

---

## Part 7: What's Correct, Incorrect, Missing, Removed

### ✓ CORRECT (Keep These)

1. **Spaces not encrypted** (SDK mode) - Preserves browser whitespace handling
2. **Server-provided character mappings** - Client doesn't know crypto algorithm
3. **Font-display: block** - Prevents FOUC
4. **Same font-family names** - Preserves typography
5. **Block boundary markers** - Preserves document structure
6. **CSS text-transform** handling - Encrypts displayed text, not source
7. **Zero-width space stripping** - Consistent position calculation
8. **TreeWalker document order** - Critical for position mapping
9. **Server-side search** - No plaintext exposure during search
10. **Dual storage** (property + WeakMap) - Reliability

### ✗ INCORRECT (Fix These)

1. **CSS text-transform not handled in decrypt-interceptor position calculation**
   - SDK applies transform before encryption, interceptor should account for it
   - Could cause position drift in edge cases

2. **getContainingBlock vs getContainingBlockSkippingHighlights** inconsistency
   - SDK and interceptor use different functions for block detection
   - Could cause drift if SDK adds highlight support

3. **No validation that client/server position maps match**
   - Silent failures if algorithms drift
   - Should POST client position count to server, compare

4. **html_encryption.py uses wrong approach**
   - Encrypts spaces (breaks whitespace handling)
   - Adds span wrapping (breaks layouts)
   - Should match SDK approach or be deprecated

### ? MISSING (Add These)

1. **Font loading error recovery**
   - If font fails to load, content stays hidden forever
   - Should timeout and show unencrypted content or error message

2. **Position map validation**
   - No check that client position count matches server plaintext length
   - Could detect algorithm drift

3. **Plaintext integrity check**
   - No hash verification after upload
   - Could detect corruption or transmission errors

4. **CSS text-transform position accounting**
   - Interceptor should apply same transform logic as SDK when counting

5. **Dynamic content position reset**
   - When MutationObserver fires, positions are recalculated
   - No clear strategy for handling mid-session content changes

6. **Shadow DOM support**
   - Text in shadow roots not encrypted
   - Common in modern web components

7. **ContentEditable support**
   - User edits break encryption
   - No re-encryption on input events

8. **Rich text clipboard**
   - Only plain text copy supported
   - Could preserve formatting (bold, links) in HTML clipboard format

9. **Font subsetting**
   - Downloads full fonts even if only a few glyphs used
   - Could reduce bandwidth with subsets

10. **Search options**
    - No case-insensitive option
    - No fuzzy search
    - No regex support

### ⊘ SHOULD REMOVE (Delete These)

1. **html_encryption.py** (or refactor to match SDK)
   - 132KB of legacy code using wrong approach
   - User said: "get rid of the current steps like modernizing the html algorithm because it would just be redundant"

2. **Potential: _cloakOriginal storage**
   - Security risk (plaintext exposed to any JS)
   - Could rebuild plaintext server-side from encrypted text + reverse mappings
   - Trade-off: more server load vs better security

---

## Part 8: Critical Path Flow Diagrams

### Flow 1: Initial Page Load
```
User visits page
    ↓
<script data-api-key="xyz">
    ↓
CloakSDK.init()
    ↓
[Hide body]
    ↓
GET character mappings from server
    ↓
Load encrypted fonts (same family names as originals)
    ↓
Encrypt all text nodes:
    - Walk DOM in document order
    - Skip excluded elements
    - Strip zero-width spaces
    - Add block boundary markers
    - Apply CSS text-transform BEFORE encryption
    - Map each char via characterMappings
    - Store original in node._cloakOriginal
    ↓
[Show body]
    ↓
Upload plaintext to server (keyed by hash)
    ↓
Inject decrypt-interceptor.js
    ↓
Start MutationObserver for dynamic content
```

### Flow 2: User Copies Text
```
User selects text and presses Ctrl+C
    ↓
Copy event fires
    ↓
Decrypt-Interceptor intercepts
    ↓
getSelectionPositions():
    - Walk DOM in document order
    - Skip excluded elements
    - Strip zero-width spaces
    - Add block boundary markers
    - Find nodes containing selection start/end
    - Return { start, end } positions
    ↓
POST /api/search/get-text-range { start, end, hash }
    ↓
Server loads plaintext from R2 using hash
    ↓
Server returns plaintext[start:end]
    ↓
Set clipboardData with plaintext
```

### Flow 3: User Searches (Ctrl+F)
```
User presses Ctrl+F
    ↓
Custom search overlay appears
    ↓
User types query
    ↓
encryptSearchQuery(query) → encrypted query
    ↓
POST /api/search/find-matches { query, hash }
    ↓
Server loads plaintext from R2 using hash
    ↓
Server searches plaintext
    ↓
Server returns matches: [{ start, end }, ...]
    ↓
mapPositionsToDOMNodes(matches):
    - Build position map from DOM
    - Convert match positions to DOM nodes
    ↓
Highlight matches with <mark> elements
    ↓
Scroll to first match
```

---

## Part 9: Recommendations

### High Priority

1. **Deprecate html_encryption.py** or refactor to match SDK approach
   - User explicitly wants to remove redundant HTML modernization
   - 132KB of problematic code

2. **Add CSS text-transform handling to decrypt-interceptor**
   - Prevents position drift
   - Low-risk fix

3. **Add position validation**
   - Client POSTs total character count to server on upload
   - Server compares to plaintext length, warns on mismatch
   - Detects algorithm drift early

4. **Add font loading timeout**
   - If fonts don't load in 10s, show error or unencrypted content
   - Prevents permanent blank page

### Medium Priority

5. **Unify block detection**
   - Both SDK and interceptor should use same function
   - Prevents future drift

6. **Add plaintext integrity check**
   - Hash uploaded plaintext
   - Server stores hash with plaintext
   - Detect corruption

7. **Security hardening**
   - Rate limit /api/search/get-text-range
   - Add session quotas
   - Consider moving _cloakOriginal to server-side storage

### Low Priority

8. **Rich text clipboard**
9. **Shadow DOM support**
10. **Font subsetting**

---

## Conclusion

The Cloak SDK has a **solid core architecture** with correct encryption, position mapping, and copy/paste handling. The main issues are:

1. **Legacy html_encryption.py divergence** (user wants this addressed)
2. **Minor position drift risks** (CSS text-transform, block detection)
3. **Security trade-offs** (plaintext exposure for dynamic content support)

The system **consistently works** for websites because:
- Spaces not encrypted → browser whitespace handling works
- Font matching → preserves typography
- Position mapping consistency → copy/paste and search work
- Server-side plaintext storage → no client-side decryption needed

The **user's request** to analyze the SDK flow and eliminate redundancy points directly to **html_encryption.py** as the culprit.
