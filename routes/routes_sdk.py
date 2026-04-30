#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SDK API Routes - Endpoints for the client-side Cloak SDK.

These endpoints handle:
- API key validation
- Session initialization
- Font generation/retrieval
- Usage tracking and billing
"""

import os
import json
import time
import hashlib
import secrets
from datetime import datetime, timedelta
from functools import wraps
from flask import request, jsonify, Response

from utils.r2_website_storage import (
    get_r2_client,
    get_storage_id,
    store_website_metadata,
    get_website_metadata,
    store_nonce_sk_hash,
)
from utils.font_utils import DEBUG_MODE
from .routes_common import SECRET_KEY
from .routes_encryption import invalidate_plaintext_cache

# ============================================
# API Key Storage (In production, use a database)
# ============================================

# In-memory storage for demo - replace with database in production
API_KEYS = {}  # api_key -> { domain, created_at, usage_limit, usage_count }
SESSIONS = {}  # session_id -> { api_key, domain, nonce, secret_key, created_at, char_count }

# R2 keys for persistent storage
API_KEYS_R2_PREFIX = "sdk/api_keys/"
USAGE_R2_PREFIX = "sdk/usage/"


def get_api_key_data(api_key: str) -> dict:
    """Get API key data from R2 or memory cache."""
    # Handle test-key for local development
    if api_key == "test-key":
        return {
            'api_key': 'test-key',
            'name': 'Local Test Key',
            'allowed_domains': ['localhost', '127.0.0.1'],
            'usage_limit': 0,  # unlimited
            'usage_count': 0,
            'features': ['copy', 'search', 'select'],
            'seed': 'test-seed-for-local-development',
            'secret_key': SECRET_KEY,
            'active': True,
            'created_at': '2024-01-01T00:00:00Z',
            'billing_cycle_start': '2024-01-01T00:00:00Z'
        }

    # Check memory cache first
    if api_key in API_KEYS:
        print(f"[SDK AUTH] Found key {api_key[:20]}... in memory cache")
        return API_KEYS[api_key]

    # Try R2
    try:
        s3_client, r2_bucket = get_r2_client()
        key = f"{API_KEYS_R2_PREFIX}{api_key}.json"
        print(f"[SDK AUTH] Looking up key in R2: {key}")
        response = s3_client.get_object(Bucket=r2_bucket, Key=key)
        data = json.loads(response['Body'].read().decode('utf-8'))
        API_KEYS[api_key] = data  # Cache
        print(f"[SDK AUTH] Found key {api_key[:20]}... in R2")
        return data
    except Exception as e:
        print(f"[SDK AUTH] Key {api_key[:20]}... not found in R2: {e}")
        return None


def store_api_key_data(api_key: str, data: dict) -> bool:
    """Store API key data in R2."""
    try:
        s3_client, r2_bucket = get_r2_client()
        key = f"{API_KEYS_R2_PREFIX}{api_key}.json"
        s3_client.put_object(
            Bucket=r2_bucket,
            Key=key,
            Body=json.dumps(data).encode('utf-8'),
            ContentType='application/json'
        )
        API_KEYS[api_key] = data  # Update cache
        return True
    except Exception as e:
        print(f"Failed to store API key: {e}")
        return False


def generate_api_key() -> str:
    """Generate a new API key."""
    return f"ck_{secrets.token_hex(24)}"


def validate_api_key(api_key: str, domain: str = None) -> tuple:
    """
    Validate an API key.

    Returns:
        (is_valid, error_message, key_data)
    """
    if not api_key:
        return False, "API key is required", None

    # Allow test-key for local development
    if api_key == "test-key":
        test_key_data = {
            'api_key': 'test-key',
            'name': 'Local Test Key',
            'allowed_domains': ['localhost', '127.0.0.1'],
            'usage_limit': 0,  # unlimited
            'usage_count': 0,
            'features': ['copy', 'search', 'select'],
            'seed': 'test-seed-for-local-development',
            'secret_key': SECRET_KEY,
            'active': True,
            'created_at': '2024-01-01T00:00:00Z',
            'billing_cycle_start': '2024-01-01T00:00:00Z'
        }
        return True, None, test_key_data

    if not api_key.startswith("ck_"):
        return False, "Invalid API key format", None

    key_data = get_api_key_data(api_key)
    if not key_data:
        return False, "Invalid API key", None

    # Check if key is active
    if not key_data.get('active', True):
        return False, "API key is disabled", None

    # Check domain allowlist (if configured)
    allowed_domains = key_data.get('allowed_domains', [])
    if allowed_domains and domain:
        domain_match = any(
            domain == d or domain.endswith('.' + d)
            for d in allowed_domains
        )
        if not domain_match:
            return False, f"Domain {domain} is not allowed for this API key", None

    # Check usage limits
    usage_limit = key_data.get('usage_limit', 0)  # 0 = unlimited
    usage_count = key_data.get('usage_count', 0)
    if usage_limit > 0 and usage_count >= usage_limit:
        return False, "Usage limit exceeded", None

    return True, None, key_data


# ============================================
# API Key Required Decorator
# ============================================

def require_api_key(f):
    """Decorator to require valid API key."""
    @wraps(f)
    def decorated(*args, **kwargs):
        api_key = request.headers.get('X-API-Key') or request.args.get('api_key')
        domain = request.json.get('domain') if request.json else request.args.get('domain')

        is_valid, error, key_data = validate_api_key(api_key, domain)
        if not is_valid:
            return jsonify({'error': error, 'code': 'INVALID_API_KEY'}), 401

        # Attach key data to request context
        request.api_key = api_key
        request.key_data = key_data

        return f(*args, **kwargs)
    return decorated


# ============================================
# Nonce Generation
# ============================================

def generate_session_nonce(api_key: str, domain: str, path: str) -> int:
    """
    Generate a deterministic nonce for a session.

    The nonce is based on:
    - API key's secret seed
    - Domain
    - Path (or page identifier)

    This ensures the same page always gets the same encryption,
    allowing font caching while maintaining security.
    """
    key_data = get_api_key_data(api_key)
    seed = key_data.get('seed', api_key)

    # Create deterministic hash
    hash_input = f"{seed}:{domain}:{path}"
    hash_bytes = hashlib.sha256(hash_input.encode()).digest()

    # Convert first 4 bytes to integer for nonce
    nonce = int.from_bytes(hash_bytes[:4], 'big') % 1000000

    return nonce


# ============================================
# Route Registration
# ============================================

def register_sdk_routes(app):
    """Register SDK API routes with the Flask app."""

    # ----------------------------------------
    # Admin: Create API Key
    # ----------------------------------------
    @app.route('/api/sdk/admin/create-key', methods=['POST'])
    def create_api_key():
        """
        Create a new API key (admin only).

        Request body:
            {
                "admin_secret": "your_admin_secret",
                "name": "Customer Name",
                "allowed_domains": ["example.com", "*.example.com"],
                "usage_limit": 1000000,  // characters per month, 0 = unlimited
                "features": ["copy", "search", "select"]
            }
        """
        data = request.json or {}

        # Simple admin auth (replace with proper auth in production)
        admin_secret = os.environ.get('ADMIN_SECRET', 'admin123')
        if data.get('admin_secret') != admin_secret:
            return jsonify({'error': 'Unauthorized'}), 401

        # Generate new key
        api_key = generate_api_key()
        seed = secrets.token_hex(32)  # Unique seed for this key

        key_data = {
            'api_key': api_key,
            'name': data.get('name', 'Unnamed'),
            'allowed_domains': data.get('allowed_domains', []),
            'usage_limit': data.get('usage_limit', 0),
            'usage_count': 0,
            'features': data.get('features', ['copy', 'search', 'select']),
            'seed': seed,
            'secret_key': SECRET_KEY,  # Use global secret key or generate per-customer
            'active': True,
            'created_at': datetime.utcnow().isoformat(),
            'billing_cycle_start': datetime.utcnow().isoformat()
        }

        if store_api_key_data(api_key, key_data):
            return jsonify({
                'api_key': api_key,
                'name': key_data['name'],
                'created_at': key_data['created_at']
            })
        else:
            return jsonify({'error': 'Failed to create API key'}), 500

    # ----------------------------------------
    # SDK: Initialize Session
    # ----------------------------------------
    @app.route('/api/sdk/init', methods=['POST', 'OPTIONS'])
    def sdk_init():
        """
        Initialize SDK session.

        Request body:
            {
                "domain": "example.com",
                "path": "/article/123",
                "userAgent": "Mozilla/5.0..."
            }

        Response:
            {
                "sessionId": "sess_abc123",
                "secretKey": 12345678,
                "nonce": 654321,
                "hash": "abc123...",
                "fontUrl": "https://api.../font/abc123.woff2"
            }
        """
        # Handle CORS preflight
        if request.method == 'OPTIONS':
            response = Response()
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-API-Key'
            return response

        # Get API key
        api_key = request.headers.get('X-API-Key')
        data = request.json or {}
        domain = data.get('domain', '')
        path = data.get('path', '/')

        # Validate API key
        is_valid, error, key_data = validate_api_key(api_key, domain)
        if not is_valid:
            return jsonify({'error': error, 'code': 'INVALID_API_KEY'}), 401

        # Generate nonce for this page
        nonce = generate_session_nonce(api_key, domain, path)
        secret_key = key_data.get('secret_key', SECRET_KEY)

        # Create session
        session_id = f"sess_{secrets.token_hex(16)}"
        storage_id = get_storage_id(nonce, secret_key)

        # Store hash for later lookups
        hash_value = store_nonce_sk_hash(nonce, secret_key)

        # Store/update metadata
        existing = get_website_metadata(storage_id)
        if not existing:
            store_website_metadata(storage_id, nonce, secret_key)

        # Generate font URL
        base_url = os.environ.get('BASE_URL', request.url_root.rstrip('/'))
        font_url = f"{base_url}/api/sdk/font/{storage_id}.woff2?hash={hash_value[:16]}"

        # Cache session
        SESSIONS[session_id] = {
            'api_key': api_key,
            'domain': domain,
            'path': path,
            'nonce': nonce,
            'secret_key': secret_key,
            'storage_id': storage_id,
            'hash': hash_value,
            'created_at': time.time(),
            'char_count': 0
        }

        if DEBUG_MODE:
            print(f"[SDK] Init session {session_id[:20]}... for {domain}{path}")
            print(f"[SDK] Nonce: {nonce}, Storage ID: {storage_id}")

        # Generate character mappings to send to client
        # CRITICAL: Use exclude_space=True for SDK mode
        # This ensures:
        # 1. Space is not a source character (not encrypted)
        # 2. Space is not a target character (no character maps TO space)
        # This allows browser whitespace handling to work normally (word wrapping, etc.)
        from utils.generate_font import get_dynamic_mappings
        upper_map, lower_map, space_map = get_dynamic_mappings(secret_key, nonce, exclude_space=True)

        # Combine into single mapping for client
        # With exclude_space=True, lower_map already excludes space
        char_mappings = {}
        char_mappings.update(upper_map)
        char_mappings.update(lower_map)
        # Don't include space_map (only has special chars like null->newline)

        response = jsonify({
            'sessionId': session_id,
            'secretKey': secret_key,
            'nonce': nonce,
            'hash': hash_value,
            'storageId': storage_id,
            'fontUrl': font_url,
            'features': key_data.get('features', []),
            'charMappings': char_mappings  # Send mappings to client
        })

        # CORS headers
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    # ----------------------------------------
    # SDK: Get Font
    # ----------------------------------------
    @app.route('/api/sdk/font/<storage_id>.woff2', methods=['GET', 'OPTIONS'])
    def sdk_get_font(storage_id):
        """
        Get the encrypted font for a session.

        The font is generated on-demand and cached in R2.
        """
        if request.method == 'OPTIONS':
            response = Response()
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response

        hash_prefix = request.args.get('hash', '')

        # Get metadata to retrieve nonce/secret_key
        metadata = get_website_metadata(storage_id)
        if not metadata:
            return jsonify({'error': 'Invalid storage ID'}), 404

        nonce = metadata['nonce']
        secret_key = metadata['secret_key']

        # Try to get cached font from R2
        try:
            s3_client, r2_bucket = get_r2_client()
            font_key = f"storage/{storage_id}/fonts/decryption_font.woff2"

            # Check if font exists
            try:
                response = s3_client.get_object(Bucket=r2_bucket, Key=font_key)
                font_data = response['Body'].read()

                resp = Response(font_data, mimetype='font/woff2')
                resp.headers['Access-Control-Allow-Origin'] = '*'
                resp.headers['Cache-Control'] = 'public, max-age=31536000'  # 1 year
                return resp
            except:
                pass  # Font doesn't exist, generate it

            # Generate font using existing infrastructure
            # CRITICAL: Use exclude_space=True for SDK mode - no character maps TO space
            from utils.font_utils import generate_font_artifacts
            from utils.generate_font import get_dynamic_mappings

            upper_map, lower_map, space_map = get_dynamic_mappings(secret_key, nonce, exclude_space=True)

            # With exclude_space=True, lower_map already excludes space
            # and no character maps TO space

            # Generate font - this will upload to R2 and return the filename
            base_url = os.environ.get('BASE_URL', request.url_root.rstrip('/'))
            font_filename, font_url_gen = generate_font_artifacts(
                secret_key, nonce, upper_map, lower_map, {},  # empty space_map
                base_url=base_url,
                website_id=storage_id
            )

            # Now the font should be in R2 at storage/{storage_id}/fonts/{font_filename}
            actual_font_key = f"storage/{storage_id}/fonts/{font_filename}"
            response = s3_client.get_object(Bucket=r2_bucket, Key=actual_font_key)
            font_data = response['Body'].read()

            resp = Response(font_data, mimetype='font/woff2')
            resp.headers['Access-Control-Allow-Origin'] = '*'
            resp.headers['Cache-Control'] = 'public, max-age=31536000'
            return resp

        except Exception as e:
            print(f"[SDK] Font error: {e}")
            return jsonify({'error': 'Failed to generate font'}), 500

    # ----------------------------------------
    # SDK: Generate Font from URL (for font matching)
    # ----------------------------------------
    @app.route('/api/sdk/font-from-url', methods=['POST', 'OPTIONS'])
    def sdk_font_from_url():
        """
        Generate an encrypted font from a source font URL.

        This allows the SDK to match the page's original fonts by:
        1. Client detects fonts on the page (family, weight, style, URL)
        2. Client requests encrypted versions of each font
        3. Server downloads the font, encrypts it, and returns the URL

        Request body:
            {
                "fontUrl": "https://fonts.gstatic.com/s/...",
                "family": "Open Sans",
                "weight": "400",
                "style": "normal",
                "storageId": "abc123..."
            }

        Response:
            {
                "encryptedFontUrl": "http://localhost:8001/api/sdk/font/abc123/OpenSans-400-normal.woff2",
                "family": "Open Sans",
                "weight": "400",
                "style": "normal"
            }
        """
        if request.method == 'OPTIONS':
            response = Response()
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-API-Key'
            return response

        # Validate API key
        api_key = request.headers.get('X-API-Key')
        is_valid, error, key_data = validate_api_key(api_key)
        if not is_valid:
            return jsonify({'error': error}), 401

        data = request.json or {}
        font_url = data.get('fontUrl', '')
        family = data.get('family', 'Unknown')
        weight = data.get('weight', 'normal')
        style = data.get('style', 'normal')
        storage_id = data.get('storageId', '')

        if not font_url or not storage_id:
            return jsonify({'error': 'fontUrl and storageId are required'}), 400

        # Get metadata to retrieve nonce/secret_key
        metadata = get_website_metadata(storage_id)
        if not metadata:
            return jsonify({'error': 'Invalid storage ID'}), 404

        nonce = metadata['nonce']
        secret_key = metadata['secret_key']

        try:
            from utils.font_utils import generate_font_artifacts, download_font
            from utils.generate_font import get_dynamic_mappings

            # Download the source font
            base_url = os.environ.get('BASE_URL', request.url_root.rstrip('/'))
            local_font_path = download_font(font_url, base_url=base_url)

            if not local_font_path:
                return jsonify({'error': f'Failed to download font from {font_url}'}), 400

            # Get the character mappings
            # CRITICAL: Use exclude_space=True for SDK mode - no character maps TO space
            upper_map, lower_map, space_map = get_dynamic_mappings(secret_key, nonce, exclude_space=True)

            # With exclude_space=True, lower_map already excludes space
            # and no character maps TO space

            # Generate encrypted font from the downloaded source
            font_filename, encrypted_font_url = generate_font_artifacts(
                secret_key=secret_key,
                nonce=nonce,
                upper_map=upper_map,
                lower_map=lower_map,  # Already excludes space with exclude_space=True
                space_map={},  # Empty - no special char mapping needed
                base_url=base_url,
                base_font_path=local_font_path,
                font_family=family,
                font_weight=weight,
                font_style=style,
                website_id=storage_id,
                source_url=font_url  # Critical for unique hash per source font
            )

            if not encrypted_font_url:
                return jsonify({'error': 'Failed to generate encrypted font'}), 500

            response = jsonify({
                'encryptedFontUrl': encrypted_font_url,
                'family': family,
                'weight': weight,
                'style': style,
                'originalUrl': font_url
            })
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response

        except Exception as e:
            print(f"[SDK] Font from URL error: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({'error': str(e)}), 500

    # ----------------------------------------
    # SDK: Resolve Google Fonts
    # ----------------------------------------
    @app.route('/api/sdk/resolve-google-fonts', methods=['POST', 'OPTIONS'])
    def sdk_resolve_google_fonts():
        """
        Resolve Google Fonts CSS URLs to actual font file URLs.

        Google Fonts serves a CSS file that contains @font-face rules with the actual
        font URLs. This endpoint fetches that CSS and extracts the font URLs.

        Request body:
            {
                "cssUrl": "https://fonts.googleapis.com/css2?family=Lora:wght@400;700&display=swap"
            }

        Response:
            {
                "fonts": [
                    {
                        "family": "Lora",
                        "weight": "400",
                        "style": "normal",
                        "url": "https://fonts.gstatic.com/s/lora/v37/..."
                    },
                    ...
                ]
            }
        """
        if request.method == 'OPTIONS':
            response = Response()
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-API-Key'
            return response

        data = request.json or {}
        css_url = data.get('cssUrl', '')

        if not css_url:
            return jsonify({'error': 'cssUrl is required'}), 400

        # Validate it's a Google Fonts URL
        if not css_url.startswith('https://fonts.googleapis.com/'):
            return jsonify({'error': 'Only Google Fonts URLs are supported'}), 400

        try:
            import requests
            import re

            # Use an older User-Agent to get STATIC fonts instead of variable fonts
            # Variable fonts return the same URL for all weights (400, 700, etc.)
            # which breaks our glyph swapping (we can't preserve weight variation).
            # Older browsers get separate static font files for each weight.
            # Firefox 40 is old enough to get static woff2 fonts.
            css_response = requests.get(css_url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; rv:40.0) Gecko/20100101 Firefox/40.0'
            }, timeout=30)
            css_response.raise_for_status()
            css_content = css_response.text

            # Parse @font-face rules
            fonts_raw = []
            font_face_pattern = r'@font-face\s*\{([^}]+)\}'
            for match in re.finditer(font_face_pattern, css_content):
                block = match.group(1)

                # Extract font-family
                family_match = re.search(r"font-family:\s*['\"]?([^;'\"]+)['\"]?", block)
                family = family_match.group(1).strip() if family_match else 'Unknown'

                # Extract font-weight
                weight_match = re.search(r'font-weight:\s*(\d+|normal|bold)', block)
                weight = weight_match.group(1) if weight_match else 'normal'

                # Extract font-style
                style_match = re.search(r'font-style:\s*(\w+)', block)
                style = style_match.group(1) if style_match else 'normal'

                # Extract URL (prefer woff2)
                url_match = re.search(r"url\(([^)]+)\)", block)
                if url_match:
                    url = url_match.group(1).strip("'\"")
                    fonts_raw.append({
                        'family': family,
                        'weight': str(weight),
                        'style': style,
                        'url': url
                    })

            # Deduplicate: keep only one URL per family/weight/style combination
            # (Google serves multiple subsets, we just need one - prefer latin which is usually last)
            seen = {}
            for font in fonts_raw:
                key = (font['family'], font['weight'], font['style'])
                seen[key] = font  # Last one wins (usually latin subset)

            fonts = list(seen.values())

            response = jsonify({'fonts': fonts})
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response

        except Exception as e:
            print(f"[SDK] Error resolving Google Fonts: {e}")
            return jsonify({'error': str(e)}), 500

    # ----------------------------------------
    # SDK: Resolve System Fonts
    # ----------------------------------------
    @app.route('/api/sdk/resolve-system-font', methods=['POST', 'OPTIONS'])
    def sdk_resolve_system_font():
        """
        Resolve a system font (Arial, Times New Roman, etc.) to a downloadable Google Font.

        System fonts can't be downloaded directly, so we map them to metrically-compatible
        Google Fonts alternatives (e.g., Arial -> Arimo, Times New Roman -> Tinos).

        Request body:
            {
                "fontFamily": "Arial",
                "weight": "400",
                "style": "normal"
            }

        Response:
            {
                "found": true,
                "originalFamily": "Arial",
                "googleFont": "Arimo",
                "fonts": [
                    {
                        "family": "Arimo",
                        "weight": "400",
                        "style": "normal",
                        "url": "https://fonts.gstatic.com/s/arimo/..."
                    }
                ]
            }
        """
        if request.method == 'OPTIONS':
            response = Response()
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-API-Key'
            return response

        data = request.json or {}
        font_family = data.get('fontFamily', '')
        requested_weight = data.get('weight', '400')
        requested_style = data.get('style', 'normal')

        if not font_family:
            return jsonify({'error': 'fontFamily is required'}), 400

        # Import system font mapping
        from utils.system_fonts import get_system_font_equivalent

        mapping = get_system_font_equivalent(font_family)
        if not mapping:
            response = jsonify({
                'found': False,
                'originalFamily': font_family,
                'error': f'No mapping found for system font: {font_family}'
            })
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response

        # Resolve the Google Font CSS to get actual font file URLs
        try:
            import requests
            import re

            css_url = mapping['css_url']

            # Use older User-Agent to get static fonts (not variable fonts)
            css_response = requests.get(css_url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; rv:40.0) Gecko/20100101 Firefox/40.0'
            }, timeout=30)
            css_response.raise_for_status()
            css_content = css_response.text

            # Parse @font-face rules
            fonts_raw = []
            font_face_pattern = r'@font-face\s*\{([^}]+)\}'
            for match in re.finditer(font_face_pattern, css_content):
                block = match.group(1)

                # Extract font-family
                family_match = re.search(r"font-family:\s*['\"]?([^;'\"]+)['\"]?", block)
                family = family_match.group(1).strip() if family_match else mapping['google_font']

                # Extract font-weight
                weight_match = re.search(r'font-weight:\s*(\d+|normal|bold)', block)
                weight = weight_match.group(1) if weight_match else 'normal'

                # Extract font-style
                style_match = re.search(r'font-style:\s*(\w+)', block)
                style = style_match.group(1) if style_match else 'normal'

                # Extract URL (prefer woff2)
                url_match = re.search(r"url\(([^)]+)\)", block)
                if url_match:
                    url = url_match.group(1).strip("'\"")
                    fonts_raw.append({
                        'family': family,
                        'weight': str(weight),
                        'style': style,
                        'url': url
                    })

            # Deduplicate by family/weight/style
            seen = {}
            for font in fonts_raw:
                key = (font['family'], font['weight'], font['style'])
                seen[key] = font

            fonts = list(seen.values())

            # Find the best match for requested weight/style
            best_match = None
            for font in fonts:
                if font['weight'] == requested_weight and font['style'] == requested_style:
                    best_match = font
                    break

            # If no exact match, try to find closest weight
            if not best_match and fonts:
                # Try same style, any weight
                for font in fonts:
                    if font['style'] == requested_style:
                        best_match = font
                        break
                # Fall back to first available
                if not best_match:
                    best_match = fonts[0]

            response = jsonify({
                'found': True,
                'originalFamily': font_family,
                'googleFont': mapping['google_font'],
                'fonts': fonts,
                'bestMatch': best_match
            })
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response

        except Exception as e:
            print(f"[SDK] Error resolving system font {font_family}: {e}")
            return jsonify({
                'found': False,
                'originalFamily': font_family,
                'error': str(e)
            }), 500

    # ----------------------------------------
    # SDK: Report Usage
    # ----------------------------------------
    @app.route('/api/sdk/usage', methods=['POST', 'OPTIONS'])
    def sdk_report_usage():
        """
        Report usage statistics.

        Request body:
            {
                "domain": "example.com",
                "path": "/article/123",
                "characters": 5000,
                "sessionId": "sess_abc123"
            }
        """
        if request.method == 'OPTIONS':
            response = Response()
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-API-Key'
            return response

        api_key = request.headers.get('X-API-Key')
        data = request.json or {}

        # Validate API key
        is_valid, error, key_data = validate_api_key(api_key)
        if not is_valid:
            return jsonify({'error': error}), 401

        characters = data.get('characters', 0)
        session_id = data.get('sessionId')

        # Update session
        if session_id and session_id in SESSIONS:
            SESSIONS[session_id]['char_count'] = characters

        # Update API key usage count
        key_data['usage_count'] = key_data.get('usage_count', 0) + characters
        store_api_key_data(api_key, key_data)

        # Store detailed usage log (for billing)
        try:
            s3_client, r2_bucket = get_r2_client()
            usage_key = f"{USAGE_R2_PREFIX}{api_key}/{datetime.utcnow().strftime('%Y-%m-%d')}.jsonl"

            # Append to daily log
            log_entry = json.dumps({
                'timestamp': datetime.utcnow().isoformat(),
                'domain': data.get('domain'),
                'path': data.get('path'),
                'characters': characters,
                'session_id': session_id
            }) + '\n'

            # Get existing log and append
            try:
                existing = s3_client.get_object(Bucket=r2_bucket, Key=usage_key)
                existing_data = existing['Body'].read().decode('utf-8')
            except:
                existing_data = ''

            s3_client.put_object(
                Bucket=r2_bucket,
                Key=usage_key,
                Body=(existing_data + log_entry).encode('utf-8'),
                ContentType='application/jsonl'
            )
        except Exception as e:
            if DEBUG_MODE:
                print(f"[SDK] Failed to log usage: {e}")

        response = jsonify({
            'status': 'ok',
            'totalUsage': key_data['usage_count']
        })
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    # ----------------------------------------
    # SDK: Get Usage Stats
    # ----------------------------------------
    @app.route('/api/sdk/stats', methods=['GET'])
    @require_api_key
    def sdk_get_stats():
        """Get usage statistics for an API key."""
        key_data = request.key_data

        return jsonify({
            'name': key_data.get('name'),
            'usage_count': key_data.get('usage_count', 0),
            'usage_limit': key_data.get('usage_limit', 0),
            'billing_cycle_start': key_data.get('billing_cycle_start'),
            'features': key_data.get('features', [])
        })

    # ----------------------------------------
    # SDK: Search (server-side)
    # ----------------------------------------
    @app.route('/api/sdk/search', methods=['POST', 'OPTIONS'])
    def sdk_search():
        """
        Server-side search for SDK.

        Request body:
            {
                "query": "search term",
                "hash": "abc123..."
            }

        Response:
            {
                "matches": [{"start": 0, "end": 5}, ...]
            }
        """
        if request.method == 'OPTIONS':
            response = Response()
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-API-Key'
            return response

        data = request.json or {}
        query = data.get('query', '')
        hash_value = data.get('hash', '')

        if not query or not hash_value:
            return jsonify({'error': 'query and hash are required'}), 400

        # Reuse existing search endpoint logic
        from utils.r2_website_storage import get_nonce_sk_from_hash, get_plaintext_index

        hash_data = get_nonce_sk_from_hash(hash_value)
        if not hash_data:
            return jsonify({'error': 'Invalid hash'}), 404

        storage_id = get_storage_id(hash_data['nonce'], hash_data['secret_key'])
        plaintext = get_plaintext_index(storage_id)

        if not plaintext:
            return jsonify({'error': 'Plaintext not found'}), 404

        # Case-insensitive search
        query_lower = query.lower()
        text_lower = plaintext.lower()

        matches = []
        start_pos = 0
        while True:
            idx = text_lower.find(query_lower, start_pos)
            if idx == -1:
                break
            matches.append({'start': idx, 'end': idx + len(query)})
            start_pos = idx + 1

        response = jsonify({'matches': matches, 'total': len(matches)})
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    # ----------------------------------------
    # SDK: Upload Plaintext
    # ----------------------------------------
    @app.route('/api/sdk/upload-plaintext', methods=['POST', 'OPTIONS'])
    def sdk_upload_plaintext():
        """
        Upload plaintext from client for server-side search/copy.

        Request body:
            {
                "storageId": "abc123...",
                "hash": "def456...",
                "plaintext": "The full text content...",
                "sessionId": "sess_xyz..."
            }
        """
        if request.method == 'OPTIONS':
            response = Response()
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-API-Key'
            return response

        # Validate API key
        api_key = request.headers.get('X-API-Key')
        is_valid, error, key_data = validate_api_key(api_key)
        if not is_valid:
            return jsonify({'error': error}), 401

        # DIAGNOSTIC: Check raw request body before parsing JSON
        raw_body = request.get_data()
        print(f"[SDK DIAGNOSTIC] Raw request body length: {len(raw_body)} bytes")
        print(f"[SDK DIAGNOSTIC] Content-Length header: {request.content_length}")

        data = request.json or {}
        storage_id = data.get('storageId', '')
        hash_value = data.get('hash', '')
        plaintext = data.get('plaintext', '')
        session_id = data.get('sessionId', '')

        print(f"[SDK DIAGNOSTIC] Parsed JSON plaintext field length: {len(plaintext)} chars")
        print(f"[SDK DIAGNOSTIC] First 200 chars: {repr(plaintext[:200])}")
        print(f"[SDK DIAGNOSTIC] Last 100 chars: {repr(plaintext[-100:])}")

        if not storage_id or not plaintext:
            return jsonify({'error': 'storageId and plaintext are required'}), 400

        # Store plaintext using existing infrastructure
        from utils.r2_website_storage import store_plaintext_index

        try:
            # Use hash_value as the html_hash for SDK-encrypted content
            # This allows lookup via the encryption hash
            html_hash = hash_value if hash_value else storage_id
            success = store_plaintext_index(storage_id, html_hash, plaintext)

            if success:
                # CRITICAL: Invalidate the in-memory cache so new plaintext is used immediately
                # Without this, the server serves stale plaintext for up to 1 hour!
                invalidate_plaintext_cache(storage_id)

                # Calculate hash of stored plaintext for integrity verification
                stored_hash = hashlib.sha256(plaintext.encode('utf-8')).hexdigest()

                if DEBUG_MODE:
                    print(f"[SDK] Stored plaintext for {storage_id}: {len(plaintext)} chars")

                response = jsonify({
                    'status': 'ok',
                    'stored_length': len(plaintext),
                    'stored_hash': stored_hash
                })
            else:
                response = jsonify({
                    'status': 'error',
                    'message': 'Failed to store plaintext'
                })

            response.headers['Access-Control-Allow-Origin'] = '*'
            return response

        except Exception as e:
            if DEBUG_MODE:
                print(f"[SDK] Failed to store plaintext: {e}")
            return jsonify({'error': str(e)}), 500

    if DEBUG_MODE:
        print("[SDK] Routes registered")
