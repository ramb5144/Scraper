/**
 * Decryption Interceptor for Server-Side Encrypted Pages
 * Provides copy-paste interception and search functionality for pages encrypted server-side
 *
 * Requires window.encryptionConfig to be set before this script loads:
 * window.encryptionConfig = {
 *     hash: 'abc123...',  // Hash of nonce+secret_key (preferred)
 *     OR (for backward compatibility):
 *     secretKey: 29202393,
 *     nonce: 462508,
 *     websiteId: 'abc123...',  // NEW: For lazy-loading support
 *     apiBaseUrl: 'http://localhost:8001'
 * };
 *
 * Built from modular sources in client/decrypt/src/
 * Run 'node client/decrypt/build.js' to rebuild after editing modules.
 */
(function() {
    'use strict';

    // ============================================================================
    // === CONFIG ================================================================
    // ============================================================================

    // === CONFIG ===
    // Configuration proxy, API helpers, decrypt/encrypt functions

    // CRITICAL: Access window.encryptionConfig dynamically via getter to ensure we always
    // read the current value, not a stale snapshot from module load time.
    // This fixes race conditions where cloak-sdk.js sets window.encryptionConfig
    // after this script starts loading but before functions are called.
    const encryptionConfig = new Proxy({}, {
        get(target, prop) {
            const config = window.encryptionConfig || {};
            return config[prop];
        }
    });

    // Debug: Log script initialization
    console.log('%c\uD83D\uDD13 Decrypt Interceptor Loading...', 'color: #9C27B0; font-weight: bold; font-size: 14px;');

    // Validate configuration
    const configStatus = {
        'Hash': encryptionConfig.hash ? '\u2705 Set' : '\u274C Missing',
        'Secret Key (backward compat)': encryptionConfig.secretKey ? '\u2705 Set' : '\u26A0\uFE0F Not set',
        'Nonce (backward compat)': encryptionConfig.nonce ? '\u2705 Set' : '\u26A0\uFE0F Not set',
        'Website ID': encryptionConfig.websiteId ? '\u2705 Set' : '\u26A0\uFE0F Not set (lazy encryption disabled)',
        'API Base URL': encryptionConfig.apiBaseUrl ? '\u2705 Set' : '\u274C Missing',
        'API Key': encryptionConfig.apiKey ? '\u2705 Set' : '\u274C Missing (search/copy disabled)'
    };

    /**
     * Get common headers for API requests including API key
     */
    function getApiHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        // Debug: Check what we're getting from the Proxy
        const apiKey = encryptionConfig.apiKey;
        console.log('%c\uD83D\uDD11 getApiHeaders() called', 'color: #E91E63; font-weight: bold;');
        console.log('  - encryptionConfig.apiKey:', apiKey ? `"${apiKey.substring(0, 8)}..."` : 'undefined/null');
        console.log('  - window.encryptionConfig:', window.encryptionConfig);
        console.log('  - window.encryptionConfig?.apiKey:', window.encryptionConfig?.apiKey ? `"${window.encryptionConfig.apiKey.substring(0, 8)}..."` : 'undefined/null');

        if (apiKey) {
            headers['X-API-Key'] = apiKey;
        }
        console.log('  - Headers being returned:', headers);
        return headers;
    }

    /**
     * Set API headers on an XMLHttpRequest object
     */
    function setXhrHeaders(xhr) {
        xhr.setRequestHeader('Content-Type', 'application/json');
        if (encryptionConfig.apiKey) {
            xhr.setRequestHeader('X-API-Key', encryptionConfig.apiKey);
        }
    }

    console.log('%c\u2699\uFE0F Configuration Status:', 'color: #2196F3; font-weight: bold;');
    console.table(configStatus);

    if (!encryptionConfig.hash && (!encryptionConfig.secretKey || !encryptionConfig.nonce)) {
        console.error('%c\u274C Critical: Missing encryption configuration!', 'color: #F44336; font-weight: bold; font-size: 14px;');
        console.error('Required: hash OR (secretKey and nonce)');
        console.error('Current config:', encryptionConfig);
    }

    if (!encryptionConfig.apiBaseUrl) {
        console.warn('%c\u26A0\uFE0F Warning: API Base URL not set. Decryption API calls will fail.', 'color: #FF9800; font-weight: bold;');
    }

    /**
     * Encrypt lazy-loaded content using stored nonce for website
     * Uses the /api/encrypt/lazy endpoint which uses the persistent nonce
     */
    async function encryptLazyContent(text) {
        if (!encryptionConfig.websiteId) {
            console.warn('No websiteId in config, cannot encrypt lazy content');
            return text;
        }

        if (!encryptionConfig.apiBaseUrl) {
            console.warn('No apiBaseUrl in config, cannot encrypt lazy content');
            return text;
        }

        try {
            const response = await fetch(`${encryptionConfig.apiBaseUrl}/api/encrypt/lazy`, {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify({
                    website_id: encryptionConfig.websiteId,
                    text: text,
                    hash: encryptionConfig.hash || null
                })
            });

            if (!response.ok) {
                console.warn('Lazy encryption failed:', response.status);
                const errorData = await response.json().catch(() => ({}));
                console.warn('Error details:', errorData);
                return text;
            }

            const data = await response.json();
            return data.encrypted || text;
        } catch (error) {
            console.warn('Error encrypting lazy content:', error);
            return text;
        }
    }

    /**
     * Decrypt text using the decryption API
     * Handles zero-width spaces, non-breaking spaces, and special characters
     */
    async function decryptText(encryptedText) {
        if (!encryptionConfig.hash && (!encryptionConfig.secretKey || !encryptionConfig.nonce)) {
            return encryptedText;
        }

        // Remove zero-width spaces (U+200B) that were inserted for word-breaking
        const textWithoutZWSP = encryptedText.replace(/\u200B/g, '');

        // Replace non-breaking spaces (U+00A0) with regular spaces for decryption
        // The font maps both regular spaces and non-breaking spaces to the same glyph
        const normalizedText = textWithoutZWSP.replace(/\u00A0/g, ' ');

        // Call the decryption API
        try {
            const response = await fetch(`${encryptionConfig.apiBaseUrl}/api/decrypt`, {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify({
                    encrypted: normalizedText,
                    hash: encryptionConfig.hash || null,
                    // Backward compatibility: include secretKey and nonce if hash not available
                    ...(encryptionConfig.hash ? {} : {
                        secret_key: encryptionConfig.secretKey,
                        nonce: encryptionConfig.nonce
                    })
                })
            });

            if (!response.ok) {
                console.warn('Decryption API call failed:', response.status);
                return encryptedText; // Return original if API fails
            }

            const data = await response.json();
            return data.decrypted || encryptedText;
        } catch (error) {
            console.warn('Error calling decryption API:', error);
            return encryptedText; // Return original if API call fails
        }
    }


    // ============================================================================
    // === COPY INTERCEPTION =====================================================
    // ============================================================================

    /**
     * Intercept copy events and replace clipboard content with decrypted text
     * This allows users to copy-paste normally while scrapers see encrypted text
     * Note: Uses synchronous XMLHttpRequest because clipboardData API requires synchronous access
     *
     * Handles mixed selections that include both encrypted and excluded (plain) text.
     * For example: encrypted paragraph -> <code> block -> encrypted paragraph
     */
    function setupCopyInterception() {
        console.log('%c📋 Setting up copy interception...', 'color: #FF9800; font-weight: bold;');
        document.addEventListener('copy', function(e) {
            console.log('[Decrypt Interceptor] Copy event triggered');
            // Only intercept if we have encryption config (hash required for position-based lookup)
            if (!encryptionConfig.hash) {
                console.warn('[Decrypt Interceptor] No hash in encryptionConfig, skipping copy interception');
                return; // Let default copy behavior proceed
            }

            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) {
                console.log('[Decrypt Interceptor] No selection, skipping');
                return; // No selection, let default behavior proceed
            }

            // Get selected text (this will be the encrypted text)
            const selectedText = selection.toString();

            if (!selectedText || selectedText.trim().length === 0) {
                console.log('[Decrypt Interceptor] Empty selection, skipping');
                return; // Empty selection, let default behavior proceed
            }

            console.log('%c📋 Copy intercepted! Decrypting...', 'color: #4CAF50; font-weight: bold;');
            // Prevent default copy behavior
            e.preventDefault();

            const range = selection.getRangeAt(0);

            // First, check if selection contains any excluded elements (code, pre, etc.)
            // If not, use the simpler position-based approach which handles highlights correctly
            let hasExcludedContent = false;
            const checkWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            let checkNode;
            while (checkNode = checkWalker.nextNode()) {
                try {
                    if (range.intersectsNode(checkNode) && isTextNodeInExcludedElement(checkNode)) {
                        const nodeText = checkNode.textContent;
                        if (nodeText && nodeText.trim()) {
                            hasExcludedContent = true;
                            break;
                        }
                    }
                } catch (err) {
                    continue;
                }
            }

            let finalText = '';

            if (!hasExcludedContent) {
                // Simple case: no excluded content, use getSelectionPositions which handles highlights
                try {
                    // NOTE: With CSS Custom Highlight API, DOM is never modified!
                    // No need to normalize text nodes - they were never split.
                    // This is a huge performance and correctness improvement.

                    const positions = getSelectionPositions();
                    console.log('📋 [COPY] Simple mode - positions:', positions);

                    if (positions && positions.start !== null && positions.end !== null) {
                        console.log(`📋 [COPY] Requesting range: start=${positions.start}, end=${positions.end}, length=${positions.end - positions.start}`);

                        // DEBUG: Fetch server's total plaintext length to compare
                        try {
                            const debugXhr = new XMLHttpRequest();
                            debugXhr.open('POST', `${encryptionConfig.apiBaseUrl}/api/search/get-text-range`, false);
                            setXhrHeaders(debugXhr);
                            debugXhr.send(JSON.stringify({ start: 0, end: 999999, hash: encryptionConfig.hash }));
                            if (debugXhr.status === 200) {
                                const fullText = JSON.parse(debugXhr.responseText).text;
                                console.log(`📋 [COPY] DEBUG: Server total plaintext length: ${fullText.length}`);
                                // Check if our end position is beyond server text
                                if (positions.end > fullText.length) {
                                    console.error(`📋 [COPY] ⚠️ END POSITION EXCEEDS SERVER TEXT! end=${positions.end}, serverLen=${fullText.length}`);
                                    console.error(`📋 [COPY] ⚠️ This explains truncation - client counted more chars than server has!`);
                                    // Show what server has at the end
                                    console.log(`📋 [COPY] Server text ends with: "...${fullText.slice(-50)}"`);
                                }
                            }
                        } catch (e) {
                            console.log('📋 [COPY] DEBUG: Could not fetch full plaintext:', e);
                        }

                        const xhr = new XMLHttpRequest();
                        const apiUrl = `${encryptionConfig.apiBaseUrl}/api/search/get-text-range`;
                        xhr.open('POST', apiUrl, false);
                        setXhrHeaders(xhr);
                        xhr.send(JSON.stringify({
                            start: positions.start,
                            end: positions.end,
                            hash: encryptionConfig.hash
                        }));

                        if (xhr.status === 200) {
                            const data = JSON.parse(xhr.responseText);
                            if (data.text) {
                                finalText = data.text;
                                console.log(`📋 [COPY] Received text: "${finalText.substring(0, 50)}..." (${finalText.length} chars)`);
                                console.log(`📋 [COPY] Text ends with: "...${finalText.slice(-30)}"`);
                            }
                        } else {
                            console.error(`📋 [COPY] Server error: ${xhr.status} ${xhr.responseText}`);
                        }
                    }
                } catch (error) {
                    console.error('Copy plaintext lookup failed:', error);
                }
            } else {
                // Complex case: selection includes excluded content (code, pre, etc.)
                // Need to handle each segment separately
                console.log('📋 [COPY] Mixed mode - selection includes excluded elements');

                // Build list of text segments, noting which are excluded (plain) vs encrypted
                const segments = [];
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
                let textNode;
                let encryptedPosition = 0;
                let lastBlock = null;

                while (textNode = walker.nextNode()) {
                    const nodeEnd = textNode.textContent.length;
                    let nodeBeforeSelection = false;
                    let nodeAfterSelection = false;
                    let nodeIntersects = false;

                    try {
                        nodeIntersects = range.intersectsNode(textNode);
                        if (!nodeIntersects) {
                            // Check if before or after
                            const startCompare = range.comparePoint(textNode, 0);
                            if (startCompare > 0) {
                                nodeAfterSelection = true;
                            } else {
                                nodeBeforeSelection = true;
                            }
                        }
                    } catch (err) {
                        continue;
                    }

                    const isExcluded = isTextNodeInExcludedElement(textNode);

                    // For nodes before selection, update encrypted position (skip excluded)
                    if (nodeBeforeSelection) {
                        if (!isExcluded && !shouldExcludeTextNodeForPositionCalc(textNode)) {
                            const text = textNode.textContent.replace(/\u200B/g, '');
                            if (text.length > 0 && text.trim()) {
                                const currentBlock = getContainingBlockSkippingHighlights(textNode);
                                if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
                                    encryptedPosition += 1;
                                }
                                if (currentBlock !== null) lastBlock = currentBlock;
                                encryptedPosition += text.length;
                            }
                        }
                        continue;
                    }

                    if (nodeAfterSelection) {
                        break;
                    }

                    // Node intersects selection - determine which part
                    let startOffset = 0;
                    let endOffset = textNode.textContent.length;

                    if (textNode === range.startContainer) {
                        startOffset = range.startOffset;
                    }
                    if (textNode === range.endContainer) {
                        endOffset = range.endOffset;
                    }

                    const selectedPart = textNode.textContent.substring(startOffset, endOffset);

                    if (isExcluded) {
                        // Plain text - use directly
                        if (selectedPart) {
                            segments.push({ type: 'plain', text: selectedPart });
                        }
                    } else if (!shouldExcludeTextNodeForPositionCalc(textNode)) {
                        // Encrypted text
                        const text = textNode.textContent.replace(/\u200B/g, '');
                        if (text.length > 0 && text.trim()) {
                            const currentBlock = getContainingBlockSkippingHighlights(textNode);
                            if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
                                encryptedPosition += 1;
                            }
                            if (currentBlock !== null) lastBlock = currentBlock;

                            // Adjust offsets for zero-width spaces
                            let adjustedStart = 0;
                            let adjustedEnd = 0;
                            const rawText = textNode.textContent;
                            for (let i = 0; i < rawText.length; i++) {
                                if (rawText[i] !== '\u200B') {
                                    if (i < startOffset) adjustedStart++;
                                    if (i < endOffset) adjustedEnd++;
                                }
                            }

                            if (adjustedEnd > adjustedStart) {
                                segments.push({
                                    type: 'encrypted',
                                    start: encryptedPosition + adjustedStart,
                                    end: encryptedPosition + adjustedEnd
                                });
                            }

                            encryptedPosition += text.length;
                        }
                    }
                }

                console.log('📋 [COPY] Segments:', segments);

                // Merge adjacent encrypted segments for fewer server requests
                const mergedSegments = [];
                for (const seg of segments) {
                    if (seg.type === 'encrypted' && mergedSegments.length > 0) {
                        const last = mergedSegments[mergedSegments.length - 1];
                        if (last.type === 'encrypted' && last.end === seg.start) {
                            last.end = seg.end;
                            continue;
                        }
                    }
                    mergedSegments.push(seg);
                }

                // Build final text from segments
                for (const segment of mergedSegments) {
                    if (segment.type === 'plain') {
                        finalText += segment.text;
                    } else if (segment.type === 'encrypted' && segment.start < segment.end) {
                        try {
                            const xhr = new XMLHttpRequest();
                            const apiUrl = `${encryptionConfig.apiBaseUrl}/api/search/get-text-range`;
                            xhr.open('POST', apiUrl, false);
                            setXhrHeaders(xhr);
                            xhr.send(JSON.stringify({
                                start: segment.start,
                                end: segment.end,
                                hash: encryptionConfig.hash
                            }));

                            if (xhr.status === 200) {
                                const data = JSON.parse(xhr.responseText);
                                if (data.text) {
                                    finalText += data.text;
                                }
                            }
                        } catch (error) {
                            console.error('Failed to fetch encrypted segment:', error);
                        }
                    }
                }
            }

            // Normalize whitespace to match browser rendering
            finalText = finalText
                .split('\n')
                .map(line => line.replace(/[ \t]+/g, ' ').trim())
                .filter(line => line.length > 0)
                .join('\n');

            // Set clipboard data with plaintext
            e.clipboardData.setData('text/plain', finalText);
        }, true); // Use capture phase to intercept early
    }

    // Setup copy interception once (avoid duplicate handlers)
    if (document.readyState === 'loading') {
        console.log('[Decrypt Interceptor] Document still loading, will setup copy on DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', setupCopyInterception);
    } else {
        console.log('[Decrypt Interceptor] Document ready, setting up copy interception now');
        setupCopyInterception();
    }
    console.log('%c✅ Copy interception active', 'color: #4CAF50; font-weight: bold;');

    // ============================================================================
    // CONTEXT MENU FUNCTIONALITY (Native menu with hidden selection trick)
    // ============================================================================

    /**
     * Check if a text node is inside an excluded element (code, pre, input, etc.)
     * Returns true if the node should NOT be treated as encrypted text.
     * This is used for copy handling to distinguish plain vs encrypted text.
     */
    function isTextNodeInExcludedElement(textNode) {
        let parent = textNode.parentElement;
        while (parent && parent !== document.body && parent !== document.documentElement) {
            const tagName = parent.tagName ? parent.tagName.toLowerCase() : '';

            // Exclude elements by tag name (matches SDK excludeSelectors)
            if (EXCLUDE_SELECTORS.includes(tagName)) {
                return true;
            }

            // Exclude elements with excluded attributes (matches SDK excludeAttributes)
            for (const attr of EXCLUDE_ATTRIBUTES) {
                if (parent.hasAttribute(attr)) {
                    return true;
                }
            }

            // Exclude data-cloak-exclude elements (matches SDK)
            if (parent.hasAttribute('data-cloak-exclude')) {
                return true;
            }

            // Exclude data-nosnippet elements (server-side compatibility)
            if (parent.hasAttribute('data-nosnippet')) {
                return true;
            }

            parent = parent.parentElement;
        }
        return false;
    }

    /**
     * Check if a text node should be excluded for position calculation.
     * This is a MODIFIED version that INCLUDES text inside <mark> highlight elements,
     * since those are just visual wrappers around the encrypted text.
     */
    function shouldExcludeTextNodeForPositionCalc(textNode) {
        let parent = textNode.parentElement;
        while (parent && parent !== document.body && parent !== document.documentElement) {
            const tagName = parent.tagName ? parent.tagName.toLowerCase() : '';

            // Exclude elements by tag name (matches SDK excludeSelectors)
            if (EXCLUDE_SELECTORS.includes(tagName)) {
                return true;
            }

            // Exclude elements with excluded attributes (matches SDK excludeAttributes)
            for (const attr of EXCLUDE_ATTRIBUTES) {
                if (parent.hasAttribute(attr)) {
                    return true;
                }
            }

            // Exclude data-cloak-exclude elements (matches SDK)
            if (parent.hasAttribute('data-cloak-exclude')) {
                return true;
            }

            // Exclude data-nosnippet elements (server-side compatibility)
            if (parent.hasAttribute('data-nosnippet')) {
                return true;
            }

            // NOTE: We DO NOT exclude encrypted-search-highlight here!
            // Text inside <mark> highlights is still encrypted text that needs position mapping.
            // The <mark> is just a visual wrapper.

            // CRITICAL: Exclude the search overlay UI entirely (matches SDK)
            if (parent.id === 'encrypted-search-overlay') {
                return true;
            }

            // Check custom exclude selectors from config (if available)
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

            parent = parent.parentElement;
        }
        return false;
    }

    /**
     * Get the start and end positions of the current text selection in plaintext coordinates.
     * Reuses the same DOM walking logic as getCharacterPositionFromClick and selectTextByPosition.
     *
     * IMPORTANT: This function MUST work even when search highlights are active.
     * When highlights exist, text nodes are split and wrapped in <mark> elements.
     * We need to calculate positions as if the highlights don't exist.
     */
    function getSelectionPositions() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return null;
        }

        const range = selection.getRangeAt(0);
        const startContainer = range.startContainer;
        const endContainer = range.endContainer;
        const startOffset = range.startOffset;
        const endOffset = range.endOffset;

        // With CSS Custom Highlight API, DOM is NEVER modified!
        // This entire complex workaround for DOM mutation is no longer needed.
        // Check if highlights are active (not by DOM, but by state)
        const highlightsActive = searchState && searchState.highlightRanges.length > 0;

        // CRITICAL: Check if endContainer is an ELEMENT node (not TEXT)
        // This happens when selection ends at an element boundary (e.g., end of an <li>)
        // In this case, endContainer is the parent element and endOffset is 0
        const endContainerIsElement = endContainer.nodeType === Node.ELEMENT_NODE;

        // Optional: Use originalEncryptedText if available for consistency
        // (Not strictly necessary anymore since DOM is unchanged)
        if (highlightsActive && typeof searchState !== 'undefined' && searchState.originalEncryptedText) {
            console.log(`⚠️ [POSITION] Using pre-highlight position lookup (${highlightsCount} highlights active)`);

            // Extract the selected text from the current range
            const selectedText = range.toString().replace(/\u200B/g, '');
            if (!selectedText || !selectedText.trim()) {
                return null;
            }

            // Find the selected encrypted text within the original encrypted text
            const originalEncrypted = searchState.originalEncryptedText;

            // Try direct match first
            let startIdx = originalEncrypted.indexOf(selectedText);

            if (startIdx >= 0) {
                const endIdx = startIdx + selectedText.length;
                console.log(`⚠️ [POSITION] Found selection in original text: start=${startIdx}, end=${endIdx}, len=${selectedText.length}`);
                return { start: startIdx, end: endIdx };
            }

            // If direct match fails, it's likely due to newline/whitespace differences
            // browser's range.toString() may not preserve newlines the same way
            // Try matching with normalized whitespace
            const normalizedSelected = selectedText.replace(/\s+/g, ' ').trim();
            const normalizedOriginal = originalEncrypted.replace(/\s+/g, ' ');

            const normalizedIdx = normalizedOriginal.indexOf(normalizedSelected);
            if (normalizedIdx >= 0) {
                // Found match in normalized form - now find corresponding position in original
                // Count chars while accounting for whitespace normalization
                let origPos = 0;
                let normPos = 0;
                while (normPos < normalizedIdx && origPos < originalEncrypted.length) {
                    if (/\s/.test(originalEncrypted[origPos])) {
                        // In original: consume all consecutive whitespace
                        while (origPos < originalEncrypted.length && /\s/.test(originalEncrypted[origPos])) {
                            origPos++;
                        }
                        normPos++; // In normalized: just one space
                    } else {
                        origPos++;
                        normPos++;
                    }
                }
                const actualStartIdx = origPos;

                // Now find end position
                normPos = 0;
                while (normPos < normalizedSelected.length && origPos < originalEncrypted.length) {
                    if (/\s/.test(originalEncrypted[origPos])) {
                        while (origPos < originalEncrypted.length && /\s/.test(originalEncrypted[origPos])) {
                            origPos++;
                        }
                        normPos++;
                    } else {
                        origPos++;
                        normPos++;
                    }
                }
                const actualEndIdx = origPos;

                console.log(`⚠️ [POSITION] Found selection via normalized match: start=${actualStartIdx}, end=${actualEndIdx}`);
                return { start: actualStartIdx, end: actualEndIdx };
            }

            // Still not found - log debug info and fall back
            console.warn(`⚠️ [POSITION] Could not find selection via text-matching, using DOM-walk fallback`);
            console.log(`⚠️ [POSITION] Selected text length: ${selectedText.length}, first 100: "${selectedText.substring(0, 100)}..."`);
            console.log(`⚠️ [POSITION] Original length: ${originalEncrypted.length}, first 100: "${originalEncrypted.substring(0, 100)}..."`);
            console.log(`⚠️ [POSITION] Normalized selected (first 100): "${normalizedSelected.substring(0, 100)}..."`);
        }

        if (highlightsCount > 0) {
            console.log(`⚠️ [POSITION] DOM-walk fallback: Calculating positions with ${highlightsCount} search highlights active`);
            console.log(`⚠️ [POSITION] endContainer nodeType: ${endContainer.nodeType} (${endContainerIsElement ? 'ELEMENT' : 'TEXT'})`);
            console.log(`⚠️ [POSITION] endContainer text: "${endContainer.textContent?.substring(0, 50)}...", endOffset: ${endOffset}`);
            if (endContainerIsElement) {
                console.log(`⚠️ [POSITION] endContainer is ELEMENT: <${endContainer.tagName}> - selection ends at element boundary`);
            }
            // Check if endContainer is excluded (which would explain why we're not finding it)
            console.log(`⚠️ [POSITION] endContainer excluded: ${shouldExcludeTextNodeForPositionCalc(endContainer)}`);
            // Check parent elements
            let parent = endContainer.parentElement;
            let parentChain = [];
            while (parent && parent !== document.body) {
                parentChain.push(parent.tagName + (parent.className ? '.' + parent.className : ''));
                parent = parent.parentElement;
            }
            console.log(`⚠️ [POSITION] endContainer parent chain: ${parentChain.join(' > ')}`);
        }

        // Build position map using range intersection (more robust than node matching)
        // This handles cases where highlights have split text nodes
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null
        );

        let globalPosition = 0;
        let lastBlock = null;
        let startPos = null;
        let endPos = null;
        let textNode;
        let foundStart = false;
        let foundEnd = false;

        // Debug: track positions around selection
        let debugPositions = [];

        while (textNode = walker.nextNode()) {
            // Use the special exclusion function that INCLUDES highlight text
            if (shouldExcludeTextNodeForPositionCalc(textNode)) {
                continue;
            }

            // Get raw text and strip zero-width spaces
            let text = textNode.textContent.replace(/\u200B/g, '');

            // Skip empty or whitespace-only text nodes (MUST MATCH SDK: !originalText.trim())
            if (text.length === 0 || !text.trim()) {
                continue;
            }

            // CRITICAL: Apply ALL CSS text-affecting properties to match SDK behavior
            // SDK encrypts transformed text (e.g., "HELLO" for text-transform: uppercase)
            // This includes text-transform, font-variant-caps, font-feature-settings, etc.
            // We must count positions on transformed text, not raw DOM content
            const transforms = getTextAffectingTransforms(textNode);
            for (const transform of transforms) {
                text = transform(text);
            }

            // Check for block boundary - add 1 for \n marker
            const currentBlock = getContainingBlockSkippingHighlights(textNode);
            let blockBoundary = false;
            if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
                globalPosition += 1;  // Count the \n marker between blocks
                blockBoundary = true;
            }
            if (currentBlock !== null) {
                lastBlock = currentBlock;
            }

            // Check if this node intersects with the selection range
            // We use multiple methods because intersectsNode can be unreliable with split nodes
            let nodeIntersectsRange = false;
            try {
                nodeIntersectsRange = range.intersectsNode(textNode);

                // Also check using comparePoint - sometimes intersectsNode returns false incorrectly
                // for nodes that are partially or fully within the range
                if (!nodeIntersectsRange) {
                    const startCompare = range.comparePoint(textNode, 0);
                    const endCompare = range.comparePoint(textNode, textNode.textContent.length);
                    // Node intersects if it's not entirely before (-1, -1) or entirely after (1, 1)
                    // startCompare > 0 means node start is after range end
                    // endCompare < 0 means node end is before range start
                    nodeIntersectsRange = !(startCompare > 0 || endCompare < 0);
                }
            } catch (e) {
                // Fall back to node matching
                nodeIntersectsRange = (textNode === startContainer || textNode === endContainer);
            }

            // Check if this node contains the start of selection
            if (!foundStart) {
                if (textNode === startContainer) {
                    // Exact match - use the offset
                    let adjustedOffset = 0;
                    const rawText = textNode.textContent;
                    for (let i = 0; i < startOffset && i < rawText.length; i++) {
                        if (rawText[i] !== '\u200B') {
                            adjustedOffset++;
                        }
                    }
                    startPos = globalPosition + Math.min(adjustedOffset, text.length);
                    foundStart = true;
                    if (highlightsCount > 0) {
                        console.log(`⚠️ [POSITION] Found exact startContainer:`);
                        console.log(`⚠️ [POSITION]   globalPosition=${globalPosition}, startOffset=${startOffset}, adjustedOffset=${adjustedOffset}`);
                        console.log(`⚠️ [POSITION]   startPos = ${startPos}`);
                    }
                } else if (nodeIntersectsRange && startPos === null) {
                    // Node intersects but isn't the exact container - selection starts at beginning of this node
                    // This happens when highlights have split the original text node
                    try {
                        const compareStart = range.comparePoint(textNode, 0);
                        if (compareStart <= 0) {
                            // Range starts at or before this node
                            startPos = globalPosition;
                            foundStart = true;
                        }
                    } catch (e) {
                        // comparePoint failed, use node start
                        startPos = globalPosition;
                        foundStart = true;
                    }
                }
            }

            // Check if this node contains the end of selection
            // DEBUG: Check if this is close to endContainer (only for TEXT nodes, not ELEMENT containers)
            if (highlightsCount > 0 && !foundEnd && !endContainerIsElement &&
                textNode.textContent.includes(endContainer.textContent.substring(0, 5))) {
                console.log(`⚠️ [POSITION] Similar to endContainer: textNode="${textNode.textContent.substring(0, 30)}", endContainer="${endContainer.textContent.substring(0, 30)}"`);
                console.log(`⚠️ [POSITION]   textNode === endContainer: ${textNode === endContainer}`);
                console.log(`⚠️ [POSITION]   textNode.parentElement: ${textNode.parentElement?.tagName}.${textNode.parentElement?.className}`);
                console.log(`⚠️ [POSITION]   endContainer.parentElement: ${endContainer.parentElement?.tagName}.${endContainer.parentElement?.className}`);
            }
            if (textNode === endContainer) {
                // Exact match - but check for offset 0 edge case
                // When endOffset is 0, it means selection ends BEFORE this node
                // (browser sometimes sets endContainer to the next node with offset 0)
                if (endOffset === 0) {
                    // Selection actually ended at the previous position
                    // endPos should already be set from the previous intersecting node
                    foundEnd = true;
                    if (highlightsCount > 0) {
                        console.log(`⚠️ [POSITION] endContainer with offset 0 - selection ends before this node, using endPos=${endPos}`);
                    }
                    // CRITICAL: Break out of the loop - we've found the end boundary
                    // Don't continue walking or we'll extend endPos incorrectly
                    break;
                } else {
                    let adjustedOffset = 0;
                    const rawText = textNode.textContent;
                    for (let i = 0; i < endOffset && i < rawText.length; i++) {
                        if (rawText[i] !== '\u200B') {
                            adjustedOffset++;
                        }
                    }
                    endPos = globalPosition + Math.min(adjustedOffset, text.length);
                    foundEnd = true;
                    if (highlightsCount > 0) {
                        console.log(`⚠️ [POSITION] Found exact endContainer:`);
                        console.log(`⚠️ [POSITION]   globalPosition=${globalPosition}, endOffset=${endOffset}, adjustedOffset=${adjustedOffset}`);
                        console.log(`⚠️ [POSITION]   text.length=${text.length}, rawText.length=${rawText.length}`);
                        console.log(`⚠️ [POSITION]   endPos = ${globalPosition} + ${Math.min(adjustedOffset, text.length)} = ${endPos}`);
                        console.log(`⚠️ [POSITION]   text="${text.substring(0, 50)}..."`);
                    }
                }
            } else if (foundStart && !foundEnd) {
                // After finding start, keep extending endPos for any node that intersects

                // The key insight: range.intersectsNode() is the authoritative check.
                // When it returns false after returning true, we've found the boundary.
                if (nodeIntersectsRange) {
                    endPos = globalPosition + text.length;
                    if (highlightsCount > 0) {
                        console.log(`⚠️ [POSITION] Extending endPos via intersection, endPos=${endPos}, text="${text.substring(0, 30)}..."`);
                    }
                } else {
                    // Node doesn't intersect range anymore - we've passed the selection boundary
                    foundEnd = true;
                    if (highlightsCount > 0) {
                        console.log(`⚠️ [POSITION] Node doesn't intersect range, finalizing endPos=${endPos}`);
                    }
                }
            }

            // Debug: track all nodes within selection
            if (highlightsCount > 0 && foundStart && !foundEnd) {
                debugPositions.push({
                    pos: globalPosition,
                    len: text.length,
                    text: text.substring(0, 20),
                    block: blockBoundary
                });
            }

            globalPosition += text.length;
        }

        // Debug output
        if (highlightsCount > 0) {
            console.log(`⚠️ [POSITION] Calculated: start=${startPos}, end=${endPos}, foundStart=${foundStart}, foundEnd=${foundEnd}`);
            console.log(`⚠️ [POSITION] Nodes within selection:`, debugPositions);
        }

        if (startPos === null || endPos === null) {
            console.warn('⚠️ [POSITION] Failed to calculate positions', { startPos, endPos, foundStart, foundEnd });
            return null;
        }

        // Log the final calculated range and total chars counted
        console.log(`📊 [POSITION] Final range: start=${startPos}, end=${endPos}, length=${endPos - startPos}`);
        console.log(`📊 [POSITION] Total globalPosition at end of walk: ${globalPosition}`);

        // DEBUG: Check if globalPosition matches expected (3199 from buildTextPositionMap)
        // If different, it means getSelectionPositions is counting differently than SDK
        if (highlightsCount > 0) {
            // Note: When endContainerIsElement is true, we won't find it in a TEXT node walk (expected)
            if (endContainerIsElement) {
                console.log(`📊 [POSITION] DEBUG: endContainer is ELEMENT <${endContainer.tagName}>, using intersection-based boundary detection`);
            }
            // Count what buildTextPositionMap would count
            const checkWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            let checkPos = 0;
            let checkLastBlock = null;
            let checkNode;
            let nodesSeen = 0;
            let foundEndContainerInCheck = false;
            let blockBoundaryCount = 0;
            let insideMarkCount = 0;
            let markCharsTotal = 0;
            let skippedWhitespace = 0;
            let skippedWhitespaceChars = 0;
            let skippedExcluded = 0;
            let nodeDetails = [];
            while (checkNode = checkWalker.nextNode()) {
                if (checkNode === endContainer) {
                    console.log(`📊 [POSITION] DEBUG: Found endContainer in check walk at node ${nodesSeen}, pos ${checkPos}`);
                    foundEndContainerInCheck = true;
                }
                if (shouldExcludeTextNodeForPositionCalc(checkNode)) {
                    skippedExcluded++;
                    continue;
                }
                const checkText = checkNode.textContent.replace(/\u200B/g, '');
                if (checkText.length === 0 || !checkText.trim()) {
                    skippedWhitespace++;
                    skippedWhitespaceChars += checkText.length;
                    continue;
                }
                const currentBlock = getContainingBlockSkippingHighlights(checkNode);
                if (checkLastBlock !== null && currentBlock !== null && currentBlock !== checkLastBlock) {
                    checkPos += 1;
                    blockBoundaryCount++;
                }
                if (currentBlock !== null) checkLastBlock = currentBlock;
                // Check if inside <mark>
                const isInsideMark = checkNode.parentElement?.tagName === 'MARK';
                if (isInsideMark) {
                    insideMarkCount++;
                    markCharsTotal += checkText.length;
                }
                // Store first 10 nodes in detail
                if (nodesSeen < 10) {
                    nodeDetails.push({
                        pos: checkPos,
                        len: checkText.length,
                        inMark: isInsideMark,
                        text: checkText.substring(0, 20)
                    });
                }
                checkPos += checkText.length;
                nodesSeen++;
            }
            console.log(`📊 [POSITION] DEBUG: Re-counted ${nodesSeen} nodes, ${checkPos} chars (should match ${globalPosition})`);
            console.log(`📊 [POSITION] DEBUG: Block boundaries: ${blockBoundaryCount}, nodes inside <mark>: ${insideMarkCount}, chars in marks: ${markCharsTotal}`);
            console.log(`📊 [POSITION] DEBUG: Skipped: ${skippedWhitespace} whitespace-only (${skippedWhitespaceChars} chars), ${skippedExcluded} excluded`);
            console.log(`📊 [POSITION] DEBUG: Server has 3199 chars. Missing: ${3199 - checkPos} chars`);
            console.log(`📊 [POSITION] DEBUG: First 10 nodes:`, nodeDetails);
            if (!foundEndContainerInCheck && !endContainerIsElement) {
                // Only warn if endContainer is a TEXT node that we expected to find
                console.error(`📊 [POSITION] DEBUG: endContainer NOT FOUND in walk! endContainer.textContent="${endContainer.textContent}"`);
                console.error(`📊 [POSITION] DEBUG: endContainer.parentElement=${endContainer.parentElement?.tagName}`);
                console.error(`📊 [POSITION] DEBUG: endContainer in document: ${document.body.contains(endContainer)}`);
            }
        }
        return { start: startPos, end: endPos };
    }

    /**
     * Find the containing block element.
     * NOTE: With CSS Custom Highlight API, there are NO <mark> elements to skip!
     * This function is now simpler since DOM structure is never modified.
     */
    function getContainingBlockSkippingHighlights(node) {
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        while (current && current !== document.body) {
            if (BLOCK_ELEMENTS.includes(current.tagName)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    /**
     * Get the CSS text-transform value for a text node's parent element.
     * MUST MATCH cloak-sdk.js getTextTransform() exactly.
     */
    function getTextTransform(textNode) {
        const parent = textNode.parentElement;
        if (!parent) return 'none';
        const style = window.getComputedStyle(parent);
        return style.textTransform || 'none';
    }

    /**
     * Apply CSS text-transform to a string.
     * This ensures we calculate positions on the text as it will be DISPLAYED, not as it is in source.
     * MUST MATCH cloak-sdk.js applyTextTransform() exactly.
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
     * MUST MATCH cloak-sdk.js applyFontVariantCaps() exactly.
     */
    function applyFontVariantCaps(text, capsValue) {
        switch (capsValue) {
            case 'small-caps':
            case 'all-small-caps':
            case 'petite-caps':
            case 'all-petite-caps':
            case 'unicase':
            case 'titling-caps':
                return text.toUpperCase();
            default:
                return text;
        }
    }

    /**
     * Get all CSS properties that affect text rendering and their transformations.
     * MUST MATCH cloak-sdk.js getTextAffectingProperties() exactly.
     * Returns array of transform functions to apply in sequence.
     */
    function getTextAffectingTransforms(textNode) {
        const parent = textNode.parentElement;
        if (!parent) return [];

        const style = window.getComputedStyle(parent);
        const transforms = [];

        // text-transform
        const textTransform = style.textTransform;
        if (textTransform && textTransform !== 'none') {
            transforms.push((text) => applyTextTransform(text, textTransform));
        }

        // font-variant-caps
        const fontVariantCaps = style.fontVariantCaps;
        if (fontVariantCaps && fontVariantCaps !== 'normal') {
            transforms.push((text) => applyFontVariantCaps(text, fontVariantCaps));
        }

        // font-variant shorthand (check for small-caps)
        const fontVariant = style.fontVariant;
        if (fontVariant && fontVariant.includes('small-caps')) {
            const hasCapTransform = transforms.length > 0;
            if (!hasCapTransform) {
                transforms.push((text) => applyFontVariantCaps(text, 'small-caps'));
            }
        }

        // font-feature-settings (OpenType features)
        const fontFeatureSettings = style.fontFeatureSettings;
        if (fontFeatureSettings && fontFeatureSettings !== 'normal') {
            if (fontFeatureSettings.includes('smcp') || fontFeatureSettings.includes('c2sc')) {
                const hasCapTransform = transforms.some(t => t.toString().includes('FontVariantCaps'));
                if (!hasCapTransform) {
                    transforms.push((text) => applyFontVariantCaps(text, 'small-caps'));
                }
            }
        }

        return transforms;
    }

    /**
     * Fetch plaintext for a position range from the server.
     */
    async function fetchPlaintextRange(start, end) {
        if (!encryptionConfig.apiBaseUrl || !encryptionConfig.hash) {
            console.warn('Missing API config for context menu');
            return null;
        }

        try {
            const response = await fetch(`${encryptionConfig.apiBaseUrl}/api/search/get-text-range`, {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify({
                    start: start,
                    end: end,
                    hash: encryptionConfig.hash
                })
            });

            if (response.ok) {
                const data = await response.json();
                return data.text;
            } else {
                console.warn('Failed to fetch plaintext range:', response.status);
                return null;
            }
        } catch (error) {
            console.warn('Error fetching plaintext range:', error);
            return null;
        }
    }

    /**
     * Check if a click event is on a text node.
     * Returns the character position if on text, null otherwise.
     */
    function getClickPositionIfOnText(e) {
        let range;
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(e.clientX, e.clientY);
        } else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
            if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
            }
        }

        if (!range) return null;

        const node = range.startContainer;
        // Check if we clicked on a text node
        if (node.nodeType !== Node.TEXT_NODE) return null;

        // Check if this text node should be excluded (script, style, etc.)
        if (shouldExcludeTextNode(node)) return null;

        // Get the character position using the same logic as double-click
        return getCharacterPositionFromClick(e);
    }

    /**
     * Select a word at the given position (without entering drag mode).
     * Similar to handleWordSelectionWithDragStart but without drag state.
     */
    async function selectWordAtPosition(position) {
        if (!encryptionConfig.hash || !encryptionConfig.apiBaseUrl) {
            return false;
        }

        try {
            const response = await fetch(`${encryptionConfig.apiBaseUrl}/api/search/word-boundaries`, {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify({
                    position: position,
                    hash: encryptionConfig.hash,
                    mode: 'word'
                })
            });

            if (!response.ok) return false;

            const data = await response.json();
            if (data.start !== undefined && data.end !== undefined) {
                selectTextByPosition(data.start, data.end);
                return true;
            }
        } catch (error) {
            console.warn('Error selecting word:', error);
        }
        return false;
    }

    /**
     * Set up context menu blocking when right-clicking on encrypted text.
     * - Blocks menu when text is selected (prevents "Search Google for encrypted")
     * - Blocks menu when clicking on text without selection (prevents wrong word selection)
     * - Allows normal menu on blank space, images, links, etc.
     */
    function setupContextMenuInterception() {
        document.addEventListener('contextmenu', async function(e) {
            const selection = window.getSelection();
            const selectedText = selection ? selection.toString().trim() : '';

            // Case 1: Already have a selection - block menu
            if (selectedText && selectedText.length > 0) {
                e.preventDefault();
                return;
            }

            // Case 2: No selection - check if clicking on text
            const charPosition = getClickPositionIfOnText(e);

            if (charPosition === null) {
                // Not on text - allow normal context menu (inspect, save image, etc.)
                return;
            }

            // On text without selection - block menu and select correct word
            e.preventDefault();

            // Select the word at this position using plaintext word boundaries
            await selectWordAtPosition(charPosition);

            // Menu is blocked, user can now Ctrl+C to copy the correctly selected word
        }, true);
    }

    // Setup context menu interception
    setupContextMenuInterception();

    // ============================================================================
    // SEARCH FUNCTIONALITY
    // ============================================================================

    // Navigation throttle for arrow keys
    let lastNavigationTime = 0;
    const NAVIGATION_THROTTLE_MS = 80; // ~12 navigations per second max

    // Search state
    const searchState = {
        overlay: null,
        input: null,
        matchCounter: null,
        prevButton: null,
        nextButton: null,
        closeButton: null,
        currentMatches: [],
        currentMatchIndex: -1,
        highlightRanges: [],      // Range objects for CSS Custom Highlight API
        highlightElements: [],    // DEPRECATED: Kept for backward compat, will store range metadata
        allHighlightMarks: [],    // DEPRECATED: Kept for backward compat, empty with CSS API
        lastOriginalQuery: '', // Store original query for case-insensitive search
        positionMap: null,  // Cache position mapping for server-side search
        encryptedText: null,  // Cache encrypted text from DOM (cleared on highlight clear)
        originalEncryptedText: null,  // Permanent cache of clean text for server search (never cleared)
        originalPlaintextLength: null,  // Server's plaintext length at first search (for detecting DOM changes)
        debounceTimer: null,  // Timer for debouncing search input
        markerContainer: null,  // Container for scroll bar markers
        searchVersion: 0,  // Incremented on each search, used to ignore stale results
        abortController: null  // For cancelling in-flight fetch requests
    };

    // Initialize CSS Custom Highlight API styles
    (function initHighlightStyles() {
        const style = document.createElement('style');
        style.textContent = `
            ::highlight(search-results) {
                background-color: #fff59d;
                color: inherit;
            }
            ::highlight(search-current) {
                background-color: #ff9632;
                color: inherit;
            }
        `;
        document.head.appendChild(style);
    })();

    // Ligatures mapping
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
        
        if (!encryptionConfig.hash && (!encryptionConfig.secretKey || !encryptionConfig.nonce)) {
            return query; // Return as-is if config is missing
        }
        
        try {
            const requestBody = {
                text: query
            };
            if (encryptionConfig.hash) {
                requestBody.hash = encryptionConfig.hash;
            } else {
                requestBody.secret_key = encryptionConfig.secretKey;
                requestBody.nonce = encryptionConfig.nonce;
            }
            
            const response = await fetch(`${encryptionConfig.apiBaseUrl}/api/encrypt/query`, {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify(requestBody)
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



    // ============================================================================
    // === POSITION MAPPING ======================================================
    // ============================================================================

    async function searchServerSide(query, signal) {
        /**
         * Call server-side search API.
         * Server searches in stored plaintext (retrieved from R2 via hash) and returns match positions.
         * Positions correspond exactly to character indices in the encrypted DOM text.
         * @param {string} query - Search query
         * @param {AbortSignal} signal - AbortController signal for cancellation
         */
        try {
            const response = await fetch(`${encryptionConfig.apiBaseUrl}/api/search/find-matches`, {
                method: 'POST',
                headers: getApiHeaders(),
                signal: signal,  // Pass abort signal for cancellation
                body: JSON.stringify({
                    query: query,
                    hash: encryptionConfig.hash
                    // Note: encrypted_text removed - server uses R2-stored plaintext via hash lookup
                })
            });

            if (!response.ok) {
                console.error('Server search failed:', response.status);
                return { matches: [] };
            }

            const data = await response.json();
            console.log(`🔍 SERVER RESPONSE: plaintext_length = ${data.plaintext_length}, matches = ${(data.matches || []).length}`);
            return {
                matches: data.matches || [],
                plaintext_length: data.plaintext_length  // For DOM change detection
            };
        } catch (error) {
            // Handle AbortError gracefully (request was cancelled)
            if (error.name === 'AbortError') {
                console.log('🔍 Search request cancelled');
                return { matches: [], aborted: true };
            }
            console.error('Error calling server search:', error);
            return { matches: [] };
        }
    }

    function mapPositionsToDOMNodes(matches, positionMap) {
        /**
         * Convert server-returned position indices to DOM match objects.
         * Now works with the new position map that has individual text nodes.
         *
         * matches: Array of {start, end} from server (global positions in plaintext index)
         * positionMap: Array of {node, parent, startIndex, endIndex} - each entry is a TEXT NODE
         *
         * The positions from server are in the plaintext index, which has 1:1 character
         * correspondence with the encrypted text in the DOM (same length, same order).
         */
        const domMatches = [];

        for (const match of matches) {
            const matchStart = match.start;
            const matchEnd = match.end;

            // Find ALL text nodes that overlap with this match
            // A match might span multiple text nodes
            const overlappingNodes = [];

            for (const nodeInfo of positionMap) {
                const nodeStart = nodeInfo.startIndex;
                const nodeEnd = nodeInfo.endIndex;

                // Check if this node overlaps with the match
                if (matchStart < nodeEnd && matchEnd > nodeStart) {
                    overlappingNodes.push(nodeInfo);
                }
            }

            if (overlappingNodes.length === 0) {
                console.warn('Could not find any nodes for match:', match);
                continue;
            }

            // For single-node matches (most common case)
            if (overlappingNodes.length === 1) {
                const nodeInfo = overlappingNodes[0];
                const nodeStart = nodeInfo.startIndex;

                // Convert global positions to node-relative positions
                const nodeRelativeStart = matchStart - nodeStart;
                const nodeRelativeEnd = matchEnd - nodeStart;

                domMatches.push({
                    node: nodeInfo.node,
                    parent: nodeInfo.parent,
                    startIndex: nodeRelativeStart,
                    endIndex: nodeRelativeEnd,
                    text: nodeInfo.node.textContent.substring(nodeRelativeStart, nodeRelativeEnd)
                });
            } else {
                // Multi-node match - use first node's parent and calculate relative positions
                // The highlighting function will handle spanning across nodes
                const firstNode = overlappingNodes[0];
                const parentGlobalStart = firstNode.startIndex;

                domMatches.push({
                    node: firstNode.node,
                    parent: firstNode.parent,
                    startIndex: matchStart - parentGlobalStart,
                    endIndex: matchEnd - parentGlobalStart,
                    text: '',
                    // Include info about all nodes for multi-node highlighting
                    overlappingNodes: overlappingNodes
                });
            }
        }

        return domMatches;
    }

    function getElementDepth(element) {
        let depth = 0;
        let current = element;
        while (current && current !== document.body) {
            depth++;
            current = current.parentElement;
        }
        return depth;
    }

    function isElementVisible(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        // Check the element AND all its ancestors for visibility
        let current = element;
        while (current && current !== document.body && current !== document.documentElement) {
            // Check for hidden HTML attribute
            if (current.hidden || current.hasAttribute('hidden')) {
                return false;
            }

            // Check for aria-hidden (screen readers ignore, often visually hidden too)
            if (current.getAttribute('aria-hidden') === 'true') {
                return false;
            }

            // Check computed style
            const style = window.getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }

            // Check for off-screen positioning (common hide technique)
            if (style.position === 'absolute' || style.position === 'fixed') {
                const left = parseFloat(style.left);
                const top = parseFloat(style.top);
                if (left < -1000 || top < -1000) {
                    return false;
                }
            }

            // Check for clip-path hiding
            if (style.clipPath === 'inset(100%)' || style.clip === 'rect(0, 0, 0, 0)') {
                return false;
            }

            current = current.parentElement;
        }

        // Check if element has zero dimensions
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            // Might be a line break or whitespace-only element, check if it has visible children
            const children = Array.from(element.children);
            if (children.length > 0) {
                // Check if any child is visible
                return children.some(child => isElementVisible(child));
            }
            // If no children and zero size, it's likely not visible
            return false;
        }

        return true;
    }

    /**
     * Check if text is actually rendered/visible (like browser's Ctrl+F does)
     * Uses innerText which only returns rendered text, not hidden text
     */
    function hasVisibleText(element) {
        // innerText returns empty string for hidden elements
        // This is the same logic browsers use for Ctrl+F
        try {
            const innerText = element.innerText;
            return innerText && innerText.trim().length > 0;
        } catch (e) {
            return false;
        }
    }

    /**
     * Check if element has data-nosnippet attribute.
     * These are excluded from the server-side plaintext index, so must be excluded client-side too.
     * MUST MATCH: html_encryption.py plaintext extraction logic
     * NOTE: We no longer exclude nav/footer/header - all visible text should be searchable
     */
    function isStructuralElement(element) {
        let current = element;
        while (current && current !== document.body && current !== document.documentElement) {
            // Exclude data-nosnippet (Google's hint for non-content)
            if (current.hasAttribute('data-nosnippet')) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    // Elements to exclude from position mapping (MUST MATCH cloak-sdk.js excludeSelectors)
    // NOTE: code/pre/kbd/samp/var removed in quick-008 to match SDK (see quick-007)
    const EXCLUDE_SELECTORS = [
        'script', 'style', 'noscript', 'meta', 'link', 'head',
        'svg', 'path',  // SVG elements
        'textarea', 'input', 'select', 'option', 'optgroup', 'button'  // Form elements
    ];
    const EXCLUDE_ATTRIBUTES = ['hidden', 'aria-hidden'];

    /**
     * Check if a text node should be excluded based on its ancestors.
     * MUST MATCH: cloak-sdk.js shouldExcludeNode() logic exactly
     * This ensures decrypt-interceptor builds the same position map as the SDK.
     */
    function shouldExcludeTextNode(textNode) {
        let parent = textNode.parentElement;
        while (parent && parent !== document.body && parent !== document.documentElement) {
            const tagName = parent.tagName ? parent.tagName.toLowerCase() : '';

            // Exclude elements by tag name (matches SDK excludeSelectors)
            if (EXCLUDE_SELECTORS.includes(tagName)) {
                return true;
            }

            // Check for contenteditable (WYSIWYG editors, editable regions) - MUST MATCH SDK
            if (parent.isContentEditable || parent.getAttribute('contenteditable') === 'true' || parent.getAttribute('contenteditable') === '') {
                return true;
            }

            // Exclude elements with excluded attributes (matches SDK excludeAttributes)
            for (const attr of EXCLUDE_ATTRIBUTES) {
                if (parent.hasAttribute(attr)) {
                    return true;
                }
            }

            // Exclude data-cloak-exclude elements (matches SDK)
            if (parent.hasAttribute('data-cloak-exclude')) {
                return true;
            }

            // Exclude data-nosnippet elements (server-side compatibility)
            if (parent.hasAttribute('data-nosnippet')) {
                return true;
            }

            // NOTE: We DO NOT exclude encrypted-search-highlight here anymore!
            // The server's plaintext includes ALL text, including text that's currently
            // highlighted by search. If we excluded highlighted text, position calculations
            // would be off by the total length of all highlighted text.
            // The <mark> elements are just visual wrappers - the underlying text is unchanged.
            // if (parent.classList && parent.classList.contains('encrypted-search-highlight')) {
            //     return true;
            // }

            // CRITICAL: Exclude the search overlay UI entirely (matches SDK)
            if (parent.id === 'encrypted-search-overlay') {
                return true;
            }

            // Check custom exclude selectors from config (if available)
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

            parent = parent.parentElement;
        }
        return false;
    }

    /**
     * Build position map by walking ALL text nodes in document order.
     * MUST MATCH: Server-side extraction in html_encryption.py which uses:
     *   body.get_text(separator='', strip=False) after removing nav/footer/header/hidden
     *
     * This creates a 1:1 character mapping between:
     * - Server's plaintext index (stored in R2)
     * - Client's DOM text nodes
     */
    // Block elements for position mapping (must match server-side BLOCK_ELEMENTS in html_encryption.py)
    const BLOCK_ELEMENTS_SEARCH = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                                   'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'SECTION',
                                   'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE',
                                   'TABLE', 'TR', 'TD', 'TH', 'THEAD', 'TBODY', 'TFOOT',
                                   'DL', 'DT', 'DD', 'FORM', 'FIELDSET', 'LEGEND',
                                   'ADDRESS', 'HR', 'FIGURE', 'FIGCAPTION', 'MAIN', 'BODY'];

    /**
     * Find the nearest block element ancestor of a node (for search).
     */
    function getContainingBlockForSearch(node) {
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        while (current && !BLOCK_ELEMENTS_SEARCH.includes(current.tagName)) {
            current = current.parentElement;
        }
        return current;
    }

    // DEBUG: Expose a function to compare SDK plaintext with decrypt-interceptor's encrypted text
    window.debugPositionMapping = async function() {
        console.log('=== DEBUG POSITION MAPPING ===');

        // Check for highlights (CSS Custom Highlight API - no DOM elements!)
        const highlightsActive = searchState && searchState.highlightRanges.length > 0;
        console.log('Highlights present:', highlightsActive ? searchState.highlightRanges.length : 0);

        // Build position map (same as what getSelectionPositions does)
        const mapData = buildTextPositionMap();
        console.log('Decrypt-interceptor encrypted text length:', mapData.encryptedText.length);
        console.log('Position map nodes:', mapData.positionMap.length);
        console.log('First 500 encrypted:', JSON.stringify(mapData.encryptedText.slice(0, 500)));

        // Find the LAST section header - should be near end of content
        // Look for a pattern that indicates "Performance" section
        // Since encryption varies, we'll search for the last H2's content
        const h2Elements = document.querySelectorAll('h2');
        let lastH2Text = '';
        let lastH2EncText = '';
        if (h2Elements.length > 0) {
            const lastH2 = h2Elements[h2Elements.length - 1];
            lastH2Text = lastH2.textContent.replace(/\u200B/g, '').trim();
            lastH2EncText = lastH2.textContent.replace(/\u200B/g, '').trim();
        }
        const encPerfIdx = mapData.encryptedText.indexOf(lastH2EncText);
        console.log('\n=== KEY POSITIONS ===');
        console.log(`Last H2 text: "${lastH2Text}" (${lastH2Text.length} chars)`);
        console.log(`Last H2 found in encrypted text at position: ${encPerfIdx}`);

        // Now fetch server plaintext and compare
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${encryptionConfig.apiBaseUrl}/api/search/get-text-range`, false);
            setXhrHeaders(xhr);
            xhr.send(JSON.stringify({ hash: encryptionConfig.hash, start: 0, end: 10000 }));
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                const serverPlaintext = data.text || '';
                console.log('Server plaintext length:', serverPlaintext.length);
                console.log('First 500 server plaintext:', JSON.stringify(serverPlaintext.slice(0, 500)));

                // Find "Performance Considerations" in server plaintext
                const plainPerfIdx = serverPlaintext.indexOf('Performance Considerations');
                console.log('"Performance Considerations" in server plaintext at position:', plainPerfIdx);

                // Compare
                console.log('\n=== COMPARISON ===');
                console.log('Interceptor position:', encPerfIdx);
                console.log('Server position:', plainPerfIdx);
                console.log('Position difference:', encPerfIdx - plainPerfIdx);
                if (encPerfIdx !== plainPerfIdx && plainPerfIdx !== -1 && encPerfIdx !== -1) {
                    console.log('❌ MISMATCH! Decrypt-interceptor and server have different positions');
                    console.log('   Text around server position:', JSON.stringify(serverPlaintext.slice(Math.max(0, plainPerfIdx-20), plainPerfIdx+50)));
                    console.log('   Text around interceptor position:', JSON.stringify(mapData.encryptedText.slice(Math.max(0, encPerfIdx-20), encPerfIdx+50)));

                    // Find where they diverge
                    console.log('\n=== DIVERGENCE ANALYSIS ===');
                    let divergeIdx = 0;
                    const minLen = Math.min(serverPlaintext.length, mapData.encryptedText.length);
                    // They won't match char-for-char since one is plain and one is encrypted
                    // But lengths of blocks between newlines should match
                    const serverBlocks = serverPlaintext.split('\n');
                    const encBlocks = mapData.encryptedText.split('\n');
                    console.log(`Server has ${serverBlocks.length} blocks, interceptor has ${encBlocks.length} blocks`);

                    let serverPos = 0, encPos = 0;
                    for (let i = 0; i < Math.min(serverBlocks.length, encBlocks.length); i++) {
                        const sLen = serverBlocks[i].length;
                        const eLen = encBlocks[i].length;
                        if (sLen !== eLen) {
                            console.log(`Block ${i} MISMATCH: server=${sLen} chars, interceptor=${eLen} chars`);
                            console.log(`  Server block: "${serverBlocks[i].slice(0, 50)}..."`);
                            console.log(`  Encrypt block: "${encBlocks[i].slice(0, 50)}..."`);
                            console.log(`  At position: server=${serverPos}, interceptor=${encPos}`);
                            break;
                        }
                        serverPos += sLen + 1; // +1 for newline
                        encPos += eLen + 1;
                    }
                } else if (plainPerfIdx === -1) {
                    console.log('⚠️ "Performance Considerations" not found in server plaintext!');
                    console.log('Last 200 chars of server plaintext:', JSON.stringify(serverPlaintext.slice(-200)));
                } else {
                    console.log('✅ Positions match!');
                }
            }
        } catch (e) {
            console.log('Could not fetch server plaintext:', e);
        }

        // Show each node in position map
        console.log('\n=== POSITION MAP NODES ===');
        mapData.positionMap.forEach((node, i) => {
            if (i < 20) {  // First 20 nodes
                const text = node.node.textContent.replace(/\u200B/g, '');
                // Note: _cloakOriginal is cleared after upload for security - plaintext is server-side only
                console.log(`Node ${i}: [${node.startIndex}-${node.endIndex}] encrypted="${text.slice(0,30)}..."`);
            }
        });

        return mapData;
    };

    function buildTextPositionMap() {

        const positionMap = [];
        let globalCharIndex = 0;
        let fullEncryptedText = '';
        let lastBlock = null;

        // Walk ALL text nodes in document order (same order as server's get_text())
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null  // Accept all, we filter manually to match server exactly
        );

        let textNode;
        let nodesInMark = 0;
        while (textNode = walker.nextNode()) {
            // Skip if this text node should be excluded
            // IMPORTANT: Use shouldExcludeTextNodeForPositionCalc to match getSelectionPositions
            // This ensures consistent position calculations whether or not search highlights are active
            if (shouldExcludeTextNodeForPositionCalc(textNode)) {
                continue;
            }

            // Get raw text content (server uses get_text which gives textContent equivalent)
            let text = textNode.textContent;

            // Remove zero-width spaces (matches server: .replace('\u200B', ''))
            text = text.replace(/\u200B/g, '');

            // Skip empty or whitespace-only text nodes (MUST MATCH SDK: !originalText.trim())
            if (text.length === 0 || !text.trim()) {
                continue;
            }

            // CRITICAL: Apply ALL CSS text-affecting properties to match SDK behavior
            // SDK encrypts transformed text (e.g., "HELLO" for text-transform: uppercase)
            // This includes text-transform, font-variant-caps, font-feature-settings, etc.
            // We must count positions on transformed text, not raw DOM content
            const transforms = getTextAffectingTransforms(textNode);
            for (const transform of transforms) {
                text = transform(text);
            }

            // DEBUG: Track nodes inside <mark>
            if (textNode.parentElement?.tagName === 'MARK') {
                nodesInMark++;
            }

            // Check for block boundary - add 1 for \n marker
            // IMPORTANT: Use getContainingBlockSkippingHighlights to match getSelectionPositions
            // This ensures search highlights (which wrap text in <mark>) don't affect block detection
            const currentBlock = getContainingBlockSkippingHighlights(textNode);
            // Only add newline if both blocks are valid and different
            if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
                globalCharIndex += 1;  // Count the \n marker between blocks
                fullEncryptedText += '\n';
            }
            if (currentBlock !== null) {
                lastBlock = currentBlock;
            }

            // Add to position map
            positionMap.push({
                node: textNode,
                parent: textNode.parentElement,
                startIndex: globalCharIndex,
                endIndex: globalCharIndex + text.length,
                length: text.length
            });

            globalCharIndex += text.length;
            fullEncryptedText += text;
        }

        // Strip trailing whitespace to match server: .rstrip()
        const originalLength = fullEncryptedText.length;
        fullEncryptedText = fullEncryptedText.replace(/\s+$/, '');
        const trimmedChars = originalLength - fullEncryptedText.length;

        // Adjust the last position map entry if we trimmed characters
        if (trimmedChars > 0 && positionMap.length > 0) {
            const lastEntry = positionMap[positionMap.length - 1];
            lastEntry.endIndex -= trimmedChars;
            lastEntry.length -= trimmedChars;
            // Remove entry if it's now empty
            if (lastEntry.length <= 0) {
                positionMap.pop();
            }
        }


        return {
            positionMap: positionMap,
            totalLength: fullEncryptedText.length,
            encryptedText: fullEncryptedText
        };
    }

    // Keep extractTextNodesForSearch for backward compatibility with other search functions
    function extractTextNodesForSearch() {
        const mapData = buildTextPositionMap();

        // Convert position map to the old format expected by searchEncryptedDOM
        const textNodes = [];
        const processedParents = new Set();

        for (const entry of mapData.positionMap) {
            const parent = entry.parent;
            if (!processedParents.has(parent)) {
                processedParents.add(parent);

                // Collect all text from this parent's entries
                let parentText = '';
                for (const e of mapData.positionMap) {
                    if (e.parent === parent) {
                        parentText += e.node.textContent.replace(/\u200B/g, '');
                    }
                }

                textNodes.push({
                    node: entry.node,
                    parent: parent,
                    text: parentText
                });
            }
        }

        return textNodes;
    }



    // ============================================================================
    // === SEARCH ================================================================
    // ============================================================================

    async function searchEncryptedDOM(encryptedQuery) {
        if (!encryptedQuery || encryptedQuery.length === 0) {
            return [];
        }
        
        const textNodes = extractTextNodesForSearch();

        // CRITICAL: The encrypted text in the DOM has regular spaces replaced with non-breaking spaces (\u00A0)
        // So we need to replace spaces in the encrypted query with non-breaking spaces to match
        // Also remove zero-width spaces
        const normalizedQuery = encryptedQuery.replace(/\u200B/g, '').replace(/\u0020/g, '\u00A0');
        
        // For case-insensitive search, encrypt common case variations of the original query
        const originalQuery = searchState.lastOriginalQuery || '';
        const queriesToSearch = [normalizedQuery]; // Always include the query as-is
        
        if (originalQuery) {
            // Encrypt lowercase version
            const lowerEncrypted = await encryptSearchQuery(originalQuery.toLowerCase());
            if (lowerEncrypted && lowerEncrypted !== normalizedQuery) {
                // Convert spaces to non-breaking spaces to match DOM
                queriesToSearch.push(lowerEncrypted.replace(/\u200B/g, '').replace(/\u0020/g, '\u00A0'));
            }
            
            // Encrypt uppercase version
            const upperEncrypted = await encryptSearchQuery(originalQuery.toUpperCase());
            if (upperEncrypted && upperEncrypted !== normalizedQuery) {
                // Convert spaces to non-breaking spaces to match DOM
                queriesToSearch.push(upperEncrypted.replace(/\u200B/g, '').replace(/\u0020/g, '\u00A0'));
            }
            
            // Encrypt title case (first letter uppercase, rest lowercase)
            if (originalQuery.length > 0) {
                const titleCase = originalQuery[0].toUpperCase() + originalQuery.slice(1).toLowerCase();
                const titleEncrypted = await encryptSearchQuery(titleCase);
                if (titleEncrypted && titleEncrypted !== normalizedQuery) {
                    // Convert spaces to non-breaking spaces to match DOM
                    queriesToSearch.push(titleEncrypted.replace(/\u200B/g, '').replace(/\u0020/g, '\u00A0'));
                }
            }
        }
        
        // Remove duplicates
        const uniqueQueries = [...new Set(queriesToSearch)];
        
        // Simple, robust deduplication: track matches by their actual text content and position
        // Use a Set with a key that uniquely identifies each occurrence in the document
        const seenMatches = new Set();
        const matches = [];
        const matchDetails = []; // For debugging
        
        console.log('🔍 Searching with', uniqueQueries.length, 'query variations:', uniqueQueries.map(q => JSON.stringify(q.substring(0, 20))));
        
        for (const textNode of textNodes) {
            const text = textNode.text;
            
            // Search for each encrypted query variation
            for (const queryToSearch of uniqueQueries) {
                let startIndex = 0;
                while (true) {
                    const index = text.indexOf(queryToSearch, startIndex);
                    if (index === -1) break;
                    
                    const endIndex = index + queryToSearch.length;
                    
                    // Create a unique key for this match:
                    // 1. The actual matched text (what was found in DOM)
                    // 2. A large context window (50 chars before and after) to uniquely identify the occurrence
                    // 3. The container's unique identifier
                    const matchText = text.substring(index, endIndex);
                    const contextStart = Math.max(0, index - 50);
                    const contextEnd = Math.min(text.length, endIndex + 50);
                    const context = text.substring(contextStart, contextEnd);
                    
                    // Get a stable identifier for the container
                    let containerId = 'root';
                    if (textNode.parent) {
                        // Use the container's text content hash as a stable ID
                        // This helps identify when the same container appears multiple times
                        const containerText = textNode.parent.textContent.replace(/\u200B/g, '');
                        const containerHash = containerText.substring(0, 100) + '_' + containerText.length;
                        containerId = `${textNode.parent.tagName}_${containerHash}`;
                    }
                    
                    // Create unique key: match text + large context + container
                    // This ensures we don't count the same occurrence twice
                    const uniqueKey = `${matchText}_${context}_${containerId}`;
                    
                    // Only add if we haven't seen this exact occurrence
                    if (!seenMatches.has(uniqueKey)) {
                        seenMatches.add(uniqueKey);
                        matches.push({
                            node: textNode.node,
                            parent: textNode.parent,
                            startIndex: index,
                            endIndex: endIndex,
                            text: queryToSearch,
                            context: context // Store the context for deduplication
                        });
                        matchDetails.push({
                            query: queryToSearch.substring(0, 10),
                            context: context.substring(0, 30),
                            container: containerId.substring(0, 50),
                            key: uniqueKey.substring(0, 80)
                        });
                    } else {
                        console.log('🔍 Duplicate skipped:', {
                            query: queryToSearch.substring(0, 10),
                            context: context.substring(0, 30),
                            key: uniqueKey.substring(0, 80)
                        });
                    }
                    
                    startIndex = index + 1;
                }
            }
        }
        
        console.log('🔍 After first pass:', matches.length, 'unique matches found');
        console.log('🔍 Match details:', matchDetails.slice(0, 10)); // Show first 10 for debugging
        
        // Additional pass: if same text appears in parent and child containers, keep only one
        // Sort by container depth (deeper = more specific) and remove duplicates
        const finalMatches = [];
        const occurrenceKeys = new Set();
        const duplicateInfo = [];
        
        // Sort matches by container depth (deepest first) so we keep the most specific ones
        matches.sort((a, b) => {
            const depthA = getElementDepth(a.parent);
            const depthB = getElementDepth(b.parent);
            return depthB - depthA; // Deeper containers first
        });
        
        // Single-stage deduplication: Check for nested containers (parent/child with same match = duplicate)
        // The first pass already handles duplicates with same context + container using uniqueKey
        // So we only need to handle nested containers here
        
        // First, filter out matches in hidden elements
        const visibleMatches = matches.filter(match => {
            if (!match.parent) return true; // Keep if no parent (shouldn't happen)
            const visible = isElementVisible(match.parent);
            if (!visible) {
                duplicateInfo.push({
                    stage: 'visibility',
                    reason: 'element not visible',
                    removed: match.parent ? match.parent.tagName : 'unknown'
                });
            }
            return visible;
        });
        
        console.log('🔍 After visibility filter:', visibleMatches.length, 'visible matches from', matches.length, 'total');
        
        // Sort by depth (deepest first) so we process children before parents
        visibleMatches.sort((a, b) => {
            const depthA = getElementDepth(a.parent);
            const depthB = getElementDepth(b.parent);
            return depthB - depthA;
        });
        
        visibleMatches.forEach((match, idx) => {
            const matchText = match.text;
            const newContainer = match.parent;
            const newContext = match.context;
            const newNode = match.node;
            const newStartIndex = match.startIndex;
            const newEndIndex = match.endIndex;
            
            // Check if this match is a duplicate of any existing match
            let isDuplicate = false;
            
            for (let i = 0; i < finalMatches.length; i++) {
                const existingMatch = finalMatches[i];
                const existingContainer = existingMatch.parent;
                const existingContext = existingMatch.context;
                const existingNode = existingMatch.node;
                const existingStartIndex = existingMatch.startIndex;
                const existingEndIndex = existingMatch.endIndex;
                
                if (!existingContainer || !newContainer) continue;
                
                // Must have the same match text to be considered duplicates
                if (existingMatch.text !== matchText) continue;
                
                // Check if they're in the same text node at the same position
                const sameTextNode = existingNode === newNode;
                const samePosition = sameTextNode && 
                                   existingStartIndex === newStartIndex && 
                                   existingEndIndex === newEndIndex;
                
                // Check if positions overlap in the same text node
                let positionsOverlap = false;
                if (sameTextNode) {
                    positionsOverlap = (newStartIndex >= existingStartIndex && newStartIndex < existingEndIndex) ||
                                     (newEndIndex > existingStartIndex && newEndIndex <= existingEndIndex) ||
                                     (newStartIndex <= existingStartIndex && newEndIndex >= existingEndIndex);
                }
                
                // Check if containers are nested (one actually contains the other in DOM tree)
                const existingContainsNew = existingContainer.contains && existingContainer.contains(newContainer);
                const newContainsExisting = newContainer.contains && newContainer.contains(existingContainer);
                const containersNested = existingContainsNew || newContainsExisting;
                
                // CRITICAL FIX: If containers are nested and match text is the same,
                // they represent the same occurrence (child's text is included in parent's textContent)
                // Since we process deeper containers first (sorted by depth), existing (in finalMatches) is deeper
                // So if new (current) contains existing, new is parent and should be skipped
                if (containersNested && existingMatch.text === matchText) {
                    // newContainsExisting means new (parent) contains existing (child) - skip the parent
                    if (newContainsExisting) {
                        isDuplicate = true;
                        duplicateInfo.push({
                            stage: 2,
                            index: idx,
                            reason: 'nested container: parent match, child already found',
                            kept: existingContainer.tagName,
                            removed: newContainer.tagName,
                            keptDepth: getElementDepth(existingContainer),
                            removedDepth: getElementDepth(newContainer)
                        });
                        break;
                    }
                    // existingContainsNew shouldn't happen since we process deeper first,
                    // but if it does, it means existing (child) contains new (parent) which is impossible
                    // So we can ignore this case
                }
                
                // Check if contexts match (exact match)
                const contextsMatch = existingContext === newContext;
                
                // Check if one context contains the other (one is a substring of the other)
                // This handles cases where the context window captures slightly different ranges
                const contextContains = existingContext.includes(newContext) || newContext.includes(existingContext);
                
                // Check if contexts share significant overlap (at least 60% of the shorter context)
                // This catches cases where context windows are slightly different but represent the same occurrence
                const minContextLength = Math.min(existingContext.length, newContext.length);
                const maxContextLength = Math.max(existingContext.length, newContext.length);
                let contextOverlap = false;
                if (minContextLength > 0 && maxContextLength > 0) {
                    // Find longest common substring that includes the match text
                    const matchInExisting = existingContext.includes(matchText);
                    const matchInNew = newContext.includes(matchText);
                    if (matchInExisting && matchInNew) {
                        // Check if they share a significant portion (60% of shorter context)
                        const overlapThreshold = Math.floor(minContextLength * 0.6);
                        // Simple check: if one contains a significant portion of the other
                        const existingInNew = newContext.includes(existingContext.substring(0, overlapThreshold)) ||
                                            newContext.includes(existingContext.substring(existingContext.length - overlapThreshold));
                        const newInExisting = existingContext.includes(newContext.substring(0, overlapThreshold)) ||
                                            existingContext.includes(newContext.substring(newContext.length - overlapThreshold));
                        contextOverlap = existingInNew || newInExisting;
                    }
                }
                
                // Check if they're in the same container
                const sameContainer = existingContainer === newContainer;
                
                // Check if text nodes are related (one contains the other, or they're siblings)
                const nodesRelated = (existingNode.parentNode && existingNode.parentNode.contains(newNode)) ||
                                   (newNode.parentNode && newNode.parentNode.contains(existingNode)) ||
                                   (existingNode.parentNode === newNode.parentNode);
                
                // Determine if this is a duplicate:
                // 1. Same position in same text node (definite duplicate)
                // 2. Overlapping positions in same text node (same match)
                // 3. Nested containers with same context (parent/child showing same occurrence)
                // 4. Same container with matching/overlapping contexts (same occurrence, different context window)
                // 5. Related text nodes with same context (sibling or parent-child text nodes showing same occurrence)
                if (samePosition || 
                    (sameTextNode && positionsOverlap) || 
                    (containersNested && contextsMatch) ||
                    (sameContainer && (contextsMatch || contextOverlap)) ||
                    (nodesRelated && contextsMatch)) {
                    isDuplicate = true;
                    duplicateInfo.push({
                        stage: 2,
                        index: idx,
                        reason: samePosition ? 'same text node and position' : 
                               (sameTextNode && positionsOverlap) ? 'overlapping positions in same text node' :
                               (containersNested && contextsMatch) ? 'nested containers with same context' :
                               (sameContainer && contextsMatch) ? 'same container with same context' :
                               (sameContainer && contextOverlap) ? 'same container with overlapping contexts' :
                               'related text nodes with same context',
                        kept: existingContainer.tagName,
                        removed: newContainer.tagName,
                        keptDepth: getElementDepth(existingContainer),
                        removedDepth: getElementDepth(newContainer)
                    });
                    break;
                }
            }
            
            if (!isDuplicate) {
                finalMatches.push(match);
            }
        });
        
        console.log('🔍 After deduplication:', finalMatches.length, 'unique matches');
        if (duplicateInfo.length > 0) {
            console.log('🔍 Removed duplicates:', duplicateInfo);
        }
        
        // Sort matches back to document order (the order they appear in the DOM)
        finalMatches.sort((a, b) => {
            // Compare the text nodes' positions in the document
            const nodeA = a.node;
            const nodeB = b.node;
            
            if (!nodeA || !nodeB) return 0;
            
            // Use compareDocumentPosition to determine order
            const position = nodeA.compareDocumentPosition(nodeB);
            
            // If nodeA comes before nodeB
            if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
                return -1;
            }
            // If nodeA comes after nodeB
            if (position & Node.DOCUMENT_POSITION_PRECEDING) {
                return 1;
            }
            
            // If they're in the same node, compare by start index
            if (position === 0 || (position & Node.DOCUMENT_POSITION_CONTAINED_BY)) {
                return a.startIndex - b.startIndex;
            }
            
            return 0;
        });
        
        console.log('🔍 Final unique matches:', finalMatches.length, 'from', matches.length, 'raw matches (', uniqueQueries.length, 'query variations)');
        return finalMatches;
    }

    /**
     * Update highlight styling for navigation without clearing/rebuilding.
     * With CSS Custom Highlight API - just update which ranges are in which highlight!
     */
    function updateCurrentMatchHighlight(currentIndex) {
        if (!CSS.highlights) return;

        // Get the range for the current match
        const currentRangeData = searchState.highlightElements[currentIndex];

        if (currentRangeData && currentRangeData.range) {
            // Update CSS highlights: current match gets orange highlight, all others get yellow
            const currentRange = currentRangeData.range;
            const allOtherRanges = searchState.highlightRanges
                .filter(rd => rd.matchIndex !== currentIndex)
                .map(rd => rd.range);

            // Register highlights
            CSS.highlights.set('search-results', new Highlight(...allOtherRanges));
            CSS.highlights.set('search-current', new Highlight(currentRange));

            // Scroll to current match
            const rect = currentRange.getBoundingClientRect();
            const viewportHeight = window.innerHeight;

            // Check visibility states
            const isFullyVisible = rect.top >= 0 && rect.bottom <= viewportHeight;
            const isPartiallyVisibleTop = rect.top < 0 && rect.bottom > 0;
            const isPartiallyVisibleBottom = rect.top < viewportHeight && rect.bottom > viewportHeight;
            const isCompletelyOffScreen = rect.bottom <= 0 || rect.top >= viewportHeight;

            if (isFullyVisible) {
                // Already fully visible - no scroll needed
            } else if (isPartiallyVisibleTop) {
                // Partially cut off at top - scroll so match is at top edge
                currentRange.startContainer.parentElement.scrollIntoView({ behavior: 'instant', block: 'start' });
            } else if (isPartiallyVisibleBottom) {
                // Partially cut off at bottom - scroll so match is at bottom edge
                currentRange.startContainer.parentElement.scrollIntoView({ behavior: 'instant', block: 'end' });
            } else if (isCompletelyOffScreen) {
                // Completely off screen - center it
                currentRange.startContainer.parentElement.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
        }

        // Update scroll bar markers to reflect current match
        updateScrollMarkers(currentIndex);
    }

    function clearHighlights() {
        // CSS Custom Highlight API approach - no DOM modification needed!
        // Simply clear the highlight registries
        if (CSS.highlights) {
            CSS.highlights.delete('search-results');
            CSS.highlights.delete('search-current');
        }

        // Clear state
        searchState.highlightRanges = [];
        searchState.highlightElements = [];
        searchState.allHighlightMarks = [];

        // Note: With CSS Highlight API, we DON'T invalidate position map
        // because DOM structure was never modified - it's still pristine!
        // This improves performance for repeated searches.
        // searchState.positionMap = null;  // NOT NEEDED
        // searchState.encryptedText = null;  // NOT NEEDED

        // Clear scroll markers
        if (searchState.markerContainer) {
            searchState.markerContainer.innerHTML = '';
            searchState.markerContainer.style.display = 'none';
        }
    }

    /**
     * Create the container for scroll bar markers.
     * Positioned on the right side of the viewport over the scroll track.
     */
    function createScrollMarkerContainer() {
        const container = document.createElement('div');
        container.id = 'search-scroll-markers';
        container.style.cssText = `
            position: fixed;
            right: 0;
            top: 0;
            width: 12px;
            height: 100vh;
            pointer-events: none;
            z-index: 10001;
            display: none;
        `;
        document.body.appendChild(container);
        searchState.markerContainer = container;
    }

    /**
     * Update scroll bar markers to show match positions.
     * Yellow markers for regular matches, orange for current match.
     */
    function updateScrollMarkers(currentMatchIndex) {
        if (!searchState.markerContainer) return;

        // Clear existing markers
        searchState.markerContainer.innerHTML = '';

        const highlights = searchState.highlightElements;
        if (highlights.length === 0) {
            searchState.markerContainer.style.display = 'none';
            return;
        }

        searchState.markerContainer.style.display = 'block';
        const docHeight = document.documentElement.scrollHeight;

        // Group matches by line (vertical position)
        const lineGroups = new Map(); // Map<roundedTop, {percentage, hasCurrentMatch}>

        highlights.forEach((rangeData, idx) => {
            if (!rangeData.range) return;

            const rect = rangeData.range.getBoundingClientRect();
            const absoluteTop = rect.top + window.scrollY;
            const roundedTop = Math.round(absoluteTop);
            const percentage = (absoluteTop / docHeight) * 100;

            if (!lineGroups.has(roundedTop)) {
                lineGroups.set(roundedTop, {
                    percentage: percentage,
                    hasCurrentMatch: idx === currentMatchIndex
                });
            } else if (idx === currentMatchIndex) {
                lineGroups.get(roundedTop).hasCurrentMatch = true;
            }
        });

        // Create one marker per line
        lineGroups.forEach((group) => {
            const marker = document.createElement('div');
            marker.style.cssText = `
                position: absolute;
                right: 0;
                top: ${group.percentage}%;
                width: 12px;
                height: 1px;
                background-color: ${group.hasCurrentMatch ? '#ff9632' : '#ffeb3b'};
            `;
            searchState.markerContainer.appendChild(marker);
        });
    }

    /**
     * Find the match closest to the viewport center.
     * Used for smart initial match selection when searching.
     * @param {number|null} savedScrollY - Saved scroll position to use instead of current (optional)
     */
    function findClosestMatchToViewport(savedScrollY = null) {
        const highlights = searchState.highlightElements;
        if (highlights.length === 0) return 0;

        // Use saved position if provided, otherwise current position
        const scrollY = savedScrollY !== null ? savedScrollY : window.scrollY;
        const viewportCenterY = scrollY + (window.innerHeight / 2);
        let closestIndex = 0;
        let closestDistance = Infinity;

        highlights.forEach((rangeData, idx) => {
            if (!rangeData.range) return;

            const rect = rangeData.range.getBoundingClientRect();
            // Adjust for scroll position difference if using saved position
            const currentScrollY = window.scrollY;
            const scrollDiff = savedScrollY !== null ? (currentScrollY - savedScrollY) : 0;
            const absoluteTop = rect.top + currentScrollY - scrollDiff;
            const distance = Math.abs(absoluteTop - viewportCenterY);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = idx;
            }
        });

        return closestIndex;
    }

    function highlightAcrossMultipleNodes(startChar, endChar, matchIndex, parentContainer) {
        // For multi-node matches, collect all nodes and create ONE range spanning them
        // NO DOM modification with CSS Custom Highlight API!

        // Use the parent container as TreeWalker root (e.g., <p>, not <span>)
        const walker = document.createTreeWalker(
            parentContainer,
            NodeFilter.SHOW_TEXT,
            null
        );

        // Find start and end nodes
        let currentNode;
        let foundStart = false;
        const nodesToHighlight = [];

        while (currentNode = walker.nextNode()) {
            if (currentNode === startChar.node) {
                foundStart = true;
            }

            if (foundStart) {
                let startOffset, endOffset;
                const logicalLength = currentNode.textContent.replace(/\u200B/g, '').length;

                if (currentNode === startChar.node && currentNode === endChar.node) {
                    startOffset = startChar.offset;
                    endOffset = endChar.offset + 1;
                } else if (currentNode === startChar.node) {
                    startOffset = startChar.offset;
                    endOffset = logicalLength;
                } else if (currentNode === endChar.node) {
                    startOffset = 0;
                    endOffset = endChar.offset + 1;
                } else {
                    startOffset = 0;
                    endOffset = logicalLength;
                }

                nodesToHighlight.push({
                    node: currentNode,
                    startOffset,
                    endOffset
                });

                if (currentNode === endChar.node) {
                    break;
                }
            }
        }

        if (!foundStart || nodesToHighlight.length === 0) {
            console.warn('Could not find nodes for multi-node match');
            return;
        }

        // Create ranges for each node segment (can't create a single cross-node range with different offsets)
        let firstRangeData = null;
        for (const nodeInfo of nodesToHighlight) {
            const rangeData = highlightInSingleTextNode(
                nodeInfo.node,
                nodeInfo.startOffset,
                nodeInfo.endOffset,
                matchIndex,
                true  // skipTracking - we'll track only the first one
            );

            if (!firstRangeData && rangeData) {
                firstRangeData = rangeData;
            }
        }

        // Track only the first range for navigation (multi-node matches count as ONE match)
        if (firstRangeData) {
            searchState.highlightElements.push(firstRangeData);
        }
    }

    /**
     * Highlight a match that spans multiple text nodes using CSS Custom Highlight API.
     * Creates Range objects for each node segment - NO DOM modification!
     * Only the first range is tracked for navigation (so multi-word matches count as ONE match).
     */
    function highlightMultiNodeMatch(match, matchIndex) {
        const overlappingNodes = match.overlappingNodes;
        if (!overlappingNodes || overlappingNodes.length === 0) return;

        // Calculate global match boundaries
        const firstNodeGlobalStart = overlappingNodes[0].startIndex;
        const globalMatchStart = firstNodeGlobalStart + match.startIndex;
        const globalMatchEnd = firstNodeGlobalStart + match.endIndex;

        let firstRangeData = null;

        // Process all nodes (no need for reverse order since we're not modifying DOM!)
        for (const nodeInfo of overlappingNodes) {
            const nodeGlobalStart = nodeInfo.startIndex;
            const nodeLogicalLength = nodeInfo.node.textContent.replace(/\u200B/g, '').length;

            // Calculate which portion of this node is part of the match (all in logical coordinates)
            const highlightStart = Math.max(0, globalMatchStart - nodeGlobalStart);
            const highlightEnd = Math.min(nodeLogicalLength, globalMatchEnd - nodeGlobalStart);

            if (highlightStart < highlightEnd && nodeInfo.node.nodeType === Node.TEXT_NODE) {
                const rangeData = highlightInSingleTextNode(
                    nodeInfo.node,
                    highlightStart,
                    highlightEnd,
                    matchIndex,
                    true  // Skip automatic tracking - we'll handle it manually
                );

                // Track the first range for navigation
                if (!firstRangeData && rangeData) {
                    firstRangeData = rangeData;
                }
            }
        }

        // Only push ONE range per match for navigation purposes
        if (firstRangeData) {
            searchState.highlightElements.push(firstRangeData);
        }
    }

    /**
     * Highlight multiple matches within a single text node using CSS Custom Highlight API.
     * NO DOM modification - creates Range objects instead!
     * Matches must be sorted by startIndex (ascending order).
     */
    function highlightMultipleMatchesInNode(textNode, matches) {
        if (!textNode || !textNode.parentNode || matches.length === 0) return;

        const rawText = textNode.textContent;

        // Convert all logical offsets to raw offsets and create ranges
        for (const match of matches) {
            const rawStart = logicalToRawOffset(rawText, match.startIndex);
            const rawEnd = logicalToRawOffset(rawText, match.endIndex);

            if (rawStart >= rawEnd || rawStart > rawText.length || rawEnd > rawText.length) {
                console.warn('Invalid match offsets:', { match, rawStart, rawEnd, rawTextLen: rawText.length });
                continue;
            }

            // Create a Range object for this match - NO DOM MODIFICATION!
            const range = document.createRange();
            range.setStart(textNode, rawStart);
            range.setEnd(textNode, rawEnd);

            // Store range with metadata for navigation
            const rangeData = {
                range,
                matchIndex: match.matchIndex,
                node: textNode
            };

            searchState.highlightRanges.push(rangeData);
            searchState.highlightElements.push(rangeData);  // For navigation compatibility
        }
    }

    function highlightInSingleTextNode(textNode, startOffset, endOffset, matchIndex, skipTracking = false) {
        const rawText = textNode.textContent;

        // Validate offsets
        if (startOffset < 0 || endOffset < 0 || startOffset >= endOffset) {
            console.warn('Invalid offsets:', { startOffset, endOffset, rawTextLen: rawText.length });
            return null;
        }

        // Convert logical offsets (which exclude zero-width spaces) to raw offsets
        const rawStartOffset = logicalToRawOffset(rawText, startOffset);
        const rawEndOffset = logicalToRawOffset(rawText, endOffset);

        // Validate raw offsets
        if (rawStartOffset > rawText.length || rawEndOffset > rawText.length) {
            console.warn('Raw offset out of bounds:', { rawStartOffset, rawEndOffset, rawTextLen: rawText.length, startOffset, endOffset });
            return null;
        }

        // Create a Range object for this match - NO DOM MODIFICATION!
        const range = document.createRange();
        range.setStart(textNode, rawStartOffset);
        range.setEnd(textNode, rawEndOffset);

        // Store range with metadata for navigation
        const rangeData = {
            range,
            matchIndex,
            node: textNode
        };

        searchState.highlightRanges.push(rangeData);

        // Track in highlightElements for navigation (skip for multi-node parts handled by caller)
        if (!skipTracking) {
            searchState.highlightElements.push(rangeData);
        }

        return rangeData;
    }

    function highlightSingleMatch(match, charToNode, parentContainer) {
        const startChar = charToNode[match.startIndex];
        const endChar = charToNode[match.endIndex - 1];
        if (!startChar || !endChar) return;

        // Handle single text node case (most common)
        if (startChar.node === endChar.node) {
            highlightInSingleTextNode(
                startChar.node,
                startChar.offset,
                endChar.offset + 1,
                match.matchIndex
            );
        } else {
            // Handle multi-node case (match spans multiple text nodes)
            highlightAcrossMultipleNodes(
                startChar,
                endChar,
                match.matchIndex,
                parentContainer
            );
        }
    }

    function highlightMatchesInParent(parent, matches) {
        if (!parent || !parent.parentNode) return;

        // Get all text nodes in this parent
        const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null);
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }
        if (textNodes.length === 0) return;

        // Build character position map for this parent
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

        // No need to sort when using CSS Highlight API - order doesn't matter!

        // Process each match
        matches.forEach(match => {
            try {
                highlightSingleMatch(match, charToNode, parent);
            } catch (e) {
                console.warn('Error highlighting match:', e);
            }
        });
    }

    function highlightMatches(matches, currentIndex, isNavigation = false) {
        // For navigation, just update styling - don't clear and rebuild highlights
        if (isNavigation) {
            updateCurrentMatchHighlight(currentIndex);
            return;
        }

        // Full rebuild for new searches
        clearHighlights();
        if (matches.length === 0) return;

        // Add matchIndex to each match for tracking
        const indexedMatches = matches.map((m, idx) => ({...m, matchIndex: idx}));

        // Group matches by text node - NO LONGER CRITICAL with CSS Highlight API!
        // We don't modify DOM, so node references stay valid
        const matchesByNode = new Map();
        const multiNodeMatches = [];

        for (const match of indexedMatches) {
            if (match.overlappingNodes && match.overlappingNodes.length > 1) {
                multiNodeMatches.push(match);
            } else if (match.node && match.node.nodeType === Node.TEXT_NODE) {
                if (!matchesByNode.has(match.node)) {
                    matchesByNode.set(match.node, []);
                }
                matchesByNode.get(match.node).push(match);
            }
        }

        // Process each node's matches - order doesn't matter with CSS Highlight API!
        for (const [node, nodeMatches] of matchesByNode) {
            nodeMatches.sort((a, b) => a.startIndex - b.startIndex);

            try {
                highlightMultipleMatchesInNode(node, nodeMatches);
            } catch (e) {
                console.warn('Error highlighting matches in node:', e, nodeMatches);
            }
        }

        // Process multi-node matches
        for (const match of multiNodeMatches) {
            try {
                highlightMultiNodeMatch(match, match.matchIndex);
            } catch (e) {
                console.warn('Error highlighting multi-node match:', e, match);
            }
        }

        // Sort range data in document order for proper navigation
        searchState.highlightElements.sort((a, b) => {
            const posA = a.range.startContainer;
            const posB = b.range.startContainer;
            const position = posA.compareDocumentPosition(posB);
            if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
            if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
            return 0;
        });

        // Register all ranges with CSS Custom Highlight API
        if (CSS.highlights) {
            // Create Highlight objects for all matches and current match
            const allRanges = searchState.highlightRanges.map(rd => rd.range);
            const allHighlight = new Highlight(...allRanges);
            CSS.highlights.set('search-results', allHighlight);

            // Set initial current match highlight
            updateCurrentMatchHighlight(currentIndex);
        } else {
            console.warn('CSS Custom Highlight API not supported in this browser');
        }

        // Scroll to current match only if out of view
        if (currentIndex >= 0 && currentIndex < searchState.highlightElements.length) {
            const rangeData = searchState.highlightElements[currentIndex];
            if (rangeData && rangeData.range) {
                const rect = rangeData.range.getBoundingClientRect();
                const margin = 100;
                const isInView = rect.top >= margin && rect.bottom <= (window.innerHeight - margin);
                if (!isInView) {
                    rangeData.range.startContainer.parentElement.scrollIntoView({ behavior: 'instant', block: 'center' });
                }
            }
        }

        // Update scroll bar markers
        updateScrollMarkers(currentIndex);
    }

    function navigateToMatch(direction) {
        const matches = searchState.currentMatches;
        if (matches.length === 0) return;
        
        if (direction === 'next') {
            searchState.currentMatchIndex = (searchState.currentMatchIndex + 1) % matches.length;
        } else if (direction === 'prev') {
            searchState.currentMatchIndex = searchState.currentMatchIndex <= 0 
                ? matches.length - 1 
                : searchState.currentMatchIndex - 1;
        }
        
        highlightMatches(matches, searchState.currentMatchIndex, true);  // true = navigation mode
        updateMatchCounter();
    }

    function updateMatchCounter() {
        const count = searchState.currentMatches.length;
        const index = searchState.currentMatchIndex;
        // Reset color (may have been changed by DOM change warning)
        if (searchState.matchCounter) {
            searchState.matchCounter.style.color = '';
        }
        if (count === 0) {
            searchState.matchCounter.textContent = 'No matches';
        } else {
            searchState.matchCounter.textContent = `${index + 1} of ${count}`;
        }
    }

    /**
     * Public function to search encrypted content programmatically
     * @param {string} query - The search query (will be encrypted automatically)
     * @returns {Promise<Array>} Array of match objects
     */
    async function searchEncryptedContent(query) {
        if (!query || query.trim().length === 0) {
            clearHighlights();
            searchState.currentMatches = [];
            searchState.currentMatchIndex = -1;
            updateMatchCounter();
            return [];
        }
        
        try {
            console.log('🔍 searchEncryptedContent called with query:', query);
            
            // Encrypt the query
            const encryptedQuery = await encryptSearchQuery(query);
            console.log('🔍 Encrypted query:', encryptedQuery);
            
            // Search for matches
            const matches = await searchEncryptedDOM(encryptedQuery);
            searchState.currentMatches = matches;
            
            if (matches.length > 0) {
                searchState.currentMatchIndex = 0;
                highlightMatches(matches, 0);
                console.log('✅ Found', matches.length, 'matches');
            } else {
                searchState.currentMatchIndex = -1;
                clearHighlights();
                console.log('❌ No matches found');
            }
            
            updateMatchCounter();
            return matches;
        } catch (error) {
            console.error('❌ Error in searchEncryptedContent:', error);
            console.error('Stack:', error.stack);
            return [];
        }
    }

    function handleSearchInput(event) {
        const query = event.target.value;

        // Cancel any in-flight search request immediately
        if (searchState.abortController) {
            searchState.abortController.abort();
            searchState.abortController = null;
        }

        // Handle empty query immediately
        if (!query || query.trim().length === 0) {
            console.log('🔍 Empty query, clearing highlights');
            searchState.searchVersion++;  // Invalidate any in-flight searches
            clearHighlights();
            searchState.currentMatches = [];
            searchState.currentMatchIndex = -1;
            updateMatchCounter();
            return;
        }

        // Increment version and create new AbortController for this search
        searchState.searchVersion++;
        const thisSearchVersion = searchState.searchVersion;
        const currentQuery = query;
        searchState.abortController = new AbortController();
        const signal = searchState.abortController.signal;

        // Search immediately on every keystroke
        // AbortController cancels previous requests, searchVersion handles edge cases
        (async () => {

            try {
                console.log('🔍 handleSearchInput called (decrypt-interceptor)');
                console.log('🔍 Query value:', currentQuery);
                searchState.lastOriginalQuery = currentQuery;

                // Cache the original clean text on first search (before any highlights exist)
                // This text never changes - only <mark> elements are added/removed
                if (!searchState.originalEncryptedText) {
                    clearHighlights();  // Ensure clean DOM
                    const mapData = buildTextPositionMap();
                    searchState.originalEncryptedText = mapData.encryptedText;
                    console.log('🔍 Cached original encrypted text for future searches');
                }

                // KEEP old highlights visible during server search (no flicker)
                // Server search uses the cached CLEAN text (never includes <mark> elements)
                console.log(`🔍 Searching for: "${currentQuery}"`);
                const serverResult = await searchServerSide(currentQuery, signal);

                // Check if request was aborted (cancelled by newer search)
                if (serverResult.aborted) {
                    // Clear any warning that might have been set by a previous search
                    // This prevents stale "Content changed - refresh page" warnings from persisting
                    if (searchState.matchCounter) {
                        searchState.matchCounter.style.color = '';
                    }
                    return;  // Silently exit - a newer search is in progress
                }

                console.log(`🔍 Server found ${serverResult.matches.length} matches`);

                // CHECK: If a newer search started, discard these stale results (backup check)
                if (thisSearchVersion !== searchState.searchVersion) {
                    console.log('🔍 Discarding stale search results');
                    // Clear any warning that might have been set by a previous search
                    if (searchState.matchCounter) {
                        searchState.matchCounter.style.color = '';
                    }
                    return;
                }

                // NOW clear highlights and rebuild position map in quick succession
                // This happens synchronously, so no visible gap
                clearHighlights();

                // Build position map with clean DOM (no <mark> elements)
                console.log('🔍 Building position map...');
                const mapData = buildTextPositionMap();
                searchState.positionMap = mapData.positionMap;
                searchState.encryptedText = mapData.encryptedText;
                console.log(`🔍 Position map ready: ${mapData.totalLength} characters`);

                // DETECT DOM CHANGES: Compare server's plaintext length with current DOM length
                // Server returns plaintext_length - if it differs from our DOM, content has changed
                const serverPlaintextLength = serverResult.plaintext_length;
                console.log(`🔍 DOM CHANGE CHECK: serverResult.plaintext_length = ${serverPlaintextLength}`);
                console.log(`🔍 DOM CHANGE CHECK: mapData.totalLength = ${mapData.totalLength}`);
                console.log(`🔍 DOM CHANGE CHECK: serverPlaintextLength !== undefined? ${serverPlaintextLength !== undefined}`);
                if (serverPlaintextLength !== undefined) {
                    // Store on first search
                    if (searchState.originalPlaintextLength === null) {
                        searchState.originalPlaintextLength = serverPlaintextLength;
                        console.log(`🔍 Stored original plaintext length: ${serverPlaintextLength}`);
                    }

                    // Check for mismatch (allow small tolerance for whitespace differences)
                    const lengthDiff = Math.abs(mapData.totalLength - serverPlaintextLength);
                    const TOLERANCE = 5;  // Small tolerance for trailing whitespace
                    console.log(`🔍 DOM CHANGE CHECK: lengthDiff = ${lengthDiff}, TOLERANCE = ${TOLERANCE}`);
                    if (lengthDiff > TOLERANCE) {
                        console.warn(`⚠️ DOM CONTENT CHANGED: Server plaintext=${serverPlaintextLength}, DOM=${mapData.totalLength}, diff=${lengthDiff}`);
                        console.warn('⚠️ Search positions may be inaccurate. Refresh page for accurate search.');

                        // Show warning to user
                        if (searchState.matchCounter) {
                            searchState.matchCounter.textContent = 'Content changed - refresh page';
                            searchState.matchCounter.style.color = '#ff6b6b';
                        }
                        searchState.currentMatches = [];
                        searchState.currentMatchIndex = -1;
                        return;  // Don't attempt to highlight - positions would be wrong
                    }
                }

                // DEBUG: Compare lengths and first few chars
                console.log('🔍 DEBUG: Encrypted text length:', mapData.encryptedText.length);
                console.log('🔍 DEBUG: First 200 encrypted chars:', JSON.stringify(mapData.encryptedText.slice(0, 200)));
                console.log('🔍 DEBUG: Position map nodes:', mapData.positionMap.length);
                if (mapData.positionMap.length > 0) {
                    const first = mapData.positionMap[0];
                    const last = mapData.positionMap[mapData.positionMap.length - 1];
                    console.log('🔍 DEBUG: First node range:', first.startIndex, '-', first.endIndex, 'text:', JSON.stringify(first.node.textContent.slice(0, 50)));
                    console.log('🔍 DEBUG: Last node range:', last.startIndex, '-', last.endIndex);
                }

                // DEBUG: Show first match details
                if (serverResult.matches.length > 0) {
                    const firstMatch = serverResult.matches[0];
                    console.log('🔍 DEBUG: First server match:', firstMatch);
                    console.log('🔍 DEBUG: Encrypted text at match position:', JSON.stringify(mapData.encryptedText.slice(firstMatch.start, firstMatch.end)));
                }

                // Map server positions to DOM nodes
                const domMatches = mapPositionsToDOMNodes(serverResult.matches, searchState.positionMap);
                console.log(`🔍 Mapped to ${domMatches.length} DOM matches`);

                // DEBUG: Show first DOM match
                if (domMatches.length > 0) {
                    const firstDom = domMatches[0];
                    console.log('🔍 DEBUG: First DOM match:', {
                        startIndex: firstDom.startIndex,
                        endIndex: firstDom.endIndex,
                        text: firstDom.text,
                        nodeText: firstDom.node.textContent.slice(0, 100)
                    });
                }
                searchState.currentMatches = domMatches;

                if (domMatches.length > 0) {
                    // Save current scroll position BEFORE highlighting (which may scroll)
                    const savedScrollY = window.scrollY;

                    // Highlight all matches (pass -1 to skip auto-scroll)
                    highlightMatches(domMatches, -1);

                    // Find closest match using SAVED scroll position
                    const closestIndex = findClosestMatchToViewport(savedScrollY);
                    searchState.currentMatchIndex = closestIndex;
                    updateCurrentMatchHighlight(closestIndex);
                    console.log(`✅ Search successful! Starting at match ${closestIndex + 1} (closest to viewport)`);
                } else {
                    searchState.currentMatchIndex = -1;
                    // Already cleared above, no need to clear again
                    console.log('❌ No matches found');
                }

                updateMatchCounter();
            } catch (error) {
                console.error('❌ Error in handleSearchInput:', error);
                console.error('Stack:', error.stack);
                updateMatchCounter();
            }
        })();
    }

    function createSearchOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'encrypted-search-overlay';
        overlay.style.cssText = `position: fixed; top: 20px; right: 20px; background: white; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); padding: 8px; z-index: 10000; font-size: 14px; display: none;`;
        
        const inputContainer = document.createElement('div');
        inputContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Search...';
        input.style.cssText = `border: 1px solid #ccc; border-radius: 2px; padding: 4px 8px; font-size: 14px; width: 200px; outline: none;`;
        input.addEventListener('input', handleSearchInput);
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                navigateToMatch('next');
            } else if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                navigateToMatch('prev');
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const now = Date.now();
                if (now - lastNavigationTime >= NAVIGATION_THROTTLE_MS) {
                    lastNavigationTime = now;
                    navigateToMatch('next');
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const now = Date.now();
                if (now - lastNavigationTime >= NAVIGATION_THROTTLE_MS) {
                    lastNavigationTime = now;
                    navigateToMatch('prev');
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideSearchOverlay();
            }
        });
        
        const matchCounter = document.createElement('span');
        matchCounter.style.cssText = 'color: #666; font-size: 12px; min-width: 60px; text-align: center;';
        matchCounter.textContent = 'No matches';
        
        const prevButton = document.createElement('button');
        prevButton.textContent = '↑';
        prevButton.title = 'Previous (↑ or Shift+Enter)';
        prevButton.style.cssText = `border: 1px solid #ccc; background: white; border-radius: 2px; padding: 2px 8px; cursor: pointer; font-size: 12px;`;
        prevButton.addEventListener('click', () => navigateToMatch('prev'));
        
        const nextButton = document.createElement('button');
        nextButton.textContent = '↓';
        nextButton.title = 'Next (↓ or Enter)';
        nextButton.style.cssText = prevButton.style.cssText;
        nextButton.addEventListener('click', () => navigateToMatch('next'));
        
        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.title = 'Close (Esc)';
        closeButton.style.cssText = `border: none; background: transparent; font-size: 18px; cursor: pointer; padding: 0 4px; line-height: 1; color: #666;`;
        closeButton.addEventListener('click', hideSearchOverlay);
        
        inputContainer.appendChild(input);
        inputContainer.appendChild(matchCounter);
        inputContainer.appendChild(prevButton);
        inputContainer.appendChild(nextButton);
        inputContainer.appendChild(closeButton);
        overlay.appendChild(inputContainer);
        
        searchState.overlay = overlay;
        searchState.input = input;
        searchState.matchCounter = matchCounter;
        searchState.prevButton = prevButton;
        searchState.nextButton = nextButton;
        searchState.closeButton = closeButton;
        
        return overlay;
    }

    function showSearchOverlay() {
        if (!searchState.overlay) {
            const overlay = createSearchOverlay();
            document.body.appendChild(overlay);
            // Create scroll marker container when overlay is first created
            createScrollMarkerContainer();
        }
        searchState.overlay.style.display = 'block';
        searchState.input.focus();
        searchState.input.select();
    }

    function hideSearchOverlay() {
        // Cancel any in-flight search request
        if (searchState.abortController) {
            searchState.abortController.abort();
            searchState.abortController = null;
        }

        if (searchState.overlay) {
            searchState.overlay.style.display = 'none';
            searchState.input.value = '';
            clearHighlights();
            searchState.currentMatches = [];
            searchState.currentMatchIndex = -1;
        }
    }

    function setupSearchInterception() {
        console.log('%c🔍 Setting up Ctrl+F search interception...', 'color: #2196F3; font-weight: bold;');
        document.addEventListener('keydown', function(e) {
            // Only log when Ctrl or Cmd key is pressed with 'f'
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                console.log('%c🔍 Ctrl+F detected! Intercepting...', 'color: #4CAF50; font-weight: bold;');
                console.log('[Decrypt Interceptor] Key event details:', {
                    key: e.key,
                    ctrlKey: e.ctrlKey,
                    metaKey: e.metaKey,
                    defaultPrevented: e.defaultPrevented
                });
                e.preventDefault();
                e.stopPropagation();
                console.log('[Decrypt Interceptor] Called preventDefault() and stopPropagation()');
                showSearchOverlay();
            }
        }, true);
        console.log('%c✅ Ctrl+F search interception active', 'color: #4CAF50; font-weight: bold;');
    }

    // Setup search interception immediately
    setupSearchInterception();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupSearchInterception);
    }



    // ============================================================================
    // === SELECTION =============================================================
    // ============================================================================

    // ============================================================================
    // WORD SELECTION (Double/Triple Click) FUNCTIONALITY
    // ============================================================================

    // Block elements that define paragraph/section boundaries (must match server-side BLOCK_ELEMENTS in html_encryption.py)
    const BLOCK_ELEMENTS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                            'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'SECTION',
                            'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE',
                            'TABLE', 'TR', 'TD', 'TH', 'THEAD', 'TBODY', 'TFOOT',
                            'DL', 'DT', 'DD', 'FORM', 'FIELDSET', 'LEGEND',
                            'ADDRESS', 'HR', 'FIGURE', 'FIGCAPTION', 'MAIN', 'BODY'];

    /**
     * Find the nearest block element ancestor of a node.
     */
    function getContainingBlock(node) {
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        while (current && !BLOCK_ELEMENTS.includes(current.tagName)) {
            current = current.parentElement;
        }
        return current;
    }

    /**
     * Get a character position based on Y coordinate for shift+drag in empty space.
     * Returns the end of the last text node above the Y position, or start/end of document.
     */
    function getPositionFromYCoordinate(clientY) {
        // Build position map with node bounding rects
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null
        );

        let globalPosition = 0;
        let lastBlock = null;
        let textNode;
        let lastValidPosition = 0;
        let lastNodeBottom = 0;

        while (textNode = walker.nextNode()) {
            if (shouldExcludeTextNodeForPositionCalc(textNode)) {
                continue;
            }

            const text = textNode.textContent.replace(/\u200B/g, '');
            if (text.length === 0 || !text.trim()) {
                continue;
            }

            const currentBlock = getContainingBlockSkippingHighlights(textNode);
            if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
                globalPosition += 1;
            }
            if (currentBlock !== null) {
                lastBlock = currentBlock;
            }

            // Get bounding rect of this text node
            const range = document.createRange();
            range.selectNodeContents(textNode);
            const rect = range.getBoundingClientRect();

            // If click Y is above this node, return end of previous content
            if (clientY < rect.top && lastValidPosition > 0) {
                return lastValidPosition;
            }

            // If click Y is within this node's vertical range, return end of this node
            if (clientY >= rect.top && clientY <= rect.bottom) {
                return globalPosition + text.length;
            }

            globalPosition += text.length;
            lastValidPosition = globalPosition;
            lastNodeBottom = rect.bottom;
        }

        // Click is below all content - return end of document
        return lastValidPosition;
    }

    /**
     * Get the character position in the full document text from a click event.
     * Uses the same position mapping as search functionality.
     * Inserts \n markers at block element boundaries to match server plaintext.
     */
    function getCharacterPositionFromClick(event) {
        const target = event.target;

        // Get the text node and offset from the click
        let range;
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(event.clientX, event.clientY);
        } else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(event.clientX, event.clientY);
            if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
            }
        }

        if (!range) return null;

        const clickedNode = range.startContainer;
        const offsetInNode = range.startOffset;

        // If we didn't click on a text node, return null
        if (clickedNode.nodeType !== Node.TEXT_NODE) {
            return null;
        }

        // Build position map to find global position
        // We need to walk the DOM in the same order as the server-side extraction
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null
        );

        let globalPosition = 0;
        let lastBlock = null;
        let textNode;
        while (textNode = walker.nextNode()) {
            // Skip excluded text nodes - use highlight-aware version
            // This ensures position calculation works even when search highlights are active
            if (shouldExcludeTextNodeForPositionCalc(textNode)) {
                continue;
            }

            // Get text content without zero-width spaces
            const text = textNode.textContent.replace(/\u200B/g, '');

            // Skip empty or whitespace-only text nodes (MUST MATCH SDK: !originalText.trim())
            if (text.length === 0 || !text.trim()) {
                continue;
            }

            // Check for block boundary - add 1 for \n marker
            // Use highlight-aware block detection
            const currentBlock = getContainingBlockSkippingHighlights(textNode);
            // Only add newline if both blocks are valid and different
            if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
                globalPosition += 1;  // Count the \n marker between blocks
            }
            if (currentBlock !== null) {
                lastBlock = currentBlock;
            }

            // Check if this is the clicked node
            if (textNode === clickedNode) {
                // Adjust offset for any zero-width spaces before the click position
                let adjustedOffset = 0;
                const rawText = textNode.textContent;
                for (let i = 0; i < offsetInNode && i < rawText.length; i++) {
                    if (rawText[i] !== '\u200B') {
                        adjustedOffset++;
                    }
                }
                return globalPosition + Math.min(adjustedOffset, text.length - 1);
            }

            globalPosition += text.length;
        }

        return null;
    }

    /**
     * Select text in the DOM given start and end positions (in plaintext coordinates).
     * Maps positions back to DOM nodes and creates a selection.
     * Accounts for \n markers at block element boundaries.
     *
     * IMPORTANT: Uses highlight-aware functions to work even when search highlights are active.
     */
    function selectTextByPosition(startPos, endPos) {
        if (startPos === endPos) {
            // Empty selection
            window.getSelection().removeAllRanges();
            return;
        }

        // Build position map with block boundary markers
        const positionMap = [];
        let globalCharIndex = 0;
        let lastBlock = null;

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null
        );

        let textNode;
        while (textNode = walker.nextNode()) {
            // Use highlight-aware exclusion
            if (shouldExcludeTextNodeForPositionCalc(textNode)) {
                continue;
            }

            const text = textNode.textContent.replace(/\u200B/g, '');
            // Skip empty or whitespace-only text nodes (MUST MATCH SDK: !originalText.trim())
            if (text.length === 0 || !text.trim()) {
                continue;
            }

            // Check for block boundary - add 1 for \n marker
            // Use highlight-aware block detection
            const currentBlock = getContainingBlockSkippingHighlights(textNode);
            // Only add newline if both blocks are valid and different
            if (lastBlock !== null && currentBlock !== null && currentBlock !== lastBlock) {
                globalCharIndex += 1;  // Count the \n marker between blocks
            }
            if (currentBlock !== null) {
                lastBlock = currentBlock;
            }

            positionMap.push({
                node: textNode,
                startIndex: globalCharIndex,
                endIndex: globalCharIndex + text.length,
                // Map from logical position to actual text node offset (accounting for zero-width spaces)
                rawText: textNode.textContent
            });

            globalCharIndex += text.length;
        }

        // Find nodes that contain our selection
        let startNode = null, startOffset = 0;
        let endNode = null, endOffset = 0;

        for (const entry of positionMap) {
            // Find start node
            if (!startNode && startPos >= entry.startIndex && startPos < entry.endIndex) {
                startNode = entry.node;
                // Convert logical offset to raw offset (accounting for zero-width spaces)
                const logicalOffset = startPos - entry.startIndex;
                startOffset = logicalToRawOffset(entry.rawText, logicalOffset);
            }

            // Find end node
            if (endPos > entry.startIndex && endPos <= entry.endIndex) {
                endNode = entry.node;
                const logicalOffset = endPos - entry.startIndex;
                endOffset = logicalToRawOffset(entry.rawText, logicalOffset);
            }
        }

        if (!startNode || !endNode) {
            console.warn('Could not find nodes for selection', { startPos, endPos, startNode, endNode });
            return;
        }

        // Create selection
        try {
            const selection = window.getSelection();
            selection.removeAllRanges();
            const range = document.createRange();
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
            selection.addRange(range);
        } catch (e) {
            console.warn('Error creating selection:', e);
        }
    }

    /**
     * Convert logical offset (excluding zero-width spaces) to raw offset in text.
     */
    function logicalToRawOffset(rawText, logicalOffset) {
        let rawOffset = 0;
        let logicalCount = 0;
        while (rawOffset < rawText.length && logicalCount < logicalOffset) {
            if (rawText[rawOffset] !== '\u200B') {
                logicalCount++;
            }
            rawOffset++;
        }
        return rawOffset;
    }

    /**
     * State for word-by-word drag selection (double-click-hold-drag).
     * When active, mousemove expands selection word-by-word instead of char-by-char.
     */
    const wordDragState = {
        active: false,
        anchorWordStart: null,
        anchorWordEnd: null
    };
    let lastDragApiCall = 0;
    const DRAG_THROTTLE_MS = 50;

    /**
     * Handle double-click word selection AND start word drag mode.
     * Uses server-side word boundary detection to keep plaintext secure.
     */
    async function handleWordSelectionWithDragStart(position) {
        if (!encryptionConfig.hash || !encryptionConfig.apiBaseUrl) {
            console.warn('Cannot perform word selection: missing hash or apiBaseUrl');
            return;
        }

        try {
            const response = await fetch(`${encryptionConfig.apiBaseUrl}/api/search/word-boundaries`, {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify({
                    position: position,
                    hash: encryptionConfig.hash,
                    mode: 'word'
                })
            });

            if (!response.ok) {
                console.warn('Word boundaries API call failed:', response.status);
                return;
            }

            const data = await response.json();

            if (data.start !== undefined && data.end !== undefined) {
                // Select the word/punctuation/whitespace
                selectTextByPosition(data.start, data.end);
                console.log('📝 Selected word:', data.text);

                // Enter word drag mode - anchor this word for drag selection
                wordDragState.active = true;
                wordDragState.anchorWordStart = data.start;
                wordDragState.anchorWordEnd = data.end;

                // Update shift+click anchor to start of selected word
                selectionAnchorPosition = data.start;
            }
        } catch (error) {
            console.warn('Error in word selection with drag start:', error);
        }
    }

    /**
     * Select the containing block element for triple-click (paragraph selection).
     * This is handled client-side since it's based on DOM structure, not plaintext positions.
     */
    function selectContainingBlock(event) {
        let range;
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(event.clientX, event.clientY);
        } else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(event.clientX, event.clientY);
            if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
            }
        }

        if (!range) return false;

        let node = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE) {
            node = node.parentElement;
        }

        // Find the containing block element
        while (node && node !== document.body) {
            if (BLOCK_ELEMENTS.includes(node.tagName)) {
                const selection = window.getSelection();
                selection.removeAllRanges();
                const newRange = document.createRange();
                newRange.selectNodeContents(node);
                selection.addRange(newRange);
                console.log('📝 Selected paragraph:', node.tagName);

                // Update shift+click anchor to start of selected paragraph
                // We get the positions from the selection we just made
                const positions = getSelectionPositions();
                if (positions && positions.start !== null) {
                    selectionAnchorPosition = positions.start;
                }
                return true;
            }
            node = node.parentElement;
        }
        return false;
    }

    /**
     * Setup double/triple click handling for word selection.
     * Uses mousedown with event.detail to prevent default selection BEFORE it happens.
     * Allows drag-to-select naturally.
     */

    // Track anchor position for shift+click selection extension
    let selectionAnchorPosition = null;

    // Track shift+drag state for character-by-character selection
    const shiftDragState = {
        active: false,
        anchorPosition: null
    };

    function setupWordSelectionInterception() {
        // Handle click types in mousedown
        // event.detail: 1 = single click, 2 = double click, 3 = triple click, 4+ = rapid clicks
        document.addEventListener('mousedown', function(event) {
            // Only handle left clicks
            if (event.button !== 0) return;

            if (event.detail === 1) {
                // Single click handling
                if (event.shiftKey && selectionAnchorPosition !== null) {
                    // Shift+click: extend selection from anchor to clicked position
                    // Also enable shift+drag mode for continued dragging
                    event.preventDefault();

                    // Always enable shift+drag mode, even if click is outside text
                    // This allows dragging to work like native browser behavior
                    shiftDragState.active = true;
                    shiftDragState.anchorPosition = selectionAnchorPosition;

                    const clickedPosition = getCharacterPositionFromClick(event);
                    if (clickedPosition !== null) {
                        const startPos = Math.min(selectionAnchorPosition, clickedPosition);
                        const endPos = Math.max(selectionAnchorPosition, clickedPosition);
                        selectTextByPosition(startPos, endPos);
                        // Keep anchor at original position for further shift+clicks
                    }
                    // If clickedPosition is null (clicked outside text), drag handler will pick up movement
                } else {
                    // Normal single click: set new anchor position, clear selection
                    window.getSelection().removeAllRanges();
                    const clickedPosition = getCharacterPositionFromClick(event);
                    if (clickedPosition !== null) {
                        selectionAnchorPosition = clickedPosition;
                    }
                    // Don't preventDefault - allow cursor placement and drag-to-select
                }
            } else if (event.detail === 2) {
                // Double-click: word selection + start word drag mode
                event.preventDefault();
                const charPosition = getCharacterPositionFromClick(event);
                if (charPosition !== null) {
                    handleWordSelectionWithDragStart(charPosition);
                }
            } else if (event.detail === 3) {
                // Triple-click: paragraph selection via DOM (client-side)
                event.preventDefault();
                selectContainingBlock(event);
            } else if (event.detail >= 4) {
                // Rapid clicks (4+): prevent default to keep existing selection stable
                event.preventDefault();
            }
        }, true); // Use capture phase to intercept early

        // Mousemove handler for word-by-word drag selection AND shift+drag character selection
        document.addEventListener('mousemove', async function(event) {
            // Handle shift+drag (character-by-character selection)
            if (shiftDragState.active) {
                // Throttle updates during drag
                const now = Date.now();
                if (now - lastDragApiCall < DRAG_THROTTLE_MS) return;
                lastDragApiCall = now;

                // Try to get exact character position first
                let charPosition = getCharacterPositionFromClick(event);

                // If click is outside text, use Y-coordinate fallback (like native browser)
                if (charPosition === null) {
                    charPosition = getPositionFromYCoordinate(event.clientY);
                }

                if (charPosition === null) return;

                // Extend selection from anchor to current position (character-by-character)
                const startPos = Math.min(shiftDragState.anchorPosition, charPosition);
                const endPos = Math.max(shiftDragState.anchorPosition, charPosition);
                selectTextByPosition(startPos, endPos);
                return;
            }

            // Handle word drag (word-by-word selection after double-click)
            if (!wordDragState.active) return;

            // Throttle API calls during drag
            const now = Date.now();
            if (now - lastDragApiCall < DRAG_THROTTLE_MS) return;
            lastDragApiCall = now;

            const charPosition = getCharacterPositionFromClick(event);
            if (charPosition === null) return;

            // Get word boundaries at current mouse position
            try {
                const response = await fetch(`${encryptionConfig.apiBaseUrl}/api/search/word-boundaries`, {
                    method: 'POST',
                    headers: getApiHeaders(),
                    body: JSON.stringify({
                        position: charPosition,
                        hash: encryptionConfig.hash,
                        mode: 'word'
                    })
                });

                if (!response.ok) return;
                const data = await response.json();

                if (data.start !== undefined && data.end !== undefined) {
                    // Extend selection from anchor word to current word
                    const selStart = Math.min(wordDragState.anchorWordStart, data.start);
                    const selEnd = Math.max(wordDragState.anchorWordEnd, data.end);
                    selectTextByPosition(selStart, selEnd);
                }
            } catch (error) {
                // Ignore errors during drag
            }
        }, true);

        // Mouseup handler to exit drag modes
        document.addEventListener('mouseup', function(event) {
            if (wordDragState.active) {
                wordDragState.active = false;
                wordDragState.anchorWordStart = null;
                wordDragState.anchorWordEnd = null;
            }
            if (shiftDragState.active) {
                shiftDragState.active = false;
                // Keep anchorPosition - it's the same as selectionAnchorPosition
            }
        }, true);

        console.log('%c📝 Word Selection Interception:', 'color: #9C27B0; font-weight: bold;', '✅ Active (with word drag)');
    }

    // Setup word selection interception (only once to prevent duplicate handlers)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupWordSelectionInterception);
    } else {
        setupWordSelectionInterception();
    }

    // Prefetch search index to warm the cache (fire-and-forget)
    function prefetchSearchIndex() {
        if (encryptionConfig && encryptionConfig.hash && encryptionConfig.apiBaseUrl) {
            fetch(`${encryptionConfig.apiBaseUrl}/api/search/prefetch`, {
                method: 'POST',
                headers: getApiHeaders(),
                body: JSON.stringify({ hash: encryptionConfig.hash })
            }).catch(() => {}); // Silently ignore errors
        }
    }
    prefetchSearchIndex();

    // Update scroll markers on window resize
    window.addEventListener('resize', () => {
        if (searchState.highlightElements.length > 0) {
            updateScrollMarkers(searchState.currentMatchIndex);
        }
    });

    // Expose functions globally for use by other scripts
    window.encryptLazyContent = encryptLazyContent;
    window.decryptText = decryptText;
    window.searchEncryptedContent = searchEncryptedContent;
    window.showSearchOverlay = showSearchOverlay;
    window.hideSearchOverlay = hideSearchOverlay;


    // ============================================================================
    // === INITIALIZATION ========================================================
    // ============================================================================


    // Debug helper - only runs when explicitly called
    window.debugEncryption = function() {
        console.log('%c🔧 Encryption Debug Information', 'color: #4CAF50; font-weight: bold; font-size: 16px;');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        console.log('%c1. Configuration', 'color: #2196F3; font-weight: bold; font-size: 14px;');
        console.table(window.encryptionConfig || { error: 'Not set' });

        console.log('%c2. Available Functions', 'color: #9C27B0; font-weight: bold; font-size: 14px;');
        console.log({
            'decryptText': typeof window.decryptText,
            'encryptLazyContent': typeof window.encryptLazyContent,
            'searchEncryptedContent': typeof window.searchEncryptedContent,
            'showSearchOverlay': typeof window.showSearchOverlay
        });

        console.log('%c3. Font Status', 'color: #FF9800; font-weight: bold; font-size: 14px;');
        if (document.fonts) {
            const allFonts = Array.from(document.fonts);
            const encryptedFontsByName = allFonts.filter(f =>
                f.family.includes('Encrypted') || f.family.includes('decryption')
            );

            // Check for font sources in CSS (base64 vs URLs)
            const styleTags = document.querySelectorAll('style');
            let base64InlinedFonts = 0;
            let urlBasedFonts = 0;

            styleTags.forEach(style => {
                const css = style.textContent || '';

                // Check for base64 inlined fonts
                const base64Matches = css.match(/data:font\/woff2;base64,[A-Za-z0-9+\/=]+/g);
                if (base64Matches) base64InlinedFonts += base64Matches.length;

                // Check for URL-based fonts
                if (css.includes('proxy-font') || css.includes('decryption_') || css.includes('/fonts/decryption_')) {
                    const urlMatches = css.match(/url\(['"]?([^'"]*(?:proxy-font|decryption_)[^'"]*)['"]?\)/g);
                    if (urlMatches) urlBasedFonts += urlMatches.length;
                }
            });

            const fontLinks = document.querySelectorAll('link[rel="preload"][as="font"], link[href*="decryption_"], link[href*="proxy-font"]');

            const loadingMethod = base64InlinedFonts > 0
                ? '✅ Base64 Inlined (instant)'
                : urlBasedFonts > 0
                ? '🌐 URL-Based (network)'
                : '⚠️ Unknown';

            console.log({
                'Total fonts': allFonts.length,
                'Encrypted fonts (by name)': encryptedFontsByName.length,
                'Base64 inlined fonts': base64InlinedFonts,
                'URL-based fonts': urlBasedFonts,
                'Font preload links': fontLinks.length,
                'Loading Method': loadingMethod,
                'Fonts ready': document.fonts.check('1em EncryptedFont') || base64InlinedFonts > 0 || urlBasedFonts > 0
            });

            if (base64InlinedFonts > 0) {
                console.log('%c⚡ Fonts inlined as base64 - loaded instantly!', 'color: #4CAF50; font-weight: bold;');
            } else if (urlBasedFonts > 0) {
                console.log('%c⏳ Fonts loaded from URLs - network request required', 'color: #FF9800; font-weight: bold;');
            }
        }

        console.log('%c4. DOM Analysis', 'color: #00BCD4; font-weight: bold; font-size: 14px;');
        const encryptedElements = document.querySelectorAll('[style*="font-family"][style*="Encrypted"], span[style*="word-break"]');
        console.log({
            'Encrypted elements': encryptedElements.length,
            'Sample elements': Array.from(encryptedElements).slice(0, 3).map(el => ({
                tag: el.tagName,
                text: el.textContent.substring(0, 50) + '...',
                hasEncryptedFont: getComputedStyle(el).fontFamily.includes('Encrypted')
            }))
        });

        console.log('%c5. API Connectivity', 'color: #F44336; font-weight: bold; font-size: 14px;');
        if (window.encryptionConfig && window.encryptionConfig.apiBaseUrl) {
            fetch(window.encryptionConfig.apiBaseUrl + '/api/health')
                .then(res => res.json())
                .then(data => console.log({ status: '✅ Connected', service: data.service }))
                .catch(err => console.error({ status: '❌ Failed', error: err.message }));
        } else {
            console.warn('API Base URL not configured');
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('%c💡 Run debugEncryption() anytime to see this information', 'color: #607D8B; font-style: italic;');
    };


})();
