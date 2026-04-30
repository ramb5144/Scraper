# Debug Session Log

## 2026-01-22: Excessive Logging and Ticker Exclusion

**Issue:** Two critical problems after quick-004:
1. Console flooded with 200+ debug messages on page load
2. "Content changed - refresh page" warning appearing immediately (67 char diff)

**Investigation:**
- Quick-004 claimed to fix these but didn't address root causes
- Excessive logging came from cloak-sdk.js high-frequency logs in hot paths
- Ticker exclusion was only in decrypt-interceptor, NOT in SDK's shouldExcludeNode
- This caused SDK to upload 7964 chars (with ticker) but client excluded ticker (7897 chars)

**Root Causes:**
1. cloak-sdk.js line 155: logged data-cloak-exclude check for every text node
2. High-frequency logs in encryptTextNode, processPendingNodes, getTextNodes, MutationObserver
3. SDK missing ticker-content/breaking-news class exclusion in shouldExcludeNode
4. Decrypt-interceptor had unconditional logs in position.js and search.js

**Fix:**
- Removed 6 high-frequency logs from cloak-sdk.js
- Added ticker exclusion to SDK's shouldExcludeNode (TWO places: text node ancestor check + element parent check)
- Removed logs from decrypt-interceptor source modules (position.js, search.js)
- Rebuilt decrypt-interceptor.js

**Commit:** 28f57cb
**Debug File:** .planning/debug/resolved/excessive-logging-and-ticker-exclusion-broken.md

**Result:**
✅ Console quiet on page load
✅ No content-changed warning (both SDK and interceptor exclude ticker)
✅ Server and client plaintext lengths match
