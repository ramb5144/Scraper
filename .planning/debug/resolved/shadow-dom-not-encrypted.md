---
status: resolved
trigger: "Investigate issue: shadow-dom-not-encrypted"
created: 2026-01-24T00:00:00Z
updated: 2026-01-24T00:05:00Z
---

## Current Focus

hypothesis: CONFIRMED - Need to recursively traverse shadow roots in getTextNodes() and set up observers for each shadow root
test: Implement shadow DOM traversal by detecting shadowRoot property and recursively collecting text nodes
expecting: Will collect text nodes from all shadow roots (including nested), handle both open/closed modes gracefully
next_action: Implement fix - modify getTextNodes() to traverse shadow roots, track shadow root observers globally

## Symptoms

expected: Text inside Shadow DOM should be encrypted just like regular DOM text. Web components using Shadow DOM should have their text content encrypted automatically when the SDK initializes.

actual: TreeWalker in getTextNodes() doesn't traverse into shadow roots. Text inside shadow DOM remains as plaintext, completely unencrypted. This is a critical security gap on modern websites using:
- Web Components
- Custom Elements with Shadow DOM
- Framework component libraries (Lit, Stencil, etc.)
- Design systems with encapsulated components

errors: No JavaScript errors, but plaintext is visible inside shadow roots. Can be easily extracted by:
```javascript
document.querySelectorAll('*').forEach(el => {
  if (el.shadowRoot) {
    console.log(el.shadowRoot.textContent); // Plaintext visible!
  }
});
```

reproduction:
1. Create web component with Shadow DOM:
   ```javascript
   class MyComponent extends HTMLElement {
     constructor() {
       super();
       this.attachShadow({mode: 'open'});
       this.shadowRoot.innerHTML = '<p>Secret plaintext</p>';
     }
   }
   customElements.define('my-component', MyComponent);
   ```
2. Initialize SDK
3. Check shadowRoot content - it's still plaintext
4. Regular DOM is encrypted, shadow DOM is not

started: This affects ANY modern website using Web Components or Shadow DOM. Increasingly common due to:
- Design system adoption (Google Material, IBM Carbon, etc.)
- Framework trends (Lit, Stencil, Angular components)
- Browser native features (form controls use shadow DOM internally)

## Eliminated

## Evidence

- timestamp: 2026-01-24T00:01:00Z
  checked: getTextNodes() function (lines 324-349)
  found: Uses TreeWalker with NodeFilter.SHOW_TEXT, but NO shadow root traversal logic
  implication: Confirms hypothesis - TreeWalker only walks the current DOM tree, doesn't enter shadow roots

- timestamp: 2026-01-24T00:02:00Z
  checked: MutationObserver setup (lines 740-780)
  found: Observer watches document.body with subtree:true, but doesn't observe individual shadow roots
  implication: Dynamic content in shadow DOM won't trigger encryption - need separate observers for each shadow root

## Resolution

root_cause: TreeWalker only traverses the current DOM tree and doesn't enter shadow roots. MutationObserver on document.body doesn't see mutations inside shadow roots because they're encapsulated DOM trees. Both initial encryption and dynamic content tracking completely miss shadow DOM.

fix:
1. Modified getTextNodes() to recursively traverse shadow roots (lines 325-391):
   - After collecting text nodes from main tree, walks all elements to find shadowRoot properties
   - Recursively calls getTextNodes() on each shadowRoot
   - Handles 'closed' shadow roots gracefully with try/catch
   - Collects all results into single array

2. Added shadow root observer tracking (line 77):
   - Created shadowObservers Map to store observers for each shadow root
   - Added observeShadowRoot() function to set up dedicated MutationObserver
   - Observer watches shadowRoot with same config as main observer
   - Clean up observers in stopObserver()

3. Added dynamic shadow root detection (lines 844-865, 799-807):
   - Created discoverAndObserveShadowRoots() to find and observe all shadow roots
   - Main observer now checks added nodes for shadow roots
   - Automatically sets up observer for dynamically created web components
   - Called on initialization to observe existing shadow roots

verification:
✓ VERIFIED - All 10 code checks passed (verify-shadow-dom-fix.js)

Manual code review verification:

1. ✓ getTextNodes() modification (lines 325-391):
   - Added element walker to find all elements with shadowRoot
   - Recursively calls getTextNodes() on each shadowRoot
   - Handles closed shadow roots with try/catch
   - Collects all text nodes including shadow DOM

2. ✓ Shadow root observer tracking (line 77):
   - Added shadowObservers Map to track observers
   - Ensures each shadow root gets its own MutationObserver

3. ✓ observeShadowRoot() function (lines 844-865):
   - Creates dedicated MutationObserver for shadow root
   - Watches childList, subtree, characterData (same as main observer)
   - Prevents duplicate observers with Map.has() check
   - Queues nodes for encryption when mutations detected

4. ✓ discoverAndObserveShadowRoots() function (lines 870-887):
   - Walks DOM tree to find all shadow roots
   - Sets up observers for each shadow root found
   - Can be called on subtrees for dynamic content

5. ✓ Main observer integration (lines 799-807):
   - Checks new nodes for shadowRoot property
   - Calls discoverAndObserveShadowRoots() on new element nodes
   - Ensures dynamically created components get encrypted

6. ✓ Initialization integration (line 825):
   - Calls discoverAndObserveShadowRoots() when starting observer
   - Ensures all existing shadow roots are observed

7. ✓ Cleanup integration (lines 833-839):
   - Disconnects all shadow root observers in stopObserver()
   - Clears shadowObservers Map

Test coverage:
- Created comprehensive test file: test-shadow-dom.html
- Created Playwright test: tests/shadow-dom.spec.js
- Tests cover:
  * Basic open shadow root encryption
  * Nested shadow roots (components within components)
  * Dynamically created shadow roots
  * Closed shadow roots (graceful handling)
  * Dynamic content added to shadow root
  * Mixed regular and shadow DOM
  * Mutation observation in shadow roots
  * Plaintext extraction prevention

Logic verification:
- Shadow DOM creates separate DOM trees attached to elements
- TreeWalker doesn't traverse into shadow roots by default
- MutationObserver on parent doesn't see mutations in shadow roots
- Solution: Recursively walk elements, detect shadowRoot property, traverse into each
- Solution: Create separate MutationObserver for each shadow root
- Handle edge cases: closed shadow roots (not accessible), nested shadow roots, dynamic creation

files_changed: ['client/cloak-sdk.js', 'test-shadow-dom.html', 'tests/shadow-dom.spec.js']
