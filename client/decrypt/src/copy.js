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
                // WORKAROUND: Normalize all parents of highlights before position calculation
                // This ensures split text nodes are merged correctly
                // (Fixes issue where first search has incorrect positions)
                const highlightParents = new Set();
                document.querySelectorAll('.encrypted-search-highlight').forEach(mark => {
                    if (mark.parentElement) {
                        highlightParents.add(mark.parentElement);
                    }
                });
                if (highlightParents.size > 0) {
                    console.log(`📋 [COPY] Found ${highlightParents.size} parents with highlights`);
                }

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

        console.log(`[Decrypt Interceptor] finalText after normalization: "${finalText.substring(0, 50)}..." (${finalText.length} chars)`);

        // Set clipboard data with plaintext (for browser's default copy behavior)
        if (!e.clipboardData) {
            console.error('[Decrypt Interceptor] clipboardData is null! Cannot set clipboard.');
            return;
        }

        if (!finalText || finalText.length === 0) {
            console.error('[Decrypt Interceptor] finalText is empty! API call may have failed.');
        }

        // Clear any existing clipboard data first
        e.clipboardData.clearData();

        // Set our decrypted text as the clipboard content
        e.clipboardData.setData('text/plain', finalText);
        console.log(`[Decrypt Interceptor] Set clipboardData to: "${finalText.substring(0, 50)}..." (${finalText.length} chars)`);

        // Prevent default to stop browser from copying the encrypted text
        // The clipboardData we set will be used instead
        e.preventDefault();

        // Also write to system clipboard for automated test compatibility
        // In Playwright/automated contexts, clipboardData.setData alone may not populate system clipboard
        // We need to use navigator.clipboard.writeText as well
        if (navigator.clipboard && navigator.clipboard.writeText) {
            // Fire-and-forget async write to system clipboard
            navigator.clipboard.writeText(finalText).then(() => {
                console.log('[Decrypt Interceptor] Successfully wrote to system clipboard via navigator.clipboard.writeText');
            }).catch(err => {
                console.warn('[Decrypt Interceptor] Failed to write to system clipboard:', err);
                // If clipboard API fails, try legacy execCommand approach
                try {
                    const textArea = document.createElement('textarea');
                    textArea.value = finalText;
                    textArea.style.position = 'fixed';
                    textArea.style.opacity = '0';
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    console.log('[Decrypt Interceptor] Fell back to execCommand copy');
                } catch (execErr) {
                    console.error('[Decrypt Interceptor] Both clipboard methods failed:', execErr);
                }
            });
        } else {
            console.warn('[Decrypt Interceptor] navigator.clipboard.writeText not available');
        }
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

    // DEBUG: Check if search highlights are present during position calculation
    const highlightsCount = document.querySelectorAll('.encrypted-search-highlight').length;

    // CRITICAL: Check if endContainer is an ELEMENT node (not TEXT)
    // This happens when selection ends at an element boundary (e.g., end of an <li>)
    // In this case, endContainer is the parent element and endOffset is 0
    const endContainerIsElement = endContainer.nodeType === Node.ELEMENT_NODE;

    // CRITICAL FIX: When highlights are present, use searchState.originalEncryptedText for position lookup
    // The DOM has been modified by highlights, so counting positions directly gives wrong results.
    // Instead, extract the selected encrypted text and find it in the original encrypted text.
    // NOTE: We use originalEncryptedText (permanent cache) not encryptedText (cleared on each search)
    if (highlightsCount > 0) {
        console.log(`⚠️ [POSITION] Checking for pre-highlight text: searchState exists=${typeof searchState !== 'undefined'}, originalEncryptedText=${searchState?.originalEncryptedText?.length || 'null'}, encryptedText=${searchState?.encryptedText?.length || 'null'}`);
    }
    if (highlightsCount > 0 && typeof searchState !== 'undefined' && searchState.originalEncryptedText) {
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

        const text = textNode.textContent.replace(/\u200B/g, '');
        // Skip empty or whitespace-only text nodes (MUST MATCH SDK: !originalText.trim())
        if (text.length === 0 || !text.trim()) {
            continue;
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
 * Find the containing block element, skipping over <mark> highlight elements.
 * This is needed because <mark> elements are not structural and shouldn't
 * affect block boundary detection.
 */
function getContainingBlockSkippingHighlights(node) {
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
    highlightElements: [],    // One per match (for navigation counting)
    allHighlightMarks: [],    // ALL mark elements (for cleanup and styling)
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

