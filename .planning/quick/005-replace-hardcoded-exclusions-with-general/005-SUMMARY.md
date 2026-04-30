---
phase: quick
plan: 005
subsystem: client-sdk
tags: [javascript, refactoring, config, exclusions]
requires: []
provides:
  - "Config-driven exclusion system via excludeSelectors"
  - "data-cloak-exclude attribute for per-element exclusion"
  - "Dynamic CSS generation for custom selectors"
affects: []
tech-stack:
  added: []
  patterns:
    - "CSS selector matching for config-driven exclusions"
    - "Filter pattern to separate tag names from CSS selectors"
key-files:
  created: []
  modified:
    - "client/cloak-sdk.js"
    - "client/decrypt/src/position.js"
    - "client/decrypt/src/copy.js"
    - "client/decrypt-interceptor.js"
    - "templates/dynamic_test.html"
decisions:
  - id: "use-data-cloak-exclude-for-ticker"
    what: "Use data-cloak-exclude attribute instead of config excludeSelectors for ticker"
    why: "Cleaner approach, demonstrates per-element exclusion pattern for end users"
    when: "2026-01-22"
    alternatives: ["Add .ticker-content and .breaking-news to config.excludeSelectors in init()"]
metrics:
  duration: "~15min"
  completed: "2026-01-22"
---

# Quick Task 005: Replace Hardcoded Exclusions with General System Summary

**One-liner:** Replaced hardcoded `.ticker-content` and `.breaking-news` checks with config-driven `excludeSelectors` supporting CSS selectors (classes, IDs, attributes)

## What Was Done

### Task 1: Update cloak-sdk.js to use config-driven exclusions
- **Removed hardcoded ticker/breaking-news checks** from `shouldExcludeNode()` at lines ~170 and ~218
- **Added custom selector matching** that filters `config.excludeSelectors` for CSS selectors (contains `.`, `#`, or `[`)
- **Used `element.matches(selector)`** for both element and ancestor checks
- **Generated font-family override CSS dynamically** from config instead of hardcoded `.ticker-content, .breaking-news` rules
- **Maintained backward compatibility** with tag name and attribute exclusions
- **Commit:** `688f8f0`

### Task 2: Update decrypt-interceptor source modules
- **In position.js (line ~268):** Removed hardcoded ticker/breaking-news check, added `window.encryptionConfig.excludeSelectors` matching
- **In copy.js (line ~384):** Same change - removed hardcoded check, added config-driven selector matching
- **Rebuilt decrypt-interceptor.js:** Ran `node client/decrypt/build.js` successfully with validation passed
- **Commit:** `ea290b8`

### Task 3: Update dynamic_test.html to use config-driven exclusion
- **Added `data-cloak-exclude` attribute** to `.breaking-news` ticker container
- **Updated comment** to explain exclusion approach (demonstrates attribute-based pattern)
- **This demonstrates the recommended pattern** for per-element exclusion without SDK config changes
- **Commit:** `3ef1d74`

## Deviations from Plan

None - plan executed exactly as written.

## Technical Implementation

### Config-Driven Selector Matching Pattern

```javascript
// Filter excludeSelectors to get only CSS selectors (not tag names)
const customSelectors = config.excludeSelectors.filter(s =>
    s.includes('.') || s.includes('#') || s.includes('[')
);

// Match element against custom selectors
for (const selector of customSelectors) {
    try {
        if (element.matches(selector)) return true;
    } catch (e) {
        // Invalid selector, skip
    }
}
```

### Dynamic CSS Generation

```javascript
const customSelectorCSS = config.excludeSelectors
    .filter(s => s.includes('.') || s.includes('#') || s.includes('['))
    .map(s => `${s}, ${s} *`)
    .join(', ');

// Include in fontFamilyOverrides if selectors exist
${customSelectorCSS ? `${customSelectorCSS} {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
}` : ''}
```

### Two Exclusion Methods

1. **Config-based (for patterns):** Pass CSS selectors in `CloakSDK.init({ excludeSelectors: ['.ticker-content', '.ads', '[data-dynamic]'] })`
2. **Attribute-based (for specific elements):** Add `data-cloak-exclude` to any element that should be excluded

## Before/After

### Before
- Hardcoded `.ticker-content` and `.breaking-news` checks in 4 locations across SDK and decrypt modules
- Required SDK source code changes to exclude new element types
- Hardcoded CSS rules for ticker font overrides

### After
- Zero hardcoded class checks - all exclusions driven by config or attributes
- Sites can exclude custom elements via `excludeSelectors` config or `data-cloak-exclude` attribute
- Font override CSS generated dynamically from config
- dynamic_test.html demonstrates best practice using `data-cloak-exclude`

## Files Changed

| File | Changes | Lines Modified |
|------|---------|----------------|
| `client/cloak-sdk.js` | Remove hardcoded checks, add selector matching, dynamic CSS | +67, -6 |
| `client/decrypt/src/position.js` | Remove hardcoded check, add config-driven matching | +16, -8 |
| `client/decrypt/src/copy.js` | Remove hardcoded check, add config-driven matching | +16, -8 |
| `client/decrypt-interceptor.js` | Rebuilt from source modules | +32, -16 |
| `templates/dynamic_test.html` | Add data-cloak-exclude attribute | +5, -2 |

## Verification Results

✅ `grep -rn "ticker-content\|breaking-news"` returns no functional code matches in SDK/decrypt source
✅ `grep -n "excludeSelectors"` shows 9 usage locations in cloak-sdk.js with selector matching logic
✅ `grep "data-cloak-exclude"` shows attribute on `.breaking-news` ticker in dynamic_test.html
✅ Build script succeeded with validation passed

## Next Phase Readiness

**Ready for:** Any future work requiring element exclusions

**Enables:**
- Sites can exclude dynamic content (tickers, ads, live scores) without SDK modifications
- Config-driven exclusions make SDK more flexible and maintainable
- Clear pattern documented for end users

**No blockers or concerns.**

## Lessons Learned

1. **Filter pattern works well** - Separating tag names from CSS selectors using `.includes('.')` is simple and effective
2. **data-cloak-exclude is cleaner for specific elements** - Config excludeSelectors better for patterns/classes used throughout site
3. **Dynamic CSS generation prevents maintenance burden** - No hardcoded font overrides to update when exclusions change
4. **try/catch for matches() is essential** - Invalid selectors would break the entire exclusion system without error handling

## Related Work

- Builds on work from Quick Task 004 which added ticker exclusion to SDK's shouldExcludeNode
- This refactor generalizes that solution to work for any site's dynamic content
- Pattern can be reused for future exclusion needs (ads, social widgets, third-party embeds)
