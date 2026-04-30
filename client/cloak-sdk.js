/**
 * Cloak SDK - Client-side text encryption
 *
 * Usage:
 * <script src="https://api.cloaktext.com/sdk.js" data-api-key="your_api_key"></script>
 *
 * Or programmatically:
 * CloakSDK.init({ apiKey: 'your_api_key' });
 *
 * =============================================================================
 * SECURITY NOTES & KNOWN LIMITATIONS
 * =============================================================================
 *
 * THREAT MODEL:
 * This SDK protects against non-JavaScript scrapers (bots that parse HTML without
 * executing JS). The encrypted text in the DOM is gibberish without the custom font.
 * It does NOT protect against:
 * - Attackers who can execute JavaScript on the page
 * - Screenshots or screen recording
 * - Manual copy-paste by legitimate users (intentionally allowed)
 *
 * KNOWN EXPOSURES:
 *
 * 1. /api/search/get-text-range Endpoint
 *    - This API returns plaintext for a given character range
 *    - An attacker can call: POST /api/search/get-text-range { start: 0, end: 999999 }
 *      to retrieve the entire plaintext in one request
 *    - WHY IT EXISTS: Required for copy-paste functionality. When users copy text,
 *      we need to return the original plaintext, not encrypted characters.
 *    - FUTURE FIX OPTIONS:
 *      a) Rate limiting per session/IP
 *      b) Maximum range limit (e.g., 1000 chars per request)
 *      c) Session-based quotas (track total chars retrieved)
 *      d) Require proof of user interaction (e.g., selection events)
 *
 * 2. Character Mappings in Memory
 *    - The characterMappings object contains the encryption lookup table
 *    - JS can inspect window.CloakSDK or closure variables via debugger
 *    - This is inherent to any client-side encryption scheme
 *
 * BOTTOM LINE:
 * If an attacker can run arbitrary JavaScript on your page, they can extract
 * the plaintext. The value of Cloak is defeating automated non-JS scrapers
 * and making casual extraction more difficult.
 * =============================================================================
 */

(function(window, document) {
    'use strict';

    const SDK_VERSION = '1.0.0';

    // Default configuration
    const DEFAULT_CONFIG = {
        apiBaseUrl: 'http://localhost:8001',
        debug: false,
        excludeSelectors: [
            'script', 'style', 'noscript', 'meta', 'link', 'head',
            'svg', 'path',  // SVG elements
            'textarea', 'input', 'select', 'option', 'optgroup', 'button'  // Form elements
        ],
        excludeAttributes: ['hidden', 'aria-hidden'],
        batchDelay: 0, // ms - batch DOM mutations (0 = next tick, eliminates FOUT while maintaining batching)
        fontDisplay: 'block',
        matchFonts: true,  // Try to match page fonts (requires server support)
        fontLoadTimeout: 10000  // ms - timeout for font loading (10 seconds)
    };

    // SDK State
    let config = { ...DEFAULT_CONFIG };
    let isInitialized = false;
    let encryptionConfig = null; // { secretKey, nonce, hash, fontUrl }
    let characterMappings = null; // { upper: {}, lower: {}, space: {} }
    let pendingNodes = new Set();
    let batchTimeout = null;
    let observer = null;
    let shadowObservers = new Map(); // Track MutationObservers for shadow roots
    let plaintextIndex = []; // Array of { node, start, end, originalText }
    let totalCharacters = 0;
    let isEncrypting = false; // Flag to prevent re-encryption loops
    let encryptedTextCache = new Map(); // Map of encrypted text -> original plaintext (for framework re-renders)

    // WeakMap storage for plaintext (secure alternative to DOM properties)
    // Stores original plaintext for encrypted nodes, needed for dynamic content and server upload
    // WeakMap is ideal because:
    // 1. Not accessible via DOM traversal (more secure than node._cloakOriginal)
    // 2. Doesn't prevent garbage collection of removed nodes
    const plaintextStorage = new WeakMap();

    // ========================================
    // Encryption Logic (uses server-provided mappings)
    // ========================================

    /**
     * Encrypt a single character using server-provided mappings
     */
    function encryptChar(char) {
        if (!characterMappings) return char;

        // CRITICAL: Do NOT encrypt ANY whitespace (space, tab, newline, etc.)
        // The browser's whitespace handling must work normally:
        // - Multiple spaces collapse to one
        // - Newlines become spaces (in normal flow)
        // - Line wrapping works at word boundaries
        // If we encrypt spaces to visible characters, all this breaks.
        // The space character in the font is NOT swapped, so regular spaces render correctly.
        if (/\s/.test(char)) {
            return char;
        }

        // Use the flat mapping from server for letters
        if (characterMappings[char]) return characterMappings[char];

        return char; // Numbers, punctuation, etc. pass through
    }

    /**
     * Encrypt a string
     */
    function encryptText(text) {
        if (!characterMappings) return text;
        return text.split('').map(encryptChar).join('');
    }

    /**
     * Decrypt all encrypted nodes back to plaintext (used when fonts fail to load)
     * Walks the DOM tree and restores original plaintext from WeakMap storage
     */
    function decryptAllNodes() {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null
        );

        let decryptedCount = 0;
        const nodes = [];

        // Collect all text nodes first (modifying during walk can cause issues)
        let node;
        while ((node = walker.nextNode())) {
            if (node._cloakEncrypted && plaintextStorage.has(node)) {
                nodes.push(node);
            }
        }

        // Restore plaintext to all encrypted nodes
        for (const textNode of nodes) {
            const originalText = plaintextStorage.get(textNode);
            textNode.nodeValue = originalText;
            // Keep _cloakEncrypted marker and WeakMap entry for consistency
            // (in case fonts load later or page is still functional)
            decryptedCount++;
        }

        if (config.debug) {
            console.log(`[Cloak] Decrypted ${decryptedCount} nodes back to plaintext`);
        }

        return decryptedCount;
    }

    // ========================================
    // DOM Manipulation
    // ========================================

    /**
     * Check if a node should be excluded from encryption
     */
    function shouldExcludeNode(node) {
        if (!node) return true;

        // For text nodes, check parent element and ancestors
        if (node.nodeType === Node.TEXT_NODE) {
            // CRITICAL: Check for incompatible CSS properties first
            // Properties like -webkit-text-security or writing-mode make encryption impossible
            const textProps = getTextAffectingProperties(node);
            if (textProps.shouldExclude) {
                return true;
            }

            let element = node.parentElement;
            while (element) {
                // Check tag name
                const tagName = element.tagName.toLowerCase();
                if (config.excludeSelectors.includes(tagName)) return true;

                // Check for contenteditable (WYSIWYG editors, editable regions)
                if (element.isContentEditable || element.getAttribute('contenteditable') === 'true' || element.getAttribute('contenteditable') === '') {
                    return true;
                }

                // Check excluded attributes
                for (const attr of config.excludeAttributes) {
                    if (element.hasAttribute(attr)) return true;
                }

                // Check for data-cloak-exclude attribute
                if (element.hasAttribute('data-cloak-exclude')) {
                    return true;
                }

                // Check for data-nosnippet attribute (MUST MATCH decrypt-interceptor.js)
                if (element.hasAttribute('data-nosnippet')) return true;

                // CRITICAL: Exclude search highlight elements to prevent double-encryption
                // When decrypt-interceptor creates <mark> elements for Ctrl+F highlighting,
                // we must NOT re-encrypt the text inside them
                if (element.classList && element.classList.contains('encrypted-search-highlight')) return true;

                // CRITICAL: Exclude the search overlay UI entirely
                if (element.id === 'encrypted-search-overlay') return true;

                // Check if element matches any custom exclude selector from config
                // Filter to only CSS selectors (not tag names which are handled separately)
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

                element = element.parentElement;
            }
            return false;
        }

        // Check tag name for elements
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            if (config.excludeSelectors.includes(tagName)) return true;

            // Check attributes
            for (const attr of config.excludeAttributes) {
                if (node.hasAttribute(attr)) return true;
            }

            // Check for data-cloak-exclude attribute
            if (node.hasAttribute('data-cloak-exclude')) return true;

            // Check for data-nosnippet attribute (MUST MATCH decrypt-interceptor.js)
            if (node.hasAttribute('data-nosnippet')) return true;

            // CRITICAL: Exclude search highlight elements to prevent double-encryption
            if (node.classList && node.classList.contains('encrypted-search-highlight')) return true;

            // CRITICAL: Exclude the search overlay UI entirely
            if (node.id === 'encrypted-search-overlay') return true;

            // Check if inside excluded element
            let parent = node.parentElement;
            while (parent) {
                const parentTag = parent.tagName.toLowerCase();
                if (config.excludeSelectors.includes(parentTag)) return true;
                for (const attr of config.excludeAttributes) {
                    if (parent.hasAttribute(attr)) return true;
                }
                // Check for data-cloak-exclude attribute on parents
                if (parent.hasAttribute('data-cloak-exclude')) return true;
                // Check for data-nosnippet attribute on parents (MUST MATCH decrypt-interceptor.js)
                if (parent.hasAttribute('data-nosnippet')) return true;
                // CRITICAL: Exclude search highlight elements to prevent double-encryption
                if (parent.classList && parent.classList.contains('encrypted-search-highlight')) return true;
                // CRITICAL: Exclude the search overlay UI entirely
                if (parent.id === 'encrypted-search-overlay') return true;

                // Check if parent matches any custom exclude selector from config
                const customSelectors = config.excludeSelectors.filter(s =>
                    s.includes('.') || s.includes('#') || s.includes('[')
                );
                for (const selector of customSelectors) {
                    try {
                        if (parent.matches(selector)) return true;
                    } catch (e) {
                        // Invalid selector, skip
                    }
                }

                parent = parent.parentElement;
            }
        }

        return false;
    }

    // Block elements for position mapping (must match decrypt-interceptor.js)
    const BLOCK_ELEMENTS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                            'LI', 'OL', 'UL', 'BLOCKQUOTE', 'PRE', 'SECTION',
                            'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE',
                            'TABLE', 'TR', 'TD', 'TH', 'THEAD', 'TBODY', 'TFOOT',
                            'DL', 'DT', 'DD', 'FORM', 'FIELDSET', 'LEGEND',
                            'ADDRESS', 'HR', 'FIGURE', 'FIGCAPTION', 'MAIN', 'BODY'];

    /**
     * Find the nearest block element ancestor of a node.
     * Must match decrypt-interceptor.js logic exactly.
     * Skips over <mark> highlight elements as they are not structural blocks.
     */
    function getContainingBlock(node) {
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        while (current && current !== document.body) {
            // Skip over <mark> elements - they're not structural blocks
            if (current.tagName === 'MARK' && current.classList.contains('encrypted-search-highlight')) {
                current = current.parentElement;
                continue;
            }
            if (BLOCK_ELEMENTS.includes(current.tagName)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    // Track last block for newline insertion between blocks
    let lastBlock = null;

    /**
     * Get all text nodes under an element, including shadow DOM
     */
    function getTextNodes(element) {
        const textNodes = [];
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    const excluded = shouldExcludeNode(node);
                    if (excluded) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // Strip zero-width spaces FIRST, then check trim
                    // MUST MATCH decrypt-interceptor logic
                    const text = node.textContent.replace(/\u200B/g, '');
                    if (text.length === 0 || !text.trim()) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }

        // CRITICAL: Traverse shadow roots to encrypt text inside web components
        // Shadow DOM creates encapsulated DOM trees that TreeWalker doesn't enter
        // Must recursively collect text nodes from all shadow roots
        const elementsWithShadow = [];
        const elementWalker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_ELEMENT,
            null
        );

        let elem;
        while (elem = elementWalker.nextNode()) {
            if (elem.shadowRoot) {
                elementsWithShadow.push(elem);
            }
        }

        // Also check the root element itself
        if (element.shadowRoot) {
            elementsWithShadow.push(element);
        }

        // Recursively get text nodes from each shadow root
        for (const elem of elementsWithShadow) {
            try {
                // Only accessible for 'open' shadow roots
                // 'closed' shadow roots will have shadowRoot === null
                const shadowNodes = getTextNodes(elem.shadowRoot);
                textNodes.push(...shadowNodes);
            } catch (e) {
                // Shadow root not accessible (closed mode), skip gracefully
                if (config.debug) {
                    console.warn('[Cloak] Could not access shadow root:', e);
                }
            }
        }

        return textNodes;
    }

    /**
     * Get the effective text-transform CSS property for a text node's parent
     * Returns 'uppercase', 'lowercase', 'capitalize', or 'none'
     */
    function getTextTransform(textNode) {
        const parent = textNode.parentElement;
        if (!parent) return 'none';
        const style = window.getComputedStyle(parent);
        return style.textTransform || 'none';
    }

    /**
     * Apply CSS text-transform to a string
     * This ensures we encrypt the text as it will be DISPLAYED, not as it is in source
     */
    function applyTextTransform(text, transform) {
        switch (transform) {
            case 'uppercase':
                return text.toUpperCase();
            case 'lowercase':
                return text.toLowerCase();
            case 'capitalize':
                // Capitalize first letter of each word
                return text.replace(/\b\w/g, char => char.toUpperCase());
            default:
                return text;
        }
    }

    /**
     * Apply font-variant-caps transformation to text
     * Handles small-caps and related CSS properties that change case presentation
     */
    function applyFontVariantCaps(text, capsValue) {
        switch (capsValue) {
            case 'small-caps':
                // Lowercase letters become small capitals (uppercase in our approximation)
                // Uppercase letters stay uppercase
                return text.toUpperCase();
            case 'all-small-caps':
                // All letters become small capitals
                return text.toUpperCase();
            case 'petite-caps':
            case 'all-petite-caps':
                // Petite caps are smaller than small caps but function similarly
                return text.toUpperCase();
            case 'unicase':
                // Mixed case that looks uniform - approximate as uppercase
                return text.toUpperCase();
            case 'titling-caps':
                // Capital letters designed for titles
                return text.toUpperCase();
            default:
                return text;
        }
    }

    /**
     * Comprehensive check for CSS properties that affect text rendering
     *
     * STRATEGY:
     * CSS properties are categorized into three groups:
     *
     * 1. COMPENSATE: Properties that predictably transform text
     *    - text-transform: uppercase, lowercase, capitalize
     *    - font-variant-caps: small-caps, all-small-caps, etc.
     *    - font-feature-settings: smcp, c2sc (OpenType small caps)
     *    Action: Apply transformation BEFORE encryption, reset property AFTER
     *    Result: Encrypted text displays correctly without gibberish
     *
     * 2. EXCLUDE: Properties that make encryption impossible/meaningless
     *    - -webkit-text-security: disc, circle, square (password masking)
     *    - writing-mode: vertical-rl, vertical-lr (vertical text)
     *    - text-orientation: affects vertical text rendering
     *    Action: Return shouldExclude=true to skip encryption
     *    Result: Text remains in plaintext (better than gibberish)
     *
     * 3. MONITOR: Properties that might cause issues but aren't handled yet
     *    - text-rendering: optimizeLegibility (ligatures)
     *    - font-variant-ligatures: common, discretionary, etc.
     *    - Custom @font-face with unicode-range remapping
     *    Action: Let through for now, monitor for issues
     *    Result: May cause visual artifacts, but unlikely to be complete gibberish
     *
     * Returns { shouldExclude, transforms, propertiesToReset } where:
     * - shouldExclude: true if element should not be encrypted (incompatible properties)
     * - transforms: array of {property, value, apply} objects for compensatable properties
     * - propertiesToReset: array of {name, value} to reset on parent element after encryption
     */
    function getTextAffectingProperties(textNode) {
        const parent = textNode.parentElement;
        if (!parent) return { shouldExclude: false, transforms: [] };

        const style = window.getComputedStyle(parent);
        const result = {
            shouldExclude: false,
            transforms: [],
            propertiesToReset: []
        };

        // 1. Check for INCOMPATIBLE properties that require exclusion

        // -webkit-text-security: password masking (disc, circle, square)
        const textSecurity = style.webkitTextSecurity || style.getPropertyValue('-webkit-text-security');
        if (textSecurity && textSecurity !== 'none') {
            if (config.debug) {
                console.log('[Cloak] Excluding node: -webkit-text-security detected:', textSecurity);
            }
            result.shouldExclude = true;
            return result;
        }

        // writing-mode: vertical text changes orientation
        const writingMode = style.writingMode;
        if (writingMode && writingMode.startsWith('vertical') || writingMode.startsWith('sideways')) {
            if (config.debug) {
                console.log('[Cloak] Excluding node: writing-mode detected:', writingMode);
            }
            result.shouldExclude = true;
            return result;
        }

        // text-orientation: affects vertical text rendering
        const textOrientation = style.textOrientation;
        if (textOrientation && textOrientation !== 'mixed' && (writingMode && writingMode !== 'horizontal-tb')) {
            if (config.debug) {
                console.log('[Cloak] Excluding node: text-orientation detected:', textOrientation);
            }
            result.shouldExclude = true;
            return result;
        }

        // 2. Collect COMPENSATABLE properties and their transforms

        // text-transform (already handled, but include in comprehensive approach)
        const textTransform = style.textTransform;
        if (textTransform && textTransform !== 'none') {
            result.transforms.push({
                property: 'text-transform',
                value: textTransform,
                apply: (text) => applyTextTransform(text, textTransform)
            });
            result.propertiesToReset.push({ name: 'text-transform', value: 'none' });
        }

        // font-variant-caps: small-caps and variants
        const fontVariantCaps = style.fontVariantCaps;
        if (fontVariantCaps && fontVariantCaps !== 'normal') {
            result.transforms.push({
                property: 'font-variant-caps',
                value: fontVariantCaps,
                apply: (text) => applyFontVariantCaps(text, fontVariantCaps)
            });
            result.propertiesToReset.push({ name: 'font-variant-caps', value: 'normal' });
        }

        // font-variant shorthand (check for small-caps)
        const fontVariant = style.fontVariant;
        if (fontVariant && fontVariant.includes('small-caps')) {
            // Only add if we haven't already detected font-variant-caps
            const hasCapTransform = result.transforms.some(t => t.property === 'font-variant-caps');
            if (!hasCapTransform) {
                result.transforms.push({
                    property: 'font-variant',
                    value: fontVariant,
                    apply: (text) => applyFontVariantCaps(text, 'small-caps')
                });
                result.propertiesToReset.push({ name: 'font-variant', value: 'normal' });
            }
        }

        // 3. Check for RISKY properties that might cause issues

        // font-feature-settings: OpenType features (smcp, c2sc, etc.)
        const fontFeatureSettings = style.fontFeatureSettings;
        if (fontFeatureSettings && fontFeatureSettings !== 'normal') {
            // Check for small caps features
            if (fontFeatureSettings.includes('smcp') || fontFeatureSettings.includes('c2sc')) {
                // Small caps via OpenType - treat similar to font-variant-caps
                const hasCapTransform = result.transforms.some(t =>
                    t.property === 'font-variant-caps' || t.property === 'font-variant'
                );
                if (!hasCapTransform) {
                    result.transforms.push({
                        property: 'font-feature-settings',
                        value: fontFeatureSettings,
                        apply: (text) => applyFontVariantCaps(text, 'small-caps')
                    });
                }
                result.propertiesToReset.push({ name: 'font-feature-settings', value: 'normal' });
            }
            // Note: Other OpenType features (ligatures, alternates) are harder to compensate
            // They may cause visual artifacts, but won't make text completely unreadable
            // We'll let them through and monitor for issues
        }

        return result;
    }

    /**
     * Encrypt a text node and track its position
     * Position tracking matches decrypt-interceptor.js logic exactly:
     * - Block boundaries insert \n markers (add 1 to position count)
     * - Zero-width spaces are stripped
     */
    function encryptTextNode(textNode) {
        if (textNode._cloakEncrypted) return; // Already encrypted

        // Use nodeValue for text nodes (more direct than textContent)
        const originalText = textNode.nodeValue;
        if (!originalText) return;

        // PROTECTION: Check if this text is already encrypted (framework re-render scenario)
        // When React/Vue/Angular re-render, they create new DOM nodes with innerHTML replacement.
        // The new nodes have our encrypted text but lack the _cloakEncrypted marker.
        // Detect this by checking if the text matches something we've already encrypted.
        if (encryptedTextCache.has(originalText)) {
            // This text is already encrypted - we know the original plaintext from our cache
            const cachedPlaintext = encryptedTextCache.get(originalText);
            textNode._cloakEncrypted = true;

            // Restore the plaintext to WeakMap storage (for copy-paste functionality)
            plaintextStorage.set(textNode, cachedPlaintext);

            // Note: We don't add to plaintextIndex because:
            // 1. The node will be in a different DOM position than the original
            // 2. Position tracking (start/end) would be incorrect without re-scanning the whole DOM
            // 3. Copy-paste still works via plaintextStorage
            // If position accuracy is critical, the app should avoid framework re-renders during encryption

            if (config.debug) {
                console.log('[Cloak] Skipped double-encryption (framework re-render detected):', originalText.substring(0, 50));
            }
            return;
        }

        // Strip zero-width spaces FIRST to match decrypt-interceptor behavior
        const cleanText = originalText.replace(/\u200B/g, '');

        // Skip empty or whitespace-only text nodes AFTER stripping zero-width spaces
        // MUST MATCH decrypt-interceptor: if (text.length === 0 || !text.trim())
        if (cleanText.length === 0 || !cleanText.trim()) return;

        // Check for block boundary - add 1 for \n marker (matches decrypt-interceptor)
        const currentBlock = getContainingBlock(textNode);
        // Only add newline if both blocks are valid and different
        // MUST MATCH decrypt-interceptor: if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock)
        if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
            totalCharacters += 1; // Count the \n marker between blocks
        }
        if (currentBlock !== null) {
            lastBlock = currentBlock;
        }

        // CRITICAL: Check for ALL CSS properties that affect text rendering
        // This includes text-transform, font-variant-caps, font-feature-settings, etc.
        // We need to:
        // 1. Apply all transforms to get the DISPLAYED text (not source text)
        // 2. Reset those CSS properties to prevent re-transformation of encrypted text
        const textProps = getTextAffectingProperties(textNode);
        let textToEncrypt = originalText;

        // Apply all transforms in sequence
        if (textProps.transforms.length > 0) {
            for (const transform of textProps.transforms) {
                textToEncrypt = transform.apply(textToEncrypt);
            }

            // Reset CSS properties on parent element to prevent re-transformation
            const parent = textNode.parentElement;
            if (parent && !parent._cloakPropertiesReset) {
                for (const prop of textProps.propertiesToReset) {
                    // Use setProperty with 'important' to override even !important CSS rules
                    parent.style.setProperty(prop.name, prop.value, 'important');
                }
                parent._cloakPropertiesReset = true;

                if (config.debug) {
                    const propsDesc = textProps.transforms.map(t => `${t.property}: ${t.value}`).join(', ');
                    console.log(`[Cloak] Reset CSS properties on ${parent.tagName}.${parent.className}: ${propsDesc}`);
                }
            }
        }

        // Encrypt the transformed text
        const encryptedText = encryptText(textToEncrypt);

        // Track for plaintext index - use the TRANSFORMED text for position tracking
        // since that's what the user sees and will select/copy
        let transformedCleanText = cleanText;
        for (const transform of textProps.transforms) {
            transformedCleanText = transform.apply(transformedCleanText);
        }
        const startPos = totalCharacters;
        totalCharacters += transformedCleanText.length;

        plaintextIndex.push({
            node: textNode,
            start: startPos,
            end: totalCharacters,
            originalText: transformedCleanText, // Store transformed clean text
            hasBlockBoundaryBefore: lastBlock !== null && currentBlock !== lastBlock
        });

        // Replace text content with encrypted version
        // CRITICAL: Use nodeValue instead of textContent to ensure we modify in-place
        // textContent on a node replaces children, nodeValue modifies the text node directly
        const beforeNodeValue = textNode.nodeValue;
        textNode.nodeValue = encryptedText;
        textNode._cloakEncrypted = true;

        // Store plaintext in WeakMap (not as DOM property for security)
        // WeakMap is not accessible via DOM traversal, making extraction harder
        plaintextStorage.set(textNode, textToEncrypt);

        // Cache encrypted text -> original plaintext mapping to detect framework re-renders
        // This prevents double-encryption when frameworks create new DOM nodes with our encrypted content
        encryptedTextCache.set(encryptedText, textToEncrypt);

        // DIAGNOSTIC: Verify property was set

    }

    /**
     * Process pending nodes in batch
     */
    function processPendingNodes() {
        if (pendingNodes.size === 0) return;
        if (isEncrypting) return; // Prevent re-entry

        isEncrypting = true; // Set flag before modifying DOM

        const nodes = Array.from(pendingNodes);
        pendingNodes.clear();

        // CRITICAL: Reset lastBlock before processing new batch
        // The decrypt-interceptor always starts fresh when building position map
        // If we don't reset, positions will be off for dynamically added content
        lastBlock = null;

        for (const node of nodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                encryptTextNode(node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const textNodes = getTextNodes(node);
                textNodes.forEach(encryptTextNode);
            }
        }

        isEncrypting = false; // Clear flag after done

        // Report usage
        reportUsage();

        // Reset upload flags so new content triggers re-upload
        // The server will replace the stored plaintext with the updated version
        plaintextUploaded = false;
        plaintextUploadPromise = null;

        // Upload updated plaintext to server for search/copy
        uploadPlaintextToServer();
    }

    /**
     * Schedule batch processing
     */
    function scheduleBatch() {
        if (batchTimeout) return;
        batchTimeout = setTimeout(() => {
            batchTimeout = null;
            processPendingNodes();
        }, config.batchDelay);
    }

    /**
     * Queue a node for encryption
     */
    function queueNode(node) {
        pendingNodes.add(node);
        scheduleBatch();
    }

    // ========================================
    // MutationObserver
    // ========================================

    /**
     * Start observing DOM mutations
     */
    function startObserver() {
        if (observer) return;

        observer = new MutationObserver((mutations) => {
            // Ignore mutations caused by our own encryption
            if (isEncrypting) return;

            for (const mutation of mutations) {
                // Handle added nodes
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (shouldExcludeNode(node)) continue;
                        // Skip nodes we already encrypted
                        if (node._cloakEncrypted) continue;

                        queueNode(node);

                        // CRITICAL: Check if new node has shadow root or contains elements with shadow roots
                        // Must set up observers for dynamically created web components
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.shadowRoot) {
                                observeShadowRoot(node.shadowRoot);
                            }
                            // Check descendants for shadow roots
                            discoverAndObserveShadowRoots(node);
                        }
                    }
                }

                // Handle text content changes (for truly external changes)
                if (mutation.type === 'characterData') {
                    const node = mutation.target;
                    if (shouldExcludeNode(node)) continue;
                    // Only re-encrypt if content changed externally (not by us)
                    if (node._cloakEncrypted) continue;

                    queueNode(node);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });

        // CRITICAL: Discover and observe all existing shadow roots
        discoverAndObserveShadowRoots(document.body);

        if (config.debug) {
            console.log('[Cloak] MutationObserver started');
        }
    }

    /**
     * Stop observing DOM mutations
     */
    function stopObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        // Also disconnect all shadow root observers
        for (const shadowObserver of shadowObservers.values()) {
            shadowObserver.disconnect();
        }
        shadowObservers.clear();
    }

    /**
     * Set up MutationObserver for a shadow root
     * Shadow DOM mutations don't bubble to parent observers, so each shadow root needs its own
     */
    function observeShadowRoot(shadowRoot) {
        // Don't observe the same shadow root twice
        if (shadowObservers.has(shadowRoot)) return;

        const shadowObserver = new MutationObserver((mutations) => {
            // Ignore mutations caused by our own encryption
            if (isEncrypting) return;

            for (const mutation of mutations) {
                // Handle added nodes
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (shouldExcludeNode(node)) continue;
                        if (node._cloakEncrypted) continue;
                        queueNode(node);
                    }
                }

                // Handle text content changes
                if (mutation.type === 'characterData') {
                    const node = mutation.target;
                    if (shouldExcludeNode(node)) continue;
                    if (node._cloakEncrypted) continue;
                    queueNode(node);
                }
            }
        });

        shadowObserver.observe(shadowRoot, {
            childList: true,
            subtree: true,
            characterData: true
        });

        shadowObservers.set(shadowRoot, shadowObserver);

        if (config.debug) {
            console.log('[Cloak] Observing shadow root');
        }
    }

    /**
     * Discover and observe all shadow roots in the DOM
     * Called during initialization and when new elements are added
     */
    function discoverAndObserveShadowRoots(rootElement = document.body) {
        const walker = document.createTreeWalker(
            rootElement,
            NodeFilter.SHOW_ELEMENT,
            null
        );

        let elem;
        while (elem = walker.nextNode()) {
            if (elem.shadowRoot && !shadowObservers.has(elem.shadowRoot)) {
                observeShadowRoot(elem.shadowRoot);
            }
        }

        // Check root element itself
        if (rootElement.shadowRoot && !shadowObservers.has(rootElement.shadowRoot)) {
            observeShadowRoot(rootElement.shadowRoot);
        }
    }

    // ========================================
    // Font Detection & Loading
    // ========================================

    /**
     * Detect Google Fonts CSS links in the page
     * Returns array of CSS URLs
     */
    function detectGoogleFontsLinks() {
        const links = [];
        document.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach(link => {
            if (link.href && link.href.includes('fonts.googleapis.com/css')) {
                links.push(link.href);
            }
        });
        return links;
    }

    /**
     * Resolve Google Fonts CSS URL to actual font file URLs via server
     */
    async function resolveGoogleFonts(cssUrl) {
        try {
            const response = await fetch(`${config.apiBaseUrl}/api/sdk/resolve-google-fonts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ cssUrl })
            });

            if (!response.ok) {
                throw new Error(`Failed to resolve Google Fonts: ${response.status}`);
            }

            const data = await response.json();
            return data.fonts || [];
        } catch (e) {
            if (config.debug) {
                console.warn('[Cloak] Failed to resolve Google Fonts:', e);
            }
            return [];
        }
    }

    /**
     * Detect fonts used on the page
     * Returns an array of individual font objects, each with { family, weight, style, url }
     * This preserves the association between URL and its specific weight/style
     */
    async function detectPageFonts() {
        const fontList = []; // Array of { family, weight, style, url }
        // Dedupe by (family, weight, style) - NOT by URL alone
        // Variable fonts use same URL for multiple weights
        const seenFonts = new Set();

        // Method 1: Detect Google Fonts links and resolve them via server
        const googleFontsLinks = detectGoogleFontsLinks();
        if (googleFontsLinks.length > 0) {
            if (config.debug) {
                console.log('[Cloak] Found Google Fonts links:', googleFontsLinks);
            }

            for (const cssUrl of googleFontsLinks) {
                const resolvedFonts = await resolveGoogleFonts(cssUrl);
                for (const font of resolvedFonts) {
                    const key = `${font.family}|${font.weight}|${font.style}`;
                    if (!seenFonts.has(key)) {
                        seenFonts.add(key);
                        fontList.push({
                            family: font.family,
                            weight: font.weight || 'normal',
                            style: font.style || 'normal',
                            url: font.url
                        });
                    }
                }
            }
        }

        // Method 2: Parse @font-face rules from same-origin stylesheets
        try {
            for (const sheet of document.styleSheets) {
                try {
                    const rules = sheet.cssRules || sheet.rules;
                    if (!rules) continue;

                    for (const rule of rules) {
                        if (rule instanceof CSSFontFaceRule) {
                            const family = rule.style.fontFamily?.replace(/['"]/g, '');
                            const src = rule.style.src;
                            if (family && src) {
                                // Extract URL from src
                                const urlMatch = src.match(/url\(['"]?([^'")\s]+)['"]?\)/);
                                if (urlMatch) {
                                    const weight = rule.style.fontWeight || 'normal';
                                    const style = rule.style.fontStyle || 'normal';
                                    const key = `${family}|${weight}|${style}`;
                                    if (!seenFonts.has(key)) {
                                        seenFonts.add(key);
                                        fontList.push({
                                            family: family,
                                            weight: weight,
                                            style: style,
                                            url: urlMatch[1]
                                        });
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    // Cross-origin stylesheet, skip (but Google Fonts already handled above)
                }
            }
        } catch (e) {
            if (config.debug) console.warn('[Cloak] Error parsing stylesheets:', e);
        }

        return fontList;
    }

    /**
     * Detect what category (serif, sans-serif, monospace) an unknown font falls back to.
     * Creates a test element and measures character widths to determine the category.
     * This is used for unmapped system fonts to ensure they get an encrypted font
     * of the correct visual category.
     */
    function detectFontCategory(fontFamily) {
        // Create a hidden test container
        const testContainer = document.createElement('div');
        testContainer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
        document.body.appendChild(testContainer);

        // Test strings - monospace fonts have equal width for all chars
        const testString = 'iiiiiiiiii'; // 10 i's - very narrow in proportional fonts
        const testString2 = 'mmmmmmmmmm'; // 10 m's - very wide in proportional fonts

        // Create test spans for different font categories
        const createTestSpan = (fontStack) => {
            const span = document.createElement('span');
            span.style.cssText = `font-family:${fontStack};font-size:72px;white-space:nowrap;`;
            span.textContent = testString;
            return span;
        };

        const createTestSpan2 = (fontStack) => {
            const span = document.createElement('span');
            span.style.cssText = `font-family:${fontStack};font-size:72px;white-space:nowrap;`;
            span.textContent = testString2;
            return span;
        };

        // Test with the unknown font falling back to each category
        const unknownWithSerif = createTestSpan(`"${fontFamily}", serif`);
        const unknownWithSans = createTestSpan(`"${fontFamily}", sans-serif`);
        const unknownWithMono = createTestSpan(`"${fontFamily}", monospace`);

        // Test with just the generic fonts for comparison
        const pureSerif = createTestSpan('serif');
        const pureSans = createTestSpan('sans-serif');
        const pureMono = createTestSpan('monospace');

        // Also test with 'm' characters to detect monospace
        const unknownWithMono2 = createTestSpan2(`"${fontFamily}", monospace`);
        const pureMono2 = createTestSpan2('monospace');

        testContainer.appendChild(unknownWithSerif);
        testContainer.appendChild(unknownWithSans);
        testContainer.appendChild(unknownWithMono);
        testContainer.appendChild(pureSerif);
        testContainer.appendChild(pureSans);
        testContainer.appendChild(pureMono);
        testContainer.appendChild(unknownWithMono2);
        testContainer.appendChild(pureMono2);

        // Measure widths
        const widthUnknownSerif = unknownWithSerif.offsetWidth;
        const widthUnknownSans = unknownWithSans.offsetWidth;
        const widthUnknownMono = unknownWithMono.offsetWidth;
        const widthPureSerif = pureSerif.offsetWidth;
        const widthPureSans = pureSans.offsetWidth;
        const widthPureMono = pureMono.offsetWidth;
        const widthUnknownMono2 = unknownWithMono2.offsetWidth;
        const widthPureMono2 = pureMono2.offsetWidth;

        // Clean up
        document.body.removeChild(testContainer);

        // Determine category:
        // 1. If the font exists on the system, widths will differ from pure generic
        // 2. If the font doesn't exist, browser falls back to the generic

        // Check if it's a monospace font (i and m should have same width)
        // In monospace, 10 i's and 10 m's have the same total width
        const monoRatio = widthUnknownMono / widthUnknownMono2;
        const pureMonoRatio = widthPureMono / widthPureMono2;

        // If the ratio is close to 1 (i's and m's same width), it's monospace
        if (Math.abs(monoRatio - 1) < 0.1 || Math.abs(monoRatio - pureMonoRatio) < 0.05) {
            // Check if it's actually using the monospace fallback
            if (Math.abs(widthUnknownMono - widthPureMono) < 2) {
                return 'monospace';
            }
        }

        // Check serif vs sans-serif
        // If the font falls back to serif, its width should match pure serif
        const serifDiff = Math.abs(widthUnknownSerif - widthPureSerif);
        const sansDiff = Math.abs(widthUnknownSans - widthPureSans);

        // If font exists, it won't match either pure generic
        // If font doesn't exist, it will match the fallback generic
        if (serifDiff < 2 && sansDiff > 5) {
            return 'serif';
        } else if (sansDiff < 2 && serifDiff > 5) {
            return 'sans-serif';
        }

        // If we can't determine, check which generic it's closest to
        // by comparing the unknown font with serif fallback to pure serif
        if (serifDiff <= sansDiff) {
            return 'serif';
        } else {
            return 'sans-serif';
        }
    }

    /**
     * Detect fonts actually used by text elements via getComputedStyle
     * This catches system fonts (Arial, Georgia, etc.) that aren't in @font-face rules
     * Also tracks generic font families (monospace, serif, etc.) separately for later resolution
     */
    function detectUsedFonts() {
        const usedFonts = new Map(); // family -> { weights: Set, styles: Set }
        const usedGenericFonts = new Map(); // generic family -> { weights: Set, styles: Set }

        // Generic font families that need special handling
        const genericFamilies = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];

        // Get all text-containing elements
        const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, a, li, td, th, div, article, section, blockquote, figcaption, label, button, code, pre, kbd, samp, var');

        for (const el of textElements) {
            // Skip elements we exclude from encryption
            if (el.closest('[data-cloak-exclude]') ||
                el.closest('script') ||
                el.closest('style') ||
                el.closest('#encrypted-search-overlay')) {
                continue;
            }

            const style = window.getComputedStyle(el);
            const fontFamily = style.fontFamily;
            const fontWeight = style.fontWeight || '400';
            const fontStyle = style.fontStyle || 'normal';

            if (!fontFamily) continue;

            // Parse font-family (can be comma-separated list)
            // Only use the FIRST font - that's what the browser actually uses
            const families = fontFamily.split(',').map(f => f.trim().replace(/['"]/g, ''));
            const firstFamily = families[0];

            if (!firstFamily) continue;

            // Track generic font families separately - they need special resolution
            if (genericFamilies.includes(firstFamily.toLowerCase())) {
                if (!usedGenericFonts.has(firstFamily.toLowerCase())) {
                    usedGenericFonts.set(firstFamily.toLowerCase(), { weights: new Set(), styles: new Set() });
                }
                usedGenericFonts.get(firstFamily.toLowerCase()).weights.add(fontWeight);
                usedGenericFonts.get(firstFamily.toLowerCase()).styles.add(fontStyle);
                continue;
            }

            if (!usedFonts.has(firstFamily)) {
                usedFonts.set(firstFamily, { weights: new Set(), styles: new Set() });
            }
            usedFonts.get(firstFamily).weights.add(fontWeight);
            usedFonts.get(firstFamily).styles.add(fontStyle);
        }

        return { usedFonts, usedGenericFonts };
    }

    /**
     * Resolve a system font to a downloadable Google Font equivalent
     */
    async function resolveSystemFont(fontFamily, weight, style) {
        try {
            const response = await fetch(`${config.apiBaseUrl}/api/sdk/resolve-system-font`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': encryptionConfig?.apiKey || ''
                },
                body: JSON.stringify({
                    fontFamily: fontFamily,
                    weight: weight || '400',
                    style: style || 'normal'
                })
            });

            if (!response.ok) {
                return null;
            }

            return await response.json();
        } catch (e) {
            if (config.debug) {
                console.warn(`[Cloak] Failed to resolve system font ${fontFamily}:`, e);
            }
            return null;
        }
    }

    /**
     * Check if a font family is a web font (has @font-face) or system font
     */
    function isWebFont(fontFamily) {
        // Check if there's a @font-face rule for this family
        try {
            for (const sheet of document.styleSheets) {
                try {
                    const rules = sheet.cssRules || sheet.rules;
                    if (!rules) continue;
                    for (const rule of rules) {
                        if (rule instanceof CSSFontFaceRule) {
                            const family = rule.style.fontFamily?.replace(/['"]/g, '').toLowerCase();
                            if (family === fontFamily.toLowerCase()) {
                                return true;
                            }
                        }
                    }
                } catch (e) {
                    // Cross-origin stylesheet
                }
            }
        } catch (e) {
            // Ignore errors
        }
        return false;
    }

    /**
     * Request an encrypted version of a font from the server
     */
    async function requestEncryptedFont(fontInfo) {
        try {
            const response = await fetch(`${config.apiBaseUrl}/api/sdk/font-from-url`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': encryptionConfig.apiKey
                },
                body: JSON.stringify({
                    fontUrl: fontInfo.url,
                    family: fontInfo.family,
                    weight: fontInfo.weight || 'normal',
                    style: fontInfo.style || 'normal',
                    storageId: encryptionConfig.storageId
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to get encrypted font: ${response.status}`);
            }

            return await response.json();
        } catch (e) {
            if (config.debug) {
                console.warn(`[Cloak] Failed to encrypt font ${fontInfo.family}:`, e);
            }
            return null;
        }
    }

    /**
     * Load and apply the encrypted font(s)
     *
     * Strategy:
     * 1. WEB FONTS (Google Fonts, etc.): Download the actual font file, encrypt it,
     *    and serve with the SAME family name. This preserves exact typography.
     * 2. SYSTEM FONTS (Arial, Georgia, etc.): We can't download these, so we use
     *    our fallback CloakFont and override font-family globally.
     */
    async function loadFont(defaultFontUrl) {
        const style = document.createElement('style');
        style.id = 'cloak-font-style';

        let cssContent = '';
        let fontFamilyOverrides = '';
        const encryptedFonts = []; // Track successfully encrypted WEB fonts only
        const encryptedGenericFonts = []; // Track encrypted generic fonts for CSS overrides
        const googleFontsLinks = []; // Track Google Fonts links to disable later
        let hasSystemFonts = false; // Track if page uses system fonts

        // Collect Google Fonts links BEFORE detection (so we can disable them after our fonts load)
        document.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach(link => {
            googleFontsLinks.push(link);
        });

        // If matchFonts is enabled, detect page fonts and request encrypted versions
        if (config.matchFonts && encryptionConfig) {
            // Detect WEB fonts only (from @font-face rules and Google Fonts links)
            const webFonts = await detectPageFonts();

            if (config.debug) {
                console.log('[Cloak] Detected web fonts (from @font-face):', webFonts);
            }

            // Also detect fonts from computed styles to see if system fonts are used
            const { usedFonts, usedGenericFonts } = detectUsedFonts();
            if (config.debug) {
                console.log('[Cloak] Detected used fonts (from computed styles):', [...usedFonts.keys()]);
                if (usedGenericFonts.size > 0) {
                    console.log('[Cloak] Detected generic fonts in use:', [...usedGenericFonts.keys()]);
                }
            }

            // Process WEB fonts - encrypt them with the SAME family name
            if (webFonts.length > 0) {
                if (config.debug) {
                    console.log('[Cloak] Found', webFonts.length, 'web font variants to encrypt');
                }

                // Group fonts by URL to avoid redundant encryption requests
                const encryptedByUrl = new Map(); // url -> encryptedFontUrl

                for (const font of webFonts) {
                    let encryptedFontUrl = encryptedByUrl.get(font.url);

                    // Only request encryption if we haven't done this URL yet
                    if (!encryptedFontUrl) {
                        const encrypted = await requestEncryptedFont(font);
                        if (encrypted) {
                            encryptedFontUrl = encrypted.encryptedFontUrl;
                            encryptedByUrl.set(font.url, encryptedFontUrl);
                        }
                    }

                    if (encryptedFontUrl) {
                        encryptedFonts.push({
                            ...font,
                            encryptedFontUrl
                        });

                        // Use the SAME family name - this works because we disable the original
                        cssContent += `
                            @font-face {
                                font-family: '${font.family}';
                                src: url('${encryptedFontUrl}') format('woff2');
                                font-weight: ${font.weight};
                                font-style: ${font.style};
                                font-display: block;
                            }
                        `;

                        if (config.debug) {
                            console.log(`[Cloak] Registered encrypted web font: ${font.family} (${font.weight}, ${font.style})`);
                        }
                    }
                }
            }

            // Process SYSTEM fonts - resolve to Google Font equivalents and encrypt
            // We register them with the ORIGINAL system font family name so they override
            if (config.debug) {
            }

            const systemFontsToProcess = [];
            for (const [family, {weights, styles}] of usedFonts) {
                // Skip if this family is already a web font
                const hasWebFont = webFonts.some(f => f.family.toLowerCase() === family.toLowerCase());
                if (hasWebFont) {
                    continue;
                }

                // Check if it's a system font (not a web font with @font-face)
                const isSystemFontFamily = !isWebFont(family);
                if (isSystemFontFamily) {
                    // Add all weight/style combinations for this family
                    for (const weight of weights) {
                        for (const style of styles) {
                            systemFontsToProcess.push({
                                originalFamily: family,
                                weight,
                                style
                            });
                        }
                    }
                }
            }

            if (systemFontsToProcess.length > 0) {
                if (config.debug) {
                    console.log(`[Cloak] Found ${systemFontsToProcess.length} system font variants to resolve:`, systemFontsToProcess);
                }

                // Group by URL to avoid redundant encryption
                const encryptedByUrl = new Map();

                for (const systemFont of systemFontsToProcess) {
                    // Resolve system font to Google Font equivalent
                    const resolved = await resolveSystemFont(
                        systemFont.originalFamily,
                        systemFont.weight,
                        systemFont.style
                    );

                    if (resolved && resolved.found && resolved.fonts && resolved.fonts.length > 0) {
                        // Use bestMatch if available (correct weight/style), otherwise fall back to first font
                        const googleFont = resolved.bestMatch || resolved.fonts[0];

                        if (config.debug) {
                            console.log(`[Cloak] Resolved system font "${systemFont.originalFamily}" -> "${resolved.googleFont}"`);
                        }

                        // Check if we already encrypted this URL
                        let encryptedFontUrl = encryptedByUrl.get(googleFont.url);

                        if (!encryptedFontUrl) {
                            // Encrypt the Google Font equivalent
                            const encrypted = await requestEncryptedFont({
                                family: resolved.googleFont,
                                weight: googleFont.weight,
                                style: googleFont.style,
                                url: googleFont.url
                            });

                            if (encrypted) {
                                encryptedFontUrl = encrypted.encryptedFontUrl;
                                encryptedByUrl.set(googleFont.url, encryptedFontUrl);
                            }
                        }

                        if (encryptedFontUrl) {
                            encryptedFonts.push({
                                family: systemFont.originalFamily, // Use ORIGINAL family name!
                                weight: systemFont.weight,
                                style: systemFont.style,
                                encryptedFontUrl
                            });

                            // Register with ORIGINAL system font family name
                            // This overrides the browser's built-in font
                            cssContent += `
                                @font-face {
                                    font-family: '${systemFont.originalFamily}';
                                    src: url('${encryptedFontUrl}') format('woff2');
                                    font-weight: ${systemFont.weight};
                                    font-style: ${systemFont.style};
                                    font-display: block;
                                }
                            `;

                            if (config.debug) {
                                console.log(`[Cloak] Registered encrypted system font: ${systemFont.originalFamily} (${systemFont.weight}, ${systemFont.style}) -> ${resolved.googleFont}`);
                            }
                        }
                    } else {
                        // ZERO-DEGRADATION: For unmapped system fonts, detect the font category
                        // and use an appropriate encrypted Google Font with the ORIGINAL font name
                        if (config.debug) {
                            console.log(`[Cloak] System font "...`);
                        }

                        const category = detectFontCategory(systemFont.originalFamily);

                        // Map category to a suitable Google Font
                        const categoryFontMappings = {
                            'monospace': 'Roboto Mono',
                            'serif': 'Tinos',      // Tinos is metrically compatible with Times/serif
                            'sans-serif': 'Arimo'  // Arimo is metrically compatible with Arial/sans-serif
                        };

                        const categoryGoogleFont = categoryFontMappings[category];

                        if (config.debug) {
                            console.log(`[Cloak] Detected ", using ${categoryGoogleFont}`);
                        }

                        // Resolve and encrypt the category-appropriate Google Font
                        const categoryResolved = await resolveSystemFont(categoryGoogleFont, systemFont.weight, systemFont.style);

                        if (categoryResolved && categoryResolved.found && categoryResolved.fonts && categoryResolved.fonts.length > 0) {
                            const googleFont = categoryResolved.bestMatch || categoryResolved.fonts[0];

                            let encryptedFontUrl = encryptedByUrl.get(googleFont.url);

                            if (!encryptedFontUrl) {
                                const encrypted = await requestEncryptedFont({
                                    family: categoryResolved.googleFont,
                                    weight: googleFont.weight,
                                    style: googleFont.style,
                                    url: googleFont.url
                                });

                                if (encrypted) {
                                    encryptedFontUrl = encrypted.encryptedFontUrl;
                                    encryptedByUrl.set(googleFont.url, encryptedFontUrl);
                                }
                            }

                            if (encryptedFontUrl) {
                                encryptedFonts.push({
                                    family: systemFont.originalFamily, // Use ORIGINAL font name!
                                    weight: systemFont.weight,
                                    style: systemFont.style,
                                    encryptedFontUrl
                                });

                                // Register with ORIGINAL font name - this overrides the unknown font
                                cssContent += `
                                    @font-face {
                                        font-family: '${systemFont.originalFamily}';
                                        src: url('${encryptedFontUrl}') format('woff2');
                                        font-weight: ${systemFont.weight};
                                        font-style: ${systemFont.style};
                                        font-display: block;
                                    }
                                `;

                                if (config.debug) {
                                    console.log(`[Cloak] Registered encrypted font for unmapped "${systemFont.originalFamily}" (${systemFont.weight}, ${systemFont.style}) -> ${categoryResolved.googleFont} [${category}]`);
                                }
                            } else {
                                if (config.debug) {
                                    console.warn(`[Cloak] Failed to encrypt category font for: ${systemFont.originalFamily}`);
                                }
                                hasSystemFonts = true; // Last resort fallback
                            }
                        } else {
                            if (config.debug) {
                                console.warn(`[Cloak] Could not resolve category font ${categoryGoogleFont} for: ${systemFont.originalFamily}`);
                            }
                            hasSystemFonts = true; // Last resort fallback
                        }
                    }
                }
            }

            // Process GENERIC fonts (monospace, serif, sans-serif, etc.)
            // These need to be resolved to specific downloadable fonts and then CSS overrides added
            if (usedGenericFonts.size > 0) {
                if (config.debug) {
                    console.log('[Cloak] Processing generic fonts...');
                }

                // Mapping from generic font to a suitable Google Font
                const genericFontMappings = {
                    'monospace': 'Roboto Mono',
                    'serif': 'Lora',
                    'sans-serif': 'Inter',
                    'cursive': 'Dancing Script',
                    'fantasy': 'Creepster',
                    'system-ui': 'Inter'
                };

                const genericEncryptedByUrl = new Map();

                for (const [genericFamily, {weights, styles}] of usedGenericFonts) {
                    const googleFontName = genericFontMappings[genericFamily];
                    if (!googleFontName) {
                        if (config.debug) {
                            console.warn(`[Cloak] No mapping for generic font: ${genericFamily}`);
                        }
                        continue;
                    }

                    // For each weight/style combo, resolve and encrypt
                    for (const weight of weights) {
                        for (const style of styles) {
                            const resolved = await resolveSystemFont(googleFontName, weight, style);

                            if (resolved && resolved.found && resolved.fonts && resolved.fonts.length > 0) {
                                const googleFont = resolved.bestMatch || resolved.fonts[0];

                                if (config.debug) {
                                    console.log(`[Cloak] Resolved generic font "${genericFamily}" -> "${resolved.googleFont}"`);
                                }

                                let encryptedFontUrl = genericEncryptedByUrl.get(googleFont.url);

                                if (!encryptedFontUrl) {
                                    const encrypted = await requestEncryptedFont({
                                        family: resolved.googleFont,
                                        weight: googleFont.weight,
                                        style: googleFont.style,
                                        url: googleFont.url
                                    });

                                    if (encrypted) {
                                        encryptedFontUrl = encrypted.encryptedFontUrl;
                                        genericEncryptedByUrl.set(googleFont.url, encryptedFontUrl);
                                    }
                                }

                                if (encryptedFontUrl) {
                                    // Create a unique family name for this generic font
                                    const encryptedGenericFamily = `CloakGeneric-${genericFamily}`;

                                    encryptedGenericFonts.push({
                                        genericFamily: genericFamily,
                                        encryptedFamily: encryptedGenericFamily,
                                        weight: weight,
                                        style: style,
                                        encryptedFontUrl
                                    });

                                    // Register with a unique family name
                                    cssContent += `
                                        @font-face {
                                            font-family: '${encryptedGenericFamily}';
                                            src: url('${encryptedFontUrl}') format('woff2');
                                            font-weight: ${weight};
                                            font-style: ${style};
                                            font-display: block;
                                        }
                                    `;

                                    if (config.debug) {
                                        console.log(`[Cloak] Registered encrypted generic font: ${genericFamily} -> ${encryptedGenericFamily} (${weight}, ${style})`);
                                    }
                                }
                            } else {
                                if (config.debug) {
                                    console.warn(`[Cloak] Could not resolve generic font ${genericFamily} (mapped to ${googleFontName})`);
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // matchFonts disabled - all fonts will use fallback
            hasSystemFonts = true;
        }

        // Always add a fallback CloakFont
        cssContent += `
            @font-face {
                font-family: 'CloakFont';
                src: url('${defaultFontUrl}') format('woff2');
                font-display: block;
            }
        `;

        // Build font-family overrides
        const excludedElementsSelector = config.excludeSelectors
            .filter(s => !['script', 'style', 'noscript', 'meta', 'link', 'head'].includes(s))
            .join(', ');

        if (encryptedFonts.length > 0) {
            const matchedFamilies = [...new Set(encryptedFonts.map(f => f.family))];

            // DO NOT override font-family on body/elements!
            // The @font-face declarations above use the SAME font-family names as the original CSS,
            // so the browser will automatically use our encrypted fonts.
            // Overriding font-family would break the page's typography (serif vs sans-serif, etc.)
            //
            // We only need to ensure:
            // 1. Excluded elements (code, pre, etc.) use real system fonts for readability
            // 2. Search overlay uses system fonts
            // 3. Elements with data-cloak-exclude use system fonts
            // 4. Custom exclude selectors from config also use system fonts
            const customSelectorCSS = config.excludeSelectors
                .filter(s => s.includes('.') || s.includes('#') || s.includes('['))
                .map(s => `${s}, ${s} *`)
                .join(', ');

            fontFamilyOverrides = `
                ${excludedElementsSelector} {
                    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace !important;
                }
                #encrypted-search-overlay, #encrypted-search-overlay * {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                }
                [data-cloak-exclude], [data-cloak-exclude] * {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                }
                ${customSelectorCSS ? `${customSelectorCSS} {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                }` : ''}
            `;

            if (config.debug) {
                console.log('[Cloak] Registered', encryptedFonts.length, 'encrypted font variants for families:', matchedFamilies);
                console.log('[Cloak] Original page font-family CSS preserved (no override)');
                console.log('[Cloak] Excluded elements will use system fonts:', excludedElementsSelector);
            }
        } else {
            // No fonts matched - fall back to CloakFont for everything except excluded elements
            const customSelectorCSS = config.excludeSelectors
                .filter(s => s.includes('.') || s.includes('#') || s.includes('['))
                .map(s => `${s}, ${s} *`)
                .join(', ');

            fontFamilyOverrides = `
                body, body * {
                    font-family: 'CloakFont', sans-serif !important;
                }
                ${excludedElementsSelector} {
                    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace !important;
                }
                #encrypted-search-overlay, #encrypted-search-overlay * {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                }
                [data-cloak-exclude], [data-cloak-exclude] * {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                }
                ${customSelectorCSS ? `${customSelectorCSS} {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                }` : ''}
            `;
            if (config.debug) {
                console.log('[Cloak] No web fonts detected, using default CloakFont');
            }
        }

        // STEP 1: Disable Google Fonts links FIRST (set media="none" to prevent loading)
        // This is better than removing because it prevents FOUC
        googleFontsLinks.forEach(link => {
            if (config.debug) {
                console.log('[Cloak] Disabling original Google Fonts link:', link.href);
            }
            link.setAttribute('media', 'none');
            link.setAttribute('data-cloak-disabled', 'true');
        });

        // STEP 2: Add our encrypted font styles
        style.textContent = cssContent + fontFamilyOverrides;
        document.head.appendChild(style);

        // STEP 3: Wait for our encrypted fonts to load
        if (document.fonts && document.fonts.load) {
            const loadPromises = [];

            // Load the fallback font
            loadPromises.push(document.fonts.load('16px CloakFont').catch(() => {}));

            // Load each encrypted font with all weight variants
            for (const font of encryptedFonts) {
                // Try loading with explicit weight
                const fontString = `${font.style === 'italic' ? 'italic ' : ''}${font.weight} 16px "${font.family}"`;
                loadPromises.push(
                    document.fonts.load(fontString).catch(e => {
                        if (config.debug) {
                            console.warn(`[Cloak] Failed to load font: ${fontString}`, e);
                        }
                    })
                );
            }

            // Load encrypted generic fonts (monospace, serif, etc.)
            for (const font of encryptedGenericFonts) {
                const fontString = `${font.style === 'italic' ? 'italic ' : ''}${font.weight} 16px "${font.encryptedFamily}"`;
                loadPromises.push(
                    document.fonts.load(fontString).catch(e => {
                        if (config.debug) {
                            console.warn(`[Cloak] Failed to load generic font: ${fontString}`, e);
                        }
                    })
                );
            }

            // Race font loading against timeout to prevent infinite blank page
            const fontLoadPromise = Promise.all(loadPromises);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Font loading timeout')), config.fontLoadTimeout);
            });

            try {
                await Promise.race([fontLoadPromise, timeoutPromise]);

                if (config.debug) {
                    console.log('[Cloak] All fonts loaded successfully');
                    // Log which fonts are now available
                    document.fonts.forEach(font => {
                        if (encryptedFonts.some(ef => ef.family === font.family)) {
                            console.log(`[Cloak] Font available: ${font.family} ${font.weight} ${font.style}`);
                        }
                    });
                }
            } catch (error) {
                // Font loading timed out or failed - decrypt text back to plaintext
                console.warn(`[Cloak] Font loading failed or timed out after ${config.fontLoadTimeout}ms:`, error.message);
                console.warn('[Cloak] Decrypting content back to plaintext for readability');

                // Restore all encrypted text to plaintext so users see readable content
                // without the custom font that maps encrypted characters to readable glyphs
                const decryptedCount = decryptAllNodes();

                if (decryptedCount > 0) {
                    console.log(`[Cloak] Successfully restored ${decryptedCount} text nodes to plaintext`);
                } else {
                    console.warn('[Cloak] No encrypted nodes found to decrypt - content may already be plaintext');
                }
            }
        } else {
            // Fallback for older browsers
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // STEP 3.5: Apply encrypted fonts to elements using generic font families
        // This is necessary because we can't override generic fonts via @font-face
        if (encryptedGenericFonts.length > 0) {
            // Build a map from generic family to encrypted family name
            const genericFamilyMap = new Map();
            for (const gf of encryptedGenericFonts) {
                if (!genericFamilyMap.has(gf.genericFamily)) {
                    genericFamilyMap.set(gf.genericFamily, gf.encryptedFamily);
                }
            }

            // Generic font families to check
            const genericFamilies = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];

            // Find all elements and check their computed font-family
            const allElements = document.querySelectorAll('*');
            let appliedCount = 0;

            for (const el of allElements) {
                // Skip excluded elements
                if (el.closest('[data-cloak-exclude]') ||
                    el.closest('#encrypted-search-overlay') ||
                    el.tagName === 'SCRIPT' ||
                    el.tagName === 'STYLE') {
                    continue;
                }

                const computedStyle = window.getComputedStyle(el);
                const fontFamily = computedStyle.fontFamily;

                if (!fontFamily) continue;

                // Check if computed font-family starts with a generic family
                const families = fontFamily.split(',').map(f => f.trim().replace(/['"]/g, ''));
                const firstFamily = families[0]?.toLowerCase();

                if (firstFamily && genericFamilies.includes(firstFamily)) {
                    const encryptedFamily = genericFamilyMap.get(firstFamily);
                    if (encryptedFamily) {
                        // Apply encrypted font while preserving fallbacks
                        el.style.fontFamily = `'${encryptedFamily}', ${fontFamily}`;
                        appliedCount++;
                    }
                }
            }

            if (config.debug && appliedCount > 0) {
                console.log(`[Cloak] Applied encrypted fonts to ${appliedCount} elements using generic fonts`);
            }
        }

        // STEP 4: Now that our fonts are loaded, remove the disabled Google Fonts links entirely
        // This ensures our fonts take full precedence
        googleFontsLinks.forEach(link => {
            if (config.debug) {
                console.log('[Cloak] Removing disabled Google Fonts link');
            }
            link.remove();
        });
    }

    // ========================================
    // API Communication
    // ========================================

    /**
     * Initialize encryption with the API
     */
    async function initWithAPI(apiKey) {
        const response = await fetch(`${config.apiBaseUrl}/api/sdk/init`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify({
                domain: window.location.hostname,
                path: window.location.pathname,
                userAgent: navigator.userAgent
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || `Failed to initialize (${response.status})`);
        }

        return response.json();
    }

    /**
     * Report usage statistics
     */
    let usageReportTimeout = null;
    function reportUsage() {
        if (usageReportTimeout) return;

        usageReportTimeout = setTimeout(async () => {
            usageReportTimeout = null;

            if (!encryptionConfig || !encryptionConfig.apiKey) return;

            try {
                await fetch(`${config.apiBaseUrl}/api/sdk/usage`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': encryptionConfig.apiKey
                    },
                    body: JSON.stringify({
                        domain: window.location.hostname,
                        path: window.location.pathname,
                        characters: totalCharacters,
                        sessionId: encryptionConfig.sessionId
                    })
                });
            } catch (e) {
                if (config.debug) {
                    console.warn('[Cloak] Failed to report usage:', e);
                }
            }
        }, 5000); // Debounce usage reports
    }

    /**
     * Upload plaintext index to server for search/copy functionality
     */
    let plaintextUploaded = false;
    let plaintextUploadPromise = null;
    let lastUploadedPlaintextLength = 0; // Track last successful upload length to prevent corruption

    /**
     * Upload plaintext to server for search/copy/double-click functionality.
     *
     * CRITICAL: This function MUST build plaintext using the EXACT same algorithm
     * as decrypt-interceptor.js buildTextPositionMap(). Both must:
     * 1. Use TreeWalker to iterate text nodes in document order
     * 2. Skip excluded nodes using shouldExcludeNode/shouldExcludeTextNode
     * 3. Strip zero-width spaces from each text node
     * 4. Skip whitespace-only text nodes (after stripping zero-width spaces)
     * 5. Add \n markers at block element boundaries
     * 6. Strip trailing whitespace from final result
     *
     * Returns a promise so callers can wait for completion.
     */
    function uploadPlaintextToServer() {
        if (plaintextUploaded) return Promise.resolve(); // Already uploaded

        // CRITICAL: Don't re-upload while search highlights are active
        // The presence of <mark class="encrypted-search-highlight"> elements means the DOM
        // is temporarily modified for search, and rebuilding plaintext would be incorrect.
        // The server already has the correct plaintext from the initial upload.
        if (document.querySelector('.encrypted-search-highlight')) {
            return Promise.resolve();
        }
        if (plaintextUploadPromise) return plaintextUploadPromise; // Upload in progress

        plaintextUploadPromise = (async () => {
            if (!encryptionConfig || !encryptionConfig.storageId) return;

            // Build plaintext by walking ALL text nodes in document order
            // This MUST match decrypt-interceptor.js buildTextPositionMap() exactly
            let fullPlaintext = '';
            let lastBlock = null;
            let newlineCount = 0;
            let nodeCount = 0;
            let encryptedWithOriginal = 0;
            let encryptedWithoutOriginal = 0;
            let unencryptedNodes = 0;


            // Use TreeWalker to iterate in exact document order (same as decrypt-interceptor)
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null  // Accept all, filter manually to match decrypt-interceptor exactly
            );

            let textNode;
            while (textNode = walker.nextNode()) {
                // Skip excluded nodes (matches decrypt-interceptor shouldExcludeTextNode)
                if (shouldExcludeNode(textNode)) {
                    continue;
                }

                // Get raw text content
                let text = textNode.textContent;

                // Remove zero-width spaces (matches decrypt-interceptor)
                text = text.replace(/\u200B/g, '');

                // Skip empty or whitespace-only text nodes (matches decrypt-interceptor)
                if (text.length === 0 || !text.trim()) {
                    continue;
                }

                // Check for block boundary - add \n marker (matches decrypt-interceptor)
                const currentBlock = getContainingBlock(textNode);
                if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
                    fullPlaintext += '\n'; // Block boundary marker
                    newlineCount++;
                    if (newlineCount <= 10) {
                    }
                }
                if (currentBlock !== null) {
                    lastBlock = currentBlock;
                }

                // Get original (unencrypted) text for this node
                // Encrypted nodes: retrieve from WeakMap storage
                // Unencrypted nodes: use current text (already plaintext)
                let originalText;
                if (textNode._cloakEncrypted && plaintextStorage.has(textNode)) {
                    // Node was encrypted - retrieve original from WeakMap
                    originalText = plaintextStorage.get(textNode);
                    encryptedWithOriginal++;
                } else if (textNode._cloakEncrypted) {
                    // Skip silently - this is expected when highlights split nodes
                    encryptedWithoutOriginal++;
                    continue;
                } else {
                    // Node is not encrypted - use current text (it's already plaintext)
                    originalText = text;
                    unencryptedNodes++;
                }
                // Also strip zero-width spaces from original
                originalText = originalText.replace(/\u200B/g, '');

                fullPlaintext += originalText;
                nodeCount++;
            }

            const firstNewline = fullPlaintext.indexOf('\n');

            // Strip trailing whitespace (matches decrypt-interceptor: .rstrip())
            fullPlaintext = fullPlaintext.replace(/\s+$/, '');

            if (!fullPlaintext) return;

            // CRITICAL: Don't overwrite good plaintext with corrupted data
            // If we have fewer characters than last successful upload AND we skipped nodes,
            // the DOM has been corrupted by innerHTML replacements - don't upload
            if (encryptedWithoutOriginal > 0 && fullPlaintext.length < lastUploadedPlaintextLength) {
                return;
            }

            // Calculate expected hash for integrity verification
            const expectedLength = fullPlaintext.length;
            let expectedHash;
            try {
                const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fullPlaintext));
                expectedHash = Array.from(new Uint8Array(hashBuffer))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            } catch (hashError) {
                if (config.debug) {
                    console.warn('[Cloak] Failed to calculate hash:', hashError);
                }
                expectedHash = null; // Proceed without hash verification
            }

            // Retry logic with exponential backoff
            const maxRetries = 3;
            let uploadSuccess = false;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const requestBody = {
                        storageId: encryptionConfig.storageId,
                        hash: encryptionConfig.hash,
                        plaintext: fullPlaintext,
                        sessionId: encryptionConfig.sessionId
                    };

                    const response = await fetch(`${config.apiBaseUrl}/api/sdk/upload-plaintext`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-Key': encryptionConfig.apiKey
                        },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        if (config.debug) {
                            console.warn(`[Cloak] Upload attempt ${attempt + 1} failed: ${response.status}`);
                        }
                        // Wait with exponential backoff before retry
                        if (attempt < maxRetries - 1) {
                            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                        }
                        continue;
                    }

                    // Parse response to verify integrity
                    const result = await response.json();

                    // Verify length
                    if (result.stored_length !== expectedLength) {
                        if (config.debug) {
                            console.error(`[Cloak] Length mismatch: expected ${expectedLength}, got ${result.stored_length}`);
                        }
                        if (attempt < maxRetries - 1) {
                            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                        }
                        continue;
                    }

                    // Verify hash (if we calculated it)
                    if (expectedHash && result.stored_hash !== expectedHash) {
                        if (config.debug) {
                            console.error('[Cloak] Hash mismatch: corruption detected');
                        }
                        if (attempt < maxRetries - 1) {
                            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                        }
                        continue;
                    }

                    // Success!
                    uploadSuccess = true;
                    plaintextUploaded = true;
                    lastUploadedPlaintextLength = fullPlaintext.length;

                    if (config.debug) {
                        console.log(`[Cloak] Plaintext uploaded and verified (${expectedLength} chars)`);
                    }

                    // NOTE: Plaintext is stored in WeakMap (plaintextStorage), not as DOM properties
                    // This makes extraction via DOM traversal impossible while preserving functionality

                    break; // Exit retry loop

                } catch (e) {
                    if (config.debug) {
                        console.warn(`[Cloak] Upload attempt ${attempt + 1} error:`, e);
                    }
                    if (attempt < maxRetries - 1) {
                        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                    }
                }
            }

            // If all retries failed, show user error
            if (!uploadSuccess) {
                console.error('[Cloak] Failed to upload plaintext after 3 attempts. Copy/paste may not work correctly.');
                // Show non-intrusive notification to user
                if (typeof config.onUploadError === 'function') {
                    config.onUploadError('Failed to store encrypted content. Copy/paste may not work.');
                }
            }
        })();

        return plaintextUploadPromise;
    }

    // ========================================
    // Decrypt Interceptor Injection
    // ========================================

    /**
     * Inject the decrypt-interceptor.js script and set up encryption config
     * This provides Ctrl+F search and copy/paste functionality using server-side plaintext
     */
    function injectDecryptInterceptor() {
        // Set up the encryption config that decrypt-interceptor expects
        window.encryptionConfig = {
            hash: encryptionConfig.hash,
            storageId: encryptionConfig.storageId,
            websiteId: encryptionConfig.storageId, // Alias for lazy encryption support
            apiBaseUrl: config.apiBaseUrl,
            apiKey: config.apiKey  // Required for /api/search/* endpoints
        };

        // Load the decrypt-interceptor script
        const script = document.createElement('script');
        script.src = `${config.apiBaseUrl}/client/decrypt-interceptor.js`;
        script.defer = true;
        document.head.appendChild(script);

        if (config.debug) {
            console.log('[Cloak] Injected decrypt-interceptor.js');
        }
    }

    // ========================================
    // Public API
    // ========================================

    const CloakSDK = {
        version: SDK_VERSION,

        /**
         * Initialize the SDK
         * @param {Object} options - Configuration options
         * @param {string} options.apiKey - Your API key
         * @param {string} [options.apiBaseUrl] - API base URL
         * @param {boolean} [options.debug] - Enable debug logging
         */
        async init(options = {}) {
            if (isInitialized) {
                console.warn('[Cloak] SDK already initialized');
                return;
            }

            // Merge config
            config = { ...DEFAULT_CONFIG, ...options };

            if (!options.apiKey) {
                throw new Error('[Cloak] API key is required');
            }

            // Store original body visibility for restoration (declare outside try for catch access)
            let originalBodyVisibility = '';
            let originalBodyOpacity = '';

            try {
                if (config.debug) {
                    console.log('[Cloak] Initializing SDK v' + SDK_VERSION);
                }

                // Get encryption config from API
                const initData = await initWithAPI(options.apiKey);

                encryptionConfig = {
                    apiKey: options.apiKey,
                    secretKey: initData.secretKey,
                    nonce: initData.nonce,
                    hash: initData.hash,
                    fontUrl: initData.fontUrl,
                    sessionId: initData.sessionId,
                    storageId: initData.storageId
                };

                // Use server-provided character mappings (exact match to server encryption)
                characterMappings = initData.charMappings;

                if (config.debug) {
                    console.log('[Cloak] Using server-provided character mappings');
                    console.log('[Cloak] Sample mapping: A ->', characterMappings['A'], ', a ->', characterMappings['a']);
                }

                // CRITICAL: Hide content before loading fonts to prevent FOUC
                // (Flash of Unencrypted Content - plaintext with encrypted fonts = gibberish)
                // We'll show it again after encryption completes
                originalBodyVisibility = document.body.style.visibility;
                originalBodyOpacity = document.body.style.opacity;
                document.body.style.visibility = 'hidden';
                if (config.debug) {
                    console.log('[Cloak] Content hidden during font loading and encryption');
                }

                try {
                    // Load the encrypted font
                    await loadFont(encryptionConfig.fontUrl);

                    // Reset block tracking for initial encryption
                    lastBlock = null;

                    // Encrypt existing content
                    const existingNodes = getTextNodes(document.body);
                    existingNodes.forEach(encryptTextNode);
                } finally {
                    // CRITICAL: Always restore visibility, even if font loading fails
                    // This prevents users from being stuck on a blank page
                    document.body.style.visibility = originalBodyVisibility || '';
                    document.body.style.opacity = originalBodyOpacity || '';
                }
                if (config.debug) {
                    console.log('[Cloak] Content revealed - encryption complete');
                }

                // Upload plaintext to server BEFORE injecting decrypt-interceptor
                // This ensures server has plaintext ready when search/copy is attempted
                await uploadPlaintextToServer();

                // NOW inject decrypt-interceptor.js for Ctrl+F search and copy/paste
                // It uses the server-side plaintext cache which is now populated
                injectDecryptInterceptor();

                // Start observing for new content
                startObserver();

                isInitialized = true;

                if (config.debug) {
                    console.log('[Cloak] SDK initialized successfully');
                    console.log('[Cloak] Encrypted', totalCharacters, 'characters');
                }

                // Dispatch ready event
                window.dispatchEvent(new CustomEvent('cloak:ready', {
                    detail: { characters: totalCharacters }
                }));

            } catch (error) {
                // CRITICAL: Restore visibility if initialization fails
                // Otherwise page remains permanently hidden
                document.body.style.visibility = originalBodyVisibility || '';
                document.body.style.opacity = originalBodyOpacity || '';
                console.error('[Cloak] Initialization failed:', error);
                throw error;
            }
        },

        /**
         * Manually encrypt new content
         * @param {Element} element - Element to encrypt
         */
        encrypt(element) {
            if (!isInitialized) {
                console.warn('[Cloak] SDK not initialized');
                return;
            }

            const textNodes = getTextNodes(element);
            textNodes.forEach(encryptTextNode);
        },

        /**
         * Get decrypted text for a range
         * @param {number} start - Start position
         * @param {number} end - End position
         */
        getDecryptedText(start, end) {
            return getOriginalText(start, end);
        },

        /**
         * Get current statistics
         */
        getStats() {
            return {
                initialized: isInitialized,
                totalCharacters,
                nodeCount: plaintextIndex.length
            };
        },

        /**
         * Pause encryption (useful for editing)
         */
        pause() {
            stopObserver();
        },

        /**
         * Resume encryption
         */
        resume() {
            startObserver();
        },

        /**
         * Destroy the SDK instance
         */
        destroy() {
            stopObserver();

            // Remove font style
            const style = document.getElementById('cloak-font-style');
            if (style) style.remove();

            // Reset state
            isInitialized = false;
            encryptionConfig = null;
            characterMappings = null;
            plaintextIndex = [];
            totalCharacters = 0;
            pendingNodes.clear();
            encryptedTextCache.clear();
        }
    };

    // Auto-initialize if script tag has data-api-key
    if (document.currentScript) {
        const apiKey = document.currentScript.getAttribute('data-api-key');
        const debug = document.currentScript.hasAttribute('data-debug');
        const apiBaseUrl = document.currentScript.getAttribute('data-api-url');

        if (apiKey) {
            // Wait for DOM ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    CloakSDK.init({ apiKey, debug, apiBaseUrl });
                });
            } else {
                CloakSDK.init({ apiKey, debug, apiBaseUrl });
            }
        }
    }

    // Export to window
    window.CloakSDK = CloakSDK;

})(window, document);
