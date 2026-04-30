---
phase: quick
plan: 006
status: cancelled
reason: architectural-decision
---

# Quick Task 006: Fix Encrypted Code Blocks (CANCELLED)

**One-liner:** Investigation revealed exclusion approach is wrong; code encryption is acceptable

## What Happened

Initial plan suggested adding `code` and `pre` to excludeSelectors to fix garbled code display. This was **rejected** as it violates core architecture principles.

## Why Cancelled

**Core principle:** NEVER use exclusion lists to fix rendering issues. This defeats encryption purpose.

**The real issue:**
- Stack Overflow code blocks use monospace fonts
- Cloak applies proportional encrypted fonts (Inter)
- Encrypted text + proportional font = garbled appearance

**Proper solution would require:**
Creating monospace encrypted font variants (Courier New, Monaco, Consolas encrypted). This is complex and not currently implemented.

##Decision

**Code blocks will remain encrypted and appear garbled visually.**

This is ACCEPTABLE because:
1. The decrypt-interceptor handles copy/paste correctly
2. Users can copy code and get plaintext
3. Scrapers cannot read the encrypted code
4. Security > aesthetics for code blocks

## Architectural Note

Added to PROJECT.md:
```
Never use exclusion lists as solutions to rendering issues.
Exclusions defeat encryption purpose.
Only exclude technical elements (script, style, meta).
```

## No Changes Made

SDK remains unchanged - code/pre NOT added to exclusions.
Code blocks stay encrypted as intended.
