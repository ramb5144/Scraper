# External Integrations

**Analysis Date:** 2026-01-21

## APIs & External Services

**Content Rendering:**
- Playwright (optional) - Headless browser automation for URL-to-HTML conversion
  - SDK/Client: `playwright` (async_api)
  - Usage: `routes_url.py` for encrypting live web URLs

**HTTP Requests:**
- requests library - General-purpose HTTP client for fetching external content
  - SDK/Client: `requests`
  - Usage: Font downloads, external content fetching in multiple route handlers

## Data Storage

**Databases:**

**Production Database:**
- Supabase (PostgreSQL)
  - Connection: `DATABASE_URL` environment variable (postgresql:// format)
  - Client: SQLAlchemy ORM with psycopg2-binary adapter
  - Location: `database.py` for model definitions and session management
  - Models: User, APIKey, Website, Encryption metadata (SQLAlchemy declarative models)

**Development Database:**
- SQLite
  - Connection: Auto-created at `cloak.db` if `DATABASE_URL` not set
  - Client: SQLAlchemy ORM
  - Fallback when DATABASE_URL is not configured

**File Storage:**
- Cloudflare R2 (S3-compatible object storage)
  - Service: R2 managed by Cloudflare
  - Connection: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
  - Client: boto3 (AWS S3 API v3 format)
  - Location: `r2_website_storage.py` for all R2 operations
  - Stored data:
    - Encrypted fonts: `storage/{storage_id}/fonts/decryption_{font_hash}.woff2`
    - Cached HTML: `storage/{storage_id}/html_cache/{html_hash}.html`
    - Metadata: `storage/{storage_id}/metadata.json`
    - SDK API keys: `sdk/api_keys/{api_key}.json`
  - Fallback: Local `/fonts/` endpoint if `USE_R2_FONTS=false`

**Caching:**
- In-memory caching in Python
  - Plaintext index cache: `_plaintext_cache` (1 hour TTL)
  - Hash data cache: `_hash_data_cache` (1 hour TTL)
  - Location: `routes_encryption.py`

## Authentication & Identity

**Auth Provider:**
- Custom API Key system (no external provider)
  - Implementation: Environment variable based (`ADMIN_SECRET`)
  - Storage: R2 under `sdk/api_keys/{api_key}.json` or in-memory cache
  - Key formats:
    - Legacy: `cloak_live_{32 hex chars}` or `cloak_test_{32 hex chars}`
    - SDK: `ck_{48 hex chars}`
  - Validation: `@validate_api_key()` decorator in middleware.py

**Domain Validation:**
- Domain-to-API-key binding in `API_KEYS` metadata
  - Stored with each API key
  - Validated per request via `check_domain=True` decorator parameter

## Monitoring & Observability

**Error Tracking:**
- Sentry
  - SDK: sentry-sdk[flask] 1.39.1
  - Configuration: `SENTRY_DSN` environment variable
  - Integration: FlaskIntegration with 10% transaction sampling
  - Optional: Disabled if `SENTRY_DSN` not set
  - Location: `encrypt_api.py` lines 20-34

**Logs:**
- File-based logging (local development)
  - File: `app.log` (truncated on each server restart)
  - Format: Timestamp, logger name, level, message
  - Output: Both file and console (via TeeOutput class)
  - Location: `encrypt_api.py`

## CI/CD & Deployment

**Hosting:**
- Heroku
  - Procfile: `web: gunicorn encrypt_api:app --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 120`

**CI Pipeline:**
- Not detected (no GitHub Actions, GitLab CI, or similar configuration)

## Environment Configuration

**Required env vars:**
- Production database connection:
  - `DATABASE_URL` - Supabase PostgreSQL URI (production only, optional for local dev)
- Cloudflare R2 credentials (required):
  - `R2_ACCOUNT_ID`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_BUCKET_NAME`
  - `R2_PUBLIC_URL`
- Security:
  - `SECRET_KEY` - Encryption nonce secret (numeric, default: 99887766)
  - `ADMIN_SECRET` - Admin API secret (default: dT3R3RS$gSSQhhK5AiqG)
- Monitoring:
  - `SENTRY_DSN` - Sentry error tracking (optional)
  - `ENVIRONMENT` - Environment name (production/development)
- Server:
  - `PORT` - Server port (default: 8001)
  - `HOST` - Server host (default: 0.0.0.0)
  - `DEBUG` - Debug mode (default: false)

**Secrets location:**
- `.env` file (local) - Contains all production credentials
- Environment variables on Heroku platform

## Webhooks & Callbacks

**Incoming:**
- Not detected - No webhook endpoints configured

**Outgoing:**
- Not detected - No outgoing webhook calls to external services

---

*Integration audit: 2026-01-21*
