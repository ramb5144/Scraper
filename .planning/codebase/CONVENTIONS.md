# Coding Conventions

**Analysis Date:** 2026-01-21

## Naming Patterns

**Files:**
- Python backend: `snake_case` with descriptive names
  - Route files: `routes_<feature>.py` (e.g., `routes_encryption.py`, `routes_dashboard.py`)
  - Utility files: `<function>_<domain>.py` (e.g., `r2_website_storage.py`, `font_utils.py`)
  - Test files: `test_<feature>.py` (e.g., `test_font_pipeline.py`, `test_search_positions.py`)

- JavaScript/client: `kebab-case` for files
  - SDK file: `cloak-sdk.js`
  - Interceptor: `decrypt-interceptor.js`
  - Page encryption: `encrypt-page.js`

**Functions:**
- Python: `snake_case` universally
  - Helper functions: `get_<resource>()`, `set_<resource>()`, `validate_<input>()`
  - Internal functions: Prefixed with underscore `_cleanup()`, `_create_initial_objects()`
  - Decorators: `rate_limit()`, `validate_hash()`, `log_request()`
- JavaScript: `camelCase` universally
  - Event handlers: `get<Resource>()`, `shouldExclude<Condition>()`
  - Async functions: `async function <verb><Resource>()`
  - Private functions: Prefixed with underscore (e.g., `_createInitialObjects()`)

**Variables:**
- Python: `snake_case` for all variables and module-level constants
  - Constants: `UPPERCASE_WITH_UNDERSCORES` (e.g., `MAX_TEXT_RANGE_CHARS = 5000`, `RATE_LIMITS = {...}`)
  - Module-level state: `lowercase_with_underscores` (e.g., `_plaintext_cache = {}`)
  - Configuration dicts: `lowercase_with_underscores` (e.g., `config = {...}`)

- JavaScript: `camelCase` for variables, `UPPERCASE` for constants
  - Configuration: `const DEFAULT_CONFIG = {...}`
  - State variables: `let encryptionConfig = null`
  - Arrays: `let pendingNodes = new Set()`
  - Element references: `document.getElementById('encrypted-search-overlay')`

**Types/Classes:**
- Python: `PascalCase` for classes (e.g., `RateLimiter`, `RectPool`)
- JavaScript: `PascalCase` implied (no class definitions, use IIFE with closures)

## Code Style

**Formatting:**
- No automatic formatter detected. Conventions are manual:
  - Python: 4-space indentation (observed in all files)
  - JavaScript: 4-space indentation (observed in client files)
  - Line length: No strict limit observed; pragmatic breaking at logical points

**Linting:**
- Not detected. No `.eslintrc`, `pylint`, or `flake8` config files present.
- No automated checks in CI/CD.

**Docstring Style:**
- Python: Triple-quoted docstrings with description, Args, Returns pattern
  ```python
  def get_plaintext_cached(storage_id: str) -> str:
      """Get plaintext from cache, falling back to R2."""
      # Implementation
  ```

- JavaScript: JSDoc-style comments with parameter/return descriptions
  ```javascript
  /**
   * Encrypt a single character using server-provided mappings
   */
  function encryptChar(char) {
      // Implementation
  }
  ```

## Import Organization

**Order (Python):**
1. Standard library imports (`os`, `time`, `sys`, etc.)
2. Third-party imports (`flask`, `boto3`, `fonttools`, etc.)
3. Local imports (same-project modules)

**Example from `routes_encryption.py`:**
```python
import os
from flask import request, jsonify
from generate_font import get_dynamic_mappings
from middleware import (
    rate_limit,
    validate_hash,
    ...
)
```

**Path Aliases:**
- No aliases used. All imports are absolute imports from project root.
- Imports work because routes are registered directly with Flask app.

**Order (JavaScript):**
- IIFE pattern with no explicit imports (encapsulation via closure)
- External dependencies: None (vanilla JavaScript, no module system)
- Configuration injected via `window.encryptionConfig`

## Error Handling

**Python Patterns:**
- Try/except with specific exception types (avoid bare `except`)
  ```python
  try:
      from bs4 import BeautifulSoup
      BS4_AVAILABLE = True
  except ImportError:
      BS4_AVAILABLE = False
  ```

- Decorator-based validation with early returns
  ```python
  @validate_hash(param_name='hash')
  @rate_limit('default')
  def some_route():
      # If validation fails, decorator returns error response
  ```

- Middleware decorators that return standardized JSON error responses
  - Example: `validate_api_key()` returns `{'error': 'Invalid API key'}` on failure
  - Rate limit errors include `Retry-After` header

- Function return patterns:
  - Success: Return data or boolean True
  - Failure: Return None or boolean False (checked by caller)
  - API endpoints: Return jsonify() with status codes

**JavaScript Patterns:**
- Console logging for errors (no error boundaries)
  ```javascript
  console.error('%c❌ Critical: Missing encryption configuration!', 'color: #F44336; ...');
  ```

- Validation with early returns (defensive)
  ```javascript
  if (!node) return true;
  if (node.nodeType === Node.TEXT_NODE) {
      // Process text node
  }
  ```

- Async/await with try/catch for API calls
  ```javascript
  try {
      const response = await fetch(url, options);
      if (!response.ok) {
          console.warn('Lazy encryption failed:', response.status);
          return text;  // Fallback to unencrypted
      }
  } catch (error) {
      // Handle network error
  }
  ```

- Graceful degradation: Return original value on error (no throwing)

## Logging

**Framework (Python):** `print()` statements with emoji prefixes for visual distinction
- Format: `print(f"[TAG] Message: {value}")`
- Examples from codebase:
  ```python
  print("[CACHE] Invalidated plaintext cache for storage_id")
  print(f"[DEBUG] Text node: {node.textContent.slice(0, 30)}")
  print(f"❌ ERROR: R2 credentials are not fully configured!")
  ```

**Framework (JavaScript):** `console.log()`, `console.warn()`, `console.error()` with styled output
- Uses CSS styling for console messages
  ```javascript
  console.log('%c🔓 Decrypt Interceptor Loading...', 'color: #9C27B0; font-weight: bold; font-size: 14px;');
  console.table(configStatus);  // Formatted tables for config
  ```

**Debug Mode:**
- Python: Controlled by `DEBUG_MODE = os.environ.get('DEBUG', 'false').lower() == 'true'`
- JavaScript: Controlled by `config.debug` (user-configurable at initialization)

**Patterns:**
- Prefixes for log grouping: `[CACHE]`, `[DEBUG]`, `[CLOAK]`, `❌`, `✅`, `⚠️`
- Emoji usage throughout for quick visual scanning
- Structured logging not used; plain text with context prefixes

## Comments

**When to Comment:**
- CRITICAL comments for non-obvious logic
  ```javascript
  // CRITICAL: Exclude search highlight elements to prevent double-encryption
  if (element.classList && element.classList.contains('encrypted-search-highlight')) return true;
  ```

- WHY comments explaining design decisions
  ```javascript
  // WHY IT EXISTS: Required for dynamic content. When new content is added,
  // we must rebuild the full plaintext (old + new) to upload to the server.
  // Without _cloakOriginal, the SDK can't include already-encrypted nodes.
  ```

- MUST MATCH comments for synchronization between files
  ```javascript
  // MUST MATCH decrypt-interceptor.js logic exactly
  if (element.hasAttribute('data-nosnippet')) return true;
  ```

- Block boundaries: Large comment sections for major sections
  ```python
  # =============================================================================
  # ENCRYPTION LOGIC (uses server-provided mappings)
  # =============================================================================
  ```

**JSDoc/TSDoc:**
- Full JSDoc headers for public functions
  ```javascript
  /**
   * Encrypt a single character using server-provided mappings
   */
  function encryptChar(char) { ... }
  ```

- Parameter types documented in docstring comments
  ```python
  def is_allowed(self, key: str, limit: int, window: int) -> tuple[bool, dict]:
      """
      Check if request is allowed under rate limit.

      Args:
          key: Unique identifier (IP, API key, etc.)
          limit: Max requests allowed
          window: Time window in seconds

      Returns:
          (allowed: bool, info: dict with remaining, reset_in, etc.)
      """
  ```

## Function Design

**Size:**
- Typical functions are 15-30 lines
- Larger functions (50-100 lines) have comment sections to break them up
- Very large files (1000+ lines) use function grouping and comment headers

**Parameters:**
- Python: Use keyword arguments for clarity
  ```python
  def register_encryption_routes(app):  # Single required param
  def get_cached(storage_id: str) -> str:  # Typed params
  ```
- JavaScript: Configuration objects for multiple optional params
  ```javascript
  const DEFAULT_CONFIG = {
      apiBaseUrl: 'http://localhost:8001',
      debug: false,
      excludeSelectors: [...],
      batchDelay: 16,
  };
  ```

**Return Values:**
- Python: Return None or False on failure (caller checks truthiness)
- JavaScript: Return original value on error (graceful degradation), throw only for critical bugs

## Module Design

**Exports (Python):**
- `register_<feature>_routes(app)` pattern for route registration
  ```python
  def register_encryption_routes(app):
      @app.route('/api/get-nonce-sk', methods=['POST'])
      def get_nonce_sk():
          # Implementation
  ```

- Helper functions exported with clear naming
  - `get_<resource>()`
  - `set_<resource>()`
  - `validate_<input>()`

**Barrel Files:** Not used (no index.py files)

**Initialization:**
- Flask routes registered in `register_*_routes()` functions called by main app
- SDK initialized with `CloakSDK.init(config)` in JavaScript
- Environment variables loaded via `from dotenv import load_dotenv`

---

*Convention analysis: 2026-01-21*
