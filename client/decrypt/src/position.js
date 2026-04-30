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
const EXCLUDE_SELECTORS = ['script', 'style', 'noscript', 'meta', 'link', 'head', 'svg', 'path', 'textarea', 'input'];
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

    // Check for highlights
    const highlights = document.querySelectorAll('.encrypted-search-highlight');
    console.log('Highlights present:', highlights.length);

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

