# Verification Steps for System Font Fix

## What Was Fixed

**Problem:** System fonts (Georgia, Arial, Helvetica Neue) were detected but never encrypted or replaced. Pages using system fonts showed wrong fonts in encrypted version.

**Solution:** Added system font processing pipeline in `loadFont()` function to:
1. Detect system fonts via `detectUsedFonts()`
2. Resolve to Google Font equivalents via `resolveSystemFont()` API
3. Encrypt those fonts via `requestEncryptedFont()`
4. Register @font-face rules with ORIGINAL system font family names

## How to Verify

### Prerequisites
1. Start Flask server: `python3 encrypt_api.py`
2. Ensure all dependencies are installed (sqlalchemy, etc.)

### Test Steps

1. **Open test pages side by side:**
   - Encrypted: http://localhost:8001/test-localhost
   - Plain: http://localhost:8001/test-localhost-plain

2. **Compare typography:**
   - Body text should look identical (both using Georgia-style serif)
   - Navigation logo should look identical (both using Helvetica Neue/Arial-style sans-serif)
   - All font weights (bold, normal) should match
   - Letter spacing and line heights should be identical

3. **Open browser console on encrypted page:**
   - Look for debug logs showing system font processing:
     ```
     [Cloak] Processing system fonts...
     [Cloak] Found N system font variants to resolve: [...]
     [Cloak] Resolved system font "Georgia" -> "Tinos"
     [Cloak] Registered encrypted system font: Georgia (400, normal) -> Tinos
     [Cloak] Resolved system font "Arial" -> "Arimo"
     [Cloak] Registered encrypted system font: Arial (400, normal) -> Arimo
     ```

4. **Inspect @font-face rules:**
   - Open DevTools > Elements > Inspect `<style id="cloak-font-style">`
   - Should see @font-face rules with family: 'Georgia', 'Arial', 'Helvetica Neue'
   - These should point to encrypted font URLs

5. **Verify font matching:**
   - Select text in both versions
   - Right-click > Inspect
   - Check Computed styles > font-family
   - Both should show the same font family being used
   - Encrypted version should be using the encrypted @font-face, not browser built-in

## Expected Results

✅ **Pass criteria:**
- Visual typography identical between encrypted and plain versions
- Console logs show system fonts being resolved and encrypted
- @font-face rules use original system font names
- No fallback to CloakFont for body text

❌ **Fail indicators:**
- Serif fonts showing as sans-serif (or vice versa)
- Bold weights not appearing bold
- Console errors about font resolution
- Typography looks noticeably different

## Code Changes

**File:** `client/cloak-sdk.js`
**Lines:** 859-962 (added system font processing loop)

**Key logic:**
```javascript
// For each system font detected:
const resolved = await resolveSystemFont(family, weight, style);
// resolved.googleFont = "Tinos" (for Georgia)
// resolved.fonts[0].url = Google Fonts URL

const encrypted = await requestEncryptedFont({
    family: resolved.googleFont,  // "Tinos"
    url: googleFont.url
});

// Register with ORIGINAL name:
@font-face {
    font-family: 'Georgia';  // NOT 'Tinos'!
    src: url(encryptedFontUrl);
}
```

This allows the encrypted font to override the browser's built-in system font.
