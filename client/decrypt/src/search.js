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
 * This preserves the DOM structure and just changes which match is "current".
 */
function updateCurrentMatchHighlight(currentIndex) {
    // Style ALL marks based on their data-match-index (handles multi-node matches)
    searchState.allHighlightMarks.forEach(el => {
        const matchIdx = parseInt(el.getAttribute('data-match-index'), 10);
        if (matchIdx === currentIndex) {
            el.style.backgroundColor = '#ff9632';  // Current match - orange
        } else {
            el.style.backgroundColor = 'yellow';   // Other matches - yellow
        }
    });

    // Scroll to the primary element for this match (from highlightElements)
    const primaryEl = searchState.highlightElements[currentIndex];
    if (primaryEl) {
        const rect = primaryEl.getBoundingClientRect();
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
            primaryEl.scrollIntoView({ behavior: 'instant', block: 'start' });
        } else if (isPartiallyVisibleBottom) {
            // Partially cut off at bottom - scroll so match is at bottom edge
            primaryEl.scrollIntoView({ behavior: 'instant', block: 'end' });
        } else if (isCompletelyOffScreen) {
            // Completely off screen - center it
            primaryEl.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
    }

    // Update scroll bar markers to reflect current match
    updateScrollMarkers(currentIndex);
}

function clearHighlights() {
    // Collect unique parents that contain highlights
    const affectedParents = new Set();

    // PHASE 1: Replace all <mark> elements with text nodes, collect affected parents
    searchState.allHighlightMarks.forEach(el => {
        if (el.parentNode) {
            const parent = el.parentNode;
            affectedParents.add(parent);

            // Replace <mark> with its text content
            const restoredNode = document.createTextNode(el.textContent);
            restoredNode._cloakEncrypted = true;
            // Note: We don't set _cloakOriginal here for security - plaintext is on server only
            parent.replaceChild(restoredNode, el);
        }
    });

    // PHASE 2: Normalize each affected parent to merge adjacent text nodes
    // This restores the DOM structure to match the original (pre-highlight) state
    affectedParents.forEach(parent => {
        // Normalize the parent (merges adjacent text nodes)
        parent.normalize();

        // Re-apply _cloakEncrypted flag to merged nodes
        const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null);
        let node;
        while (node = walker.nextNode()) {
            node._cloakEncrypted = true;
            // Note: We don't set _cloakOriginal - plaintext is on server only for security
        }
    });

    searchState.highlightElements = [];
    searchState.allHighlightMarks = [];

    // Invalidate position map since DOM structure has been restored
    // This forces rebuild on next search with fresh node references
    searchState.positionMap = null;
    searchState.encryptedText = null;

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

    // Group matches by line (vertical position) so multiple matches on the same line
    // share a single marker that turns orange if ANY match on that line is current
    const lineGroups = new Map(); // Map<roundedTop, {percentage, hasCurrentMatch}>

    highlights.forEach((el, idx) => {
        const rect = el.getBoundingClientRect();
        const absoluteTop = rect.top + window.scrollY;
        const roundedTop = Math.round(absoluteTop); // Group by pixel line
        const percentage = (absoluteTop / docHeight) * 100;

        if (!lineGroups.has(roundedTop)) {
            lineGroups.set(roundedTop, {
                percentage: percentage,
                hasCurrentMatch: idx === currentMatchIndex
            });
        } else if (idx === currentMatchIndex) {
            // Update to mark this line as having the current match
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

    highlights.forEach((el, idx) => {
        const rect = el.getBoundingClientRect();
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

function highlightAcrossMultipleNodes(startChar, endChar, matchIndex, currentMatchIndex, parentContainer) {
    // For multi-node matches, collect all nodes FIRST, then highlight
    // This prevents TreeWalker invalidation when DOM is mutated
    // parentContainer: The parent element (e.g., <p>) that contains all the spans

    // Use the parent container as TreeWalker root (e.g., <p>, not <span>)
    const walker = document.createTreeWalker(
        parentContainer,
        NodeFilter.SHOW_TEXT,
        null
    );

    // PHASE 1: Collect all text nodes in the match range
    const nodesToHighlight = [];
    let currentNode;
    let foundStart = false;

    while (currentNode = walker.nextNode()) {
        // Check if this is the start node
        if (currentNode === startChar.node) {
            foundStart = true;
        }

        // Collect nodes in the range
        if (foundStart) {
            let startOffset, endOffset;
            // Get LOGICAL length (excluding zero-width spaces) for "entire node" cases
            const logicalLength = currentNode.textContent.replace(/\u200B/g, '').length;

            if (currentNode === startChar.node && currentNode === endChar.node) {
                // Single node (shouldn't happen here, but handle it)
                startOffset = startChar.offset;
                endOffset = endChar.offset + 1;
            } else if (currentNode === startChar.node) {
                // First node: from start offset to end (use logical length)
                startOffset = startChar.offset;
                endOffset = logicalLength;
            } else if (currentNode === endChar.node) {
                // Last node: from beginning to end offset
                startOffset = 0;
                endOffset = endChar.offset + 1;
            } else {
                // Middle nodes: entire node (use logical length)
                startOffset = 0;
                endOffset = logicalLength;
            }

            nodesToHighlight.push({
                node: currentNode,
                startOffset: startOffset,
                endOffset: endOffset
            });

            // Stop if we've reached the end node
            if (currentNode === endChar.node) {
                break;
            }
        }
    }

    if (!foundStart) {
        console.warn('Could not find start node in parent container');
        return;
    }

    // PHASE 2: Highlight all collected nodes in REVERSE order
    // This prevents offset shifting when modifying earlier nodes
    for (let i = nodesToHighlight.length - 1; i >= 0; i--) {
        const nodeInfo = nodesToHighlight[i];
        highlightInSingleTextNode(
            nodeInfo.node,
            nodeInfo.startOffset,
            nodeInfo.endOffset,
            matchIndex,
            currentMatchIndex
        );
    }
}

/**
 * Highlight a match that spans multiple text nodes.
 * Each node gets its appropriate portion highlighted.
 * Only the first highlight element is tracked for navigation (so multi-word matches count as ONE match).
 */
function highlightMultiNodeMatch(match, matchIndex, currentMatchIndex) {
    const overlappingNodes = match.overlappingNodes;
    if (!overlappingNodes || overlappingNodes.length === 0) return;

    // Calculate global match boundaries
    const firstNodeGlobalStart = overlappingNodes[0].startIndex;
    const globalMatchStart = firstNodeGlobalStart + match.startIndex;
    const globalMatchEnd = firstNodeGlobalStart + match.endIndex;

    let firstHighlight = null;

    // Process nodes in reverse order to avoid DOM mutation issues
    for (let i = overlappingNodes.length - 1; i >= 0; i--) {
        const nodeInfo = overlappingNodes[i];
        const nodeGlobalStart = nodeInfo.startIndex;
        // Use LOGICAL length (excluding zero-width spaces) since nodeInfo positions are logical
        const nodeLogicalLength = nodeInfo.node.textContent.replace(/\u200B/g, '').length;

        // Calculate which portion of this node is part of the match (all in logical coordinates)
        const highlightStart = Math.max(0, globalMatchStart - nodeGlobalStart);
        const highlightEnd = Math.min(nodeLogicalLength, globalMatchEnd - nodeGlobalStart);

        if (highlightStart < highlightEnd && nodeInfo.node.nodeType === Node.TEXT_NODE) {
            const highlight = highlightInSingleTextNode(
                nodeInfo.node,
                highlightStart,
                highlightEnd,
                matchIndex,
                currentMatchIndex,
                true  // Skip automatic tracking - we'll handle it manually
            );

            // Track the first node's highlight (which is the last one processed due to reverse order)
            // We want the first highlight in document order for navigation
            if (highlight) {
                firstHighlight = highlight;
            }
        }
    }

    // Only push ONE element per match for navigation purposes
    if (firstHighlight) {
        searchState.highlightElements.push(firstHighlight);
    }
}

/**
 * Highlight multiple matches within a single text node.
 * This processes all matches at once to avoid invalidating node references.
 * Matches must be sorted by startIndex (ascending order).
 */
function highlightMultipleMatchesInNode(textNode, matches, currentMatchIndex) {
    if (!textNode || !textNode.parentNode || matches.length === 0) return;

    const rawText = textNode.textContent;
    const parent = textNode.parentNode;

    // Convert all logical offsets to raw offsets and validate
    const processedMatches = [];
    for (const match of matches) {
        const rawStart = logicalToRawOffset(rawText, match.startIndex);
        const rawEnd = logicalToRawOffset(rawText, match.endIndex);

        if (rawStart >= rawEnd || rawStart > rawText.length || rawEnd > rawText.length) {
            console.warn('Invalid match offsets:', { match, rawStart, rawEnd, rawTextLen: rawText.length });
            continue;
        }

        processedMatches.push({
            rawStart,
            rawEnd,
            matchIndex: match.matchIndex
        });
    }

    if (processedMatches.length === 0) return;

    // Build the new nodes: alternating between text nodes and highlights
    // Example: "hello world test" with matches at [0,5] and [6,11]
    // becomes: [mark:"hello"][text:" "][mark:"world"][text:" test"]
    const fragment = document.createDocumentFragment();
    let lastEnd = 0;

    for (const pm of processedMatches) {
        // Add text before this match (if any)
        // CRITICAL: Mark as already encrypted so SDK doesn't re-encrypt
        if (pm.rawStart > lastEnd) {
            const newTextNode = document.createTextNode(rawText.substring(lastEnd, pm.rawStart));
            newTextNode._cloakEncrypted = true;
            // Note: No _cloakOriginal - plaintext is on server only for security
            fragment.appendChild(newTextNode);
        }

        // Add the highlight
        const highlight = document.createElement('mark');
        highlight.className = 'encrypted-search-highlight';
        if (pm.matchIndex === currentMatchIndex) {
            highlight.className += ' encrypted-search-current';
        }
        highlight.style.backgroundColor = pm.matchIndex === currentMatchIndex ? '#ffeb3b' : '#fff59d';
        highlight.style.padding = '0';
        highlight.style.fontFamily = 'inherit';
        highlight.textContent = rawText.substring(pm.rawStart, pm.rawEnd);
        highlight.setAttribute('data-match-index', pm.matchIndex);
        // Note: No _cloakOriginal - plaintext is on server only for security

        fragment.appendChild(highlight);
        searchState.allHighlightMarks.push(highlight);
        searchState.highlightElements.push(highlight);

        lastEnd = pm.rawEnd;
    }

    // Add any remaining text after the last match
    // CRITICAL: Mark as already encrypted so SDK doesn't re-encrypt
    if (lastEnd < rawText.length) {
        const newTextNode = document.createTextNode(rawText.substring(lastEnd));
        newTextNode._cloakEncrypted = true;
        // Note: No _cloakOriginal - plaintext is on server only for security
        fragment.appendChild(newTextNode);
    }

    // Replace the original text node with our fragment
    parent.replaceChild(fragment, textNode);
}

function highlightInSingleTextNode(textNode, startOffset, endOffset, matchIndex, currentMatchIndex, skipTracking = false) {
    const rawText = textNode.textContent;

    // Validate offsets
    if (startOffset < 0 || endOffset < 0 || startOffset >= endOffset) {
        console.warn('Invalid offsets:', { startOffset, endOffset, rawTextLen: rawText.length });
        return null;
    }

    // Convert logical offsets (which exclude zero-width spaces) to raw offsets
    // The charToNode map uses logical offsets, but we need raw offsets to slice the actual text
    const rawStartOffset = logicalToRawOffset(rawText, startOffset);
    const rawEndOffset = logicalToRawOffset(rawText, endOffset);

    // Validate raw offsets
    if (rawStartOffset > rawText.length || rawEndOffset > rawText.length) {
        console.warn('Raw offset out of bounds:', { rawStartOffset, rawEndOffset, rawTextLen: rawText.length, startOffset, endOffset });
        return null;
    }

    // Create the three parts using raw offsets
    const beforeText = rawText.substring(0, rawStartOffset);
    const matchText = rawText.substring(rawStartOffset, rawEndOffset);
    const afterText = rawText.substring(rawEndOffset);

    // Debug: verify we're splitting correctly
    const reconstructed = beforeText + matchText + afterText;
    if (reconstructed !== rawText) {
        console.error('Text reconstruction mismatch!', {
            rawText: rawText.substring(0, 50),
            reconstructed: reconstructed.substring(0, 50),
            beforeLen: beforeText.length,
            matchLen: matchText.length,
            afterLen: afterText.length
        });
    }

    // Create highlight element
    const highlight = document.createElement('mark');
    highlight.className = 'encrypted-search-highlight';
    if (matchIndex === currentMatchIndex) {
        highlight.className += ' encrypted-search-current';
    }
    highlight.style.backgroundColor = matchIndex === currentMatchIndex ? '#ffeb3b' : '#fff59d';
    highlight.style.padding = '0';
    // CRITICAL: Inherit font from parent to maintain encrypted font rendering
    // Without this, the mark element may use default browser font and show garbled text
    highlight.style.fontFamily = 'inherit';
    highlight.textContent = matchText;
    // Note: No _cloakOriginal - plaintext is on server only for security

    // Add data attribute to link marks belonging to the same match
    highlight.setAttribute('data-match-index', matchIndex);

    // Get parent element
    const parent = textNode.parentNode;

    // Replace text node with three nodes: before + highlight + after
    // CRITICAL: Mark new text nodes as already encrypted so SDK's MutationObserver
    // doesn't re-encrypt them (they already contain encrypted text)

    if (beforeText) {
        const beforeNode = document.createTextNode(beforeText);
        beforeNode._cloakEncrypted = true;  // Prevent re-encryption
        // Note: No _cloakOriginal - plaintext is on server only for security
        parent.insertBefore(beforeNode, textNode);
    }
    parent.insertBefore(highlight, textNode);
    if (afterText) {
        const afterNode = document.createTextNode(afterText);
        afterNode._cloakEncrypted = true;  // Prevent re-encryption
        // Note: No _cloakOriginal - plaintext is on server only for security
        parent.insertBefore(afterNode, textNode);
    }
    parent.removeChild(textNode);

    // Always track in allHighlightMarks for cleanup and styling
    searchState.allHighlightMarks.push(highlight);

    // Track in highlightElements for navigation (skip for multi-node parts handled by caller)
    if (!skipTracking) {
        searchState.highlightElements.push(highlight);
    }

    return highlight;
}

function highlightSingleMatch(match, charToNode, currentMatchIndex, parentContainer) {
    const startChar = charToNode[match.startIndex];
    const endChar = charToNode[match.endIndex - 1];
    if (!startChar || !endChar) return;

    // Handle single text node case (most common)
    if (startChar.node === endChar.node) {
        highlightInSingleTextNode(
            startChar.node,
            startChar.offset,
            endChar.offset + 1,
            match.matchIndex,
            currentMatchIndex
        );
    } else {
        // Handle multi-node case (match spans multiple text nodes)
        highlightAcrossMultipleNodes(
            startChar,
            endChar,
            match.matchIndex,
            currentMatchIndex,
            parentContainer
        );
    }
}

function highlightMatchesInParent(parent, matches, currentMatchIndex) {
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

    // Sort matches by position (process from end to start to avoid offset issues)
    matches.sort((a, b) => b.startIndex - a.startIndex);

    // Process each match
    matches.forEach(match => {
        try {
            highlightSingleMatch(match, charToNode, currentMatchIndex, parent);
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

    // Group matches by text node - this is CRITICAL because after we split a text node
    // for one highlight, the node reference is invalidated for other matches in that same node.
    // We must process all matches in a single node together, in reverse offset order.
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

    // Sort nodes by document position (reverse order - process later nodes first)
    const sortedNodes = Array.from(matchesByNode.keys()).sort((a, b) => {
        const pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return 1;  // b comes after a, so a should be processed later
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return -1;
        return 0;
    });

    // Process each node's matches - ALL matches in a node must be processed together
    // because highlighting splits the text node
    for (const node of sortedNodes) {
        const nodeMatches = matchesByNode.get(node);
        // Sort by offset (normal order for multi-highlight processing)
        nodeMatches.sort((a, b) => a.startIndex - b.startIndex);

        try {
            highlightMultipleMatchesInNode(node, nodeMatches, currentIndex);
        } catch (e) {
            console.warn('Error highlighting matches in node:', e, nodeMatches);
        }
    }

    // Process multi-node matches separately (they're more complex)
    for (const match of multiNodeMatches) {
        try {
            highlightMultiNodeMatch(match, match.matchIndex, currentIndex);
        } catch (e) {
            console.warn('Error highlighting multi-node match:', e, match);
        }
    }

    // Sort highlights in document order for proper navigation
    searchState.highlightElements.sort((a, b) => {
        const position = a.compareDocumentPosition(b);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
    });

    // Scroll to current match only if out of view
    if (currentIndex >= 0 && currentIndex < searchState.highlightElements.length) {
        const highlight = searchState.highlightElements[currentIndex];
        if (highlight && highlight.parentNode) {
            const rect = highlight.getBoundingClientRect();
            // Add margin so we scroll before element goes off-screen
            const margin = 100;
            const isInView = rect.top >= margin && rect.bottom <= (window.innerHeight - margin);
            if (!isInView) {
                highlight.scrollIntoView({ behavior: 'instant', block: 'center' });
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

