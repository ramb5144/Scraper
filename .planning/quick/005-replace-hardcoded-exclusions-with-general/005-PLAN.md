---
phase: quick
plan: 005
type: execute
wave: 1
depends_on: []
files_modified:
  - client/cloak-sdk.js
  - client/decrypt/src/position.js
  - client/decrypt/src/copy.js
  - templates/dynamic_test.html
autonomous: true

must_haves:
  truths:
    - "Hardcoded .ticker-content and .breaking-news class checks are removed from all source files"
    - "config.excludeSelectors supports custom CSS selectors for exclusion"
    - "data-cloak-exclude attribute continues to work for element-level exclusion"
    - "dynamic_test.html uses config-driven exclusion instead of hardcoded classes"
  artifacts:
    - path: "client/cloak-sdk.js"
      provides: "SDK with config.excludeSelectors support, no hardcoded ticker/breaking-news"
    - path: "client/decrypt/src/position.js"
      provides: "Position module using config-driven exclusion"
    - path: "client/decrypt/src/copy.js"
      provides: "Copy module using config-driven exclusion"
  key_links:
    - from: "client/cloak-sdk.js"
      to: "config.excludeSelectors"
      via: "shouldExcludeNode checks selector matches"
    - from: "templates/dynamic_test.html"
      to: "SDK config"
      via: "CloakSDK.init({ excludeSelectors: [...] })"
---

<objective>
Replace hardcoded `.ticker-content` and `.breaking-news` class exclusions with a general config-driven solution.

Purpose: Make exclusion logic generalizable so any site can exclude elements without modifying SDK source code.
Output: Updated SDK and decrypt modules that use config.excludeSelectors for custom exclusions.
</objective>

<context>
@.planning/STATE.md
@client/cloak-sdk.js
@client/decrypt/src/position.js
@client/decrypt/src/copy.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update cloak-sdk.js to use config-driven exclusions</name>
  <files>client/cloak-sdk.js</files>
  <action>
1. **Remove hardcoded ticker/breaking-news checks** from `shouldExcludeNode()`:
   - Line ~170: Remove `if (element.classList && (element.classList.contains('ticker-content') || element.classList.contains('breaking-news')))`
   - Line ~218: Remove `if (parent.classList && (parent.classList.contains('ticker-content') || parent.classList.contains('breaking-news'))) return true;`

2. **Add custom selector matching** to `shouldExcludeNode()`:
   - After checking `data-cloak-exclude`, add logic to check if element matches any selector in `config.excludeSelectors`
   - Use `element.matches(selector)` for CSS selector matching
   - Handle both element check (for ELEMENT_NODE) and ancestor check (in the while loop)
   - Note: `config.excludeSelectors` already exists but only contains tag names - we need to support full CSS selectors

3. **Update CSS in `loadFont()`** (lines ~1291 and ~1316):
   - Remove hardcoded `.ticker-content, .ticker-content *, .breaking-news, .breaking-news *` CSS rules
   - These font-family overrides should be generated dynamically from config.excludeSelectors
   - Build CSS rule from config.excludeSelectors that includes custom selectors (filter out standard tags)

4. **Implementation for selector matching in shouldExcludeNode**:
   ```javascript
   // Check if element matches any custom exclude selector
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
   ```

5. **Keep data-cloak-exclude support** - it already works, just ensure it's documented as the primary per-element exclusion method.
  </action>
  <verify>
    - `grep -n "ticker-content" client/cloak-sdk.js` returns only CSS comments (not functional code)
    - `grep -n "breaking-news" client/cloak-sdk.js` returns only CSS comments (not functional code)
    - `grep -n "excludeSelectors" client/cloak-sdk.js` shows selector matching logic
  </verify>
  <done>
    - No hardcoded ticker-content/breaking-news class checks in shouldExcludeNode()
    - Custom CSS selectors in config.excludeSelectors are matched against elements
    - Font override CSS is generated from config rather than hardcoded
  </done>
</task>

<task type="auto">
  <name>Task 2: Update decrypt-interceptor source modules</name>
  <files>client/decrypt/src/position.js, client/decrypt/src/copy.js</files>
  <action>
1. **In position.js** (line ~268):
   - Remove: `if (parent.classList && (parent.classList.contains('ticker-content') || parent.classList.contains('breaking-news')))`
   - Replace with config-driven check that reads from `window.encryptionConfig.excludeSelectors` (if available)
   - Implementation:
     ```javascript
     // Check custom exclude selectors from config
     if (window.encryptionConfig?.excludeSelectors) {
       const customSelectors = window.encryptionConfig.excludeSelectors.filter(s =>
         s.includes('.') || s.includes('#') || s.includes('[')
       );
       for (const selector of customSelectors) {
         try {
           if (parent.matches(selector)) return true;
         } catch (e) { /* invalid selector */ }
       }
     }
     ```

2. **In copy.js** (line ~384):
   - Same change as position.js - remove hardcoded ticker-content/breaking-news check
   - Add config-driven selector matching

3. **Rebuild decrypt-interceptor.js**:
   - Run: `cd client/decrypt && npm run build` (or equivalent build command)
   - If no build script exists, manually verify the changes need to propagate to decrypt-interceptor.js

4. **Note**: The decrypt-interceptor.js in client/ folder is the built bundle - it will be updated when the build runs. The source modules in client/decrypt/src/ are what we edit.
  </action>
  <verify>
    - `grep -n "ticker-content" client/decrypt/src/position.js` returns no results
    - `grep -n "ticker-content" client/decrypt/src/copy.js` returns no results
    - `grep -n "excludeSelectors" client/decrypt/src/position.js` shows new config check
    - Build completes successfully (if build script exists)
  </verify>
  <done>
    - position.js uses config-driven exclusion instead of hardcoded classes
    - copy.js uses config-driven exclusion instead of hardcoded classes
    - decrypt-interceptor.js is rebuilt with changes
  </done>
</task>

<task type="auto">
  <name>Task 3: Update dynamic_test.html to use config-driven exclusion</name>
  <files>templates/dynamic_test.html</files>
  <action>
1. **Update SDK initialization** to pass custom exclude selectors:
   - Find the CloakSDK.init() call
   - Add `excludeSelectors` array that includes `.ticker-content` and `.breaking-news`:
     ```javascript
     CloakSDK.init({
       apiKey: '...',
       excludeSelectors: [
         // Standard exclusions (already default)
         'script', 'style', 'noscript', 'meta', 'link', 'head', 'svg', 'path', 'code', 'pre', 'kbd', 'samp', 'var', 'textarea', 'input',
         // Custom exclusions for this site
         '.ticker-content', '.breaking-news'
       ]
     });
     ```

2. **Alternative approach**: Instead of repeating all defaults, the test can use `data-cloak-exclude` attribute on the ticker elements. This may be cleaner:
   - Add `data-cloak-exclude` attribute to the `.breaking-news` div (line ~1084)
   - This demonstrates the attribute-based approach which is simpler for end users

3. **Recommended**: Use `data-cloak-exclude` attribute since it's the cleanest approach for per-element exclusion and doesn't require config changes. Update the ticker HTML:
   ```html
   <div class="breaking-news" data-cloak-exclude>
   ```

4. **Add comment** explaining the exclusion approach for documentation purposes.
  </action>
  <verify>
    - Ticker section in dynamic_test.html uses `data-cloak-exclude` attribute OR config.excludeSelectors
    - `grep "data-cloak-exclude" templates/dynamic_test.html` shows the attribute on ticker elements
  </verify>
  <done>
    - dynamic_test.html demonstrates proper exclusion using generalizable approach
    - No reliance on hardcoded class names in SDK source
  </done>
</task>

</tasks>

<verification>
1. `grep -rn "ticker-content\|breaking-news" client/cloak-sdk.js client/decrypt/src/` should return no functional code matches (only comments if any)
2. `grep -n "excludeSelectors" client/cloak-sdk.js` shows config-driven selector matching
3. `grep -n "data-cloak-exclude" templates/dynamic_test.html` shows attribute usage on ticker
4. Test page loads without errors, ticker is excluded from encryption
</verification>

<success_criteria>
- Zero hardcoded `.ticker-content` or `.breaking-news` class checks in SDK/interceptor source
- config.excludeSelectors supports CSS selectors (classes, IDs, attribute selectors)
- data-cloak-exclude attribute works as primary per-element exclusion method
- dynamic_test.html uses config-driven or attribute-based exclusion
- Existing functionality preserved (excluded elements still get system fonts, not encrypted)
</success_criteria>

<output>
After completion, create `.planning/quick/005-replace-hardcoded-exclusions-with-general/005-SUMMARY.md`
</output>
