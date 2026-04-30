# Font Handling Architecture

## Overview

Cloak uses font-based encryption where text is scrambled via character substitution and custom fonts render the scrambled text as readable. This document explains how Cloak handles different font types to maintain visual fidelity.

## Three-Tier Font Handling

### Tier 1: Web Fonts (100% Visual Match)

**What:** Fonts loaded via `@font-face` rules or Google Fonts links (e.g., Playfair Display, Lora, Inter)

**How:**
1. SDK detects `@font-face` rules and Google Fonts links
2. Downloads the actual font file from its URL
3. Encrypts the font (remaps glyph codepoints)
4. Serves encrypted font with the SAME family name
5. Browser automatically uses our encrypted version

**Result:** Pixel-perfect typography since we use the actual font file.

**Code Location:** `client/cloak-sdk.js` - `detectPageFonts()`, `requestEncryptedFont()`

### Tier 2: System Fonts (95%+ Visual Match)

**What:** Fonts pre-installed on user's computer (Arial, Times New Roman, Georgia, etc.)

**Why Can't We Download:** These are proprietary fonts owned by Microsoft/Apple and cannot be legally redistributed.

**How:**
1. SDK detects system font usage via `getComputedStyle()`
2. Looks up metric-compatible Google Font equivalent in `SYSTEM_FONT_MAP`
3. Downloads and encrypts the Google Font
4. Registers it with the ORIGINAL system font name
5. Browser uses our @font-face over the system font

**Result:** Near-identical typography using metrically-compatible substitutes.

**Code Location:**
- `utils/system_fonts.py` - `SYSTEM_FONT_MAP`, `get_system_font_equivalent()`
- `client/cloak-sdk.js` - `detectUsedFonts()`, `resolveSystemFont()`

### Tier 3: Unknown Fonts (Category Match)

**What:** System fonts not in our mapping (rare/obscure fonts)

**How:**
1. SDK detects the font category (serif/sans-serif/monospace)
2. Uses `detectFontCategory()` which measures character widths
3. Selects appropriate category font:
   - Serif → Tinos
   - Sans-serif → Arimo
   - Monospace → Roboto Mono
4. Encrypts and registers with ORIGINAL font name

**Result:** Same font category, different specific typeface. Text remains readable with similar visual weight.

**Code Location:** `client/cloak-sdk.js` - `detectFontCategory()`

---

## Font Mapping Reference

### Excellent Metric-Compatible Matches (Croscore Fonts)

These fonts were specifically designed by Google to have identical character widths to their Microsoft counterparts:

| System Font | Google Font | Notes |
|-------------|-------------|-------|
| Arial | Arimo | Metric-compatible, Croscore project |
| Times New Roman | Tinos | Metric-compatible, Croscore project |
| Courier New | Cousine | Metric-compatible, Croscore project |

### Very Good Metric-Compatible Matches

| System Font | Google Font | Notes |
|-------------|-------------|-------|
| Georgia | Gelasio | Metric-compatible, variable font |
| Calibri | Carlito | Metric-compatible, MS Office default |
| Cambria | Caladea | Metric-compatible, MS Office serif |

### Good Visual Matches (No Metric Clone Exists)

| System Font | Google Font | Notes |
|-------------|-------------|-------|
| Verdana | Arimo | Verdana has wider x-height |
| Trebuchet MS | Arimo | Trebuchet has distinctive letterforms |
| Tahoma | Arimo | Tahoma is narrower |
| Impact | Anton | Both are bold condensed display |
| Comic Sans MS | Comic Neue | Open-source Comic Sans redesign |
| Helvetica | Arimo | Helvetica ≈ Arial ≈ Arimo |

### System UI Fonts

| System Font | Google Font | Notes |
|-------------|-------------|-------|
| -apple-system | Inter | macOS system font |
| BlinkMacSystemFont | Inter | Chrome on macOS |
| system-ui | Inter | Generic system UI |
| Segoe UI | Inter | Windows system font |
| SF Pro | Inter | San Francisco (macOS) |

### Monospace Fonts

| System Font | Google Font | Notes |
|-------------|-------------|-------|
| SF Mono | Cousine | macOS monospace |
| Menlo | Cousine | macOS default monospace |
| Monaco | Cousine | Classic Mac monospace |
| Consolas | Cousine | Windows monospace |
| Lucida Console | Cousine | Windows console font |

---

## Category Detection Algorithm

When a font is not in `SYSTEM_FONT_MAP`, the SDK uses `detectFontCategory()`:

```javascript
function detectFontCategory(fontFamily) {
    // 1. Create hidden test elements with 'iiii' and 'mmmm' text
    // 2. Measure widths with font + serif/sans-serif/monospace fallback
    // 3. Compare to pure generic font widths

    // Monospace detection: 'i' and 'm' have equal widths
    // Serif vs sans-serif: Compare which generic fallback matches

    return 'serif' | 'sans-serif' | 'monospace';
}
```

**Category Fallback Fonts:**
- Serif → Tinos (Times-like)
- Sans-serif → Arimo (Arial-like)
- Monospace → Roboto Mono

---

## Font Licensing

### Why We Can't Use System Fonts

System fonts like Arial, Times New Roman, Verdana are **proprietary**:
- Owned by Microsoft, Apple, or other companies
- Cannot be downloaded from a server and redistributed
- Only legal when rendered by the operating system

### Allowed Licenses for Cloak

We use fonts with these open-source licenses:

| License | Allows Modification | Allows Redistribution | Examples |
|---------|--------------------|-----------------------|----------|
| SIL OFL | Yes | Yes (with rename) | Most Google Fonts |
| Apache 2.0 | Yes | Yes | Croscore fonts |

### Perfect Clones Don't Exist For:

- Verdana (wide x-height, unique design)
- Trebuchet MS (distinctive letter shapes)
- Impact (specific condensed design)
- Tahoma (narrow proportions)

For these fonts, we accept a category-appropriate substitute rather than attempting an impossible perfect match.

---

## Research Summary

### Investigated Alternatives

1. **Wine Tahoma** - LGPL licensed Tahoma clone from Wine project, but not on Google Fonts
2. **TeX Gyre Pagella** - Excellent Palatino clone, but not on Google Fonts
3. **Selawik** - Microsoft's own open-source Segoe UI alternative, but kerning differs
4. **Liberation Fonts** - Red Hat's metric-compatible alternatives (same quality as Croscore)

### CSS Metric Override Technique

Modern CSS allows fine-tuning fallback fonts:
```css
@font-face {
  font-family: 'Verdana Fallback';
  src: local('Arimo');
  size-adjust: 89%;
  ascent-override: 105%;
}
```

This doesn't change glyphs but prevents layout shifts. Not yet implemented in Cloak.

### Conclusion

The current approach achieves:
- **100% match** for web fonts (80-90% of modern websites)
- **95%+ match** for common system fonts (Arial, Times, Georgia, Calibri)
- **Category match** for rare/unknown fonts

Perfect matching for all fonts is not achievable without:
- Licensing proprietary fonts ($100k+/year, modification rights unlikely)
- Commissioning custom metric-compatible fonts ($50-100k per font)

---

*Last updated: 2025-01-22*
*Related: utils/system_fonts.py, client/cloak-sdk.js*
