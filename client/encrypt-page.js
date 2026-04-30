/**
 * Automatic Page Encryption Script
 * Encrypts all text on any webpage with a single API call
 * 
 * Usage: Just include this script on any webpage:
 * <script src="https://your-api.com/client/encrypt-page.js"></script>
 * 
 * Configuration (optional, via data attributes on script tag):
 * <script src="..." data-api-url="https://your-api.com/api/encrypt/page" data-secret-key="29202393"></script>
 */
(function() {
    'use strict';
    
    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    const CONFIG = {
        // Hash of nonce+secret_key (can be overridden via data-hash attribute)
        // If not specified, API will use server default
        hash: null,
        
        // Font name for encrypted content
        fontName: 'EncryptedFont',
        
        // Elements to skip (don't encrypt text in these)
        skipSelectors: [
            'script',
            'style',
            'noscript',
            'meta',
            'title',
            'head',
            '.no-encrypt',
            '[data-no-encrypt]'
        ],
        
        // Minimum text length to encrypt (skip very short content)
        minTextLength: 1
    };
    
    // Get configuration from script tag data attributes and auto-detect API URL
    const currentScript = document.currentScript || 
        document.querySelector('script[src*="encrypt-page"]') ||
        document.querySelector('script[src*="encrypt-page.js"]');
    
    // Auto-detect API endpoint from script URL
    let apiEndpoint = '/api/encrypt/page'; // Default relative path
    if (currentScript && currentScript.src) {
        try {
            const scriptUrl = new URL(currentScript.src);
            // Build API URL from script URL (e.g., /client/encrypt-page.js -> /api/encrypt/page)
            apiEndpoint = `${scriptUrl.origin}/api/encrypt/page`;
        } catch (e) {
            // If URL parsing fails, use relative path
            apiEndpoint = '/api/encrypt/page';
        }
    }
    
    if (currentScript) {
        if (currentScript.dataset.apiUrl) {
            apiEndpoint = currentScript.dataset.apiUrl;
        }
        if (currentScript.dataset.hash) {
            CONFIG.hash = currentScript.dataset.hash;
        }
        // Backward compatibility: support data-secret-key (will be converted to hash by API)
        if (currentScript.dataset.secretKey && !CONFIG.hash) {
            // Note: This will be handled by API, but we store it for backward compatibility
            CONFIG.secretKey = parseInt(currentScript.dataset.secretKey);
        }
    }
    
    CONFIG.apiEndpoint = apiEndpoint;
    
    // ============================================================================
    // DECRYPTION MAPPINGS (for copy-paste functionality)
    // Secure storage using closure to prevent direct access
    // ============================================================================
    
    // Use Symbol-based keys to prevent enumeration
    const MAP_STORE = Symbol('mappingStore');
    const HASH_STORE = Symbol('hashStore');
    const SPACECHAR_STORE = Symbol('spaceCharStore');
    
    // Private storage in closure
    const mappingStore = {
        [MAP_STORE]: {
            upper: null,
            lower: null,
            space: null
        },
        [HASH_STORE]: null,  // Store hash instead of nonce/secretKey
        [SPACECHAR_STORE]: null
    };
    
    /**
     * Store decryption mappings from API response
     * Uses secure storage to prevent direct access
     */
    function storeDecryptionMappings(upperMap, lowerMap, spaceMap, hash) {
        // Create reverse mappings for fast decryption
        const reverseUpper = {};
        const reverseLower = {};
        const reverseSpace = {};
        
        // Reverse upper_map: encrypted -> original
        for (const [original, encrypted] of Object.entries(upperMap)) {
            reverseUpper[encrypted] = original;
        }
        
        // Reverse lower_map: encrypted -> original (includes space)
        for (const [original, encrypted] of Object.entries(lowerMap)) {
            reverseLower[encrypted] = original;
        }
        
        // Reverse space_map: encrypted -> original
        for (const [original, encrypted] of Object.entries(spaceMap)) {
            reverseSpace[encrypted] = original;
        }
        
        // Store in secure closure
        mappingStore[MAP_STORE] = {
            upper: reverseUpper,
            lower: reverseLower,
            space: reverseSpace
        };
        mappingStore[HASH_STORE] = hash || CONFIG.hash;  // Store hash instead of nonce/secretKey
    }
    
    /**
     * Get reverse mappings (encrypted -> original) for decryption
     * Returns null if mappings not available
     */
    function getReverseMappings() {
        const maps = mappingStore[MAP_STORE];
        if (!maps || !maps.upper || !maps.lower) {
            return null;
        }
        // Return a copy to prevent external modification
        return {
            upper: Object.assign({}, maps.upper),
            lower: Object.assign({}, maps.lower),
            space: Object.assign({}, maps.space)
        };
        }
        
    /**
     * Compute forward mappings (original -> encrypted) from reverse mappings
     * Computed on-the-fly and not stored for security
     * Returns null if reverse mappings not available
     */
    function computeForwardMapping() {
        const reverseMaps = mappingStore[MAP_STORE];
        if (!reverseMaps || !reverseMaps.upper || !reverseMaps.lower) {
            return null;
        }
        
        // Invert reverse mappings to get forward mappings
        const forwardUpper = {};
        const forwardLower = {};
        const forwardSpace = {};
        
        // Invert upper: for each encrypted->original, create original->encrypted
        for (const [encrypted, original] of Object.entries(reverseMaps.upper)) {
            forwardUpper[original] = encrypted;
        }
        
        // Invert lower: for each encrypted->original, create original->encrypted
        for (const [encrypted, original] of Object.entries(reverseMaps.lower)) {
            forwardLower[original] = encrypted;
        }
        
        // Invert space: for each encrypted->original, create original->encrypted
        for (const [encrypted, original] of Object.entries(reverseMaps.space)) {
            forwardSpace[original] = encrypted;
        }
        
        return {
            upper: forwardUpper,
            lower: forwardLower,
            space: forwardSpace
        };
    }
    
    /**
     * Decrypt text using stored reverse mappings
     * Handles zero-width spaces and special characters
     */
    function decryptText(encryptedText) {
        const reverseMaps = mappingStore[MAP_STORE];
        if (!reverseMaps || !reverseMaps.upper || !reverseMaps.lower) {
            // Mappings not available, return as-is
            return encryptedText;
        }
        
        // Remove zero-width spaces (U+200B) that were inserted for word-breaking
        const textWithoutZWSP = encryptedText.replace(/\u200B/g, '');
        
        // Decrypt character by character
        const result = [];
        for (const char of textWithoutZWSP) {
            // Check uppercase first
            if (char in reverseMaps.upper) {
                result.push(reverseMaps.upper[char]);
            }
            // Check lowercase or space (space is in lower_map)
            else if (char in reverseMaps.lower) {
                result.push(reverseMaps.lower[char]);
            }
            // Check special characters
            else if (char in reverseMaps.space) {
                result.push(reverseMaps.space[char]);
            }
            // Handle newline (maps to null in some cases)
            else if (char === '\n') {
                result.push('\x00');
            }
            // Keep unmapped characters as-is
            else {
                result.push(char);
            }
        }
        
        return result.join('');
    }
    
    // ============================================================================
    // TEXT EXTRACTION
    // ============================================================================
    
    /**
     * Check if a text node is at the start of a new line.
     * A text node is at line start if:
     * 1. It's the first child of its parent, OR
     * 2. The previous sibling is a block element or <br> tag, OR
     * 3. All previous siblings are whitespace-only and we're the first non-whitespace content
     * 4. We're the first non-whitespace content in a block element (even if nested in inline elements)
     */
    function isTextAtLineStart(textNode) {
        if (!textNode || !textNode.parentElement) {
            return false;
        }
        
        const parent = textNode.parentElement;
        
        // Block-level elements that cause line breaks
        const blockElements = [
            'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
            'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'SECTION',
            'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE',
            'TABLE', 'TR', 'TD', 'TH', 'THEAD', 'TBODY', 'TFOOT',
            'DL', 'DT', 'DD', 'FORM', 'FIELDSET', 'LEGEND',
            'ADDRESS', 'HR', 'FIGURE', 'FIGCAPTION', 'BODY'
        ];
        
        // Helper to check if an element has visible text content
        function hasVisibleContent(elem) {
            if (elem.nodeType === Node.ELEMENT_NODE) {
                return elem.textContent.trim().length > 0;
            } else if (elem.nodeType === Node.TEXT_NODE) {
                return elem.textContent.trim().length > 0;
            }
            return false;
        }
        
        // Check if this is the first child
        if (!parent.firstChild || parent.firstChild === textNode) {
            return true;
        }
        
        // Find the previous sibling
        let prevSibling = textNode.previousSibling;
        
        // Skip over whitespace-only text nodes
        while (prevSibling) {
            if (prevSibling.nodeType === Node.ELEMENT_NODE) {
                // It's an element
                if (prevSibling.tagName === 'BR') {
                    return true;
                }
                if (blockElements.includes(prevSibling.tagName)) {
                    return true;
                }
                // If it's an inline element, check if it has visible content
                if (hasVisibleContent(prevSibling)) {
                    return false;
                }
                // Empty inline element, continue checking
                prevSibling = prevSibling.previousSibling;
            } else if (prevSibling.nodeType === Node.TEXT_NODE) {
                // It's a text node - check if it's only whitespace
                if (hasVisibleContent(prevSibling)) {
                    return false;
                }
                // Whitespace text, continue checking
                prevSibling = prevSibling.previousSibling;
            } else {
                break;
            }
        }
        
        // If we got here, all previous siblings were whitespace or None
        // Now walk up the tree to find block element ancestors and check if we're first content
        let current = parent;
        while (current) {
            if (current.nodeType === Node.ELEMENT_NODE && blockElements.includes(current.tagName)) {
                // Found a block element - check if we're the first non-whitespace content
                for (let sibling = current.firstChild; sibling; sibling = sibling.nextSibling) {
                    // Check if this sibling is or contains our text node
                    if (sibling === textNode) {
                        // Found ourselves - we're first
                        return true;
                    }
                    // Check if our text node is inside this sibling
                    if (sibling.nodeType === Node.ELEMENT_NODE && sibling.contains && sibling.contains(textNode)) {
                        // Our text is inside this sibling
                        // Check if any previous sibling has visible content
                        // (We already checked prev_siblings above, so if we got here, we're first)
                        return true;
                    }
                    // Check if this sibling has visible content before us
                    if (hasVisibleContent(sibling)) {
                        return false;
                    }
                }
                // We're the first non-whitespace content in this block element
                return true;
            } else if (current.parentElement) {
                current = current.parentElement;
            } else {
                break;
            }
        }
        
        return false;
    }
    
    /**
     * Extract all text nodes from the entire page
     * Returns array of text content and corresponding nodes
     */
    function extractAllTextNodes() {
        const textNodes = [];
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    // Skip if parent is in skip list
                    let parent = node.parentElement;
                    while (parent && parent !== document.body) {
                        if (CONFIG.skipSelectors.some(sel => {
                            try {
                                return parent.matches && parent.matches(sel);
                            } catch (e) {
                                return false;
                            }
                        })) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        parent = parent.parentElement;
                    }
                    
                    // Skip if text is too short
                    const text = node.textContent.trim();
                    if (text.length < CONFIG.minTextLength) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        
        let node;
        while (node = walker.nextNode()) {
            // CRITICAL: Preserve original text content (including leading/trailing spaces)
            // This is important for maintaining spacing around hyperlinks and other inline elements
            const originalText = node.textContent;
            const trimmedText = originalText.trim();
            
            // Only process if trimmed text meets minimum length
            if (trimmedText.length >= CONFIG.minTextLength) {
                // CRITICAL: Check for text-transform CSS and apply it BEFORE encryption
                // This allows legitimate text-transform (like uppercase headings) to work correctly
                // We'll neutralize the CSS after encryption to prevent double transformation
                let textToEncrypt = trimmedText;
                const parentElement = node.parentElement;
                if (parentElement) {
                    try {
                        // getComputedStyle returns the final computed value including inheritance
                        // So checking the parent should show text-transform even if it's on a grandparent
                        const computedStyle = window.getComputedStyle(parentElement);
                        const textTransform = computedStyle.textTransform;
                        
                        // Also check a few ancestors to be thorough (in case of edge cases)
                        let foundTransform = textTransform;
                        if (!foundTransform || foundTransform === 'none') {
                            let ancestor = parentElement.parentElement;
                            let depth = 0;
                            while (ancestor && ancestor !== document.body && depth < 3) {
                                const ancestorStyle = window.getComputedStyle(ancestor);
                                const ancestorTransform = ancestorStyle.textTransform;
                                if (ancestorTransform && ancestorTransform !== 'none') {
                                    foundTransform = ancestorTransform;
                                    break;
                                }
                                ancestor = ancestor.parentElement;
                                depth++;
                            }
                        }
                        
                        // If we found a text-transform, apply it
                        if (foundTransform && foundTransform !== 'none') {
                            // Apply the text-transform to the text before encryption
                            if (foundTransform === 'uppercase') {
                                textToEncrypt = trimmedText.toUpperCase();
                            } else if (foundTransform === 'lowercase') {
                                textToEncrypt = trimmedText.toLowerCase();
                            } else if (foundTransform === 'capitalize') {
                                // Capitalize first letter of each word
                                textToEncrypt = trimmedText.replace(/\b\w/g, char => char.toUpperCase());
                            }
                            
                            console.log(`✅ Applied text-transform: ${foundTransform} to "${trimmedText}" -> "${textToEncrypt}"`);
                            console.log(`   Element: ${parentElement.tagName}${parentElement.className ? '.' + parentElement.className.split(' ').join('.') : ''}${parentElement.id ? '#' + parentElement.id : ''}`);
                        } else {
                            // Debug logging for troubleshooting (only for first few or random sample)
                            const shouldLog = textNodes.length < 10 || Math.random() < 0.05; // Log first 10 or 5% randomly
                            if (shouldLog) {
                                console.log(`ℹ️  No text-transform for "${trimmedText.substring(0, 30)}${trimmedText.length > 30 ? '...' : ''}" - computed: ${textTransform || 'none'}`);
                                console.log(`   Element: ${parentElement.tagName}${parentElement.className ? '.' + parentElement.className.split(' ').join('.') : ''}${parentElement.id ? '#' + parentElement.id : ''}`);
                            }
                        }
                    } catch (e) {
                        // If getComputedStyle fails, use original text
                        console.warn('⚠️  Could not get computed style for text-transform:', e);
                    }
                }
                
                textNodes.push({
                    node: node,
                    text: textToEncrypt,  // Use transformed text for encryption (if text-transform was applied)
                    originalText: originalText,  // Preserve original for spacing
                    originalTrimmedText: trimmedText  // Store original trimmed text for reference
                });
            }
        }
        
        return textNodes;
    }
    
    // ============================================================================
    // FONT LOADING
    // ============================================================================
    
    let currentFontUrl = null;
    let fontLoadingPromise = null;
    
    /**
     * Load the custom encryption font
     * Always reloads if fontUrl changes to ensure we get the latest font
     */
    async function loadFont(fontUrl) {
        if (!fontUrl) {
            return false;
        }
        
        // If this is the same font URL and it's already loading, wait for it
        if (fontUrl === currentFontUrl && fontLoadingPromise) {
            return fontLoadingPromise;
        }
        
        // If font URL changed, remove old font and load new one
        if (currentFontUrl && fontUrl !== currentFontUrl) {
            // Remove old font from document.fonts
            try {
                const oldFonts = document.fonts.check(`12px ${CONFIG.fontName}`);
                // Delete all fonts with this name
                for (let i = document.fonts.length - 1; i >= 0; i--) {
                    const font = document.fonts[i];
                    if (font.family === CONFIG.fontName) {
                        document.fonts.delete(font);
                    }
                }
            } catch (e) {
                // Ignore errors when removing fonts
            }
            currentFontUrl = null;
            fontLoadingPromise = null;
        }
        
        // If already loaded with this URL, return immediately
        if (fontUrl === currentFontUrl) {
            return true;
        }
        
        fontLoadingPromise = (async () => {
            try {
                // Add cache-busting to font URL to prevent browser caching
                const cacheBuster = `?t=${Date.now()}`;
                const fontUrlWithCacheBust = fontUrl.includes('?') 
                    ? `${fontUrl}&t=${Date.now()}` 
                    : `${fontUrl}?t=${Date.now()}`;
                
                const font = new FontFace(CONFIG.fontName, `url(${fontUrlWithCacheBust})`, {
                    display: 'swap'
                });
                await font.load();
                document.fonts.add(font);
                currentFontUrl = fontUrl;
                return true;
            } catch (error) {
                console.error('Font loading failed:', error);
                currentFontUrl = null;
                fontLoadingPromise = null;
                return false;
            }
        })();
        
        return fontLoadingPromise;
    }
    
    // ============================================================================
    // API COMMUNICATION
    // ============================================================================
    
    /**
     * Encrypt all text from the page with a single API call
     */
    async function encryptPage() {
        try {
            // Extract all text nodes
            const textNodes = extractAllTextNodes();
            
            if (textNodes.length === 0) {
                console.log('No text nodes found to encrypt');
                return;
            }
            
            // Extract just the text content
            const texts = textNodes.map(tn => tn.text);
            
            // Call API once with all text
            // Only include hash if explicitly set (otherwise API uses server default)
            const requestBody = { texts: texts };
            if (CONFIG.hash !== null) {
                requestBody.hash = CONFIG.hash;
            } else if (CONFIG.secretKey !== null) {
                // Backward compatibility: support secretKey
                requestBody.secret_key = CONFIG.secretKey;
            }
            
            const response = await fetch(CONFIG.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(`API error: ${response.status} - ${error.error || response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.encrypted_texts || !Array.isArray(data.encrypted_texts)) {
                throw new Error('Invalid API response: missing encrypted_texts array');
            }
            
            // DEBUG: Print mapping and font URL
            console.log('='.repeat(70));
            console.log('ENCRYPTION DEBUG INFO');
            console.log('='.repeat(70));
            console.log('Font URL:', data.font_url);
            console.log('Font Filename:', data.font_filename);
            if (data.hash) {
                console.log('Hash:', data.hash.substring(0, 16) + '...');
            }
            console.log('Space Character (what space encrypts to):', JSON.stringify(data.space_char));
            
            if (data.upper_map && data.lower_map) {
                console.log('\nEncryption Mapping (original -> encrypted):');
                console.log('Upper map:', data.upper_map);
                console.log('Lower map:', data.lower_map);
                
                // Create reverse mapping (encrypted -> original) for font
                const fontMappingUpper = {};
                const fontMappingLower = {};
                for (const [orig, enc] of Object.entries(data.upper_map)) {
                    fontMappingUpper[enc] = orig;
                }
                for (const [orig, enc] of Object.entries(data.lower_map)) {
                    fontMappingLower[enc] = orig;
                }
                
                console.log('\nFont Mapping (encrypted -> original):');
                console.log('Upper font map:', fontMappingUpper);
                console.log('Lower font map:', fontMappingLower);
                
                // Check what space maps to in encryption
                if (data.lower_map[' '] !== undefined) {
                    const spaceEncryptsTo = data.lower_map[' '];
                    console.log(`\nSpace encrypts to: ${JSON.stringify(spaceEncryptsTo)}`);
                    
                    // Check what that character should display in font
                    if (fontMappingUpper[spaceEncryptsTo] !== undefined) {
                        console.log(`Font should display '${spaceEncryptsTo}' as: ${JSON.stringify(fontMappingUpper[spaceEncryptsTo])}`);
                    } else if (fontMappingLower[spaceEncryptsTo] !== undefined) {
                        console.log(`Font should display '${spaceEncryptsTo}' as: ${JSON.stringify(fontMappingLower[spaceEncryptsTo])}`);
                    } else {
                        console.log(`⚠️ WARNING: '${spaceEncryptsTo}' is not in font mapping!`);
                    }
                }
                
                // Check if actual space appears in encrypted text and what it should display
                const hasActualSpace = data.encrypted_texts.some(text => text && text.includes(' '));
                if (hasActualSpace) {
                    console.log('\n⚠️ Actual space character appears in encrypted text!');
                    if (fontMappingLower[' '] !== undefined) {
                        console.log(`Font should display actual space ' ' as: ${JSON.stringify(fontMappingLower[' '])}`);
                    } else {
                        console.log(`⚠️ WARNING: Actual space ' ' is not in font mapping!`);
                    }
                }
            }
            console.log('='.repeat(70));
            
            // Load font
            if (data.font_url) {
                console.log('Loading font from:', data.font_url);
                await loadFont(data.font_url);
            }
            
            // Get the character that space maps to (for word-breaking)
            const spaceChar = data.space_char;
            
            // CRITICAL: spaceChar is what space encrypts TO, and it renders as space via the font
            // This is what we should split on for span creation
            // (We don't need to find visualSpaceChar - spaceChar IS the character that renders as space)
            
            // Store spaceChar for search functionality
            mappingStore[SPACECHAR_STORE] = spaceChar;
            
            // Store decryption mappings for copy-paste functionality
            // Use hash from response (preferred)
            if (data.upper_map && data.lower_map && data.space_map) {
                storeDecryptionMappings(
                    data.upper_map,
                    data.lower_map,
                    data.space_map,
                    data.hash || null  // Store hash instead of nonce/secretKey
                );
            }
            
            // Update CONFIG.hash from response if provided
            if (data.hash) {
                CONFIG.hash = data.hash;
                mappingStore[HASH_STORE] = data.hash;
            }
            
            // Replace all text nodes with encrypted versions
            textNodes.forEach((textNode, index) => {
                const encryptedText = data.encrypted_texts[index];
                if (encryptedText) {
                    // CRITICAL: Preserve leading and trailing spaces from original text
                    // This maintains spacing around hyperlinks and other inline elements
                    // EXCEPT: Strip leading spaces if this text node is at the start of a new line
                    // This prevents spaces from appearing at the beginning of lines
                    const originalText = textNode.originalText || textNode.text;
                    let leadingSpaces = originalText.match(/^\s*/)?.[0] || '';
                    const trailingSpaces = originalText.match(/\s*$/)?.[0] || '';
                    
                    // Strip leading spaces if at line start
                    if (isTextAtLineStart(textNode.node)) {
                        leadingSpaces = '';
                    }
                    
                    // CRITICAL: Replace actual space characters with non-breaking spaces
                    // This prevents the browser from treating them as line-break points
                    // The font will still render them as the correct glyph (e.g., 'J')
                    // Non-breaking space (U+00A0) has the same glyph mapping as regular space (U+0020)
                    // in our font, so it will display correctly
                    let processedText = encryptedText.replace(/\u0020/g, '\u00A0');  // Replace regular spaces with non-breaking spaces
                    
                    // CRITICAL: Split text at spaceChar (the character that space encrypts to, which renders as space via font)
                    // This allows CSS to break at word boundaries (where original spaces were) without using zero-width spaces
                    const parent = textNode.node.parentElement;
                    if (parent && spaceChar) {
                        // Split text at spaceChar (what space encrypts to, which renders as space via font)
                        const escapedSpaceChar = spaceChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const parts = processedText.split(new RegExp(`(${escapedSpaceChar})`, 'g'));
                        
                        // Create a document fragment to hold the wrapped segments
                        const fragment = document.createDocumentFragment();
                        
                        // Add leading spaces as spaceChar characters (preserves spacing around links)
                        // Use spaceChar instead of actual spaces so they render correctly through the font
                        if (leadingSpaces) {
                            const leadingSpaceCount = leadingSpaces.length;
                            const leadingSpaceSpan = document.createElement('span');
                            leadingSpaceSpan.textContent = spaceChar.repeat(leadingSpaceCount);
                            leadingSpaceSpan.style.display = 'inline-block';
                            leadingSpaceSpan.style.whiteSpace = 'nowrap';
                            fragment.appendChild(leadingSpaceSpan);
                        }
                        
                        let lastWordSpan = null; // Track the last word span (not delimiter span) for merging whitespace
                        
                        parts.forEach((part, partIndex) => {
                            if (part === '') return; // Skip empty parts
                            
                            if (part === spaceChar) {
                                // This is the spaceChar (what space encrypts to, which renders as space via font) - wrap it in a span that allows breaking after it
                                // The font should render spaceChar as a space glyph, but make it invisible if font doesn't work
                                const span = document.createElement('span');
                                span.textContent = part;
                                span.style.display = 'inline-block'; // Allow breaking between inline-block elements
                                span.style.whiteSpace = 'nowrap'; // Prevent breaking within the spaceChar
                                // Make spaceChar invisible but preserve spacing - font should render it as space
                                span.style.color = 'transparent';
                                span.style.width = '0.3em'; // Approximate space width
                                span.style.minWidth = '0.3em';
                                span.style.overflow = 'hidden';
                                span.style.pointerEvents = 'none'; // Let parent handle cursor (fixes cursor flickering at word boundaries)
                                fragment.appendChild(span);
                                // Don't update lastWordSpan - this is a delimiter, not a word
                            } else {
                                // This is a word segment - wrap it in a span that cannot break internally
                                // CRITICAL: Preserve ALL content including consecutive NBSPs (from multiple 'e' characters that encrypt to space)
                                // Only skip parts that are ONLY whitespace with NO other content
                                const hasNonWhitespace = part.trim().length > 0;
                                
                                if (hasNonWhitespace) {
                                    // Part has non-whitespace content - create span with full content (preserving all NBSPs)
                                    const span = document.createElement('span');
                                    span.textContent = part; // Keep original part (with all internal spaces/NBSPs preserved)
                                    span.style.display = 'inline-block'; // Allow breaking between inline-block elements
                                    span.style.whiteSpace = 'nowrap'; // CRITICAL: Prevent breaking within words
                                    span.style.wordBreak = 'keep-all'; // Additional protection against breaking
                                    span.style.cursor = 'text'; // Force text cursor (CSS selectors are fragile)
                                    fragment.appendChild(span);
                                    lastWordSpan = span; // Update last word span for potential merging
                                } else {
                                    // Part is ONLY whitespace/NBSP (no other content) - merge with last WORD span to avoid creating separate spans
                                    // This handles cases where actual spaces appear as separate parts from the split
                                    // CRITICAL: Merge with lastWordSpan (not lastChild) to preserve consecutive NBSPs correctly
                                    if (lastWordSpan && lastWordSpan.textContent !== undefined) {
                                        lastWordSpan.textContent += part; // Preserve all NBSPs when merging
                                    } else if (fragment.lastChild && fragment.lastChild.textContent !== undefined) {
                                        // Fallback: if no word span yet, merge with last child (shouldn't happen often)
                                        fragment.lastChild.textContent += part;
                                    }
                                }
                            }
                        });
                        
                        // Add trailing spaces as spaceChar characters (preserves spacing around links)
                        // Use spaceChar instead of actual spaces so they render correctly through the font
                        if (trailingSpaces) {
                            const trailingSpaceCount = trailingSpaces.length;
                            const trailingSpaceSpan = document.createElement('span');
                            trailingSpaceSpan.textContent = spaceChar.repeat(trailingSpaceCount);
                            trailingSpaceSpan.style.display = 'inline-block';
                            trailingSpaceSpan.style.whiteSpace = 'nowrap';
                            fragment.appendChild(trailingSpaceSpan);
                        }
                        
                        // CRITICAL: After creating all spans, check if the container will start on a new line.
                        // If so, remove all leading spaceChar ('O') spans to prevent spaces from appearing at the beginning of lines.
                        const containerWillStartLine = isTextAtLineStart(textNode.node);
                        if (fragment.firstChild && containerWillStartLine && spaceChar) {
                            // Keep removing 'O' (spaceChar) spans from the start until we hit a non-spaceChar span
                            while (fragment.firstChild) {
                                const firstChild = fragment.firstChild;
                                // Check if first child is a span containing only spaceChar characters
                                if (firstChild.nodeType === Node.ELEMENT_NODE && 
                                    firstChild.tagName === 'SPAN' && 
                                    firstChild.textContent) {
                                    const text = firstChild.textContent.trim();
                                    // Check if it's only spaceChar (remove all spaceChar and see if anything remains)
                                    const textWithoutSpaceChar = text.replace(new RegExp(spaceChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
                                    if (textWithoutSpaceChar === '' && text.length > 0) {
                                        // First child is a leading space span - remove it
                                        fragment.removeChild(firstChild);
                                        continue; // Check next child
                                    }
                                    // Also check if it's exactly a single spaceChar
                                    if (text === spaceChar) {
                                        // Single spaceChar at start of line - remove it
                                        fragment.removeChild(firstChild);
                                        continue; // Check next child
                                    }
                                }
                                // If we get here, first child is not a spaceChar span, so stop
                                break;
                            }
                        }
                        
                        // Replace the original text node with the fragment
                        parent.insertBefore(fragment, textNode.node);
                        textNode.node.remove();
                        
                        // Apply font and rendering properties to parent element
                        parent.style.fontFamily = `${CONFIG.fontName}, sans-serif`;
                        parent.style.textRendering = 'optimizeLegibility';
                        parent.style.fontFeatureSettings = '"kern" 1';
                        parent.style.fontKerning = 'normal';
                        parent.style.whiteSpace = 'normal'; // Allow breaking between inline-block children (spans)
                        // Allow breaking between inline-block elements
                        parent.style.wordBreak = 'normal';
                        parent.style.overflowWrap = 'normal';
                        parent.style.wordWrap = 'normal';
                        // Prevent text clipping at line breaks
                        parent.style.overflow = 'visible';
                        parent.style.textOverflow = 'clip';
                        parent.style.setProperty('height', 'auto', 'important'); // Override any height: 100% on parent elements
                        // CRITICAL: Neutralize text-transform after encryption
                        // Text-transform was applied BEFORE encryption to preserve legitimate use cases
                        // We neutralize it here to prevent double transformation of encrypted text
                        parent.style.setProperty('text-transform', 'none', 'important');
                        // Force text cursor on parent to prevent alternating cursor between spans
                        parent.style.cursor = 'text';
                    }
                }
            });
            
            // Post-process: Remove leading 'O' (spaceChar) spans from containers that are first children of block elements
            // This catches cases where the container itself starts on a new line
            if (spaceChar) {
                const blockElements = ['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 
                                     'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 
                                     'NAV', 'ASIDE', 'TABLE', 'TR', 'TD', 'TH', 'HR', 'FIGURE', 'FIGCAPTION', 'BODY',
                                     'MAIN', 'FORM', 'FIELDSET', 'DL', 'DT', 'DD'];
                
                // Find all containers (spans with white-space: normal)
                const containers = document.querySelectorAll('span[style*="white-space: normal"]');
                containers.forEach(container => {
                    // Ensure container has height: auto !important
                    container.style.setProperty('height', 'auto', 'important');
                    
                    // Walk up the DOM tree and set height: auto !important on all ancestors
                    let current = container.parentElement;
                    while (current && current !== document.body) {
                        if (blockElements.includes(current.tagName) || 
                            ['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE'].includes(current.tagName) ||
                            (current.className && (current.className.includes('companion') || current.className.includes('container')))) {
                            current.style.setProperty('height', 'auto', 'important');
                        }
                        current = current.parentElement;
                    }
                    
                    const parent = container.parentElement;
                    if (parent && blockElements.includes(parent.tagName)) {
                            
                            // Check if container is at start of line
                            let isAtLineStart = false;
                            
                            // Check if container is first child
                            if (parent.firstChild === container) {
                                isAtLineStart = true;
                            } else {
                                // Check previous siblings
                                let prev = container.previousSibling;
                                while (prev) {
                                    if (prev.nodeType === Node.ELEMENT_NODE) {
                                        if (prev.tagName === 'BR' || blockElements.includes(prev.tagName)) {
                                            isAtLineStart = true;
                                            break;
                                        }
                                        if (prev.textContent.trim()) {
                                            break;
                                        }
                                    } else if (prev.nodeType === Node.TEXT_NODE && prev.textContent.trim()) {
                                        break;
                                    }
                                    prev = prev.previousSibling;
                                }
                                
                                // If all previous siblings were whitespace and parent is block, we're at line start
                                if (!isAtLineStart) {
                                    let prev = container.previousSibling;
                                    let allPrevWhitespace = true;
                                    while (prev) {
                                        if (prev.nodeType === Node.ELEMENT_NODE) {
                                            if (blockElements.includes(prev.tagName) || prev.tagName === 'BR') {
                                                allPrevWhitespace = false;
                                                break;
                                            }
                                            if (prev.textContent.trim()) {
                                                allPrevWhitespace = false;
                                                break;
                                            }
                                        } else if (prev.nodeType === Node.TEXT_NODE && prev.textContent.trim()) {
                                            allPrevWhitespace = false;
                                            break;
                                        }
                                        prev = prev.previousSibling;
                                    }
                                    if (allPrevWhitespace) {
                                        isAtLineStart = true;
                                    }
                                }
                            }
                            
                            // If container is at line start, remove leading 'O' (spaceChar) spans
                            if (isAtLineStart && container.firstChild) {
                                // Keep removing 'O' spans from the start
                                while (container.firstChild) {
                                    const firstChild = container.firstChild;
                                    if (firstChild.nodeType === Node.ELEMENT_NODE && 
                                        firstChild.tagName === 'SPAN' && 
                                        firstChild.textContent) {
                                        const text = firstChild.textContent.trim();
                                        // Check if it's only spaceChar
                                        const textWithoutSpaceChar = text.replace(new RegExp(spaceChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
                                        if (textWithoutSpaceChar === '' && text.length > 0) {
                                            container.removeChild(firstChild);
                                            continue;
                                        }
                                        if (text === spaceChar) {
                                            container.removeChild(firstChild);
                                            continue;
                                        }
                                    }
                                    // If we get here, first child is not a spaceChar span, so stop
                                    break;
                                }
                            }
                    }
                });
            }
            
            // Inject CSS to override height: 100% for containers and companion columns
            // Also override text-transform to prevent case conversion issues
            if (!document.getElementById('encrypted-height-override')) {
                const style = document.createElement('style');
                style.id = 'encrypted-height-override';
                style.textContent = `
                    span[style*="white-space: normal"],
                    span[style*="white-space: normal"] *,
                    [class*="companion"],
                    [class*="companion"] *,
                    [class*="container"],
                    [class*="container"] *,
                    :has(span[style*="white-space: normal"]) {
                        height: auto !important;
                    }
                    /* CRITICAL: Neutralize text-transform after encryption */
                    /* Text-transform is applied BEFORE encryption to preserve legitimate use cases */
                    /* We neutralize it here to prevent double transformation of encrypted text */
                    span[style*="white-space: normal"],
                    span[style*="white-space: normal"] *,
                    span[style*="display: inline-block"][style*="white-space: nowrap"],
                    span[style*="display: inline-block"][style*="white-space: nowrap"] * {
                        text-transform: none !important;
                    }
                    /* Force text cursor on all encrypted spans including transparent space markers */
                    /* This prevents cursor alternating between text and pointer on hover */
                    span[style*="display: inline-block"][style*="white-space: nowrap"] {
                        cursor: text !important;
                    }
                    /* Force text cursor on document body and text containers */
                    /* Prevents cursor flickering in gaps between inline-block spans */
                    body, article, main, section, div, p, span {
                        cursor: text !important;
                    }
                    /* Nuclear option: force text cursor on html element */
                    html, html * {
                        cursor: text !important;
                    }
                `;
                document.head.appendChild(style);
            }

            // Also set cursor directly on html and body via JS (belt and suspenders)
            document.documentElement.style.setProperty('cursor', 'text', 'important');
            document.body.style.setProperty('cursor', 'text', 'important');

            console.log(`✅ Encrypted ${textNodes.length} text nodes on the page`);
            
        } catch (error) {
            console.error('Page encryption failed:', error);
        }
    }
    
    // ============================================================================
    // COPY-PASTE INTERCEPTION
    // ============================================================================
    
    /**
     * Intercept copy events and replace clipboard content with decrypted text
     * This allows users to copy-paste normally while scrapers see encrypted text
     */
    function setupCopyInterception() {
        document.addEventListener('copy', function(e) {
            // Only intercept if we have hash for API calls
            const hash = mappingStore[HASH_STORE] || CONFIG.hash;
            
            if (!hash) {
                return; // Let default copy behavior proceed
            }
            
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) {
                return; // No selection, let default behavior proceed
            }
            
            // Get selected text (this will be the encrypted text)
            const selectedText = selection.toString();
            
            if (!selectedText || selectedText.trim().length === 0) {
                return; // Empty selection, let default behavior proceed
            }
            
            // Prevent default copy behavior
            e.preventDefault();
            
            // Get API base URL from endpoint
            let apiBaseUrl = CONFIG.apiEndpoint;
            try {
                // Extract base URL from endpoint (e.g., /api/encrypt/page -> origin)
                const endpointUrl = new URL(apiBaseUrl, window.location.href);
                apiBaseUrl = endpointUrl.origin;
            } catch (e) {
                // If parsing fails, use current origin
                apiBaseUrl = window.location.origin;
            }
            
            // Normalize text (remove zero-width spaces and normalize non-breaking spaces)
            const textWithoutZWSP = selectedText.replace(/\u200B/g, '');
            const normalizedText = textWithoutZWSP.replace(/\u00A0/g, ' ');
            
            // Decrypt synchronously using XMLHttpRequest (required for clipboardData API)
            let decryptedText = selectedText; // Default to encrypted text if decryption fails
            
            try {
                const xhr = new XMLHttpRequest();
                const apiUrl = `${apiBaseUrl}/api/decrypt`;
                
                xhr.open('POST', apiUrl, false); // false = synchronous
                xhr.setRequestHeader('Content-Type', 'application/json');
                
                // Send request with hash
                xhr.send(JSON.stringify({
                    encrypted: normalizedText,
                    hash: mappingStore[HASH_STORE] || CONFIG.hash
                }));
                
                // Check response
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        decryptedText = data.decrypted || selectedText;
                    } catch (parseError) {
                        console.error('Failed to parse decryption response:', parseError);
                        decryptedText = selectedText;
                    }
                } else {
                    console.error('Decryption API returned status:', xhr.status);
                    decryptedText = selectedText;
                }
            } catch (error) {
                console.error('Decryption API call failed:', error);
                decryptedText = selectedText;
            }
            
            // Replace clipboard content with decrypted text
            e.clipboardData.setData('text/plain', decryptedText);
            
            // Optional: Log for debugging (remove in production)
            if (CONFIG.debug) {
                console.log('Copy intercepted: decrypted text for clipboard');
            }
        }, true); // Use capture phase to intercept early
    }
    
    // ============================================================================
    // CUSTOM SEARCH FUNCTIONALITY
    // ============================================================================
    
    // Search state (private closure)
    let searchState = {
        overlay: null,
        input: null,
        matchCounter: null,
        prevButton: null,
        nextButton: null,
        closeButton: null,
        currentMatches: [],
        currentMatchIndex: -1,
        highlightElements: [],
        lastOriginalQuery: '', // Store original query for case-insensitive search
        positionMap: null  // NEW: Cache position mapping for server-side search
    };
    
    /**
     * Expand ligatures in text (same as server-side)
     */
    const LIGATURES = {"\ufb00":"ff","\ufb01":"fi","\ufb02":"fl","\ufb03":"ffi","\ufb04":"ffl"};
    function expandLigatures(text) {
        return text.split('').map(ch => LIGATURES[ch] || ch).join('');
    }
    
    /**
     * Encrypt search query using the API (no mappings exposed in HTML)
     */
    async function encryptSearchQuery(query) {
        if (!query || query.length === 0) {
            return '';
        }
        
        const hash = mappingStore[HASH_STORE] || CONFIG.hash;
        
        console.log('🔍 encryptSearchQuery - hash:', hash ? hash.substring(0, 16) + '...' : 'null');
        
        if (!hash) {
            console.warn('⚠️ Missing hash - cannot encrypt query');
            console.warn('   HASH_STORE:', mappingStore[HASH_STORE]);
            console.warn('   CONFIG.hash:', CONFIG.hash);
            return query; // Return as-is if config is missing
        }
        
        // Get API base URL from endpoint
        let apiBaseUrl = CONFIG.apiEndpoint;
        try {
            // Extract base URL from endpoint (e.g., /api/encrypt/page -> origin)
            const endpointUrl = new URL(apiBaseUrl, window.location.href);
            apiBaseUrl = endpointUrl.origin;
        } catch (e) {
            // If parsing fails, use current origin
            apiBaseUrl = window.location.origin;
        }
        
        try {
            const response = await fetch(`${apiBaseUrl}/api/encrypt/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: query,
                    hash: hash
                })
            });
            
            if (!response.ok) {
                console.warn('Encrypt query API call failed:', response.status);
                return query; // Return original if API fails
            }
            
            const data = await response.json();
            return data.encrypted || query;
        } catch (error) {
            console.warn('Error calling encrypt query API:', error);
            return query; // Return original if API call fails
        }
    }
    
    /**
     * Check if an element contains encrypted text (spans with encryption styling)
     */
    function isEncryptedElement(element) {
        if (!element) return false;
        
        // Check if element itself has encrypted font
        const fontFamily = window.getComputedStyle(element).fontFamily;
        if (fontFamily.includes(CONFIG.fontName)) {
            return true;
        }
        
        // Check all descendant spans for encryption styling
        // Encrypted spans have display: inline-block and white-space: nowrap
        const allSpans = element.querySelectorAll('span');
        for (let span of allSpans) {
            const style = window.getComputedStyle(span);
            if (style.display === 'inline-block' && style.whiteSpace === 'nowrap') {
                return true;
            }
        }
        
        // Also check direct children for encrypted spans
        for (let child of element.children) {
            if (child.tagName === 'SPAN') {
                const style = window.getComputedStyle(child);
                if (style.display === 'inline-block' && style.whiteSpace === 'nowrap') {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * Extract all text nodes for search
     * Handles span-wrapped text by getting textContent from parent elements
     * Works with multiple fonts by checking for encrypted styling instead of specific font name
     */
    function extractTextNodesForSearch() {
        const textNodes = [];
        const processedParents = new Set();
        
        // First, try to find all elements that contain encrypted text
        // Look for elements with encrypted spans or encrypted font
        const allElements = document.querySelectorAll('*');
        const encryptedContainers = new Set();
        
        allElements.forEach(element => {
            if (isEncryptedElement(element)) {
                // Find the topmost parent that contains encrypted text
                let container = element;
                while (container && container !== document.body) {
                    const parent = container.parentElement;
                    if (parent && isEncryptedElement(parent)) {
                        container = parent;
                    } else {
                        break;
                    }
                }
                encryptedContainers.add(container);
            }
        });
        
        // Process each encrypted container
        encryptedContainers.forEach(container => {
            if (processedParents.has(container)) {
                return;
            }
            processedParents.add(container);
            
            // Get all text content from this container
            const text = container.textContent;
            if (!text || text.trim().length === 0) {
                return;
            }
            
            // Remove zero-width spaces but KEEP non-breaking spaces as-is
            // The DOM text has non-breaking spaces, so we need to preserve them for matching
            const normalizedText = text.replace(/\u200B/g, '');
            
            if (normalizedText.trim().length > 0) {
                // Find the first text node in this container as a reference
                const walker = document.createTreeWalker(
                    container,
                    NodeFilter.SHOW_TEXT,
                    null
                );
                const firstTextNode = walker.nextNode();
                
                textNodes.push({
                    node: firstTextNode || container.firstChild,
                    parent: container,
                    text: normalizedText
                });
            }
        });
        
        // Fallback: if no encrypted containers found, try to find text nodes directly
        // This handles cases where encryption styling might not be detected
        if (textNodes.length === 0) {
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function(node) {
                        // Skip if parent is in skip list
                        let parent = node.parentElement;
                        while (parent && parent !== document.body) {
                            if (CONFIG.skipSelectors.some(sel => {
                                try {
                                    return parent.matches && parent.matches(sel);
                                } catch (e) {
                                    return false;
                                }
                            })) {
                                return NodeFilter.FILTER_REJECT;
                            }
                            parent = parent.parentElement;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            
            const processedTextNodes = new Set();
            let node;
            while (node = walker.nextNode()) {
                // Get the parent element
                let parent = node.parentElement;
                while (parent && parent !== document.body) {
                    if (!processedTextNodes.has(parent)) {
                        processedTextNodes.add(parent);
                        const text = parent.textContent;
                        // Remove zero-width spaces but KEEP non-breaking spaces as-is
                        const normalizedText = text.replace(/\u200B/g, '');
                        if (normalizedText.trim().length > 0) {
                            textNodes.push({
                                node: node,
                                parent: parent,
                                text: normalizedText
                            });
                        }
                    }
                    break;
                }
            }
        }
        
        return textNodes;
    }

    function buildTextPositionMap() {
        /**
         * Build mapping from global character positions to DOM text nodes.
         * Allows converting server-returned position indices into DOM locations.
         */
        const textNodes = extractTextNodesForSearch();

        const positionMap = [];
        let globalCharIndex = 0;

        for (const textNodeInfo of textNodes) {
            const text = textNodeInfo.text; // Encrypted text from DOM

            positionMap.push({
                node: textNodeInfo.node,
                parent: textNodeInfo.parent,
                startIndex: globalCharIndex,
                endIndex: globalCharIndex + text.length,
                length: text.length
            });

            globalCharIndex += text.length;
        }

        return {
            positionMap: positionMap,
            totalLength: globalCharIndex
        };
    }

    async function searchServerSide(query) {
        /**
         * Call server-side search API.
         * Server decrypts HTML, searches, returns only match positions.
         */
        try {
            const response = await fetch(`${CONFIG.apiBaseUrl}/api/search/find-matches`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query: query,
                    hash: CONFIG.hash
                })
            });

            if (!response.ok) {
                console.error('Server search failed:', response.status);
                return [];
            }

            const data = await response.json();
            return data.matches || [];
        } catch (error) {
            console.error('Error calling server search:', error);
            return [];
        }
    }

    function mapPositionsToDOMNodes(matches, positionMap) {
        /**
         * Convert server-returned position indices to DOM node locations.
         * matches: Array of {start, end} from server
         * positionMap: Array of {node, parent, startIndex, endIndex} from client
         */
        const domMatches = [];

        for (const match of matches) {
            const matchStart = match.start;
            const matchEnd = match.end;

            // Find which DOM node(s) contain this match
            for (const nodeInfo of positionMap) {
                const nodeStart = nodeInfo.startIndex;
                const nodeEnd = nodeInfo.endIndex;

                // Check if this node contains any part of the match
                const overlapStart = Math.max(matchStart, nodeStart);
                const overlapEnd = Math.min(matchEnd, nodeEnd);

                if (overlapStart < overlapEnd) {
                    // This node contains part of the match
                    const offsetInNode = overlapStart - nodeStart;
                    const lengthInNode = overlapEnd - overlapStart;

                    domMatches.push({
                        node: nodeInfo.node,
                        parent: nodeInfo.parent,
                        startIndex: offsetInNode,
                        endIndex: offsetInNode + lengthInNode,
                        text: nodeInfo.node.textContent.substring(offsetInNode, offsetInNode + lengthInNode)
                    });
                }
            }
        }

        return domMatches;
    }

    /**
     * Search DOM for encrypted query
     * Returns array of match objects: {node, parent, startIndex, endIndex, text}
     */
    function searchEncryptedDOM(encryptedQuery) {
        if (!encryptedQuery || encryptedQuery.length === 0) {
            return [];
        }
        
        const matches = [];
        const textNodes = extractTextNodesForSearch();
        console.log('Extracted text nodes for search:', textNodes.length);
        
        if (textNodes.length === 0) {
            console.warn('No encrypted text nodes found for search');
            return [];
        }
        
        // CRITICAL: The encrypted text in the DOM structure:
        // 1. Regular spaces in encrypted text are replaced with non-breaking spaces (\u00A0)
        // 2. The spaceChar (character that space encrypts to) is used to split words
        // 3. So DOM textContent = "word1" + spaceChar + "word2" + spaceChar + "word3"
        //    but any regular spaces in the encrypted text become NBSP
        //
        // The encrypted query from API will have spaceChar where spaces were, not regular spaces
        // So we need to:
        // - Remove zero-width spaces
        // - Replace regular spaces with NBSP (for any spaces that might be in encrypted text)
        // - Keep spaceChar as-is (it's already in the query from API)
        const normalizedQuery = encryptedQuery.replace(/\u200B/g, '').replace(/\u0020/g, '\u00A0');
        
        console.log('   Normalized query:', JSON.stringify(normalizedQuery));
        console.log('   Normalized query length:', normalizedQuery.length);
        console.log('   Normalized query chars:', Array.from(normalizedQuery).map(c => {
            if (c === ' ') return '[SPACE]';
            if (c === '\u00A0') return '[NBSP]';
            if (c === '\u200B') return '[ZWSP]';
            return c.charCodeAt(0) < 32 ? `[${c.charCodeAt(0)}]` : c;
        }).join(''));
        
        // Get spaceChar from stored data if available
        const spaceChar = mappingStore[SPACECHAR_STORE];
        if (spaceChar) {
            console.log('   SpaceChar (what space encrypts to):', JSON.stringify(spaceChar));
        } else {
            console.log('   ⚠️ SpaceChar not stored - cannot identify space characters in text');
        }
        
        let totalTextLength = 0;
        let sampleTextShown = false;
        for (const textNode of textNodes) {
            const text = textNode.text;
            totalTextLength += text.length;
            
            // Show detailed analysis of first text node
            if (!sampleTextShown && text.length > 0) {
                sampleTextShown = true;
                console.log(`   Sample text node (first 100 chars):`, JSON.stringify(text.substring(0, 100)));
                console.log(`   Sample text chars:`, Array.from(text.substring(0, 100)).map(c => {
                    if (c === ' ') return '[SPACE]';
                    if (c === '\u00A0') return '[NBSP]';
                    if (c === '\u200B') return '[ZWSP]';
                    if (spaceChar && c === spaceChar) return '[SPACECHAR]';
                    return c.charCodeAt(0) < 32 ? `[${c.charCodeAt(0)}]` : c;
                }).join(''));
                
                // Check if query appears in text
                const queryIndex = text.indexOf(normalizedQuery);
                if (queryIndex >= 0) {
                    console.log(`   ✓ Query found at index ${queryIndex} in sample text`);
                    console.log(`   Context:`, JSON.stringify(text.substring(Math.max(0, queryIndex - 10), queryIndex + normalizedQuery.length + 10)));
                } else {
                    console.log(`   ✗ Query NOT found in sample text`);
                    // Try to find similar patterns
                    if (normalizedQuery.length > 0) {
                        const firstChar = normalizedQuery[0];
                        const firstCharIndex = text.indexOf(firstChar);
                        if (firstCharIndex >= 0) {
                            console.log(`   First char '${firstChar}' found at index ${firstCharIndex}`);
                            console.log(`   Context around first char:`, JSON.stringify(text.substring(Math.max(0, firstCharIndex - 10), firstCharIndex + normalizedQuery.length + 10)));
                        }
                    }
                }
            }
            
            let startIndex = 0;
            let foundInThisNode = 0;
            
            // Search for all occurrences
            while (true) {
                const index = text.indexOf(normalizedQuery, startIndex);
                if (index === -1) {
                    break;
                }
                
                foundInThisNode++;
                matches.push({
                    node: textNode.node,
                    parent: textNode.parent || textNode.node.parentElement,
                    startIndex: index,
                    endIndex: index + normalizedQuery.length,
                    text: normalizedQuery
                });
                
                startIndex = index + 1;
            }
            
            if (foundInThisNode > 0) {
                console.log(`   ✓ Found ${foundInThisNode} match(es) in text node ${textNodes.indexOf(textNode)}`);
            }
        }
        
        console.log(`   Total text length searched: ${totalTextLength} chars`);
        console.log('   Found', matches.length, 'total matches');
        return matches;
    }
    
    /**
     * Clear all search highlights
     */
    function clearHighlights() {
        searchState.highlightElements.forEach(el => {
            if (el.parentNode) {
                const parent = el.parentNode;
                parent.replaceChild(document.createTextNode(el.textContent), el);
                parent.normalize();
            }
        });
        searchState.highlightElements = [];
    }
    
    /**
     * Highlight matches in the DOM
     * Uses parent element and Range API for reliable highlighting across span boundaries
     */
    function highlightMatches(matches, currentIndex) {
        // Clear previous highlights first
        clearHighlights();
        
        if (matches.length === 0) {
            return;
        }
        
        // Group matches by parent element
        const matchesByParent = new Map();
        matches.forEach((match, index) => {
            const parent = match.parent;
            if (!parent) return;
            
            if (!matchesByParent.has(parent)) {
                matchesByParent.set(parent, []);
            }
            matchesByParent.get(parent).push({...match, matchIndex: index});
        });
        
        // Process each parent element
        matchesByParent.forEach((parentMatches, parent) => {
            if (!parent || !parent.parentNode) {
                return;
            }
            
            // Get all text nodes within this parent
            const walker = document.createTreeWalker(
                parent,
                NodeFilter.SHOW_TEXT,
                null
            );
            
            const textNodes = [];
            let node;
            while (node = walker.nextNode()) {
                textNodes.push(node);
            }
            
            if (textNodes.length === 0) {
                return;
            }
            
            // Build a map of character positions to text nodes
            let charOffset = 0;
            const charToNode = [];
            textNodes.forEach(textNode => {
                const text = textNode.textContent.replace(/\u200B/g, '').replace(/\u00A0/g, ' ');
                for (let i = 0; i < text.length; i++) {
                    charToNode.push({
                        node: textNode,
                        offset: i,
                        globalOffset: charOffset + i
                    });
                }
                charOffset += text.length;
            });
            
            // Process matches in reverse order (end to start) to preserve indices
            parentMatches.sort((a, b) => b.startIndex - a.startIndex);
            
            parentMatches.forEach(match => {
                try {
                    const startChar = charToNode[match.startIndex];
                    const endChar = charToNode[match.endIndex - 1];
                    
                    if (!startChar || !endChar) {
                        return;
                    }
                    
                    // Create range
                    const range = document.createRange();
                    range.setStart(startChar.node, startChar.offset);
                    range.setEnd(endChar.node, endChar.offset + 1);
                    
                    // Create highlight element
                    const highlight = document.createElement('mark');
                    highlight.className = 'encrypted-search-highlight';
                    if (match.matchIndex === currentIndex) {
                        highlight.className += ' encrypted-search-current';
                    }
                    highlight.style.backgroundColor = match.matchIndex === currentIndex 
                        ? '#ffeb3b' 
                        : '#fff59d';
                    highlight.style.padding = '0';
                    highlight.style.borderRadius = '2px';
                    
                    // Surround contents
                    try {
                        range.surroundContents(highlight);
                        searchState.highlightElements.push(highlight);
                    } catch (e) {
                        // If surroundContents fails, extract and insert
                        const contents = range.extractContents();
                        highlight.appendChild(contents);
                        range.insertNode(highlight);
                        searchState.highlightElements.push(highlight);
                    }
                } catch (e) {
                    console.warn('Error highlighting match:', e);
                }
            });
        });
        
        // Scroll current match into view
        if (currentIndex >= 0 && currentIndex < searchState.highlightElements.length) {
            const highlight = searchState.highlightElements[currentIndex];
            if (highlight && highlight.parentNode) {
                highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
    
    /**
     * Navigate to next/previous match
     */
    function navigateToMatch(direction) {
        const matches = searchState.currentMatches;
        if (matches.length === 0) {
            return;
        }
        
        if (direction === 'next') {
            searchState.currentMatchIndex = (searchState.currentMatchIndex + 1) % matches.length;
        } else if (direction === 'prev') {
            searchState.currentMatchIndex = searchState.currentMatchIndex <= 0 
                ? matches.length - 1 
                : searchState.currentMatchIndex - 1;
        }
        
        highlightMatches(matches, searchState.currentMatchIndex);
        updateMatchCounter();
    }
    
    /**
     * Update match counter display
     */
    function updateMatchCounter() {
        const count = searchState.currentMatches.length;
        const index = searchState.currentMatchIndex;
        
        if (count === 0) {
            searchState.matchCounter.textContent = 'No matches';
        } else {
            searchState.matchCounter.textContent = `${index + 1} of ${count}`;
        }
    }
    
    /**
     * Handle search input
     */
    async function handleSearchInput(event) {
        try {
            console.log('🔍 handleSearchInput called');
            const query = event.target.value;
            console.log('🔍 Query value:', query);
            searchState.lastOriginalQuery = query;

            if (!query || query.trim().length === 0) {
                console.log('🔍 Empty query, clearing highlights');
                clearHighlights();
                searchState.currentMatches = [];
                searchState.currentMatchIndex = -1;
                updateMatchCounter();
                return;
            }

            // Show visible indicator that search is running
            if (searchState.matchCounter) {
                searchState.matchCounter.textContent = 'Searching...';
                searchState.matchCounter.style.color = '#0066cc';
            }

            // Build position map if not cached
            if (!searchState.positionMap) {
                console.log('🔍 Building position map...');
                const mapData = buildTextPositionMap();
                searchState.positionMap = mapData.positionMap;
                console.log(`🔍 Position map ready: ${mapData.totalLength} characters`);
            }

            // Call server-side search
            console.log(`🔍 Searching for: "${query}"`);
            const serverMatches = await searchServerSide(query);
            console.log(`🔍 Server found ${serverMatches.length} matches`);

            // Map server positions to DOM nodes
            const domMatches = mapPositionsToDOMNodes(serverMatches, searchState.positionMap);
            console.log(`🔍 Mapped to ${domMatches.length} DOM matches`);
            searchState.currentMatches = domMatches;

            if (domMatches.length > 0) {
                searchState.currentMatchIndex = 0;
                highlightMatches(domMatches, 0);
                console.log('✅ Search successful!');
            } else {
                searchState.currentMatchIndex = -1;
                clearHighlights();
                console.log('❌ No matches found');
            }

            updateMatchCounter();

            // Reset counter color
            if (searchState.matchCounter) {
                searchState.matchCounter.style.color = '';
            }
        } catch (error) {
            console.error('❌ Error in handleSearchInput:', error);
            console.error('Stack:', error.stack);
            updateMatchCounter();
        }
    }
    
    /**
     * Create search overlay UI
     */
    function createSearchOverlay() {
        // Create overlay container
        const overlay = document.createElement('div');
        overlay.id = 'encrypted-search-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            padding: 8px;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            display: none;
        `;
        
        // Create input container
        const inputContainer = document.createElement('div');
        inputContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';
        
        // Create search input
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Search...';
        input.style.cssText = `
            border: 1px solid #ccc;
            border-radius: 2px;
            padding: 4px 8px;
            font-size: 14px;
            width: 200px;
            outline: none;
        `;
        input.addEventListener('input', function(e) {
            console.log('🔍 Input event fired, value:', e.target.value);
            handleSearchInput(e);
        });
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                navigateToMatch('next');
            } else if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                navigateToMatch('prev');
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideSearchOverlay();
            }
        });
        
        // Create match counter
        const matchCounter = document.createElement('span');
        matchCounter.style.cssText = 'color: #666; font-size: 12px; min-width: 60px; text-align: center;';
        matchCounter.textContent = 'No matches';
        
        // Create navigation buttons
        const prevButton = document.createElement('button');
        prevButton.textContent = '↑';
        prevButton.title = 'Previous (Shift+Enter)';
        prevButton.style.cssText = `
            border: 1px solid #ccc;
            background: white;
            border-radius: 2px;
            padding: 2px 8px;
            cursor: pointer;
            font-size: 12px;
        `;
        prevButton.addEventListener('click', () => navigateToMatch('prev'));
        
        const nextButton = document.createElement('button');
        nextButton.textContent = '↓';
        nextButton.title = 'Next (Enter)';
        nextButton.style.cssText = prevButton.style.cssText;
        nextButton.addEventListener('click', () => navigateToMatch('next'));
        
        // Create close button
        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.title = 'Close (Esc)';
        closeButton.style.cssText = `
            border: none;
            background: transparent;
            font-size: 18px;
            cursor: pointer;
            padding: 0 4px;
            line-height: 1;
            color: #666;
        `;
        closeButton.addEventListener('click', hideSearchOverlay);
        
        // Assemble overlay
        inputContainer.appendChild(input);
        inputContainer.appendChild(matchCounter);
        inputContainer.appendChild(prevButton);
        inputContainer.appendChild(nextButton);
        inputContainer.appendChild(closeButton);
        overlay.appendChild(inputContainer);
        
        // Store references
        searchState.overlay = overlay;
        searchState.input = input;
        searchState.matchCounter = matchCounter;
        searchState.prevButton = prevButton;
        searchState.nextButton = nextButton;
        searchState.closeButton = closeButton;
        
        return overlay;
    }
    
    /**
     * Show search overlay
     */
    function showSearchOverlay() {
        console.log('🔍 showSearchOverlay called');
        try {
            if (!searchState.overlay) {
                console.log('🔍 Creating new search overlay');
                const overlay = createSearchOverlay();
                document.body.appendChild(overlay);
                console.log('✅ Search overlay created and added to DOM');
            }
            
            searchState.overlay.style.display = 'block';
            searchState.overlay.style.visibility = 'visible';
            searchState.overlay.style.opacity = '1';
            searchState.input.focus();
            searchState.input.select();
            console.log('✅ Search overlay shown');
        } catch (error) {
            console.error('❌ Error showing search overlay:', error);
        }
    }
    
    /**
     * Hide search overlay
     */
    function hideSearchOverlay() {
        if (searchState.overlay) {
            searchState.overlay.style.display = 'none';
            searchState.input.value = '';
            clearHighlights();
            searchState.currentMatches = [];
            searchState.currentMatchIndex = -1;
        }
    }
    
    /**
     * Setup Ctrl+F / Cmd+F interception
     */
    function setupSearchInterception() {
        const handler = function(e) {
            // Check for Ctrl+F (Windows/Linux) or Cmd+F (Mac)
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                console.log('Ctrl+F intercepted, showing search overlay');
                showSearchOverlay();
                return false;
            }
        };
        
        // Add listener in capture phase to intercept early
        document.addEventListener('keydown', handler, true);
        // Also add to window as fallback
        window.addEventListener('keydown', handler, true);
    }
    
    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    // Setup search interception IMMEDIATELY (before anything else)
    // This ensures Ctrl+F works even before encryption completes
    setupSearchInterception();
    
    /**
     * Wait for all stylesheets to load before proceeding
     * This ensures external CSS (including text-transform rules) is available
     */
    function waitForStylesheets(callback) {
        const stylesheets = Array.from(document.styleSheets);
        let loadedCount = 0;
        let errorCount = 0;
        const total = stylesheets.length;
        
        if (total === 0) {
            // No stylesheets, proceed immediately
            callback();
            return;
        }
        
        const checkComplete = () => {
            if (loadedCount + errorCount >= total) {
                callback();
            }
        };
        
        stylesheets.forEach((sheet, index) => {
            try {
                // Try to access sheet.cssRules - this will throw if sheet isn't loaded yet
                // or if it's a cross-origin stylesheet we can't access
                if (sheet.cssRules) {
                    loadedCount++;
                    checkComplete();
                } else {
                    // Sheet might not be loaded yet, wait for it
                    if (sheet.ownerNode) {
                        if (sheet.ownerNode.tagName === 'LINK') {
                            // External stylesheet
                            sheet.ownerNode.addEventListener('load', () => {
                                loadedCount++;
                                checkComplete();
                            });
                            sheet.ownerNode.addEventListener('error', () => {
                                errorCount++;
                                checkComplete();
                            });
                        } else {
                            // Inline style tag, already loaded
                            loadedCount++;
                            checkComplete();
                        }
                    } else {
                        // Can't determine, assume loaded
                        loadedCount++;
                        checkComplete();
                    }
                }
            } catch (e) {
                // Cross-origin stylesheet or other error - assume it's loaded
                // (we can't access it, but browser has applied it)
                errorCount++;
                checkComplete();
            }
        });
        
        // Fallback timeout - proceed after 2 seconds even if some stylesheets haven't loaded
        setTimeout(() => {
            if (loadedCount + errorCount < total) {
                console.warn(`⚠️  Some stylesheets didn't load within timeout, proceeding anyway`);
                callback();
            }
        }, 2000);
    }
    
    /**
     * Initialize encryption when DOM is ready and stylesheets are loaded
     */
    function init() {
        // Setup copy interception immediately (before encryption)
        setupCopyInterception();
        
        // Search interception already set up above
        
        // Wait for DOM and stylesheets to load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                // Wait for stylesheets to load so we can detect text-transform from external CSS
                waitForStylesheets(() => {
                    setTimeout(encryptPage, 100);
                });
            });
        } else {
            // DOM already loaded, but wait for stylesheets
            waitForStylesheets(() => {
                setTimeout(encryptPage, 100);
            });
        }
    }
    
    // Start encryption
    init();
    
    // Expose manual encryption function
    if (typeof window !== 'undefined') {
        window.encryptPage = encryptPage;
        // Expose search functions for debugging
        window.testSearch = function(query) {
            console.log('🧪 Testing search with query:', query);
            if (searchState.input) {
                searchState.input.value = query;
                const event = new Event('input', { bubbles: true });
                searchState.input.dispatchEvent(event);
            } else {
                console.error('❌ Search input not available - overlay not created yet');
            }
        };
        window.showSearch = showSearchOverlay;
        console.log('✅ Search functions exposed: window.testSearch(query), window.showSearch()');
    }
    
})();

