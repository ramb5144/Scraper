# Cloak

## What This Is

Text encryption system that protects website content from scrapers using font-based decryption. Text is encrypted via Feistel cipher character remapping, and a custom font with swapped glyphs renders the encrypted text as readable to humans while bots see gibberish.

## Core Value

Encrypted text renders correctly for humans viewing the page while being unreadable to automated scrapers that don't execute JavaScript or load custom fonts.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ **ENC-01**: Feistel cipher character remapping with nonce/secret_key
- ✓ **ENC-02**: Custom font generation with swapped glyphs (WOFF2)
- ✓ **ENC-03**: SDK mode with `exclude_space=True` for client-side encryption
- ✓ **ENC-04**: Server-side HTML encryption via `/api/encrypt/html`
- ✓ **ENC-05**: URL-based encryption via Playwright rendering
- ✓ **ENC-06**: PDF encryption with preserved formatting
- ✓ **ENC-07**: Copy/paste interception returning plaintext
- ✓ **ENC-08**: Ctrl+F search on encrypted content
- ✓ **ENC-09**: R2 storage for fonts, metadata, and cached HTML
- ✓ **ENC-10**: API key management and usage tracking

### Active

<!-- Current scope. Building toward these. -->

**Milestone v1.1: Codebase Cleanup & Organization**

**Goal:** Eliminate technical debt and establish clear codebase structure for long-term maintainability.

**Target areas:**
- Remove duplicate and legacy files
- Modernize HTML encryption to match SDK approach
- Organize code into clear directory structure
- Consolidate mixed-concern modules

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Canvas/WebGL text encryption — fundamentally different rendering model
- Video subtitle encryption — separate domain, defer

## Current State

**Shipped:** v1.0 Core System Stabilization (2026-01-24)

**System Health:**
- 29 automated tests passing (encryption, copy/paste, visual regression, dynamic content)
- Complete architecture documentation (16 files in `.planning/docs/`)
- All E2E flows verified: encryption → copy/paste → search working end-to-end
- SDK encryption and decrypt-interceptor algorithms verified consistent
- Zero known critical bugs

**Technical Stats:**
- Test coverage: 29 passing Playwright tests with Page Object Model
- Documentation: 16 architecture files with Mermaid diagrams, comparison tables, troubleshooting guides
- Code: Python Flask backend, JavaScript SDK, TypeScript tests
- Infrastructure: Playwright + Flask webServer, trace viewer for debugging

**Known Technical Debt:**
- html_encryption.py (132KB) uses old span-wrapping approach (isolated from SDK mode) → Phase 6
- ~~encrypt_api_new.py is duplicate of encrypt_api.py~~ → Resolved (file removed, references cleaned in Phase 5)
- ~~EncTestNewTestF.py (62KB) mixes PDF logic with legacy code~~ → Resolved (logic extracted to utils/pdf_encryption.py, references cleaned in Phase 5)
- ~~No clear directory structure for routes/utils/tests~~ → Resolved in Phase 4

**Next Milestone Focus:** Codebase cleanup and organization

## Context

**Codebase architecture:**
- Two encryption approaches exist: SDK mode (newer, cleaner) and HTML encryption (older, problematic)
- SDK uses `exclude_space=True` — spaces not encrypted, no structural HTML changes
- HTML encryption uses `exclude_space=False` — encrypts spaces, adds span wrapping that breaks layouts
- Core system stable and verified as of v1.0

**Codebase documentation:** See `.planning/codebase/` for detailed analysis and `.planning/milestones/v1.0-ROADMAP.md` for shipped work.

## Constraints

- **Compatibility**: Must maintain existing API contracts for deployed clients
- **R2 Storage**: Font and metadata storage uses Cloudflare R2
- **Font Format**: WOFF2 required for browser compatibility

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SDK uses `exclude_space=True` | Preserves browser whitespace handling, no structural HTML changes | ✓ Good |
| HTML encryption uses span wrapping | Attempted to prevent word breaks in encrypted text | ⚠️ Revisit — causes layout breakage |
| Single font for all weights/styles | Simplifies generation | — Pending evaluation |
| Use Mermaid diagrams for architecture docs — v1.0 | Version control and GitHub rendering | ✓ Good |
| Document actual behavior with file:line refs — v1.0 | Makes debugging systematic not trial-and-error | ✓ Good |
| Clipboard clearData() before setData() — v1.0 | Prevents browser's default copy running alongside handler | ✓ Good |
| Chromium-only testing initially — v1.0 | Faster CI, add other browsers later if needed | ✓ Good |
| trace: on-first-retry — v1.0 | Autonomous debugging without always-on overhead | ✓ Good |

---
*Last updated: 2026-01-24 after v1.1 milestone started*

## Critical Architecture Principles

### Encryption Philosophy
**NEVER use exclusion lists as a solution to rendering issues.**

The Cloak SDK must encrypt ALL visible text content with NO exceptions. The architecture relies on:
1. SDK encrypts all text (character substitution)
2. Encrypted fonts make encrypted text render as plaintext
3. Decrypt-interceptor handles copy/paste and search

**Why exclusion lists are wrong:**
- Defeats the purpose of encryption (scrapers can read excluded content)
- Bandaid solution that doesn't address root cause
- Creates maintenance burden and special cases

**The correct solution for rendering issues:**
- Ensure encrypted fonts are applied correctly
- For specialized content (code blocks, math), create appropriate encrypted font variants
- Remove `!important` CSS that overrides encrypted fonts
- Fix font-family inheritance issues

**Current minimal exclusions (technical only):**
- `script`, `style`, `noscript` - not visible text
- `meta`, `link`, `head` - metadata only

Never add visible elements (code, pre, buttons, inputs, etc.) to exclusions.
