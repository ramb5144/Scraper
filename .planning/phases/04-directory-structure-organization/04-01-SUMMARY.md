---
phase: 04-directory-structure-organization
plan: 01
subsystem: infra
tags: [directory-structure, organization, refactoring]

# Dependency graph
requires:
  - phase: 03-core-system-stabilization
    provides: Stable test suite and working demo files
provides:
  - All demo HTML files consolidated in /demos directory with consistent kebab-case naming
  - Clean root directory (only application code)
  - Removed templates/ directory (no longer needed)
affects: [05-code-cleanup, 06-html-encryption-modernization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Demo files organized in /demos with kebab-case naming convention"
    - "Clear separation between application code (root) and static demos (demos/)"

key-files:
  created:
    - demos/sdk-test.html
    - demos/nyt.html
    - demos/test-localhost.html
    - demos/test-localhost-plain.html
    - demos/test-localhost-webfonts.html
    - demos/test-localhost-webfonts-plain.html
    - demos/dynamic-test.html
    - demos/dynamic-test-plain.html
    - demos/pdf-test.html
    - demos/stackoverflow.html
    - demos/stackoverflow-no-sdk.html
    - demos/stackoverflow-clean.html
    - demos/test-stackoverflow.html
  modified: []

key-decisions:
  - "Renamed demo files from snake_case to kebab-case for consistency"
  - "Did not move 'new stackoverflow.html' (temporary/working file with space in name)"
  - "Removed empty templates/ directory after moving all demo files"

patterns-established:
  - "Pattern 1: All demo HTML files live in /demos directory"
  - "Pattern 2: Kebab-case naming for demo files (e.g., test-localhost.html not test_localhost.html)"

# Metrics
duration: 2min
completed: 2026-01-24
---

# Phase 4 Plan 1: Consolidate Demo Files Summary

**All 13 demo HTML files consolidated into /demos with kebab-case naming, root and templates directories cleaned**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-24T03:40:37Z
- **Completed:** 2026-01-24T03:42:44Z
- **Tasks:** 3
- **Files modified:** 13 (moved/renamed)

## Accomplishments
- Moved 6 root-level demo HTML files to /demos with kebab-case renaming
- Moved 7 templates demo HTML files to /demos with kebab-case renaming
- Removed empty templates/ directory completely
- Established consistent naming convention for demo files

## Task Commits

Each task was committed atomically:

1. **Task 1: Move root-level demo HTML files to demos/** - `b93dfed` (chore)
2. **Task 2: Move templates demo HTML files to demos/** - `3e43792` (chore)
3. **Task 3: Clean up empty templates directory** - (completed via Task 2 - git auto-removed empty dir)

## Files Created/Modified
- `demos/sdk-test.html` - Main SDK test page (moved from root sdk_test.html)
- `demos/nyt.html` - NYT demo page
- `demos/test-localhost.html` - Localhost test page
- `demos/test-localhost-plain.html` - Localhost test without encryption
- `demos/test-localhost-webfonts.html` - Localhost test with webfonts
- `demos/test-localhost-webfonts-plain.html` - Localhost test with webfonts, no encryption
- `demos/dynamic-test.html` - Dynamic content test page (moved from templates/)
- `demos/dynamic-test-plain.html` - Dynamic content test without encryption
- `demos/pdf-test.html` - PDF generation test page
- `demos/stackoverflow.html` - Stack Overflow demo page
- `demos/stackoverflow-no-sdk.html` - Stack Overflow demo without SDK
- `demos/stackoverflow-clean.html` - Clean Stack Overflow demo
- `demos/test-stackoverflow.html` - Stack Overflow test page

## Decisions Made

1. **Renamed files from snake_case to kebab-case** - Established consistent naming convention (test_localhost.html → test-localhost.html)
2. **Excluded 'new stackoverflow.html' from moves** - File has space in name, appears to be temporary/working file, not a proper demo
3. **Removed templates/ directory** - After moving all demo files, templates/ was empty and no longer needed. Git automatically removed it when last file was moved.

## Deviations from Plan

None - plan executed exactly as written. Templates directory was automatically removed by git when the last file was moved (Task 2), so explicit removal in Task 3 was unnecessary.

## Issues Encountered

None - all file moves executed cleanly using `git mv` to preserve history.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Directory structure is now clean and organized:
- All demo files in /demos with consistent naming
- Root directory contains only application code
- Clear separation between demos and application

Ready for Phase 4 Plan 2 (organize application code directories if needed) or Phase 5 (code cleanup).

No blockers or concerns.

---
*Phase: 04-directory-structure-organization*
*Completed: 2026-01-24*
