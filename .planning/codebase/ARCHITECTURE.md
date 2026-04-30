# Architecture

**Analysis Date:** 2026-01-21

## Pattern Overview

**Overall:** Layered Flask API with specialized encryption engine and client SDK integration

**Key Characteristics:**
- Modular route-based architecture (separation by concern: encryption, HTML, PDF, SDK, dashboard)
- Asymmetric encryption approach using Feistel cipher for character remapping
- Dual-layer storage: in-memory caching + cloud (R2/Cloudflare) for fonts and metadata
- Client-side decryption via custom font glyph remapping (not traditional key-based decryption)
- Database abstraction for user/key management (optional PostgreSQL or SQLite fallback)

## Layers

**API Layer (Flask Routes):**
- Purpose: HTTP endpoint handlers for encryption, decryption, file processing, dashboard management
- Location: `routes_*.py` files (routes_encryption.py, routes_html.py, routes_pdf.py, routes_sdk.py, routes_dashboard.py, routes_static.py, routes_debug.py, routes_url.py)
- Contains: HTTP handlers decorated with `@app.route`, request validation, response formatting
- Depends on: Encryption module, R2 storage, database, middleware
- Used by: HTTP clients (SDK, web browsers, API consumers)

**Encryption Engine (Core Algorithms):**
- Purpose: Feistel cipher-based text encryption, dynamic character mapping, font generation
- Location: `encryption.py`, `generate_font.py`, `Fiesty.py` (Feistel implementation)
- Contains: Character remapping logic, nonce generation, ligature expansion, search indexing
- Depends on: Font generation libraries (fontTools)
- Used by: Route handlers, SDK initialization

**Font Generation & Management:**
- Purpose: Create custom fonts with remapped glyphs for client-side decryption
- Location: `generate_font.py`, `font_utils.py`
- Contains: TrueType/OTF font manipulation, glyph remapping, kerning table updates, R2 upload
- Depends on: fontTools library, R2 storage
- Used by: Encryption routes, SDK initialization

**Storage Layer:**
- Purpose: Persistent storage of fonts, metadata, plaintext indexes, nonce/key mappings
- Location: `r2_website_storage.py`
- Contains: R2/S3 client initialization, file upload/download, storage ID generation, caching logic
- Depends on: boto3 (AWS S3 SDK), Cloudflare R2 credentials
- Used by: Encryption routes, font generation, SDK routes

**Database Layer:**
- Purpose: User accounts, API keys, usage tracking, authentication
- Location: `database.py`
- Contains: SQLAlchemy ORM models (User, APIKey, Session), session management, password hashing
- Depends on: SQLAlchemy, PostgreSQL/SQLite, werkzeug.security
- Used by: Dashboard routes, SDK admin endpoints, authentication middleware

**Middleware & Security:**
- Purpose: Rate limiting, input validation, API key authentication, request logging
- Location: `middleware.py`
- Contains: RateLimiter class, decorators for validation (@rate_limit, @validate_api_key, @validate_hash)
- Depends on: Flask context, threading (for in-memory rate limiting)
- Used by: All route handlers for security enforcement

**HTML/Content Processing:**
- Purpose: HTML DOM traversal, metadata extraction, selective text encryption
- Location: `html_encryption.py`, `playwright_renderer.py`
- Contains: BeautifulSoup parsing, CSS/meta encryption, DOM manipulation, URL rendering
- Depends on: BeautifulSoup, Playwright, lxml
- Used by: HTML encryption routes, static content serving

## Data Flow

**Client-to-Server Text Encryption:**

1. Client calls `/api/get-nonce-sk` with plaintext hash
2. Server returns nonce and secret key (or generates if new)
3. Client calls `/api/encrypt` with plaintext
4. Server applies Feistel cipher mapping to encrypt characters
5. Server generates custom font with remapped glyphs
6. Server returns encrypted text, nonce, secret_key hash, and font URL
7. Client stores encrypted text in DOM, loads font via CSS
8. Font's glyph remapping decrypts characters when rendered

**SDK Flow (Dynamic Content Encryption):**

1. SDK initializes via `/api/sdk/init` with API key and domain
2. Server generates session ID, nonce, secret key
3. Server creates decryption font and uploads to R2
4. Client receives font URL and encryption parameters
5. Client intercepts page text mutations via MutationObserver
6. Client encrypts new text using shared nonce/key
7. Client requests plaintext index via `/api/search/prefetch`
8. Client updates font on server via SDK routes

**Search & Copy-Paste:**

1. User selects text or searches
2. Client calls `/api/search/get-text-range` with character range
3. Server returns plaintext for range (rate limited)
4. Client returns plaintext to browser (enabling copy, find-in-page)
5. Client batches plaintext index updates to server

**Font Generation & Caching:**

1. Server calculates storage_id = hash(nonce + secret_key)
2. Server checks R2 for existing font (checks algorithm version)
3. If not found: generates font, caches glyph mappings, uploads to R2
4. If found: returns cached font URL
5. Font served via CloudFront CDN for low latency

## Key Abstractions

**Storage ID:**
- Purpose: Unique identifier for a plaintext/font/metadata set
- Examples: Used in `r2_website_storage.py` as R2 path prefix
- Pattern: `storage_id = hashlib.sha256((str(nonce) + str(secret_key)).encode()).hexdigest()[:16]`
- Used to organize R2 objects: `{storage_id}/metadata.json`, `{storage_id}/fonts/`, `{storage_id}/html_cache/`

**Character Mapping:**
- Purpose: Represents the encryption/decryption transformation for a single character set
- Examples: `upper_map`, `lower_map`, `space_map` in `encryption.py`
- Pattern: `{original_char: encrypted_char}` dictionaries, generated via Feistel cipher
- Used in both text encryption and font glyph remapping

**Session (SDK Context):**
- Purpose: Tracks encryption state for a website/domain using the SDK
- Examples: In `routes_sdk.py`, SESSIONS dict stores: `{session_id: {api_key, domain, nonce, secret_key, char_count}}`
- Pattern: Session ID generated on `/api/sdk/init`, persisted for incremental font updates
- Used to enable dynamic content encryption without regenerating entire font

**API Key & Authentication:**
- Purpose: Identify SDK users and track usage
- Examples: `APIKey` model in `database.py`
- Pattern: Two formats supported: `cloak_live_*` / `cloak_test_*` (legacy) or `ck_*` (SDK format)
- Used by middleware to validate requests, track usage, enforce rate limits

## Entry Points

**Primary Server:**
- Location: `encrypt_api.py`
- Triggers: `python encrypt_api.py` or `gunicorn encrypt_api:app`
- Responsibilities: Flask app initialization, CORS setup, route registration, logging setup, Sentry error tracking

**Alternative Servers:**
- `encrypt_api_new.py`: Development/testing variant
- `serve_encrypted_nyt.py`, `serve_encrypted_nyt2.py`: Demo servers with pre-loaded content
- `serve_plain.py`: Development server serving plaintext (no encryption)

**Client Entry Point:**
- Location: `client/cloak-sdk.js`
- Triggers: Embedded as `<script src="/sdk.js" data-api-key="..."></script>` on news websites
- Responsibilities: DOM traversal, text node interception, encryption/decryption, font loading

**Utilities (One-off):**
- `generate_font.py`: Standalone font generation (also imported by routes)
- `generate_vipx_pdfs.py`: PDF encryption utility script
- `test_*.py` files: Unit/integration tests

## Error Handling

**Strategy:** Graceful degradation with detailed logging

**Patterns:**
- Middleware catches and logs all exceptions via `@app.errorhandler(Exception)`
- Encryption failures return 400 with error details
- Database failures degrade gracefully (fall back to SQLite or in-memory storage)
- Missing R2 credentials disable cloud storage but allow local operation
- Missing Playwright disables URL rendering routes
- Sentry integration (if configured) tracks production errors

## Cross-Cutting Concerns

**Logging:** Dual output to file (`app.log`) and console via TeeOutput class in `encrypt_api.py`. Each route logs via standard logging module.

**Validation:** Centralized in `middleware.py` - hash pattern validation, API key format checking, text range limits (max 5000 chars), input sanitization.

**Authentication:** Session-based (dashboard) + API key-based (SDK). Dashboard uses encrypted cookies. SDK validates `X-API-Key` header or query parameter.

**Rate Limiting:** In-memory sliding window implementation in `middleware.py`. Configured per endpoint (e.g., 20 encrypts/min, 30 searches/min). Uses thread-safe RateLimiter class.

**Caching:** Three-tier caching strategy:
- In-memory: plaintext index, hash data, API keys (1-hour TTL in `routes_encryption.py`)
- R2 cloud: fonts, HTML cache, metadata
- Client-side: decryption font as browser cache (via CDN headers)

---

*Architecture analysis: 2026-01-21*
