---
phase: 02-architecture-documentation
plan: 03
subsystem: documentation
tags: [troubleshooting, decision-trees, debugging, developer-experience]

# Dependency graph
requires:
  - phase: 02-01
    provides: Flow diagrams showing encryption, search, and font loading processes
  - phase: 02-02
    provides: Position mapping and exclusion logic verification findings
provides:
  - Systematic troubleshooting guide for text rendering issues (gibberish text, font problems)
  - Systematic troubleshooting guide for position mismatch issues (copy/paste, search highlighting)
  - Runtime diagnostic code snippets for common debugging scenarios
  - debugPositionMapping() output interpretation guide
affects: [03-codebase-cleanup, future-debugging-sessions]

# Tech tracking
tech-stack:
  added: []
  patterns: [decision-tree-troubleshooting, runtime-diagnostics]

key-files:
  created:
    - .planning/phases/02-architecture-documentation-and-verification-document-complet/troubleshooting/rendering-issues-decision-tree.md
    - .planning/phases/02-architecture-documentation-and-verification-document-complet/troubleshooting/position-mismatch-guide.md
  modified: []

key-decisions:
  - "Decision trees structured with nested checks and 'How to check' DevTools instructions"
  - "Each known issue references specific code locations for investigation"
  - "Diagnostic snippets are copy-paste ready for console execution"

patterns-established:
  - "Troubleshooting guides use systematic decision trees, not generic 'check logs' advice"
  - "Each diagnostic step includes specific DevTools commands and expected results"
  - "Known issues table includes severity, verification method, and code location"

# Metrics
duration: 5min
completed: 2026-01-24
---

# Phase 02 Plan 03: Troubleshooting Decision Trees Summary

**Systematic troubleshooting guides for rendering and position issues with decision trees, DevTools diagnostics, and runtime code snippets**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-24T00:47:24Z
- **Completed:** 2026-01-24T00:52:01Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created rendering issues decision tree with 4-level systematic diagnosis for text gibberish and font problems
- Created position mismatch guide with decision trees for copy/paste and search highlighting issues
- Documented debugPositionMapping() output interpretation with common divergence patterns
- Provided copy-paste ready diagnostic code snippets for console debugging

## Task Commits

Each task was committed atomically:

1. **Task 1: Create rendering issues decision tree** - `f5d24eb` (docs)
   - Files: `.planning/phases/02-architecture-documentation-and-verification-document-complet/troubleshooting/rendering-issues-decision-tree.md`

2. **Task 2: Create position mismatch troubleshooting guide** - `d7077cf` (docs)
   - Files: `.planning/phases/02-architecture-documentation-and-verification-document-complet/troubleshooting/position-mismatch-guide.md`

## Files Created/Modified

### Created

- **`.planning/phases/02-architecture-documentation-and-verification-document-complet/troubleshooting/rendering-issues-decision-tree.md`**
  - Systematic diagnosis of text rendering issues (gibberish text, fonts)
  - Four-level decision tree: Is encrypted? → Fonts loaded? → Fonts applied? → text-transform?
  - FAQ gibberish specific debug guide with runtime testing approach
  - Known root causes table with 7 common issues and code locations
  - Diagnostic snippets: check encryption status, list unencrypted nodes, verify fonts loaded, test exclusion config

- **`.planning/phases/02-architecture-documentation-and-verification-document-complet/troubleshooting/position-mismatch-guide.md`**
  - Systematic diagnosis of copy/paste and search position issues
  - Decision trees for both symptoms with 3 levels each
  - debugPositionMapping() output interpretation section
  - Common divergence patterns table (text-transform, extra exclusions, highlight splits)
  - Known position issues table with 6 verified issues from plan 02-02
  - Prevention checklist for deployment and runtime testing
  - Diagnostic snippets: position map verification, selection comparison, excluded nodes detection, block detection comparison

## Decisions Made

**Decision tree structure:** Each guide uses nested decision trees with specific "How to check" instructions that reference DevTools tabs, console commands, and specific code locations. This is superior to generic "check the logs" guidance per research findings.

**Code snippet philosophy:** All diagnostic code is copy-paste ready for browser console execution. Each snippet includes explanatory comments and example usage to lower the barrier for debugging.

**Known issues integration:** Both guides reference findings from verification plans (02-01, 02-02) and link to specific code locations in cloak-sdk.js and position.js for investigation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - straightforward documentation creation based on verification findings and source code review.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for future debugging:**
- Developers can systematically diagnose text rendering issues using decision tree
- Developers can diagnose position mismatches using debugPositionMapping() and decision trees
- Runtime diagnostic snippets enable quick verification of encryption status, font loading, position maps

**Ready for codebase cleanup (Phase 03):**
- Troubleshooting guides document current behavior and known issues
- Code location references (line numbers) will need updating after cleanup refactoring
- Prevention checklists provide test scenarios for regression testing

**No blockers identified.**

---
*Phase: 02-architecture-documentation*
*Completed: 2026-01-24*
