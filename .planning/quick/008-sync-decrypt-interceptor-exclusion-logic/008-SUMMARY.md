---
phase: quick
plan: 008
subsystem: client-side-encryption
tags: [position-mapping, exclusion-logic, consistency, bug-fix]

dependencies:
  requires:
    - quick-007 (SDK now encrypts code blocks)
  provides:
    - Consistent exclusion logic between SDK and decrypt-interceptor
    - Accurate position calculations on pages with code blocks
  affects:
    - Future changes to exclusion patterns must maintain consistency

tech-stack:
  patterns:
    - Exclusion logic parity between encryption and decryption

files:
  created: []
  modified:
    - client/decrypt/src/position.js (EXCLUDE_SELECTORS updated)

decisions:
  - title: "Keep defensive exclusions in decrypt-interceptor"
    rationale: "svg/path/textarea/input exclusions in DI are defensive and low-impact, acceptable difference from SDK"
    impact: "Minimal - these elements rarely contain searchable text"

metrics:
  duration: "45 seconds"
  completed: "2026-01-24"
---

# Quick Task 008: Sync Decrypt-Interceptor Exclusion Logic

**One-liner:** Removed code/pre/kbd/samp/var from decrypt-interceptor EXCLUDE_SELECTORS to match SDK changes from quick-007

## Context

Quick task 007 changed the SDK to encrypt code/pre/kbd/samp/var elements (instead of skipping them). The decrypt-interceptor still excluded these tags from position mapping, creating a **critical mismatch**:

- SDK encrypts code blocks → they appear in DOM
- Decrypt-interceptor skips code blocks → position calculations off
- Result: Copy/paste returns wrong text, position mapping errors

## Tasks Completed

### Task 1: Remove code/pre elements from EXCLUDE_SELECTORS ✅

**Change:**
```javascript
// BEFORE (line 217):
const EXCLUDE_SELECTORS = ['script', 'style', 'noscript', 'meta', 'link', 'head', 'svg', 'path', 'code', 'pre', 'kbd', 'samp', 'var', 'textarea', 'input'];

// AFTER:
// Elements to exclude from position mapping (MUST MATCH cloak-sdk.js excludeSelectors)
// NOTE: code/pre/kbd/samp/var removed in quick-008 to match SDK (see quick-007)
const EXCLUDE_SELECTORS = ['script', 'style', 'noscript', 'meta', 'link', 'head', 'svg', 'path', 'textarea', 'input'];
```

**Files modified:** `client/decrypt/src/position.js`

**Commit:** `4732671`

### Task 2: Verify consistency with SDK ✅

**Verification:**

| Element | SDK excludeSelectors | DI EXCLUDE_SELECTORS | Match? |
|---------|---------------------|----------------------|---------|
| script | ✅ | ✅ | ✅ |
| style | ✅ | ✅ | ✅ |
| noscript | ✅ | ✅ | ✅ |
| meta | ✅ | ✅ | ✅ |
| link | ✅ | ✅ | ✅ |
| head | ✅ | ✅ | ✅ |
| **code** | ❌ | ❌ | ✅ (both removed) |
| **pre** | ❌ | ❌ | ✅ (both removed) |
| **kbd** | ❌ | ❌ | ✅ (both removed) |
| **samp** | ❌ | ❌ | ✅ (both removed) |
| **var** | ❌ | ❌ | ✅ (both removed) |

**Intentional differences (documented as acceptable):**

| Element | SDK | DI | Impact |
|---------|-----|----|----|
| svg | ❌ | ✅ | Low (SVG text rarely searchable) |
| path | ❌ | ✅ | Low (SVG path data not text) |
| textarea | ❌ | ✅ | None (defensive exclusion) |
| input | ❌ | ✅ | None (defensive exclusion) |

**Result:** Core exclusion logic now consistent. Code blocks will be encrypted by SDK and included in position mapping by decrypt-interceptor.

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Type | Hash | Message |
|------|------|---------|
| fix | 4732671 | Sync decrypt-interceptor exclusion logic with SDK |

## Verification

✅ `code/pre/kbd/samp/var` removed from EXCLUDE_SELECTORS
✅ Comment added referencing quick-007/quick-008 for traceability
✅ No other changes to position.js logic
✅ Grep verification passes

## Impact

**Before this fix:**
- SDK encrypts code blocks → appear in DOM as encrypted text
- Decrypt-interceptor skips code blocks in position mapping
- Position calculations off by length of all code blocks
- Copy/paste returns incorrect text on pages with code

**After this fix:**
- SDK encrypts code blocks → appear in DOM as encrypted text
- Decrypt-interceptor includes code blocks in position mapping
- Position calculations accurate
- Copy/paste returns correct text

## Next Phase Readiness

**Blockers:** None

**Concerns:** None - this was a simple consistency fix

**Recommendations:**
- Add automated test to verify SDK and decrypt-interceptor exclusion lists match
- Consider extracting EXCLUDE_SELECTORS to shared config
