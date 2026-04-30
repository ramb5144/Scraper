# Testing Patterns

**Analysis Date:** 2026-01-21

## Test Framework

**Runner:**
- Python: `unittest`-compatible (manual test scripts, no test runner config)
- No pytest, nose, or other framework configuration detected
- Tests are run as standalone scripts: `python test_<feature>.py`

**Assertion Library:**
- Custom assertions using plain Python conditionals and `assert` statements
- No standard assertion library (no pytest.raises, unittest.TestCase, etc.)

**Run Commands:**
```bash
# Run individual test script
python test_font_pipeline.py

# Run with environment variables
DEBUG=true python test_r2_storage.py

# Check test status (manual inspection of output)
python test_search_positions.py 2>&1 | grep -E "PASS|FAIL"
```

## Test File Organization

**Location:**
- Tests are co-located in project root with source code
- Not in separate `tests/` directory
- Files: `test_<feature>.py` at root directory

**Naming:**
- Test files: `test_<feature>.py`
  - `test_font_pipeline.py` - Font generation and optimization tests
  - `test_search_positions.py` - Character position mapping tests
  - `test_r2_storage.py` - Cloud storage (Cloudflare R2) tests
  - `test_url_encryption.py` - URL encryption/decryption tests
  - `test_decrypt_mismatch.py` - Decryption validation tests
  - `test_css_cascade.py` - CSS rule application tests
  - `test_kern_table.py` - Font kerning tests
  - `test_space_fix.py` - Whitespace handling tests

**Structure:**
```
Project Root/
├── test_font_pipeline.py       # Font tests
├── test_search_positions.py    # Position tracking tests
├── test_r2_storage.py          # Storage tests
├── test_url_encryption.py      # Encryption tests
├── test_decrypt_mismatch.py    # Decryption tests
└── [source files that tests depend on]
    ├── generate_font.py
    ├── middleware.py
    ├── r2_website_storage.py
    └── routes_*.py
```

## Test Structure

**Suite Organization:**
```python
#!/usr/bin/env python3
"""
Test script to verify [feature] is working correctly
"""
import os
import sys

# Load environment variables
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Configuration and setup
DEBUG_MODE = os.environ.get('DEBUG', 'false').lower() == 'true'
FONT_ALGORITHM_VERSION = 'v2.1'

# Helper functions for structured testing
def log_test(test_name, status, details, extra_data=None):
    """Log test result with formatted output"""
    print(f"\n{'='*60}")
    print(f"TEST: {test_name}")
    print(f"Status: {status}")
    if details:
        print(f"Details: {details}")
    if extra_data:
        for key, value in extra_data.items():
            print(f"  {key}: {value}")
    print(f"{'='*60}")

# Test functions (each is standalone and can be run independently)
def test_font_type_detection():
    """Test font type detection for various font files"""
    # Setup
    fonts_dir = os.path.join(os.path.dirname(__file__), 'fonts')

    # Execute
    # ... test code ...

    # Assert (manual)
    log_test("Font Type Detection", "PASS" if results['errors'] == 0 else "WARN",
             f"Detected {len(font_files)} fonts", results)

if __name__ == '__main__':
    # Run all tests
    test_font_type_detection()
    test_glyph_swapping_truetype()
    test_plaintext_index_generation()
```

**Patterns:**
- No test setup/teardown methods (uses inline setup in each test function)
- No fixtures (test data created inline within test)
- Manual test discovery and execution (not automatic)
- Custom `log_test()` function for consistent output formatting
- Main guard: `if __name__ == '__main__':`

## Mocking

**Framework:** No mocking framework detected (no unittest.mock, pytest-mock, etc.)

**Patterns:**
```python
# Manual mock of environment variables
os.environ['DEBUG'] = 'true'
os.environ['R2_ACCOUNT_ID'] = 'test_account'

# Manual mock of file system
fonts_dir = os.path.join(os.path.dirname(__file__), 'fonts')
font_files = [f for f in os.listdir(fonts_dir) if f.endswith('.woff2')]

# Manual mock of API responses
test_website_id = "test_website_12345"
test_domain = "test.example.com"
test_nonce = 123456
test_secret_key = 29202393
```

**What to Mock:**
- Environment variables (via `os.environ`)
- File system operations (open real files from test directory)
- External service calls (API responses mocked inline)

**What NOT to Mock:**
- Core encryption functions (test with real encryption)
- Font operations (test with real font files)
- Database operations (use real test database when available)

## Fixtures and Factories

**Test Data:**
```python
# From test_r2_storage.py
test_website_id = "test_website_12345"
test_domain = "test.example.com"
test_nonce = 123456
test_secret_key = 29202393

# Used directly in test
result = store_website_metadata(test_website_id, test_domain, test_nonce, test_secret_key)
if result:
    print(f"✅ Successfully stored metadata!")
```

**Location:**
- Test data defined inline within test functions
- Shared constants at module level for reuse
- Real test files stored in `fonts/` and `fonts/extracted/` directories

**Factory Pattern:**
- No factory functions; objects created with constructor calls directly
- Test files/fonts created on-the-fly during test execution

## Coverage

**Requirements:** Not enforced (no coverage configuration detected)

**View Coverage:** Not available (no coverage tool configured)

## Test Types

**Unit Tests:**
- Test individual functions in isolation
- Example: `test_font_algorithm_version_sync()` in `test_font_pipeline.py`
  - Tests that font algorithm versions match between modules
  - Directly calls functions and checks return values
  - No mocking of dependencies

**Integration Tests:**
- Test multiple components working together
- Example: `test_r2_storage.py`
  - Tests R2 client connection
  - Tests website metadata storage and retrieval
  - Tests font upload and storage
  - Uses real R2 credentials from environment

**E2E Tests:**
- Not explicitly present
- Some tests come close: `test_url_encryption.py` tests full encryption/decryption cycle
- Manual browser testing implied (no automated E2E framework)

## Common Patterns

**Async Testing:**
Not present in codebase. Tests are synchronous.

**Error Testing:**
```python
# From test_r2_storage.py
print(f"❌ ERROR: R2 credentials are not fully configured!")
if not all([r2_account_id, r2_access_key, r2_secret_key, r2_bucket]):
    print("   Please set the following environment variables:")
    print("   - R2_ACCOUNT_ID")
    print("   - R2_ACCESS_KEY_ID")
    print("   - R2_SECRET_ACCESS_KEY")
    print("   - R2_BUCKET_NAME")
    sys.exit(1)

# Error handling in test
try:
    response = s3_client.list_objects_v2(Bucket=r2_bucket, MaxKeys=5)
    object_count = response.get('KeyCount', 0)
    print(f"✅ Connection successful! Found {object_count} object(s) in bucket")
except Exception as e:
    print(f"⚠️  Warning: Could not list bucket objects: {e}")
    print("   (This might be a permissions issue, but connection works)")
```

**Validation Testing:**
```python
# From test_font_pipeline.py
# Check version sync
if FONT_ALGORITHM_VERSION == R2_FONT_VERSION:
    log_test("Font Algorithm Version Sync", "PASS",
             f"Both modules use version: {FONT_ALGORITHM_VERSION}")
    return True
else:
    log_test("Font Algorithm Version Sync", "FAIL",
             f"Version mismatch!",
             {'font_utils.py': FONT_ALGORITHM_VERSION, 'r2_website_storage.py': R2_FONT_VERSION})
    return False
```

**Conditional Testing:**
```python
# From test_font_pipeline.py
# Skip test if prerequisites not met
if FONTOOLS_AVAILABLE:
    # Run test
else:
    log_test("Font Type Detection", "SKIP", "fonttools not available")

# Graceful handling of missing test data
fonts_dir = os.path.join(os.path.dirname(__file__), 'fonts')
if not os.path.exists(fonts_dir):
    log_test("Font Type Detection", "WARN", "fonts/ directory not found")
    return False
```

## Test Execution Strategy

**Manual Execution:**
- Tests run as standalone Python scripts
- Each test file can be executed independently
- No CI/CD integration (not detected in config)

**Output Format:**
```
============================================================
TEST: Font Algorithm Version Sync
============================================================
Status: PASS
Details: Both modules use version: v2.1
============================================================
```

**Exit Codes:**
- `sys.exit(0)` for success
- `sys.exit(1)` for critical failure (missing environment variables)
- No exit code for warnings/non-critical failures

## Limitations & Gaps

**No Test Runner:**
- Can't run all tests with single command
- No test discovery mechanism
- Manual test file execution required

**No Fixtures Framework:**
- Test data created inline, not reused across tests
- No setup/teardown hooks
- Difficult to manage complex test scenarios

**No Mocking Framework:**
- Can't easily mock external services
- Tests dependent on real R2 credentials to run
- Network calls happen during integration tests

**No Assertion Library:**
- Manual if/else checks for test results
- No meaningful assertion error messages
- Difficult to debug test failures

**Coverage Gaps:**
- No coverage measurement
- Unknown which code paths are tested
- Difficult to identify untested edge cases

---

*Testing analysis: 2026-01-21*
