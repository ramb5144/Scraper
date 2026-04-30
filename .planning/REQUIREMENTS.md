# Requirements: Cloak v1.1

**Defined:** 2026-01-24
**Core Value:** Encrypted text renders correctly for humans while being unreadable to scrapers
**Milestone:** v1.1 Codebase Cleanup & Organization

## v1.1 Requirements

Requirements for codebase cleanup milestone. Focus on technical debt elimination and structural organization.

### Code Cleanup

- [x] **CLEAN-01**: Remove duplicate encrypt_api_new.py file (file already removed, documentation references cleaned in Phase 5)
- [x] **CLEAN-02**: Remove or refactor EncTestNewTestF.py (logic extracted to utils/pdf_encryption.py, references cleaned in Phase 5)
- [x] **CLEAN-03**: All dead code and unused imports removed from codebase (Phase 5 Plan 1)
- [x] **CLEAN-04**: All TODO comments either resolved or converted to tracked issues (no TODOs found in codebase)

### HTML Encryption Modernization

- [ ] **HTML-01**: HTML encryption uses `exclude_space=True` pattern (matching SDK)
- [ ] **HTML-02**: HTML encryption removes span wrapping approach
- [ ] **HTML-03**: HTML encryption preserves browser whitespace handling
- [ ] **HTML-04**: Existing HTML encryption tests updated and passing

### Directory Structure

- [ ] **STRUCT-01**: All route handlers organized in `routes/` directory
- [ ] **STRUCT-02**: All utility functions organized in `utils/` directory
- [ ] **STRUCT-03**: All test files organized in `tests/` directory
- [ ] **STRUCT-04**: Static demo files organized in `demos/` directory
- [ ] **STRUCT-05**: Import paths updated to reflect new structure

### Code Quality

- [ ] **QUAL-01**: No duplicate code blocks (DRY principle applied)
- [ ] **QUAL-02**: Consistent naming conventions across codebase
- [ ] **QUAL-03**: All modules have clear single responsibility
- [ ] **QUAL-04**: Automated tests still passing after refactoring (29/29 tests)

## Future Requirements

Deferred to v1.2 or later.

### Performance

- **PERF-01**: Font caching optimization for faster page loads
- **PERF-02**: Batch encryption API for multiple text blocks
- **PERF-03**: CDN integration for font delivery

### Features

- **FEAT-01**: Support for additional font formats (EOT, SVG)
- **FEAT-02**: Custom exclusion rules per domain
- **FEAT-03**: Analytics dashboard for usage tracking

## Out of Scope

Explicitly excluded from v1.1.

| Feature | Reason |
|---------|--------|
| New encryption features | v1.1 focuses on cleanup, not new capabilities |
| Performance optimization | Address after structure is clean |
| UI/UX improvements | Backend cleanup milestone |
| Multi-language support | Not identified as current need |

## Traceability

Mapping requirements to phases. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| STRUCT-01 | Phase 4 | Complete |
| STRUCT-02 | Phase 4 | Complete |
| STRUCT-03 | Phase 4 | Complete |
| STRUCT-04 | Phase 4 | Complete |
| STRUCT-05 | Phase 4 | Complete |
| CLEAN-01 | Phase 5 | Complete |
| CLEAN-02 | Phase 5 | Complete |
| CLEAN-03 | Phase 5 | Complete |
| CLEAN-04 | Phase 5 | Complete |
| HTML-01 | Phase 6 | Pending |
| HTML-02 | Phase 6 | Pending |
| HTML-03 | Phase 6 | Pending |
| HTML-04 | Phase 6 | Pending |
| QUAL-01 | Phase 7 | Pending |
| QUAL-02 | Phase 7 | Pending |
| QUAL-03 | Phase 7 | Pending |
| QUAL-04 | Phase 7 | Pending |

**Coverage:**
- v1.1 requirements: 17 total
- Mapped to phases: 17/17 ✓
- Unmapped: 0 ✓

**Phase Distribution:**
- Phase 4 (Directory Structure): 5 requirements
- Phase 5 (Code Cleanup): 4 requirements
- Phase 6 (HTML Encryption Modernization): 4 requirements
- Phase 7 (Code Quality Validation): 4 requirements

---
*Requirements defined: 2026-01-24*
*Last updated: 2026-01-24 after roadmap creation*
