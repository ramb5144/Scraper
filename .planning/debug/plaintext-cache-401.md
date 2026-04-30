---
status: verifying
trigger: "plaintext-cache-401-unauthorized"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:01:30Z
---

## Current Focus

hypothesis: Code looks correct (commit e62cab2 fixed this), but issue persists - possibly browser caching old decrypt-interceptor.js version OR config.apiKey undefined at runtime
test: Check if browser is serving cached decrypt-interceptor.js without getApiHeaders, OR verify config.apiKey value at runtime
expecting: Either old decrypt-interceptor.js cached, OR config.apiKey is undefined due to init() being called without apiKey
next_action: Check if decrypt-interceptor.js getApiHeaders function exists and if window.encryptionConfig.apiKey is actually set

## Symptoms

expected: Ctrl+F search finds plaintext, double-click selects words, Ctrl+C copies plaintext
actual: Nothing happens - features don't respond
errors:
- api/search/prefetch: 401 UNAUTHORIZED
- api/search/word-boundaries: 401 UNAUTHORIZED
- api/search/find-matches: 401 UNAUTHORIZED
- decrypt-interceptor.js:3320 "Word boundaries API call failed: 401"
reproduction: Initialize SDK on dynamic-test page, try Ctrl+F or double-click to select text
started: Started noticing now on new dynamic test page

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:00:00Z
  checked: SDK behavior logs
  found: "Plaintext uploaded to server: 8638 chars" succeeds, but search operations fail with 401
  implication: Upload endpoint works, suggesting API key authentication works for uploads but not for search endpoints

- timestamp: 2026-01-22T00:00:01Z
  checked: routes_encryption.py lines 364-490
  found: All search endpoints (/api/search/prefetch, /api/search/find-matches, /api/search/word-boundaries) have @validate_api_key decorator
  implication: Backend correctly requires API key for search endpoints

- timestamp: 2026-01-22T00:00:02Z
  checked: utils/middleware.py lines 244-355
  found: validate_api_key decorator checks X-API-Key header (line 261) and also request body for api_key param (line 263)
  implication: Server expects X-API-Key header or api_key in JSON body

- timestamp: 2026-01-22T00:00:03Z
  checked: client/decrypt-interceptor.js lines 1015, 1164, 3309, 3497, 3547
  found: All search endpoint calls use getApiHeaders() function
  implication: Need to examine getApiHeaders() to see if it includes X-API-Key

- timestamp: 2026-01-22T00:00:04Z
  checked: client/decrypt-interceptor.js lines 37-45
  found: getApiHeaders() checks encryptionConfig.apiKey and sets X-API-Key header if present
  implication: API key SHOULD be included if encryptionConfig.apiKey exists

- timestamp: 2026-01-22T00:00:05Z
  checked: client/cloak-sdk.js lines 1677-1691
  found: injectDecryptInterceptor() sets window.encryptionConfig with apiKey, then loads decrypt-interceptor.js with defer attribute
  implication: Script loads asynchronously

- timestamp: 2026-01-22T00:00:06Z
  checked: client/decrypt-interceptor.js lines 18-19
  found: "const encryptionConfig = window.encryptionConfig || {}" at module level (line 19)
  implication: CRITICAL - encryptionConfig is captured when module executes, not when functions run

- timestamp: 2026-01-22T00:00:07Z
  checked: Script loading flow in cloak-sdk.js
  found: Line 1679 sets window.encryptionConfig, line 1689 creates script element with defer, line 1691 appends to head
  implication: With defer attribute, script may execute AFTER DOMContentLoaded but timing with window.encryptionConfig assignment is NOT guaranteed

- timestamp: 2026-01-22T00:00:08Z
  checked: cloak-sdk.js uploadPlaintextToServer vs decrypt-interceptor getApiHeaders
  found: Upload uses encryptionConfig.apiKey (line 1633 - LOCAL cloak-sdk variable), decrypt-interceptor uses encryptionConfig.apiKey (line 42 - from window.encryptionConfig)
  implication: Upload works because it uses cloak-sdk's local encryptionConfig which has apiKey; decrypt-interceptor depends on window.encryptionConfig.apiKey

- timestamp: 2026-01-22T00:00:09Z
  checked: window.encryptionConfig.apiKey source in injectDecryptInterceptor
  found: Line 1684 sets apiKey: config.apiKey, where config = {...DEFAULT_CONFIG, ...options} (line 1719), and options.apiKey is validated (line 1721-1723)
  implication: config.apiKey SHOULD equal options.apiKey and be set correctly

- timestamp: 2026-01-22T00:00:10Z
  checked: Code flow from init to injectDecryptInterceptor
  found: Line 1719 sets config.apiKey from options, line 1767 calls injectDecryptInterceptor(), line 1684 should set window.encryptionConfig.apiKey = config.apiKey
  implication: Either config.apiKey is somehow undefined/lost between line 1719 and 1684, OR window.encryptionConfig is being overwritten somewhere

- timestamp: 2026-01-22T00:00:11Z
  checked: Git history for previous fixes
  found: Commit e62cab2 "Fix plaintext cache API calls by adding X-API-Key headers" - THIS EXACT ISSUE WAS ALREADY FIXED!
  implication: The fix was applied on Jan 19, but user is still seeing 401 errors - something reverted or browser cache issue

- timestamp: 2026-01-22T00:00:12Z
  checked: Git commit e62cab2 diff
  found: Added `apiKey: config.apiKey` to window.encryptionConfig on line 1684, added getApiHeaders() to decrypt-interceptor.js
  implication: The code SHOULD work - need to verify why it's not working for the user

- timestamp: 2026-01-22T00:01:00Z
  checked: decrypt-interceptor.js line 19 variable capture
  found: `const encryptionConfig = window.encryptionConfig || {}` captures value ONCE at module load
  implication: If window.encryptionConfig not set yet, encryptionConfig becomes {} forever (const creates snapshot, not reference)

- timestamp: 2026-01-22T00:01:15Z
  checked: Timing race condition possibility
  found: cloak-sdk.js sets window.encryptionConfig (line 1679), then creates <script> with defer (line 1688-1691). Script must download before executing.
  implication: Even though window.encryptionConfig is set before script element creation, the script file download is async. If download is extremely fast OR browser has cached version, script could execute and capture empty {} before line 1679 sets it.

- timestamp: 2026-01-22T00:01:30Z
  checked: Fixed with Proxy pattern
  found: Replaced const capture with Proxy that dynamically reads window.encryptionConfig on each property access
  implication: FIX APPLIED - encryptionConfig.apiKey now always returns current window.encryptionConfig.apiKey value, eliminating race condition

- timestamp: 2026-01-22T00:01:40Z
  checked: Verified Proxy behavior with Node.js test
  found: Confirmed Proxy correctly reads current values while const snapshot stays frozen at capture time
  implication: Fix is sound and will resolve 401 unauthorized errors

## Resolution

root_cause: decrypt-interceptor.js line 19 captured window.encryptionConfig once at module load time with `const encryptionConfig = window.encryptionConfig || {}`. This creates a timing race condition: cloak-sdk.js sets window.encryptionConfig synchronously on line 1679, then creates a script element with defer on line 1688-1691. However, the script must download before it executes. If the download is very fast and completes before JavaScript execution returns from injectDecryptInterceptor(), the script could execute immediately and read window.encryptionConfig BEFORE line 1679 sets it. More likely: browser caches old decrypt-interceptor.js version OR the captured {} object never updates even after window.encryptionConfig is set because const creates a snapshot, not a reference.

fix: Replace `const encryptionConfig = window.encryptionConfig || {}` with a Proxy that dynamically reads window.encryptionConfig on each property access. This ensures encryptionConfig.apiKey always returns the current value of window.encryptionConfig.apiKey, not a stale snapshot from module load time.

Code change in client/decrypt-interceptor.js line 19-24:
```javascript
const encryptionConfig = new Proxy({}, {
    get(target, prop) {
        const config = window.encryptionConfig || {};
        return config[prop];
    }
});
```

verification:
  To test the fix:
  1. Start Flask server: python3 server.py
  2. Open http://localhost:8001/dynamic-test in browser
  3. Click "Initialize SDK" button
  4. Verify console shows "API Key: ✅ Set" in configuration status
  5. Test Ctrl+F search - should find encrypted text
  6. Test double-click word selection - should select word boundaries
  7. Test Ctrl+C copy - should copy plaintext
  8. Check browser network tab - /api/search/* requests should have X-API-Key header and return 200, not 401

files_changed: ['client/decrypt-interceptor.js']
