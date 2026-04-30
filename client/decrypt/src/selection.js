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
