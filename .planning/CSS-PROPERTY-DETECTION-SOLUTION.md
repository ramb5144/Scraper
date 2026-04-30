# CSS Property Detection Solution

## Problem Summary

The SDK only detected and handled the `text-transform` CSS property, but many other CSS properties affect how text is visually rendered. This caused gibberish or incorrect encryption on websites using advanced typography features like:

- **font-variant-caps**: small-caps, all-small-caps, petite-caps, etc.
- **font-feature-settings**: OpenType features (smcp, c2sc, etc.)
- **-webkit-text-security**: password masking (disc, circle, square)
- **writing-mode**: vertical text (vertical-rl, vertical-lr)
- **text-orientation**: affects vertical text rendering

## Root Cause

When CSS properties transform text appearance (e.g., small-caps makes "hello" appear as "HELLO"), the SDK was encrypting the source text ("hello") without applying the visual transformation. When the browser then applied the CSS transformation to the encrypted text, it resulted in gibberish.

For properties that completely change rendering (like -webkit-text-security replacing characters with bullets), encryption was meaningless and should have been skipped entirely.

## Solution Architecture

### Three-Category Strategy

**1. COMPENSATE** - Properties with predictable transformations
- Apply transformation BEFORE encryption
- Reset CSS property AFTER encryption to prevent double-transformation
- Properties: text-transform, font-variant-caps, font-variant, font-feature-settings (smcp/c2sc)

**2. EXCLUDE** - Properties incompatible with encryption
- Skip encryption entirely for these elements
- Better to show plaintext than gibberish
- Properties: -webkit-text-security, writing-mode (vertical-*), text-orientation

**3. MONITOR** - Properties that might cause issues (not handled yet)
- Let through for now, monitor for reported issues
- Properties: text-rendering (ligatures), font-variant-ligatures, custom @font-face

### Implementation

#### New Functions

**`getTextAffectingProperties(textNode)`** (cloak-sdk.js)
```javascript
Returns {
  shouldExclude: boolean,
  transforms: [{property, value, apply}],
  propertiesToReset: [{name, value}]
}
```

**`applyFontVariantCaps(text, capsValue)`** (cloak-sdk.js)
- Handles small-caps, all-small-caps, petite-caps, unicase, titling-caps
- Converts to uppercase as approximation

**`getTextAffectingTransforms(textNode)`** (decrypt-interceptor.js)
- Returns array of transform functions
- Used for copy-paste and search position calculations

#### Integration Points

**cloak-sdk.js:**
- `shouldExcludeNode()`: Checks `shouldExclude` flag, returns true for incompatible properties
- `encryptTextNode()`: Applies all transforms in sequence before encryption, resets properties after

**decrypt-interceptor.js:**
- Text position calculations: Applies all transforms when building plaintext index
- Ensures copy-paste and Ctrl+F search work correctly with transformed text

## Properties Handled

| Property | Values | Strategy | Action |
|----------|--------|----------|--------|
| text-transform | uppercase, lowercase, capitalize | COMPENSATE | Transform before encryption, reset to 'none' |
| font-variant-caps | small-caps, all-small-caps, petite-caps, all-petite-caps, unicase, titling-caps | COMPENSATE | Convert to uppercase, reset to 'normal' |
| font-variant | small-caps (shorthand) | COMPENSATE | Convert to uppercase, reset to 'normal' |
| font-feature-settings | "smcp", "c2sc" | COMPENSATE | Convert to uppercase, reset to 'normal' |
| -webkit-text-security | disc, circle, square | EXCLUDE | Don't encrypt, return plaintext |
| writing-mode | vertical-rl, vertical-lr, sideways-* | EXCLUDE | Don't encrypt, return plaintext |
| text-orientation | upright, sideways (with vertical mode) | EXCLUDE | Don't encrypt, return plaintext |

## Testing

### Test Files Created

**test-css-properties.html**
- Visual test page with examples of each CSS property
- Organized by strategy (COMPENSATE, EXCLUDE)
- Includes combined properties test
- Available at http://localhost:8080/test-css-properties.html

**test-css-detection.js**
- Programmatic verification script
- Checks if elements were encrypted/excluded as expected
- Verifies property reset markers
- Run `testCSSPropertyDetection()` in browser console

### Verification Checklist

- [x] text-transform elements encrypted with correct case
- [x] font-variant-caps elements encrypted with uppercase transformation
- [x] -webkit-text-security elements NOT encrypted (show as bullets)
- [x] writing-mode elements NOT encrypted (show vertical plaintext)
- [x] Combined properties have all transforms applied
- [x] Copy-paste works with transformed text
- [x] Ctrl+F search works with transformed text
- [x] No gibberish on any test case

## Files Changed

### Core Changes
- **client/cloak-sdk.js**
  - Added `getTextAffectingProperties()` (comprehensive detection)
  - Added `applyFontVariantCaps()` (small-caps transformation)
  - Modified `shouldExcludeNode()` (check for incompatible properties)
  - Modified `encryptTextNode()` (apply all transforms, reset properties)

- **client/decrypt-interceptor.js**
  - Added `applyFontVariantCaps()` (matches SDK)
  - Added `getTextAffectingTransforms()` (comprehensive detection)
  - Updated text position calculations (2 locations)

### Test Files
- **test-css-properties.html** (new) - Visual test suite
- **test-css-detection.js** (new) - Programmatic verification

### Documentation
- **.planning/debug/resolved/incomplete-css-text-manipulation-detection.md** - Debug session log

## Impact

### Before
- Only text-transform was detected and handled
- Websites using font-variant-caps showed gibberish
- Elements with -webkit-text-security were incorrectly encrypted
- Vertical text (writing-mode) showed gibberish

### After
- Comprehensive detection of ALL major text-affecting CSS properties
- Properties categorized by handling strategy
- Elements with incompatible properties excluded (no gibberish)
- Elements with transformable properties encrypted correctly
- Copy-paste and search work with all transformed text

## Future Considerations

### Properties to Monitor

**Ligatures** (text-rendering: optimizeLegibility, font-variant-ligatures)
- May cause visual artifacts (fi → ﬁ)
- Current approach: let through, monitor for issues
- If issues reported, may need to exclude or handle specially

**Custom @font-face with unicode-range**
- Can remap any character to any glyph
- Very difficult to detect and compensate
- Current approach: monitor for issues
- May need font analysis or exclusion strategy

### Potential Enhancements

1. **Dynamic property watching**: MutationObserver for style changes
2. **Font analysis**: Detect custom fonts that remap characters
3. **Ligature detection**: Analyze font-feature-settings for ligature features
4. **Performance optimization**: Cache computed styles to reduce recalculation

## References

### Research Sources
- [font-feature-settings - CSS | MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-feature-settings)
- [font-variant - CSS | MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-variant)
- [-webkit-text-security - CSS | MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-text-security)
- [writing-mode - CSS | MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/writing-mode)
- [text-orientation - CSS | MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-orientation)

### Related Issues
- .planning/ENCRYPTION-CONSISTENCY-ANALYSIS.md (original issue documentation)

## Commit

```
commit 0b27611
fix: comprehensive CSS property detection for text-affecting styles

Root cause: SDK only detected text-transform, missing many CSS properties
that affect text rendering, causing gibberish on sites with advanced typography.
```
