---
quick_task: 002
name: realistic-dynamic-test-page
type: execute
wave: 1
depends_on: []
files_modified:
  - dynamic_test.html
  - dynamic_test_plain.html
autonomous: true

must_haves:
  truths:
    - "Test page loads with multiple Google Fonts (via both @import and link tags)"
    - "Dynamic content injection works and is observable"
    - "Lazy loading simulation triggers content appearance"
    - "Interactive elements (modals, tabs, dropdowns) function correctly"
    - "Plain comparison page shows identical layout without SDK"
  artifacts:
    - path: "dynamic_test.html"
      provides: "Full-featured test page with SDK integration"
      contains: "MutationObserver"
    - path: "dynamic_test_plain.html"
      provides: "Plain comparison version without encryption"
      contains: "same layout structure"
---

<objective>
Create a realistic dynamic test page simulating a modern news/content site that exercises all SDK patterns: web fonts, system fonts, dynamic content, lazy loading, and interactive elements. Include a plain comparison version.

Purpose: Enable comprehensive testing of Cloak SDK font handling across realistic web patterns
Output: Two HTML files - one with SDK integration, one plain for comparison
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@sdk_test.html (existing simple test page)
@test_localhost_webfonts.html (existing comprehensive static test)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create dynamic test page with realistic patterns</name>
  <files>dynamic_test.html</files>
  <action>
Create `dynamic_test.html` - a realistic news site test page with:

**Font Loading (test multiple methods):**
- Google Fonts via `<link>` tag: Playfair Display, Lora, Inter
- Google Fonts via `@import` in CSS: Roboto Slab, Source Sans Pro
- System font fallbacks: Arial, Georgia, Times New Roman, Verdana
- Monospace for code blocks: SF Mono, Monaco, Consolas

**Dynamic Content Patterns:**
- "Load More Articles" button that injects new article cards via JS
- Infinite scroll simulation (scroll to bottom triggers content load)
- Comment submission form that adds new comment to DOM
- Live-updating "Breaking News" ticker with rotating headlines

**Lazy Loading Simulation:**
- Hidden sections revealed on scroll (IntersectionObserver)
- "Read More" expandable content blocks
- Tab panels where only active tab content is in DOM initially

**Interactive Elements:**
- Modal popup (opens on button click, contains text)
- Dropdown menus in navigation
- Accordion FAQ section
- Search overlay with results
- Tooltip hovers on certain elements

**Layout Structure (news site pattern):**
- Sticky navigation with multiple font weights
- Hero article section
- Article grid (2-3 columns)
- Sidebar with trending stories widget
- Footer with multiple columns

**SDK Integration:**
- Include `data-cloak-exclude` on control panel
- Debug panel showing encryption stats
- Event listeners for `cloak:ready` and `cloak:encrypted`
- Stats display showing nodes encrypted, characters processed

Reference `test_localhost_webfonts.html` for typography patterns but ADD:
- Dynamic injection via `innerHTML` and `appendChild`
- MutationObserver test scenarios
- Content that appears AFTER initial page load
  </action>
  <verify>
Open `dynamic_test.html` in browser:
1. Multiple fonts render correctly
2. "Load More" button adds new content
3. Scroll triggers lazy load sections
4. Modal opens/closes properly
5. Tabs switch content correctly
  </verify>
  <done>
Page loads with 6+ font families, dynamic content injection works via button clicks and scroll events, all interactive elements functional
  </done>
</task>

<task type="auto">
  <name>Task 2: Create plain comparison page</name>
  <files>dynamic_test_plain.html</files>
  <action>
Create `dynamic_test_plain.html` - identical layout to `dynamic_test.html` but:

**Differences from encrypted version:**
- NO SDK script inclusion
- NO debug panel
- NO `data-cloak-exclude` attributes
- NO encryption-related JS code
- Title updated to indicate "Plain Version"

**Keep identical:**
- All HTML structure
- All CSS styling
- All fonts (Google Fonts + system)
- All interactive elements (modals, tabs, lazy load)
- All dynamic content injection logic

This allows side-by-side comparison to verify encryption doesn't break layout or functionality.

Add a visible banner at top: "PLAIN VERSION - No Cloak Encryption" in a distinct color (e.g., orange background).
  </action>
  <verify>
1. `diff` the two files shows only SDK-related differences
2. Open both pages side-by-side - identical layout
3. Dynamic features work identically in both
  </verify>
  <done>
Plain page renders identically to encrypted version (minus SDK), banner clearly identifies it as comparison version
  </done>
</task>

<task type="auto">
  <name>Task 3: Document test scenarios in HTML comments</name>
  <files>dynamic_test.html</files>
  <action>
Add structured HTML comments throughout `dynamic_test.html` documenting test scenarios:

```html
<!-- TEST SCENARIO: Web Fonts via Link Tag
     Fonts: Playfair Display (serif), Inter (sans-serif)
     Expected: SDK should detect and create CloakFont variants
-->

<!-- TEST SCENARIO: Dynamic Content Injection
     Trigger: Click "Load More" button
     Expected: New content encrypted by MutationObserver
-->

<!-- TEST SCENARIO: Lazy Load Content
     Trigger: Scroll to "lazy-load-section"
     Expected: Content encrypted when IntersectionObserver fires
-->
```

Document at minimum:
- Each font loading method
- Each dynamic injection point
- Each lazy load trigger
- Each interactive element
- Edge cases (nested elements, text nodes mixed with elements)
  </action>
  <verify>
`grep -c "TEST SCENARIO" dynamic_test.html` returns 8+
  </verify>
  <done>
Test page contains documented scenarios for each SDK pattern being tested
  </done>
</task>

</tasks>

<verification>
1. Both HTML files exist and are valid HTML5
2. `dynamic_test.html` includes SDK script and debug panel
3. `dynamic_test_plain.html` has no SDK references
4. Both pages render identically (layout, fonts, colors)
5. Dynamic features (load more, lazy load, modal, tabs) work in both
6. Test scenarios documented in comments
</verification>

<success_criteria>
- Two test pages created: dynamic_test.html (~800-1200 lines) and dynamic_test_plain.html
- 6+ distinct font families loaded (mix of Google Fonts and system fonts)
- 4+ dynamic content patterns implemented
- 3+ interactive elements working
- Test scenarios documented in HTML comments
- Both pages functional when served via localhost
</success_criteria>

<output>
After completion, create `.planning/quick/002-realistic-dynamic-test-page/002-SUMMARY.md`
</output>
