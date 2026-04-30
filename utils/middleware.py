#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Security middleware for the Cloak API.
Provides rate limiting, input validation, and domain validation.
"""
import time
import re
import hashlib
from functools import wraps
from flask import request, jsonify, g
from collections import defaultdict
import threading

# =============================================================================
# CONFIGURATION
# =============================================================================

# Rate limiting settings
RATE_LIMITS = {
    'default': {'requests': 100, 'window': 60},  # 100 requests per minute
    'get_text_range': {'requests': 30, 'window': 60},  # 30 requests per minute (sensitive endpoint)
    'search': {'requests': 60, 'window': 60},  # 60 searches per minute
    'encrypt': {'requests': 20, 'window': 60},  # 20 encryptions per minute
}

# Max characters per get-text-range request
MAX_TEXT_RANGE_CHARS = 5000

# Hash validation pattern (64 hex chars for SHA-256)
HASH_PATTERN = re.compile(r'^[a-f0-9]{64}$')

# API key pattern - supports both formats:
# - cloak_live_ or cloak_test_ followed by 32 hex chars (legacy)
# - ck_ followed by 48 hex chars (SDK format)
API_KEY_PATTERN = re.compile(r'^(cloak_(live|test)_[a-f0-9]{32}|ck_[a-f0-9]{48})$')

# =============================================================================
# RATE LIMITER (In-Memory - Replace with Redis for production)
# =============================================================================

class RateLimiter:
    """
    Simple in-memory rate limiter using sliding window.
    For production, replace with Redis-based implementation.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # Structure: {key: [(timestamp, count), ...]}
        self._requests = defaultdict(list)
        # Cleanup old entries periodically
        self._last_cleanup = time.time()
        self._cleanup_interval = 300  # 5 minutes

    def _cleanup(self):
        """Remove old entries to prevent memory growth."""
        now = time.time()
        if now - self._last_cleanup < self._cleanup_interval:
            return

        with self._lock:
            cutoff = now - 300  # Remove entries older than 5 minutes
            for key in list(self._requests.keys()):
                self._requests[key] = [
                    (ts, count) for ts, count in self._requests[key]
                    if ts > cutoff
                ]
                if not self._requests[key]:
                    del self._requests[key]
            self._last_cleanup = now

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
        self._cleanup()
        now = time.time()
        window_start = now - window

        with self._lock:
            # Count requests in current window
            self._requests[key] = [
                (ts, count) for ts, count in self._requests[key]
                if ts > window_start
            ]

            current_count = sum(count for _, count in self._requests[key])

            if current_count >= limit:
                # Calculate when the oldest request will expire
                if self._requests[key]:
                    oldest_ts = min(ts for ts, _ in self._requests[key])
                    reset_in = int(oldest_ts + window - now) + 1
                else:
                    reset_in = window

                return False, {
                    'allowed': False,
                    'limit': limit,
                    'remaining': 0,
                    'reset_in': reset_in,
                    'window': window
                }

            # Add this request
            self._requests[key].append((now, 1))

            return True, {
                'allowed': True,
                'limit': limit,
                'remaining': limit - current_count - 1,
                'reset_in': window,
                'window': window
            }

# Global rate limiter instance
rate_limiter = RateLimiter()

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_client_ip():
    """Get the real client IP, handling proxies."""
    # Check for forwarded headers (when behind proxy/load balancer)
    if request.headers.get('X-Forwarded-For'):
        # X-Forwarded-For can contain multiple IPs; first is the client
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    if request.headers.get('X-Real-IP'):
        return request.headers.get('X-Real-IP')
    return request.remote_addr or 'unknown'

def get_request_origin():
    """Get the origin/referer of the request."""
    return request.headers.get('Origin') or request.headers.get('Referer') or ''

def extract_domain(url: str) -> str:
    """Extract domain from URL."""
    if not url:
        return ''
    # Remove protocol
    url = re.sub(r'^https?://', '', url)
    # Remove path and query
    domain = url.split('/')[0].split('?')[0]
    # Remove port
    domain = domain.split(':')[0]
    return domain.lower()

# =============================================================================
# DECORATORS
# =============================================================================

def rate_limit(limit_type: str = 'default'):
    """
    Rate limiting decorator.

    Usage:
        @rate_limit('get_text_range')
        def my_endpoint():
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Bypass rate limiting for test-key (local development)
            api_key = request.headers.get('X-API-Key', '')
            if api_key == 'test-key':
                # No rate limiting for test-key
                return f(*args, **kwargs)

            # Get rate limit config
            config = RATE_LIMITS.get(limit_type, RATE_LIMITS['default'])
            limit = config['requests']
            window = config['window']

            # Create rate limit key (IP + endpoint)
            client_ip = get_client_ip()
            rate_key = f"{client_ip}:{limit_type}"

            # Check rate limit
            allowed, info = rate_limiter.is_allowed(rate_key, limit, window)

            # Add rate limit headers to response
            g.rate_limit_info = info

            if not allowed:
                response = jsonify({
                    'error': 'Rate limit exceeded',
                    'limit': info['limit'],
                    'reset_in': info['reset_in'],
                    'message': f'Too many requests. Please wait {info["reset_in"]} seconds.'
                })
                response.status_code = 429
                response.headers['X-RateLimit-Limit'] = str(info['limit'])
                response.headers['X-RateLimit-Remaining'] = '0'
                response.headers['X-RateLimit-Reset'] = str(info['reset_in'])
                response.headers['Retry-After'] = str(info['reset_in'])
                return response

            # Execute the actual function
            response = f(*args, **kwargs)

            # Add rate limit headers if response is a Response object
            if hasattr(response, 'headers'):
                response.headers['X-RateLimit-Limit'] = str(info['limit'])
                response.headers['X-RateLimit-Remaining'] = str(info['remaining'])
                response.headers['X-RateLimit-Reset'] = str(info['reset_in'])

            return response
        return decorated_function
    return decorator

def validate_hash(param_name: str = 'hash'):
    """
    Validate hash parameter format.

    Usage:
        @validate_hash('hash')
        def my_endpoint():
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Get hash from request
            if request.is_json:
                hash_value = request.json.get(param_name)
            else:
                hash_value = request.args.get(param_name) or request.form.get(param_name)

            if hash_value and not HASH_PATTERN.match(hash_value):
                return jsonify({
                    'error': 'Invalid hash format',
                    'message': 'Hash must be a 64-character hexadecimal string'
                }), 400

            return f(*args, **kwargs)
        return decorated_function
    return decorator

def validate_api_key(check_domain: bool = True, check_usage: bool = False):
    """
    Validate API key against database, check domain, and optionally check usage limits.

    Usage:
        @validate_api_key()
        def my_endpoint():
            ...

        @validate_api_key(check_domain=True, check_usage=True)
        def usage_limited_endpoint():
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Get API key from header or body
            api_key_str = request.headers.get('X-API-Key')
            print(f"[AUTH DEBUG] Endpoint: {request.path}")
            print(f"[AUTH DEBUG] X-API-Key header: {api_key_str[:20] + '...' if api_key_str else 'NOT PRESENT'}")
            print(f"[AUTH DEBUG] All headers: {dict(request.headers)}")

            if not api_key_str and request.is_json:
                api_key_str = request.json.get('api_key')
                print(f"[AUTH DEBUG] Got api_key from body: {api_key_str[:20] + '...' if api_key_str else 'NOT PRESENT'}")

            if not api_key_str:
                print(f"[AUTH DEBUG] REJECTING - No API key found")
                return jsonify({
                    'error': 'Missing API key',
                    'message': 'API key is required. Provide via X-API-Key header or api_key parameter.'
                }), 401

            # Allow 'test-key' for local development (matches routes_sdk.py behavior)
            if api_key_str != 'test-key' and not API_KEY_PATTERN.match(api_key_str):
                print(f"[AUTH DEBUG] REJECTING - Invalid format: {api_key_str[:30]}...")
                return jsonify({
                    'error': 'Invalid API key format',
                    'message': 'API key must be in format: cloak_live_<32 hex chars>, cloak_test_<32 hex chars>, or ck_<48 hex chars>'
                }), 401

            # Validate against database or R2 (SDK keys)
            api_key_record = None

            # Handle test-key for local development
            if api_key_str == 'test-key':
                from routes.routes_sdk import validate_api_key as sdk_validate_key
                origin = get_request_origin()
                domain = extract_domain(origin)
                is_valid, error_msg, key_data = sdk_validate_key(api_key_str, domain)

                if not is_valid:
                    return jsonify({
                        'error': 'Invalid API key',
                        'message': error_msg or 'test-key validation failed'
                    }), 401

                # Convert SDK key_data to expected format
                api_key_record = {
                    'id': 'test-key',
                    'name': key_data.get('name', 'Test Key'),
                    'allowed_domains': key_data.get('allowed_domains', ['localhost', '127.0.0.1']),
                    'rate_limit_tier': 'standard',
                    'monthly_char_limit': 0,
                    'chars_this_month': 0,
                }

            # First try SDK keys (ck_ format) - stored in R2
            elif api_key_str.startswith('ck_'):
                try:
                    from routes.routes_sdk import validate_api_key as sdk_validate_key
                    origin = get_request_origin()
                    domain = extract_domain(origin)
                    is_valid, error_msg, key_data = sdk_validate_key(api_key_str, domain)

                    if not is_valid:
                        print(f"[AUTH DEBUG] SDK key validation failed: {error_msg}")
                        return jsonify({
                            'error': 'Invalid API key',
                            'message': error_msg or 'API key not found or has been revoked'
                        }), 401

                    print(f"[AUTH DEBUG] SDK key validated successfully: {key_data.get('name', 'unknown')}")
                    # Convert SDK key_data to expected format
                    api_key_record = {
                        'id': key_data.get('name', api_key_str[:20]),
                        'key_prefix': api_key_str[:20],
                        'name': key_data.get('name', 'SDK Key'),
                        'allowed_domains': key_data.get('allowed_domains', []),
                        'rate_limit_tier': 'standard',
                        'monthly_char_limit': key_data.get('usage_limit', 0),
                        'chars_this_month': key_data.get('usage_count', 0),
                    }
                except ImportError as ie:
                    print(f"[AUTH DEBUG] Import error for SDK validation: {ie}")
                    pass

            # Try database for cloak_live_/cloak_test_ keys
            if not api_key_record:
                try:
                    from database import validate_api_key as db_validate_key, check_domain_allowed, check_usage_limit

                    api_key_record = db_validate_key(api_key_str)

                    if not api_key_record:
                        return jsonify({
                            'error': 'Invalid API key',
                            'message': 'API key not found or has been revoked'
                        }), 401

                    # Check domain if required
                    if check_domain and api_key_record.get('allowed_domains'):
                        origin = get_request_origin()
                        domain = extract_domain(origin)
                        if domain and not check_domain_allowed(api_key_record, domain):
                            return jsonify({
                                'error': 'Domain not authorized',
                                'message': f'Domain {domain} is not authorized for this API key'
                            }), 403

                    # Check usage limits if required
                    if check_usage:
                        allowed, message = check_usage_limit(api_key_record)
                        if not allowed:
                            return jsonify({
                                'error': 'Usage limit exceeded',
                                'message': message
                            }), 429

                except ImportError:
                    # Database not set up yet, fall back to format-only validation
                    pass

            if not api_key_record:
                return jsonify({
                    'error': 'Invalid API key',
                    'message': 'API key not found or has been revoked'
                }), 401

            # Store for use in endpoint
            g.api_key = api_key_str
            g.api_key_record = api_key_record

            return f(*args, **kwargs)
        return decorated_function
    return decorator

def validate_text_range():
    """
    Validate and limit text range requests.

    Usage:
        @validate_text_range()
        def get_text_range():
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not request.is_json:
                return jsonify({'error': 'JSON body required'}), 400

            data = request.json
            start = data.get('start', 0)
            end = data.get('end', 0)

            # Validate types
            if not isinstance(start, int) or not isinstance(end, int):
                return jsonify({
                    'error': 'Invalid range',
                    'message': 'start and end must be integers'
                }), 400

            # Validate values
            if start < 0 or end < 0:
                return jsonify({
                    'error': 'Invalid range',
                    'message': 'start and end must be non-negative'
                }), 400

            if end < start:
                return jsonify({
                    'error': 'Invalid range',
                    'message': 'end must be greater than or equal to start'
                }), 400

            # Enforce max range
            range_size = end - start
            if range_size > MAX_TEXT_RANGE_CHARS:
                return jsonify({
                    'error': 'Range too large',
                    'message': f'Maximum range is {MAX_TEXT_RANGE_CHARS} characters. Requested: {range_size}',
                    'max_allowed': MAX_TEXT_RANGE_CHARS
                }), 400

            return f(*args, **kwargs)
        return decorated_function
    return decorator

def validate_domain(allowed_domains: list = None):
    """
    Validate that request comes from an allowed domain.
    If allowed_domains is None, skips validation (for development).

    Usage:
        @validate_domain(['example.com', 'app.example.com'])
        def my_endpoint():
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if allowed_domains is None:
                # Skip validation in development
                return f(*args, **kwargs)

            origin = get_request_origin()
            domain = extract_domain(origin)

            if not domain:
                # No origin header - might be server-to-server request
                # Could allow or deny based on your security requirements
                pass
            elif domain not in allowed_domains and not any(
                domain.endswith('.' + d) for d in allowed_domains
            ):
                return jsonify({
                    'error': 'Domain not authorized',
                    'message': f'Domain {domain} is not authorized for this API key'
                }), 403

            return f(*args, **kwargs)
        return decorated_function
    return decorator

def log_request(log_to_db: bool = True):
    """
    Log request details for monitoring/debugging.
    Optionally logs to database for analytics.

    Usage:
        @log_request()
        def my_endpoint():
            ...

        @log_request(log_to_db=True)
        def tracked_endpoint():
            ...
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            start_time = time.time()
            client_ip = get_client_ip()
            origin = get_request_origin()
            user_agent = request.headers.get('User-Agent', '')[:500]

            # Execute function
            response = f(*args, **kwargs)

            # Calculate duration
            duration_ms = int((time.time() - start_time) * 1000)

            # Get status code
            status_code = response.status_code if hasattr(response, 'status_code') else 200

            # Console log
            print(f"[REQUEST] {request.method} {request.path} | IP: {client_ip} | Origin: {origin} | Status: {status_code} | Duration: {duration_ms}ms")

            # Database log (if API key is available and logging enabled)
            if log_to_db and hasattr(g, 'api_key_record') and g.api_key_record:
                try:
                    from database import record_usage

                    # Try to get chars from response
                    chars = 0
                    if hasattr(response, 'json'):
                        try:
                            data = response.get_json(silent=True)
                            if data and 'text' in data:
                                chars = len(data['text'])
                            elif data and 'encrypted' in data:
                                chars = len(data['encrypted'])
                        except:
                            pass

                    record_usage(
                        api_key_info=g.api_key_record,
                        chars=chars,
                        endpoint=request.path,
                        method=request.method,
                        response_time_ms=duration_ms,
                        status_code=status_code,
                        ip_address=client_ip,
                        origin_domain=extract_domain(origin),
                        user_agent=user_agent
                    )
                except Exception as e:
                    print(f"[REQUEST] Failed to log to database: {e}")

            return response
        return decorated_function
    return decorator

# =============================================================================
# CORS CONFIGURATION
# =============================================================================

def configure_cors(app, allowed_origins: list = None):
    """
    Configure CORS for the Flask app.

    Args:
        app: Flask application
        allowed_origins: List of allowed origins, or None for '*' (development only)
    """
    from flask_cors import CORS

    if allowed_origins:
        CORS(app, origins=allowed_origins, supports_credentials=True)
    else:
        # Allow all origins (development only!)
        CORS(app)

# =============================================================================
# REQUEST SIZE LIMITS
# =============================================================================

def configure_request_limits(app, max_content_length: int = 10 * 1024 * 1024):
    """
    Configure maximum request size.

    Args:
        app: Flask application
        max_content_length: Max request body size in bytes (default 10MB)
    """
    app.config['MAX_CONTENT_LENGTH'] = max_content_length
