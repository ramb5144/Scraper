# Troubleshooting Guide: Text Rendering Issues

**Purpose:** Systematic diagnosis of text rendering problems where text appears as gibberish, fonts look wrong, or encrypted characters are visible.

**When to use this guide:**
- Text appears as scrambled characters (e.g., "Freqfkntly Asked Qfkstions")
- Plaintext is rendered with encrypted font glyphs
- Some text is readable while other text is gibberish
- FAQ section or specific elements show garbled text

---

## Symptom: Text appears as gibberish (encrypted characters visible)

### Decision Tree

```
├─ Check 1: Is the text encrypted?
│  ├─ How to check:
│  │  1. Open DevTools → Elements → find the text element → examine text content
│  │  2. Is the text scrambled letters/characters? (e.g., "Freqfkntly" instead of "Frequently")
│  │  3. Also check: Select the text node in Elements, type in Console:
│  │     $0._cloakEncrypted
│  │     $0._cloakOriginal
│  │
│  ├─ YES (text is encrypted, _cloakEncrypted = true) → Check 2
│  └─ NO (plaintext visible, _cloakEncrypted = undefined/false) →
│     Root cause: SDK didn't encrypt this text
│     └─ Fix: Check if element is in excludeSelectors, verify SDK init completed
│        - Check: element.closest('[data-cloak-exclude]')
│        - Check: config.excludeSelectors includes parent tag
│        - Check: Console shows "[Cloak] SDK initialized successfully"
│        - For FAQ section: See "FAQ Section Gibberish" below
│
├─ Check 2: Are encrypted fonts loaded?
│  ├─ How to check:
│  │  1. DevTools → Network → filter by "woff2" → look for font requests
│  │  2. Are fonts showing 200 OK status?
│  │  3. Check Console for "[Cloak] Font loaded successfully" messages
│  │
│  ├─ YES (fonts loaded successfully) → Check 3
│  └─ NO (fonts failed to load, 404/CORS errors) →
│     Root cause: Font loading failed
│     └─ Fix:
│        - Check CORS headers on font server (must allow cross-origin)
│        - Check R2 storage bucket configuration
│        - Check font URL validity in encryption config
│        - Verify font files exist at expected URLs
│
├─ Check 3: Are encrypted fonts APPLIED to this element?
│  ├─ How to check:
│  │  1. DevTools → Elements → select the gibberish text element
│  │  2. Computed tab → scroll to font-family
│  │  3. Does it show the encrypted font name? (e.g., "Arimo" from encrypted mapping)
│  │     NOT a system font like "Arial" or "Times New Roman"
│  │
│  ├─ YES (encrypted font applied, e.g., font-family shows "Arimo") → Check 4
│  └─ NO (system font shown instead of encrypted font) →
│     Root cause: Font application skipped or overridden
│     └─ Diagnose further:
│        ├─ Is element in data-cloak-exclude?
│        │  → Console: element.closest('[data-cloak-exclude]')
│        │  → If true: Font intentionally not applied
│        │
│        ├─ Does element have !important font-family rule?
│        │  → DevTools → Computed → font-family → click arrow to see source
│        │  → If CSS has !important: CSS override issue
│        │  → Fix: SDK needs to use !important or higher specificity
│        │
│        ├─ Is element dynamically added after SDK init?
│        │  → Check if element was added by JavaScript after encryption
│        │  → If true: MutationObserver should catch it
│        │  → Debug: Check Console for mutation observer messages
│        │
│        └─ Check STEP 3.5 in cloak-sdk.js (lines 1416-1463)
│           → This applies fonts to elements using generic font families
│           → If element uses generic family (serif/sans-serif/monospace),
│              font should be applied here
│           → Debug: Add console.log in this section to verify execution
│
└─ Check 4: Is there a CSS text-transform on this element?
   ├─ How to check:
   │  1. DevTools → Elements → select element
   │  2. Computed tab → find text-transform
   │  3. Is it set to anything other than "none"?
   │
   ├─ NO (text-transform: none) → Root cause unclear, investigate further:
   │  └─ Check font glyph mapping
   │     - Verify encrypted font has correct character mappings
   │     - Check if character substitution mapping is correct
   │     - Inspect font files for missing glyphs
   │
   └─ YES (text-transform: uppercase/lowercase/capitalize) →
      Root cause: text-transform mismatch
      └─ Fix:
         - SDK should reset text-transform to 'none' after encryption (line 371)
         - Check if parent._cloakTextTransformReset is set
         - Verify: window.getComputedStyle(element.parentElement).textTransform
         - If still not 'none', manually set: element.style.textTransform = 'none'
```

---

## Symptom: FAQ Section Gibberish (Specific Known Issue)

**Reference:** `.planning/debug/faq-gibberish-after-font-display-fix.md`

**Status:** INCONCLUSIVE - Requires runtime debugging

**Symptoms:**
- FAQ heading shows "Freqfkntly Asked Qfkstions" instead of "Frequently Asked Questions"
- Plaintext is rendered with encrypted font glyphs
- No obvious exclusion mechanism found in code

**Diagnostic Approach:**

### Step 1: Verify element state
```javascript
// In DevTools Console, after page loads:
const faqHeading = document.querySelector('h2'); // Or more specific selector
console.log('Text content:', faqHeading.textContent);
console.log('Is encrypted:', faqHeading.firstChild._cloakEncrypted);
console.log('Original text:', faqHeading.firstChild._cloakOriginal);
console.log('Font family:', window.getComputedStyle(faqHeading).fontFamily);
console.log('Excluded?:', faqHeading.closest('[data-cloak-exclude]'));
```

**Expected results:**
- If `_cloakEncrypted = undefined`: Text was NOT encrypted (root cause)
- If `_cloakEncrypted = true`: Text WAS encrypted, but something reverted it

### Step 2: Check exclusion logic
```javascript
// Check if SDK should exclude this element
function debugExclusion(element) {
    const tagName = element.tagName.toLowerCase();
    console.log('Tag:', tagName);
    console.log('In excludeSelectors?:', CloakSDK?.config?.excludeSelectors?.includes(tagName));
    console.log('Has data-cloak-exclude?:', element.hasAttribute('data-cloak-exclude'));
    console.log('Has excluded attribute?:',
        Array.from(element.attributes).some(a =>
            ['hidden', 'aria-hidden'].includes(a.name)
        )
    );
}

debugExclusion(faqHeading);
```

### Step 3: Trace SDK execution
```javascript
// Before page load, modify cloak-sdk.js to add debug logging:
// In getTextNodes() function (line 270):
//   console.log('[DEBUG] getTextNodes found:', textNodes.length, 'nodes');
//   console.log('[DEBUG] Sample nodes:', textNodes.slice(0, 5).map(n => ({
//       text: n.textContent.slice(0, 30),
//       parent: n.parentElement.tagName
//   })));
//
// In encryptTextNode() function (line 332):
//   console.log('[DEBUG] Encrypting:', textNode.textContent.slice(0, 30),
//               'parent:', textNode.parentElement.tagName);
```

### Step 4: Alternative hypothesis - Timing issue
```javascript
// Check if FAQ text node exists during SDK initialization
// Add to cloak-sdk.js after line 1810:
const faqText = Array.from(document.querySelectorAll('h2'))
    .find(h2 => h2.textContent.includes('Frequently'));
console.log('[DEBUG] FAQ element during init:', faqText);
console.log('[DEBUG] FAQ text node:', faqText?.firstChild);
```

**Workaround (if debugging doesn't resolve):**
```javascript
// Explicitly encrypt FAQ section after SDK init
window.addEventListener('cloakInitialized', () => {
    const faqHeading = document.querySelector('h2'); // Adjust selector
    if (faqHeading && !faqHeading.firstChild._cloakEncrypted) {
        console.log('[WORKAROUND] Manually encrypting FAQ');
        CloakSDK.encryptElement(faqHeading);
    }
});
```

---

## Known Root Causes

| Root Cause | Symptoms | Verification | Fix | Code Location |
|------------|----------|--------------|-----|---------------|
| **Font not loaded** | All text appears as gibberish | Network tab shows 404/CORS errors for font files | Check R2 storage, CORS headers, font URL validity | N/A (server config) |
| **Font not applied** | Some text gibberish, some readable | Computed style shows system font instead of encrypted font | Check exclusion logic, CSS specificity, !important rules | `cloak-sdk.js:1416-1463` (STEP 3.5) |
| **Text not encrypted** | Plaintext with encrypted font = gibberish | `_cloakEncrypted = undefined` on text node | Check shouldExcludeNode, verify SDK init completed | `cloak-sdk.js:136-242` (shouldExcludeNode) |
| **text-transform not reset** | Uppercase text appears garbled | Computed shows `text-transform: uppercase` etc. | Manual `element.style.textTransform = 'none'` | `cloak-sdk.js:370-373` |
| **Dynamic content not encrypted** | New content appears gibberish after load | Content added after SDK init, `_cloakEncrypted = undefined` | Check MutationObserver setup, verify observer is active | `cloak-sdk.js:640-720` (MutationObserver) |
| **Highlight interference** | Text gibberish after using Ctrl+F search | Search `<mark>` elements interfere with font application | Verify `encrypted-search-highlight` class is excluded | `cloak-sdk.js:163` (exclusion check) |
| **Font glyph mapping** | Specific characters appear wrong | Some characters render correctly, others don't | Check encryption mapping, verify font has all glyphs | Server-side mapping generation |

---

## Diagnostic Code Snippets

### Check if text node is encrypted

```javascript
// Find a text node by its content
const textNode = document.evaluate(
    '//text()[contains(., "yourtext")]',
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
).singleNodeValue;

if (textNode) {
    console.log('Encrypted:', textNode._cloakEncrypted);
    console.log('Original:', textNode._cloakOriginal);
    console.log('Current text:', textNode.textContent);
    console.log('Parent element:', textNode.parentElement.tagName);
    console.log('Parent font:', window.getComputedStyle(textNode.parentElement).fontFamily);
} else {
    console.log('Text node not found');
}
```

### List all unencrypted visible text nodes

```javascript
// Find text nodes that SHOULD be encrypted but aren't
const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT
);

const unencrypted = [];
let node;
while (node = walker.nextNode()) {
    // Skip excluded elements
    if (node.parentElement?.closest('[data-cloak-exclude]')) continue;
    if (node.parentElement?.closest('script, style, noscript')) continue;

    // Check if text is visible and not encrypted
    const text = node.textContent.trim();
    if (text && !node._cloakEncrypted) {
        unencrypted.push({
            text: text.slice(0, 50),
            parent: node.parentElement.tagName,
            classes: node.parentElement.className,
            excluded: node.parentElement.closest('[data-cloak-exclude]') !== null
        });
    }
}

console.table(unencrypted);
console.log(`Found ${unencrypted.length} unencrypted text nodes`);
```

### Check font loading status

```javascript
// Verify which fonts are loaded
document.fonts.ready.then(() => {
    const loadedFonts = [];
    document.fonts.forEach(font => {
        loadedFonts.push({
            family: font.family,
            weight: font.weight,
            style: font.style,
            status: font.status
        });
    });
    console.table(loadedFonts);
});
```

### Check exclusion configuration

```javascript
// Inspect SDK exclusion config
console.log('Exclude selectors:', CloakSDK?.config?.excludeSelectors);
console.log('Exclude attributes:', CloakSDK?.config?.excludeAttributes);

// Test if specific element would be excluded
function wouldBeExcluded(element) {
    const tagName = element.tagName.toLowerCase();
    const selectors = CloakSDK?.config?.excludeSelectors || [];

    // Check tag name
    if (selectors.includes(tagName)) return 'Tag in excludeSelectors';

    // Check data-cloak-exclude
    if (element.closest('[data-cloak-exclude]')) return 'Has data-cloak-exclude';

    // Check excluded attributes
    const attrs = CloakSDK?.config?.excludeAttributes || [];
    for (const attr of attrs) {
        if (element.hasAttribute(attr)) return `Has attribute: ${attr}`;
    }

    // Check custom selectors
    const customSelectors = selectors.filter(s =>
        s.includes('.') || s.includes('#') || s.includes('[')
    );
    for (const selector of customSelectors) {
        try {
            if (element.matches(selector)) return `Matches: ${selector}`;
        } catch (e) {
            // Invalid selector
        }
    }

    return 'NOT excluded';
}

// Test on FAQ heading
const faqHeading = document.querySelector('h2');
console.log('FAQ exclusion status:', wouldBeExcluded(faqHeading));
```

---

## Prevention Checklist

- [ ] Verify SDK initialization completes successfully
- [ ] Check Network tab for font loading (all 200 OK)
- [ ] Verify no CORS errors in Console
- [ ] Test with `config.debug = true` for detailed logging
- [ ] Check that `data-cloak-exclude` is only on intended elements
- [ ] Verify `excludeSelectors` doesn't accidentally include content elements
- [ ] Test dynamic content addition (AJAX, user interactions)
- [ ] Verify MutationObserver is active and catching changes
- [ ] Test with search functionality (Ctrl+F) to verify highlight handling
- [ ] Check that CSS text-transform is reset on encrypted elements

---

## Related Documentation

- **Encryption Flow:** See `.planning/phases/02-architecture-documentation-and-verification-document-complet/flows/encryption-flow.md`
- **Position Mapping:** See `.planning/phases/02-architecture-documentation-and-verification-document-complet/verification/position-mapping-comparison.md`
- **FAQ Debug Session:** See `.planning/debug/faq-gibberish-after-font-display-fix.md`

---

**Last Updated:** 2026-01-24
**Status:** Active troubleshooting guide
