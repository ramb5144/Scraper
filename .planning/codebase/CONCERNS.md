# Codebase Concerns

**Analysis Date:** 2026-01-21

## Tech Debt

**Environment Variables and Secrets Exposed in Repository:**
- Issue: Critical credentials committed to git repository in `.env` file
- Files: `/.env` contains actual Cloudflare R2 credentials, Supabase database URL, Sentry DSN, and admin secrets
- Impact: Complete compromise of production infrastructure, unauthorized access to all encrypted data storage, database compromise
- Fix approach: Immediately revoke all exposed credentials, implement `.env` in `.gitignore`, use environment-only secrets management, add pre-commit hooks to prevent credential leaks. Consider secrets rotation service.

**Bare Exception Handlers:**
- Issue: Multiple bare `except:` clauses that catch all exceptions including system exits
- Files: `middleware.py:493`, `routes_encryption.py` (multiple locations), `r2_website_storage.py:222,228`
- Impact: Silent failures mask critical errors, makes debugging difficult, can hide security issues
- Fix approach: Replace all bare `except:` with specific exception types. For logging code in `middleware.py:493`, catch `(KeyError, TypeError, AttributeError)` specifically.

**In-Memory Rate Limiting in Production:**
- Issue: Rate limiter uses in-memory dictionary instead of Redis, not suitable for distributed deployments
- Files: `middleware.py:43-92` (RateLimiter class)
- Impact: Rate limits don't work across multiple processes/servers, cleanup runs per-process, high memory usage for long-running servers
- Fix approach: Replace with Redis-based rate limiter, implement connection pooling, add fallback to in-memory for development

**Generic Exception Catching with JSON Response:**
- Issue: Most API endpoints catch broad `Exception` and return it to client with traceback
- Files: `routes_encryption.py:123,240,353,388,482,627,718,832,1072,1216`; `routes_url.py:122,289`; `routes_html.py` and others
- Impact: Leaks internal error details to attackers, reveals code paths and file structure
- Fix approach: Create custom exception handler, log full traceback server-side, return generic client messages, include error ID for logging correlation

**Hardcoded Default Secret Key:**
- Issue: Encryption uses hardcoded default `SECRET_KEY = 99887766` in `routes_common.py` when env var not set
- Files: `routes_common.py:8` defaults to `'99887766'`, used in `routes_encryption.py:189,323,795,914,1284` and other routes
- Impact: If `SECRET_KEY` env var not set, all encryptions use same weak key, reduces security to just the nonce
- Fix approach: Make SECRET_KEY mandatory (fail at startup if not provided), generate strong random default if needed, validate key strength

**Missing Input Validation on Query Parameters:**
- Issue: URL query parameters accepted without validation or type checking
- Files: `routes_static.py:891,905,1180` (request.args.get), `routes_dashboard.py:256` (type conversion but no bounds)
- Impact: Potential for injection attacks, integer overflow, malformed URLs passed to underlying systems
- Fix approach: Add request validation decorator, validate parameter types and bounds, use whitelist for allowed values

## Known Bugs

**R2 Storage Not Required But Fails Silently:**
- Symptoms: PDF and URL encryption work without R2 configured, but fonts may not be retrievable later
- Files: `routes_pdf.py:67,201` (bare except pass), `r2_website_storage.py:47-68` (get_r2_client)
- Trigger: Run without R2 credentials set, then try to serve encrypted content
- Workaround: Ensure R2 is always configured in production; fallback to local filesystem in dev

**Database Optional But No Clear Fallback:**
- Symptoms: Dashboard features "disabled" when database unavailable, but no consistent degradation messaging
- Files: `database.py:75` (DATABASE_AVAILABLE flag), `routes_dashboard.py` assumes DATABASE_AVAILABLE
- Trigger: Deploy with invalid DATABASE_URL, dashboard attempts operations anyway
- Workaround: Implement complete fallback mode or mandatory database requirement, don't make it "optional"

**Cache Invalidation Timing Window:**
- Symptoms: If R2 cache is written just before a new plaintext upload, old encrypted version may be served
- Files: `routes_encryption.py:37-75` (cache with 1-hour TTL), `routes_url.py:260-268` (store_encrypted_html)
- Trigger: Upload new plaintext, then immediately request encryption before cache expires
- Workaround: Invalidate cache on plaintext upload, implement version-based cache keys

## Security Considerations

**API Key Hash Validation Missing Domain Checks:**
- Risk: API keys can be used from any domain if `check_domain=False` decorator option used
- Files: `middleware.py:355-395` (validate_api_key decorator), routes using `check_domain=False`
- Current mitigation: Some endpoints have `check_domain=True`, but inconsistently applied
- Recommendations: Make domain checking mandatory for all user-facing endpoints, log domain mismatches

**Plaintext Cache Stored in Memory Without Encryption:**
- Risk: Plaintext text content cached in `_plaintext_cache` dictionary in routes_encryption.py is unencrypted in process memory
- Files: `routes_encryption.py:36-75` (_plaintext_cache, _hash_data_cache)
- Current mitigation: 1-hour TTL and process-memory only storage
- Recommendations: Move to encrypted cache, reduce TTL, clear on shutdown, consider never caching plaintext

**Sentry Error Tracking Enabled in Production:**
- Risk: Error tracking sends data to external service, may include sensitive information in stack traces
- Files: `encrypt_api.py:20-32` (Sentry integration), environment-based configuration
- Current mitigation: 10% sample rate (traces_sample_rate=0.1)
- Recommendations: Scrub sensitive data before sending to Sentry, configure exception filtering, verify no PII in error messages

**Password Hashing Uses Werkzeug Default (Correct But Unvetted):**
- Risk: Password hashing implementation in database.py relies on werkzeug.security defaults
- Files: `database.py:120-125` (set_password, check_password), uses werkzeug.security
- Current mitigation: Werkzeug uses scrypt/pbkdf2 by default
- Recommendations: Document password hashing algorithm, consider argon2 for stronger protection, test against common weak passwords

**Font URL Exposure in API Responses:**
- Risk: Generated font URLs exposed in API responses may reveal internal structure/naming
- Files: `routes_encryption.py:231,321,795,914,1284` (returns font_url in JSON)
- Current mitigation: Font filenames use hash-based naming
- Recommendations: Consider obfuscating font URLs further, or serving fonts through CDN with token validation

**Missing CSRF Protection:**
- Risk: State-changing operations (dashboard) have no CSRF token validation
- Files: `routes_dashboard.py` (form submissions and key creation) use POST but no CSRF checks
- Current mitigation: Only accessible to authenticated users
- Recommendations: Add Flask-WTF CSRF tokens to all forms, validate on backend

## Performance Bottlenecks

**Synchronous Font Generation on Every Encryption:**
- Problem: Each encryption request generates a new font file, CPU-intensive operation
- Files: `routes_encryption.py:214-233` (encrypt_article endpoint calls generate_font=True)
- Cause: Font generation happens in request handler, blocks response
- Improvement path: Cache fonts by (secret_key, nonce) combination, generate asynchronously, return cached version if available

**R2 Lookups for Every Search Query:**
- Problem: get_nonce_sk_from_hash called on every search, requires R2 API call even with cache
- Files: `routes_encryption.py:65-75` (get_nonce_sk_cached), R2 cache has 1-hour TTL
- Cause: Hash lookups not batched, serial R2 requests for multiple queries
- Improvement path: Implement Redis-backed hash cache, batch R2 lookups, increase TTL for stable hashes

**HTML Parsing Repeated Per Request:**
- Problem: `encrypt_html_content` parses entire HTML document for every request, even when cached
- Files: `routes_url.py:257-268`, `routes_static.py:1100-1150` (encrypt_html_content called with no caching check first)
- Cause: Cache check happens after encryption
- Improvement path: Check cache before parsing, only parse on cache miss

**BeautifulSoup Parsing on Large Documents:**
- Problem: BeautifulSoup parses entire HTML DOM for large news articles/websites
- Files: `html_encryption.py:500+` (BeautifulSoup parsing and traversal)
- Cause: No streaming parser, no DOM size limits
- Improvement path: Add document size limits (warning at 10MB), consider streaming parser, implement progressive encryption for large files

**Playwright Browser Instance per URL Request:**
- Problem: Each URL encryption spawns new browser instance (or waits for pool)
- Files: `routes_url.py:115-170` (calls playwright_renderer)
- Cause: No persistent browser pool, warm-up time per request
- Improvement path: Implement persistent browser pool, reuse across requests, add request queuing

## Fragile Areas

**Font Algorithm Version Pinning:**
- Files: `r2_website_storage.py:28-32` (FONT_ALGORITHM_VERSION = "v5")
- Why fragile: Cache invalidation depends on manual version bumps; wrong version causes silent font mismatches
- Safe modification: Increase version number before deploying algorithm changes, add validation to verify cached fonts match algorithm version
- Test coverage: `test_font_pipeline.py` tests font generation but not cache versioning; add tests for version mismatch scenarios

**HTML Encryption State Machine:**
- Files: `html_encryption.py:300-1200+` (encrypt_html_content function)
- Why fragile: Complex state tracking through nested tree traversal, difficult to reason about element ordering and font injection points
- Safe modification: Add comprehensive logging of state transitions, test with edge cases (nested fonts, comments, CDATA), extract state into separate class
- Test coverage: `test_css_cascade.py` exists but limited scope; add tests for: font-face ordering, style override precedence, broken HTML recovery

**Nonce/Secret Key Hashing for Storage ID:**
- Files: `r2_website_storage.py:89-99` (get_storage_id), uses MD5 hash truncated to 16 chars
- Why fragile: Hash collisions possible with truncation, MD5 is cryptographically weak (though not used for security here)
- Safe modification: Document collision risk, consider SHA-256 with same truncation, add storage_id validation on retrieval
- Test coverage: No tests for storage_id collision or uniqueness

## Scaling Limits

**In-Memory Cache Unbounded Growth:**
- Current capacity: `_plaintext_cache` and `_hash_data_cache` in routes_encryption.py have no size limit
- Limit: Will eventually exhaust memory on long-running servers
- Scaling path: Implement LRU cache with max_size, switch to Redis for distributed cache, monitor cache hit rates

**Rate Limiter Cleanup Per-Process:**
- Current capacity: Each gunicorn worker maintains separate rate limit state
- Limit: With 4 processes, rates multiply by 4; 2 workers × 4 threads = 8 concurrent connections before rate limit applies
- Scaling path: Move to Redis-backed rate limiter, ensure global rate limit across all processes

**Database Connection Pool Default Too Small:**
- Current capacity: SQLAlchemy default pool size
- Limit: With 2 workers × 4 threads = 8 maximum concurrent requests, may exhaust connections under load
- Scaling path: Increase pool size in database.py, add pool_recycle, monitor connection exhaustion

**File Descriptor Limits for Playwright:**
- Current capacity: Playwright instances maintain browser connections
- Limit: Max browsers depends on OS file descriptor limit (ulimit -n)
- Scaling path: Set explicit Playwright concurrency limits, implement queue with max workers, monitor open file count

## Dependencies at Risk

**PyMuPDF (fitz) Version Pinning:**
- Risk: requirements.txt likely pins old version; newer versions have breaking changes and fixes
- Impact: PDF parsing may fail on modern PDFs, missing font handling improvements, security fixes unavailable
- Migration plan: Update to latest PyMuPDF with testing, implement version range instead of exact version, add deprecation checks

**BeautifulSoup4 Implicit Optional Dependency:**
- Risk: Some routes require BeautifulSoup but fail gracefully if not installed
- Impact: Feature creep: URL encryption, HTML encryption, search disabled if BS4 missing, silent degradation
- Migration plan: Make BS4 mandatory or implement fallback parser (lxml), test both code paths, document dependency

**Cloudflare R2 API Changes:**
- Risk: boto3 R2 integration depends on AWS SDK compatibility
- Impact: Major boto3 version changes may break R2 client initialization
- Migration plan: Pin boto3 version range, add tests for R2 operations, monitor boto3 releases for R2 support

**Flask Deprecation and WSGI 3.0:**
- Risk: Flask 2.x running on old WSGI; Flask 3.0+ requires async support
- Impact: Cannot upgrade to modern Flask versions without async rewrite
- Migration plan: Plan migration to async framework (Quart) or stick with Flask 2.x LTS

## Missing Critical Features

**No Request Timeout Protection:**
- Problem: Long-running encryption requests can timeout without clear feedback
- Blocks: Users cannot request encryption of large documents without timeout
- Fix: Implement request timeouts with graceful degradation, chunked uploads for large files, async job queue for heavy operations

**No Duplicate Request Detection:**
- Problem: Identical requests processed multiple times, create multiple fonts and cache entries
- Blocks: Inefficient resource usage, potential for cache inconsistency
- Fix: Implement request deduplication using hash of request body, return cached result if in-flight request exists

**No Progressive Rendering for Large HTML:**
- Problem: Large news articles must be fully encrypted before response returned
- Blocks: Cannot stream large documents to client while encrypting
- Fix: Implement streaming JSON API, send encrypted chunks as they're ready, progressive loading on client

**No Recovery from Corrupted Fonts:**
- Problem: If font generation fails mid-process, no mechanism to regenerate
- Blocks: Corrupted fonts in R2 storage serve broken content permanently
- Fix: Implement font validation, regenerate if invalid detected, add manual recovery endpoint

## Test Coverage Gaps

**API Rate Limiting:**
- What's not tested: Edge cases like exact limit boundary, cleanup thread behavior, distributed rate limit enforcement
- Files: `middleware.py` RateLimiter class has no tests; no integration tests for /api/encrypt rate limits
- Risk: Rate limiting could be trivially bypassed with multiple client instances or if cleanup doesn't run
- Priority: High - rate limiting is security control

**Font Algorithm Correctness Across Versions:**
- What's not tested: No tests verifying font remapping is consistent with encryption, no regression tests between versions
- Files: `generate_font.py` (1583 lines) has no dedicated tests, only indirect testing via `test_font_pipeline.py`
- Risk: Font remapping bugs go undetected, old fonts may not decrypt properly
- Priority: High - breaks core functionality

**R2 Storage Failure Modes:**
- What's not tested: Network errors, partial uploads, missing credentials, bucket permission issues
- Files: `r2_website_storage.py` storage operations not tested, only `test_r2_storage.py` with mocks
- Risk: Silent failures, data loss, unrecoverable corruption
- Priority: High - affects data persistence

**HTML Encryption Edge Cases:**
- What's not tested: Malformed HTML, deeply nested elements, style tag injection attempts, script tags (should stay encrypted)
- Files: `html_encryption.py` has 2824 lines with minimal test coverage
- Risk: XSS vulnerabilities, HTML injection, broken layouts
- Priority: High - security and functionality

**API Key Authentication:**
- What's not tested: Invalid key formats, revoked keys, expired keys (if time-based), domain validation edge cases
- Files: `middleware.py` validate_api_key decorator, no dedicated tests
- Risk: Authentication bypass, unauthorized access
- Priority: Critical - security control

**Database Optional Mode:**
- What's not tested: Running without database, mixed mode with some features disabled
- Files: `database.py` DATABASE_AVAILABLE flag, `routes_dashboard.py` assumes database available
- Risk: Features enabled/disabled inconsistently, data loss potential
- Priority: Medium - affects deployment options

**PDF Encryption Large Files:**
- What's not tested: Files >50MB (limit exists but untested), memory usage under load, streaming vs. buffered
- Files: `routes_pdf.py` with 200+ lines, only basic tests
- Risk: Out of memory, timeout, corruption
- Priority: Medium - limits usability

---

*Concerns audit: 2026-01-21*
