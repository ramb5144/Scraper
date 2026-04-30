# Decrypt Interceptor - Modular Architecture

The decrypt-interceptor.js file provides copy-paste interception, search, and selection
functionality for server-side encrypted pages. It is now built from modular sources.

## Directory Structure

```
client/decrypt/
  src/
    config.js     - Configuration proxy, API helpers (~157 lines)
    copy.js       - Copy/paste interception (~1010 lines)
    position.js   - Position mapping, DOM walking (~533 lines)
    search.js     - Search overlay, highlighting (~1366 lines)
    selection.js  - Word/paragraph selection (~567 lines)
    init.js       - Debug logging, exposed functions (~194 lines)
  build.js        - Build script
  validate.js     - Validation script
  backup.js       - Pre-modular backup (for reference)
```

## Editing Workflow

1. **Edit individual modules** in `src/` instead of the monolithic file
2. **Rebuild** to generate the output file:
   ```bash
   node client/decrypt/build.js
   ```
3. **Validation runs automatically** during build

## Build Script

The build script (`build.js`) concatenates modules in dependency order:

1. `config.js` - Must be first (defines encryptionConfig and API helpers)
2. `copy.js` - Uses config functions
3. `position.js` - Uses config, provides position map for search
4. `search.js` - Uses position map, config
5. `selection.js` - Uses config, position, exposes window functions
6. `init.js` - Must be last (debug logging)

Output is wrapped in an IIFE with section headers for navigation.

## Validation

Run manually if needed:

```bash
node client/decrypt/validate.js
```

Checks:
- Line count is reasonable (3500-4500)
- All required functions exist
- JavaScript syntax is valid
- File structure (IIFE wrapper) is intact

## Recovery Options

If the built file gets corrupted:

```bash
# Option 1: Rebuild from modules
node client/decrypt/build.js

# Option 2: Restore from git
git checkout HEAD -- client/decrypt-interceptor.js

# Option 3: Restore from pre-modular backup (last resort)
cp client/decrypt/backup.js client/decrypt-interceptor.js
```

## Module Dependencies

```
config.js (encryptionConfig, getApiHeaders, setXhrHeaders)
    |
    v
copy.js (setupCopyInterception, getSelectionPositions, encryptSearchQuery)
    |
    v
position.js (buildTextPositionMap, shouldExcludeTextNode, searchServerSide)
    |
    v
search.js (searchEncryptedDOM, highlightMatches, createSearchOverlay)
    |
    v
selection.js (selectTextByPosition, setupWordSelectionInterception, window.*)
    |
    v
init.js (debugEncryption, console logging)
```

## Why Modular?

The original 3800-line monolithic file was prone to corruption during AI editing
due to context limits. Smaller modules are safer to edit individually, and the
build script ensures they're correctly assembled.
