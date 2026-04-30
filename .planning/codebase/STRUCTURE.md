# Codebase Structure

**Analysis Date:** 2026-01-21

## Directory Layout

```
project-root/
├── client/                    # JavaScript SDK and utilities
│   ├── cloak-sdk.js          # Main client-side SDK
│   ├── encrypt-page.js       # Page encryption helper
│   └── decrypt-interceptor.js # Decryption interceptor
├── templates/                # Flask HTML templates
│   └── pdf_test.html         # PDF test page
├── fonts/                    # Font files (generated and extracted)
│   ├── downloaded/           # Downloaded font files
│   └── extracted/            # Extracted font files for processing
├── .planning/                # GSD planning documents (generated)
│   └── codebase/            # Codebase analysis documents
├── .env                      # Environment variables (secrets, R2 creds)
├── .gitignore               # Git ignore rules
├── .venv/                   # Python virtual environment
├── venv/                    # Secondary Python environment
├── __pycache__/             # Python bytecode cache
├── api_routes.py            # Route registration hub
├── encrypt_api.py           # PRIMARY SERVER ENTRY POINT
├── encryption.py            # Core encryption algorithm (Feistel)
├── database.py              # SQLAlchemy ORM and models
├── middleware.py            # Security middleware (rate limiting, validation)
├── r2_website_storage.py    # Cloudflare R2 storage interface
├── generate_font.py         # Font generation algorithm
├── font_utils.py            # Font utilities and R2 upload
├── html_encryption.py       # HTML DOM encryption
├── playwright_renderer.py   # URL screenshot rendering
├── Fiesty.py                # Feistel cipher implementation
├── routes_encryption.py     # Encryption endpoints
├── routes_html.py           # HTML encryption endpoints
├── routes_pdf.py            # PDF encryption endpoints
├── routes_sdk.py            # SDK initialization endpoints
├── routes_dashboard.py      # User dashboard UI and API
├── routes_debug.py          # Debug/diagnostic endpoints
├── routes_static.py         # Landing page and static routes
├── routes_url.py            # URL rendering endpoints
├── routes_common.py         # Shared constants
├── test_*.py                # Integration tests
├── cloak.db                 # SQLite database (local dev)
├── api.log                  # Application log file
└── (Various utility scripts)
    ├── generate_vipx_pdfs.py
    ├── check_plaintext.py
    ├── clear_r2_cache.py
    └── (Other one-off utilities)
```

## Directory Purposes

**client/:**
- Purpose: Client-side JavaScript for website integration
- Contains: SDK initialization, DOM encryption, font loading, search interception
- Key files: `cloak-sdk.js` (main), `encrypt-page.js` (page wrapper), `decrypt-interceptor.js` (search)

**templates/:**
- Purpose: Flask HTML templates for test/demo pages
- Contains: HTML test pages for PDF, HTML, and general testing
- Key files: `pdf_test.html`

**fonts/:**
- Purpose: Local font file storage and processing
- Contains: Downloaded system fonts, extracted glyph tables for manipulation
- Generated: Yes (during font generation process)
- Committed: No (fonts are generated or downloaded at runtime)

**.planning/codebase/:**
- Purpose: GSD codebase analysis documents
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md
- Generated: Yes (created by GSD mapper)
- Committed: Yes (tracked in git)

## Key File Locations

**Entry Points:**
- `encrypt_api.py`: Primary Flask server (listen on port 8001)
- `client/cloak-sdk.js`: Client SDK (loaded via `<script>` tag on news websites)

**Configuration:**
- `.env`: Environment variables (DATABASE_URL, CLOUDFLARE_R2_*, SENTRY_DSN, etc.)
- `routes_common.py`: Shared constants (SECRET_KEY, feature flags)

**Core Logic:**
- `encryption.py`: Text encryption using Feistel cipher
- `generate_font.py`: Custom font generation with remapped glyphs
- `Fiesty.py`: Feistel cipher primitive (enc54 function)

**Storage:**
- `r2_website_storage.py`: Cloudflare R2 integration
- `database.py`: SQLAlchemy models and session management

**HTTP Routes (organized by domain):**
- `routes_encryption.py`: `/api/encrypt*`, `/api/decrypt`, `/api/search/*`, `/api/get-nonce-sk`
- `routes_html.py`: `/api/encrypt/html`
- `routes_pdf.py`: `/api/encrypt/pdf`
- `routes_sdk.py`: `/api/sdk/*` endpoints for SDK initialization and font retrieval
- `routes_dashboard.py`: `/dashboard/*`, `/api/dashboard/*`, `/api/auth/*` (user accounts, keys, usage)
- `routes_debug.py`: `/api/debug/*`, `/api/test`, `/api/health` (diagnostic endpoints)
- `routes_static.py`: `/` (landing page), static content serving
- `routes_url.py`: `/api/encrypt/url` (URL screenshot rendering via Playwright)

**Middleware & Security:**
- `middleware.py`: Rate limiting, input validation, API key auth, request logging

**HTML/Content Processing:**
- `html_encryption.py`: BeautifulSoup-based HTML DOM traversal and encryption
- `playwright_renderer.py`: Playwright-based URL screenshot rendering

**Testing:**
- `test_font_pipeline.py`: Font generation and glyph mapping tests
- `test_url_encryption.py`: URL rendering tests
- `test_css_cascade.py`: CSS handling tests
- `test_*.py`: Various integration tests

## Naming Conventions

**Files:**
- `routes_*.py`: HTTP route handlers organized by feature area
- `test_*.py`: Integration tests corresponding to feature area
- `encrypt_api*.py`: Flask server variants (primary: encrypt_api.py)
- `serve_*.py`: Standalone demo servers with pre-loaded content
- `generate_*.py`: Utility scripts that generate artifacts (fonts, PDFs)
- `check_*.py`, `debug_*.py`: One-off diagnostic scripts

**Directories:**
- `fonts/downloaded/`: Downloaded system fonts (e.g., from Google Fonts)
- `fonts/extracted/`: Fonts extracted for manipulation
- `__pycache__/`: Python bytecode (auto-generated)
- `.venv/`, `venv/`: Python virtual environments

**Functions:**
- Camel case for class methods and regular functions
- Snake case for module-level functions
- Decorators prefixed with `@` (e.g., `@rate_limit`, `@validate_api_key`)

**Classes:**
- Pascal case for all class names (e.g., `RateLimiter`, `TeeOutput`)

## Where to Add New Code

**New Text Encryption Feature:**
- Algorithm core: `encryption.py` (add function, follow existing pattern: `encrypt_article_text()`)
- Font generation update: `generate_font.py` (update glyph mapping logic)
- Route handler: `routes_encryption.py` (add endpoint, register in `register_encryption_routes()`)
- Tests: `test_*.py` (create new test file or add to existing)

**New HTML/Content Processing:**
- HTML parsing: `html_encryption.py` (add function following BeautifulSoup patterns)
- Route handler: `routes_html.py` (add endpoint to `register_html_routes()`)
- Tests: `test_css_cascade.py` or new `test_content_*.py`

**New API Endpoint:**
- Create route handler in appropriate `routes_*.py` file
- Use existing middleware decorators (@rate_limit, @validate_api_key, @log_request)
- Register in `api_routes.py` via `register_*_routes(app)` function
- Add tests in `test_*.py` file

**New SDK Feature:**
- Client: `client/cloak-sdk.js` (update SDK_VERSION, add feature logic)
- Server: `routes_sdk.py` (add endpoint if needed)
- Tests: `test_*.py` (test client-server interaction)

**New Database Model:**
- Define in `database.py` (extend Base via SQLAlchemy declarative)
- Create migration if needed (currently using create_all)
- Update `database.py` exports

**New Utility Script:**
- Create as `script_name.py` in root directory
- Include docstring explaining purpose
- Add command-line argument parsing if needed
- Test independently before deployment

## Special Directories

**__pycache__/:**
- Purpose: Python bytecode cache for faster imports
- Generated: Yes (automatically by Python)
- Committed: No (.gitignore excludes)

**.venv/, venv/:**
- Purpose: Python virtual environments with dependencies
- Generated: Yes (`python -m venv .venv`)
- Committed: No (.gitignore excludes)

**.git/:**
- Purpose: Git version control
- Generated: Yes (git init)
- Committed: Yes (history)

**.env:**
- Purpose: Environment variables (secrets, credentials)
- Generated: No (manually created from .env template)
- Committed: No (.gitignore excludes)

**.planning/codebase/:**
- Purpose: GSD codebase analysis
- Generated: Yes (by GSD mapper)
- Committed: Yes (tracked for reference)

## File Organization Patterns

**Route Handlers:**
Each `routes_*.py` file follows this pattern:
```python
def register_*_routes(app):
    @app.route('/api/...', methods=['GET', 'POST'])
    @rate_limit('default')
    @validate_api_key
    def handler_name():
        # Implementation
        return jsonify({...})
```

**Encryption Workflow:**
1. Input text → `encryption.py` functions (e.g., `encrypt_article_text()`)
2. Character mappings → `generate_font.py` to create font
3. Font to R2 → `r2_website_storage.py` upload
4. Response → `routes_*.py` format and return

**Database Access:**
1. Import `SessionLocal` from `database.py`
2. Create session: `session = SessionLocal()`
3. Query: `session.query(Model).filter(...).first()`
4. Commit: `session.commit()`
5. Always: `session.close()`

**API Key Validation:**
1. Use `@validate_api_key` decorator on route
2. Access via `request.api_key` or `g.api_key` in handler
3. Decorator handles 401 responses automatically

---

*Structure analysis: 2026-01-21*
