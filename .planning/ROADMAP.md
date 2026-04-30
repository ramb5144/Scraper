# Roadmap: Cloak

## Milestones

- v1.0 Core System Stabilization - Phases 1-3 (shipped 2026-01-24)
- v1.1 Codebase Cleanup & Organization - Phases 4-7 (in progress)

## Phases

<details>
<summary>v1.0 Core System Stabilization (Phases 1-3) - SHIPPED 2026-01-24</summary>

### Phase 1: Initial Setup
**Goal**: Project infrastructure established
**Plans**: Completed during initial development

### Phase 2: Architecture Documentation and Verification
**Goal**: Complete documentation and consistency verification
**Plans**: 3 plans completed

Plans:
- [x] 02-01: Create comprehensive flow documentation
- [x] 02-02: Verify algorithm consistency
- [x] 02-03: Build troubleshooting guides

### Phase 3: Automated Testing Infrastructure
**Goal**: Playwright-based test framework with all E2E flows verified
**Plans**: 3 plans completed

Plans:
- [x] 03-01: Set up Playwright test framework
- [x] 03-02: Build copy/paste and search tests
- [x] 03-03: Add visual regression and dynamic content tests

</details>

### v1.1 Codebase Cleanup & Organization (In Progress)

**Milestone Goal:** Eliminate technical debt and establish clear codebase structure for long-term maintainability.

#### Phase 4: Directory Structure Organization
**Goal**: All code organized into clear, purpose-driven directories with updated imports
**Depends on**: Phase 3 (v1.0 complete)
**Requirements**: STRUCT-01, STRUCT-02, STRUCT-03, STRUCT-04, STRUCT-05
**Success Criteria** (what must be TRUE):
  1. All route handlers exist in `/routes` directory with consistent naming
  2. All utility functions exist in `/utils` directory grouped by concern
  3. All test files exist in `/tests` directory mirroring application structure
  4. Static demo files exist in `/demos` directory separate from application code
  5. All import statements reference new structure and application runs without import errors
**Plans**: 4 plans in 3 waves

Plans:
- [x] 04-01-PLAN.md — Consolidate demo HTML files into /demos directory
- [x] 04-02-PLAN.md — Update route handlers to serve from /demos
- [x] 04-03-PLAN.md — Move api_routes.py to routes/registry.py
- [x] 04-04-PLAN.md — Verify all 29 tests pass

#### Phase 5: Code Cleanup
**Goal**: Duplicate files removed, dead code eliminated, TODOs resolved or tracked
**Depends on**: Phase 4
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04
**Success Criteria** (what must be TRUE):
  1. No duplicate API files exist (encrypt_api_new.py removed)
  2. Legacy test file EncTestNewTestF.py either refactored or removed with PDF logic preserved elsewhere
  3. All unused imports and dead code paths removed from codebase
  4. All TODO comments either resolved or converted to tracked issues with references
**Plans**: 3 plans in 2 waves

Plans:
- [x] 05-01-PLAN.md — Remove unused imports and update legacy file references
- [x] 05-02-PLAN.md — Update planning documentation to reflect cleanup
- [x] 05-03-PLAN.md — Verify all tests pass after cleanup

#### Phase 6: HTML Encryption Modernization
**Goal**: HTML encryption aligned with SDK approach (exclude_space=True, no span wrapping)
**Depends on**: Phase 5
**Requirements**: HTML-01, HTML-02, HTML-03, HTML-04
**Success Criteria** (what must be TRUE):
  1. HTML encryption uses exclude_space=True pattern matching SDK behavior
  2. HTML encryption no longer adds span wrapping around encrypted text
  3. Browser whitespace handling preserved in HTML-encrypted output
  4. All existing HTML encryption tests updated and passing with new approach
**Plans**: TBD

Plans:
- [ ] TBD

#### Phase 7: Code Quality Validation
**Goal**: Codebase follows DRY principles with consistent patterns and all tests passing
**Depends on**: Phase 6
**Requirements**: QUAL-01, QUAL-02, QUAL-03, QUAL-04
**Success Criteria** (what must be TRUE):
  1. No duplicate code blocks identified in codebase (DRY principle applied)
  2. Consistent naming conventions applied across all modules and functions
  3. Every module has clear single responsibility with focused purpose
  4. All 29 automated tests still passing after all refactoring changes
**Plans**: TBD

Plans:
- [ ] TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 4 -> 5 -> 6 -> 7

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Initial Setup | v1.0 | - | Complete | 2026-01-24 |
| 2. Architecture Documentation | v1.0 | 3/3 | Complete | 2026-01-24 |
| 3. Automated Testing | v1.0 | 3/3 | Complete | 2026-01-24 |
| 4. Directory Structure | v1.1 | 4/4 | Complete | 2026-01-24 |
| 5. Code Cleanup | v1.1 | 3/3 | Complete | 2026-01-24 |
| 6. HTML Encryption Modernization | v1.1 | 0/TBD | Not started | - |
| 7. Code Quality Validation | v1.1 | 0/TBD | Not started | - |
