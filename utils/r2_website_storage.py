#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
R2 Website Storage Module
Handles persistent storage of nonces and fonts in Cloudflare R2.

Storage Structure:
    storage/
        {storage_id}/              # storage_id = hash(nonce + secret_key)
            metadata.json          # Stores nonce, secret_key, created_at
            fonts/
                decryption_{font_hash}.woff2
            html_cache/
                {html_hash}.html   # Cached encrypted HTML keyed by content hash
"""

import os
import json
import hashlib
import base64
import re
import requests
import time
from datetime import datetime
from urllib.parse import urlparse

# Optional R2 support
try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
    R2_AVAILABLE = True
except ImportError:
    R2_AVAILABLE = False
    ClientError = None

# Debug mode
DEBUG_MODE = os.environ.get('DEBUG', 'false').lower() == 'true'

# Font algorithm version - MUST match font_utils.py!
# BUMP THIS when font generation logic changes to invalidate cached fonts
# v3 = Original TrueType-only support
# v4 = Added CFF/OTF font support (Dec 2024)
# v5 = Fixed kerning remapping (Dec 2024) - now properly remaps kern pairs
FONT_ALGORITHM_VERSION = "v5"


def get_r2_client():
    """Get configured R2 S3 client. REQUIRED - raises error if not configured."""
    if not R2_AVAILABLE:
        raise RuntimeError("R2 is REQUIRED but boto3 is not installed. Install with: pip install boto3")
    
    r2_account_id = os.environ.get('R2_ACCOUNT_ID')
    r2_access_key = os.environ.get('R2_ACCESS_KEY_ID')
    r2_secret_key = os.environ.get('R2_SECRET_ACCESS_KEY')
    r2_bucket = os.environ.get('R2_BUCKET_NAME')
    
    missing = []
    if not r2_account_id:
        missing.append('R2_ACCOUNT_ID')
    if not r2_access_key:
        missing.append('R2_ACCESS_KEY_ID')
    if not r2_secret_key:
        missing.append('R2_SECRET_ACCESS_KEY')
    if not r2_bucket:
        missing.append('R2_BUCKET_NAME')
    
    if missing:
        raise RuntimeError(f"R2 is REQUIRED but missing environment variables: {', '.join(missing)}")
    
    try:
        s3_client = boto3.client(
            's3',
            endpoint_url=f'https://{r2_account_id}.r2.cloudflarestorage.com',
            aws_access_key_id=r2_access_key,
            aws_secret_access_key=r2_secret_key,
            config=Config(signature_version='s3v4')
        )
        return s3_client, r2_bucket
    except Exception as e:
        error_msg = f"R2 is REQUIRED but failed to create R2 client: {type(e).__name__}: {e}"
        print(f"❌ {error_msg}")
        raise RuntimeError(error_msg) from e


def get_storage_id(nonce: int, secret_key: int) -> str:
    """
    Generate a storage ID from nonce and secret_key.
    This replaces the old website_id system.
    
    Args:
        nonce: Encryption nonce
        secret_key: Encryption secret key
    
    Returns:
        Storage ID (16-character hex hash)
    """
    hash_input = f"{secret_key}_{nonce}"
    storage_id = hashlib.md5(hash_input.encode()).hexdigest()[:16]
    return storage_id


def extract_website_id(request, secret_key: int = None, nonce: int = None) -> tuple:
    """
    DEPRECATED: Use get_storage_id(nonce, secret_key) instead.
    This function is kept for backward compatibility but will be removed.
    """
    if nonce is None or secret_key is None:
        # Fallback to old behavior if nonce/secret_key not provided
        domain = 'default'
        if hasattr(request, 'headers'):
            origin = request.headers.get('Origin', '')
            if origin:
                parsed = urlparse(origin)
                domain = parsed.netloc.lower().replace('www.', '').strip() or 'default'
        
        hash_input = domain
        if secret_key is not None:
            hash_input = f"{domain}_{secret_key}"
        if nonce is not None:
            hash_input = f"{hash_input}_{nonce}"
        
        website_id = hashlib.md5(hash_input.encode()).hexdigest()[:16]
        return website_id, domain
    
    # New behavior: use storage_id
    storage_id = get_storage_id(nonce, secret_key)
    return storage_id, None


def get_website_metadata(storage_id: str) -> dict:
    """
    Retrieve website metadata (nonce, secret_key) from R2.
    
    Args:
        storage_id: Storage ID (hash of nonce + secret_key)
    
    Returns:
        dict with keys: nonce, secret_key, created_at
        Returns None if not found (but R2 must be configured)
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    
    # R2 path: storage/{storage_id}/metadata.json
    r2_key = f"storage/{storage_id}/metadata.json"
    
    try:
        # Optimize: Skip head_object check, go straight to get_object
        # If it doesn't exist, get_object will raise ClientError with 404
        # This saves one R2 API call and reduces latency
        response = s3_client.get_object(Bucket=r2_bucket, Key=r2_key)
        metadata_json = response['Body'].read().decode('utf-8')
        metadata = json.loads(metadata_json)
        
        if DEBUG_MODE:
            print(f"✅ Retrieved metadata for storage {storage_id}: nonce={metadata.get('nonce')}")
        
        return metadata
    except ClientError as e:
        # Check if it's a 404 (Not Found) - this is expected when metadata doesn't exist
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code in ('404', 'NoSuchKey'):
            if DEBUG_MODE:
                print(f"📝 No metadata found for storage {storage_id}")
            return None
        # Other ClientErrors are real errors
        error_msg = f"❌ CRITICAL: Failed to retrieve metadata for {storage_id}: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e
    except s3_client.exceptions.NoSuchKey:
        if DEBUG_MODE:
            print(f"📝 No metadata found for storage {storage_id}")
        return None
    except Exception as e:
        error_msg = f"❌ CRITICAL: Failed to retrieve metadata for {storage_id}: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e


def store_website_metadata(storage_id: str, nonce: int, secret_key: int, overwrite: bool = False) -> bool:
    """
    Store website metadata in R2.
    By default, only creates if doesn't exist (immutable once created).
    If overwrite=True, will overwrite existing metadata.
    
    Args:
        storage_id: Storage ID (hash of nonce + secret_key)
        nonce: Encryption nonce
        secret_key: Encryption secret key
        overwrite: If True, overwrite existing metadata (default: False)
    
    Returns:
        True if stored, False if already exists (and overwrite=False)
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    
    # R2 path: storage/{storage_id}/metadata.json
    r2_key = f"storage/{storage_id}/metadata.json"
    
    try:
        # Check if already exists
        if not overwrite:
            try:
                s3_client.head_object(Bucket=r2_bucket, Key=r2_key)
                # Already exists - don't overwrite (immutable)
                if DEBUG_MODE:
                    print(f"✅ Metadata already exists for storage {storage_id}, not overwriting")
                return False
            except ClientError as e:
                # Check if it's a 404 (Not Found) - this means it doesn't exist, so create it
                error_code = e.response.get('Error', {}).get('Code', '')
                if error_code in ('404', 'NoSuchKey'):
                    # Doesn't exist - create it
                    pass
                else:
                    # Other ClientErrors are real errors
                    raise
            except s3_client.exceptions.NoSuchKey:
                # Doesn't exist - create it
                pass
        else:
            # Overwrite mode - proceed to create/update
            if DEBUG_MODE:
                print(f"📝 Overwriting metadata for storage {storage_id}")
        
        # Create metadata JSON
        metadata = {
            'nonce': nonce,
            'secret_key': secret_key,
            'storage_id': storage_id,
            'created_at': datetime.utcnow().isoformat()
        }
        metadata_json = json.dumps(metadata, indent=2)
        
        # Upload to R2
        s3_client.put_object(
            Bucket=r2_bucket,
            Key=r2_key,
            Body=metadata_json.encode('utf-8'),
            ContentType='application/json'
        )
        
        # Store storage_id locally for easy deletion later
        try:
            current_storage_file = os.path.join(os.path.dirname(__file__), 'current_storage_id.json')
            current_storage_data = {
                'storage_id': storage_id,
                'secret_key': secret_key,
                'nonce': nonce,
                'created_at': datetime.utcnow().isoformat()
            }
            with open(current_storage_file, 'w') as f:
                json.dump(current_storage_data, f, indent=2)
            if DEBUG_MODE:
                print(f"💾 Stored current storage_id locally: {storage_id}")
        except Exception as e:
            # Don't fail if local file write fails - R2 storage is the important part
            if DEBUG_MODE:
                print(f"⚠️ Failed to store storage_id locally: {e}")
        
        if DEBUG_MODE:
            print(f"✅ Stored metadata for storage {storage_id}: nonce={nonce}")
        
        return True
    except Exception as e:
        error_msg = f"❌ CRITICAL: Failed to store metadata for {storage_id}: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e


def check_font_in_r2(storage_id: str, font_filename: str) -> str:
    """
    Check if font exists in R2 for this storage ID and return public URL.
    
    Args:
        storage_id: Storage ID (hash of nonce + secret_key)
        font_filename: Font filename
    
    Returns:
        Public URL if found, None if not found (but R2 must be configured)
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    r2_public_url = os.environ.get('R2_PUBLIC_URL', '').rstrip('/')
    
    if not r2_public_url:
        return None
    
    # R2 path: storage/{storage_id}/fonts/{font_filename}
    r2_key = f"storage/{storage_id}/fonts/{font_filename}"
    
    try:
        # Check if object exists
        s3_client.head_object(Bucket=r2_bucket, Key=r2_key)
        
        # Return public URL
        font_url = f"{r2_public_url}/{r2_key}"
        
        if DEBUG_MODE:
            print(f"✅ Font exists in R2: {font_url}")
        
        return font_url
    except ClientError as e:
        # Check if it's a 404 (Not Found) - this is expected when font doesn't exist
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code in ('404', 'NoSuchKey'):
            if DEBUG_MODE:
                print(f"📝 Font not found in R2: {r2_key}")
            return None
        # Other ClientErrors are real errors
        error_msg = f"❌ CRITICAL: Failed to check font in R2 for {storage_id}: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e
    except s3_client.exceptions.NoSuchKey:
        if DEBUG_MODE:
            print(f"📝 Font not found in R2: {r2_key}")
        return None
    except Exception as e:
        error_msg = f"❌ CRITICAL: Failed to check font in R2 for {storage_id}: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e


def upload_font_to_r2_website(storage_id: str, font_path: str, font_filename: str) -> str:
    """
    Upload font to R2 with storage-specific path.
    
    Args:
        storage_id: Storage ID (hash of nonce + secret_key)
        font_path: Local path to font file
        font_filename: Font filename
    
    R2 path: storage/{storage_id}/fonts/{font_filename}
    
    Returns:
        Public URL if successful, None if failed (but R2 must be configured)
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    r2_public_url = os.environ.get('R2_PUBLIC_URL', '').rstrip('/')
    
    if not r2_public_url:
        return None
    
    if not os.path.exists(font_path):
        if DEBUG_MODE:
            print(f"⚠️ Font file does not exist: {font_path}")
        return None
    
    # R2 path: storage/{storage_id}/fonts/{font_filename}
    r2_key = f"storage/{storage_id}/fonts/{font_filename}"
    
    try:
        # Upload font to R2
        s3_client.upload_file(
            font_path,
            r2_bucket,
            r2_key,
            ExtraArgs={'ContentType': 'font/woff2'}
        )
        
        # Verify font is readable (not just exists) - read first 100 bytes to ensure it's available
        # Since upload_file is synchronous, the font should be immediately readable
        try:
            response = s3_client.get_object(Bucket=r2_bucket, Key=r2_key, Range='bytes=0-99')
            verification_data = response['Body'].read()
            if len(verification_data) == 0:
                raise RuntimeError(f"Font {r2_key} uploaded but verification read returned empty data")
            if DEBUG_MODE:
                print(f"✅ Font uploaded and verified readable in R2: {r2_key} ({len(verification_data)} bytes verified)")
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            if error_code in ('404', 'NoSuchKey'):
                error_msg = f"❌ Font {r2_key} uploaded but not immediately readable - R2 consistency issue"
                print(error_msg)
                raise RuntimeError(error_msg) from e
            else:
                # Other error - re-raise
                raise
        except Exception as e:
            error_msg = f"❌ Failed to verify font {r2_key} after upload: {type(e).__name__}: {e}"
            print(error_msg)
            raise RuntimeError(error_msg) from e
        
        # Return public URL
        font_url = f"{r2_public_url}/{r2_key}"
        
        if DEBUG_MODE:
            print(f"✅ Font uploaded and verified in R2: {font_url}")
        
        return font_url
    except Exception as e:
        error_msg = f"❌ CRITICAL: Failed to upload font to R2 for {storage_id}: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e


def get_font_url_for_website(storage_id: str, nonce: int, secret_key: int, 
                             font_family: str = None, font_weight: str = None, 
                             font_style: str = None, source_url: str = None) -> str:
    """
    Get font URL for a website without regenerating.
    Checks R2 first, returns URL if found.
    
    This is used for lazy-loaded content to get the font URL
    without needing to regenerate the font.
    
    Args:
        source_url: Original URL of the source font (CRITICAL for unique hash per font)
    """
    # Calculate expected font hash (same logic as generate_font_artifacts)
    # MUST include source_url to match the hash used during font generation
    hash_input = f"{secret_key}_{nonce}_{FONT_ALGORITHM_VERSION}"
    if source_url:
        hash_input += f"_{source_url}"  # Makes each source font unique
    if font_family:
        hash_input += f"_{font_family}"
    if font_weight:
        hash_input += f"_{font_weight}"
    if font_style:
        hash_input += f"_{font_style}"
    font_hash = hashlib.md5(hash_input.encode('utf-8')).hexdigest()[:12]
    font_filename = f"decryption_{font_hash}.woff2"
    
    # Check R2
    font_url = check_font_in_r2(storage_id, font_filename)
    if font_url:
        return font_url
    
    # If not found, return None (shouldn't happen if system works correctly)
    if DEBUG_MODE:
        print(f"⚠️ Font not found in R2 for storage {storage_id}, font {font_filename}")
    return None


def calculate_html_hash(html_content: str) -> str:
    """
    Calculate SHA256 hash of HTML content for cache key.
    Includes FONT_ALGORITHM_VERSION so cache invalidates when font logic changes.
    
    Args:
        html_content: Raw HTML string
    
    Returns:
        SHA256 hash as hex string
    """
    # Include font version in hash so cache invalidates when font algorithm changes
    hash_input = f"{FONT_ALGORITHM_VERSION}:{html_content}"
    return hashlib.sha256(hash_input.encode('utf-8')).hexdigest()


# ============================================================================
# URL-based caching (for /api/encrypt-url endpoint)
# ============================================================================

def get_url_cache_key(url: str, secret_key: int) -> str:
    """
    Generate a cache key from URL + secret_key.

    Args:
        url: The URL being encrypted
        secret_key: Encryption secret key

    Returns:
        SHA256 hash as hex string
    """
    content = f"{url}_{secret_key}_{FONT_ALGORITHM_VERSION}"
    return hashlib.sha256(content.encode()).hexdigest()


def store_url_cache(url_hash: str, response_data: dict) -> bool:
    """
    Store complete API response by URL hash.

    Args:
        url_hash: SHA256 hash of URL + secret_key
        response_data: Complete API response dict (encrypted_html, font_url, nonce, etc.)

    Returns:
        True if stored successfully
    """
    r2_client_info = get_r2_client()
    s3_client, r2_bucket = r2_client_info

    # Add timestamp
    response_data['cached_at'] = datetime.utcnow().isoformat() + 'Z'

    # R2 path: url_cache/{url_hash}.json
    r2_key = f"url_cache/{url_hash}.json"

    try:
        s3_client.put_object(
            Bucket=r2_bucket,
            Key=r2_key,
            Body=json.dumps(response_data).encode('utf-8'),
            ContentType='application/json'
        )

        if DEBUG_MODE:
            print(f"✅ Stored URL cache: {url_hash[:16]}...")

        return True
    except Exception as e:
        print(f"❌ Failed to store URL cache: {type(e).__name__}: {e}")
        return False


def get_url_cache(url_hash: str) -> dict:
    """
    Retrieve cached response by URL hash.

    Args:
        url_hash: SHA256 hash of URL + secret_key

    Returns:
        Cached response dict, or None if not found
    """
    r2_client_info = get_r2_client()
    s3_client, r2_bucket = r2_client_info

    # R2 path: url_cache/{url_hash}.json
    r2_key = f"url_cache/{url_hash}.json"

    try:
        response = s3_client.get_object(Bucket=r2_bucket, Key=r2_key)
        cached_json = response['Body'].read().decode('utf-8')
        cached_data = json.loads(cached_json)

        if DEBUG_MODE:
            print(f"✅ Retrieved URL cache: {url_hash[:16]}...")

        return cached_data
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code in ('404', 'NoSuchKey'):
            if DEBUG_MODE:
                print(f"📝 No URL cache found: {url_hash[:16]}...")
            return None
        print(f"❌ Failed to retrieve URL cache: {type(e).__name__}: {e}")
        return None
    except Exception as e:
        print(f"❌ Failed to retrieve URL cache: {type(e).__name__}: {e}")
        return None


def get_cached_encrypted_html(storage_id: str, html_hash: str) -> str:
    """
    Retrieve cached encrypted HTML from R2.
    
    Args:
        storage_id: Storage ID (hash of nonce + secret_key)
        html_hash: SHA256 hash of original HTML content
    
    Returns:
        Cached encrypted HTML string, or None if not found (but R2 must be configured)
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    
    # R2 path: storage/{storage_id}/html_cache/{html_hash}.html
    r2_key = f"storage/{storage_id}/html_cache/{html_hash}.html"
    
    try:
        # Optimize: Skip head_object check, go straight to get_object
        # If it doesn't exist, get_object will raise ClientError with 404
        # This saves one R2 API call and reduces latency
        response = s3_client.get_object(Bucket=r2_bucket, Key=r2_key)
        cached_html = response['Body'].read().decode('utf-8')
        
        if DEBUG_MODE:
            print(f"✅ Retrieved cached encrypted HTML for storage {storage_id} (hash: {html_hash[:16]}...)")
        
        return cached_html
    except ClientError as e:
        # Check if it's a 404 (Not Found) - this is expected when cache doesn't exist
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code in ('404', 'NoSuchKey'):
            if DEBUG_MODE:
                print(f"📝 No cached HTML found for storage {storage_id} (hash: {html_hash[:16]}...)")
            return None
        # Other ClientErrors are real errors
        error_msg = f"❌ CRITICAL: Failed to retrieve cached HTML for {storage_id}: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e
    except s3_client.exceptions.NoSuchKey:
        if DEBUG_MODE:
            print(f"📝 No cached HTML found for storage {storage_id} (hash: {html_hash[:16]}...)")
        return None
    except Exception as e:
        error_msg = f"❌ CRITICAL: Failed to retrieve cached HTML for {storage_id}: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e


def get_encrypted_html_by_hash(hash_value: str, html_hash: str = None) -> str:
    """
    Retrieve encrypted HTML from R2 using the nonce/secret_key hash.

    Args:
        hash_value: Hash of nonce + secret_key (SHA256)
        html_hash: Optional specific HTML cache hash. If None, returns most recent.

    Returns:
        Encrypted HTML string, or None if not found
    """
    # Get storage_id from hash
    hash_data = get_nonce_sk_from_hash(hash_value)
    if not hash_data:
        return None

    secret_key = hash_data['secret_key']
    nonce = hash_data['nonce']
    storage_id = get_storage_id(nonce, secret_key)

    # If html_hash provided, retrieve specific cached HTML
    if html_hash:
        return get_cached_encrypted_html(storage_id, html_hash)

    # Otherwise, list all HTML cache files and return most recent
    s3_client, r2_bucket = get_r2_client()
    prefix = f"storage/{storage_id}/html_cache/"

    try:
        response = s3_client.list_objects_v2(
            Bucket=r2_bucket,
            Prefix=prefix,
            MaxKeys=1  # Most recent only
        )

        if 'Contents' not in response or len(response['Contents']) == 0:
            return None

        # Get first (most recent) HTML file
        most_recent_key = response['Contents'][0]['Key']
        html_hash = most_recent_key.split('/')[-1].replace('.html', '')

        return get_cached_encrypted_html(storage_id, html_hash)
    except Exception as e:
        if DEBUG_MODE:
            print(f"Error retrieving HTML by hash: {e}")
        return None


def store_plaintext_index(storage_id: str, html_hash: str, plaintext: str) -> bool:
    """
    Store plaintext index (text content only, no HTML tags) in R2 for search functionality.
    This is stored during encryption so search can use pre-built plaintext instead of decrypting.

    Args:
        storage_id: Storage ID (hash of nonce + secret_key)
        html_hash: SHA256 hash of original HTML content (to match with encrypted HTML)
        plaintext: Plain text content extracted from HTML (no tags, just text)

    Returns:
        True if successful, False otherwise
    """
    try:
        s3_client, r2_bucket = get_r2_client()

        # Store in storage/{storage_id}/plaintext_index/{html_hash}.txt
        key = f"storage/{storage_id}/plaintext_index/{html_hash}.txt"

        # DIAGNOSTIC: Log what we're about to store
        encoded_body = plaintext.encode('utf-8')
        print(f"[R2 DIAGNOSTIC] Storing to key: {key}")
        print(f"[R2 DIAGNOSTIC] Plaintext length: {len(plaintext)} chars")
        print(f"[R2 DIAGNOSTIC] Encoded body length: {len(encoded_body)} bytes")
        print(f"[R2 DIAGNOSTIC] First 200 chars: {repr(plaintext[:200])}")
        print(f"[R2 DIAGNOSTIC] Last 100 chars: {repr(plaintext[-100:])}")

        s3_client.put_object(
            Bucket=r2_bucket,
            Key=key,
            Body=encoded_body,
            ContentType='text/plain; charset=utf-8'
        )

        if DEBUG_MODE:
            print(f"✅ Stored plaintext index for {storage_id} (hash: {html_hash[:16]}..., {len(plaintext)} chars)")

        return True
    except Exception as e:
        error_msg = f"❌ Failed to store plaintext index for {storage_id}: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        return False


def get_plaintext_index(storage_id: str, html_hash: str = None) -> str:
    """
    Retrieve plaintext index from R2 for search functionality.

    Args:
        storage_id: Storage ID (hash of nonce + secret_key)
        html_hash: Optional specific HTML hash. If None, returns most recent.

    Returns:
        Plaintext string, or None if not found
    """
    try:
        s3_client, r2_bucket = get_r2_client()

        if html_hash:
            # Retrieve specific plaintext index
            key = f"storage/{storage_id}/plaintext_index/{html_hash}.txt"
        else:
            # List all plaintext index files and get most recent
            prefix = f"storage/{storage_id}/plaintext_index/"
            response = s3_client.list_objects_v2(
                Bucket=r2_bucket,
                Prefix=prefix,
                MaxKeys=1  # Most recent only
            )

            if 'Contents' not in response or len(response['Contents']) == 0:
                if DEBUG_MODE:
                    print(f"📝 No plaintext index found for storage {storage_id}")
                return None

            # Get first (most recent) plaintext file
            key = response['Contents'][0]['Key']

        # Retrieve plaintext
        response = s3_client.get_object(Bucket=r2_bucket, Key=key)
        plaintext = response['Body'].read().decode('utf-8')

        if DEBUG_MODE:
            print(f"✅ Retrieved plaintext index for {storage_id} ({len(plaintext)} chars)")

        return plaintext
    except Exception as e:
        if DEBUG_MODE:
            print(f"Error retrieving plaintext index: {e}")
        return None


def store_encrypted_html(storage_id: str, html_hash: str, encrypted_html: str, inline_fonts: bool = True) -> bool:
    """
    Store encrypted HTML in R2 cache.
    Optionally inlines fonts as base64 data URIs for instant loading.
    
    Args:
        storage_id: Storage ID (hash of nonce + secret_key)
        html_hash: SHA256 hash of original HTML content
        encrypted_html: The fully encrypted HTML string
        inline_fonts: If True, inline fonts as base64 data URIs (default: True)
    
    Returns:
        True if stored successfully, False otherwise (but R2 must be configured)
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    
    # Inline fonts as base64 for instant loading (no separate network requests)
    if inline_fonts:
        try:
            encrypted_html = inline_fonts_as_base64(encrypted_html, storage_id)
            
            # CRITICAL: Validate that fonts were actually inlined
            fontface_count = len(re.findall(r'@font-face', encrypted_html, re.IGNORECASE))
            base64_count = encrypted_html.count('data:font/woff2;base64,')
            
            if DEBUG_MODE:
                print(f"✅ Inlined fonts as base64 in HTML for {storage_id}: {fontface_count} @font-face rules, {base64_count} base64 fonts")
            
            # If there are @font-face rules but no base64 fonts, that's okay
            # This can happen if fonts aren't in R2 yet (e.g., still uploading, or after clearing R2 cache)
            # The retry logic in inline_fonts_as_base64 should have tried to wait for them
            # If they're still not available, we'll serve with URLs instead
            if fontface_count > 0 and base64_count == 0:
                warning_msg = f"⚠️ Found {fontface_count} @font-face rules but no base64 fonts were inlined. Fonts may still be uploading to R2. HTML will be served with font URLs instead."
                print(warning_msg)
                # Don't raise error - allow HTML to be stored with original font URLs
                # The page will still work, just fonts will load via network requests
            
            # If there are font URLs (not base64) in @font-face rules, that's okay
            # They'll be served via proxy-font endpoint or R2 URLs
            # Just log for debugging
            proxy_font_pattern = r"url\s*\(\s*['\"]?/proxy-font/"
            r2_url_pattern = r"url\s*\(\s*['\"]?https?://[^'\"]*r2[^'\"]*"
            proxy_fonts = len(re.findall(proxy_font_pattern, encrypted_html, re.IGNORECASE))
            r2_url_fonts = len(re.findall(r2_url_pattern, encrypted_html, re.IGNORECASE))
            non_base64_urls = proxy_fonts + r2_url_fonts
            if non_base64_urls > 0 and DEBUG_MODE:
                print(f"ℹ️ Found {non_base64_urls} font URL(s) that weren't inlined as base64. These will be served via proxy-font or R2 URLs.")
                
        except RuntimeError:
            # Re-raise RuntimeError (our validation errors)
            raise
        except Exception as e:
            error_msg = f"❌ CRITICAL: Failed to inline fonts: {type(e).__name__}: {e}"
            print(error_msg)
            import traceback
            traceback.print_exc()
            raise RuntimeError(error_msg) from e
    
    # Inject CSS and JavaScript to hide content until fonts are ready
    # This prevents FOUT (Flash of Unstyled Text) and ensures fonts load before content is shown
    hide_css = """
<style id="font-loading-hide">
    body { 
        visibility: hidden; 
        opacity: 0; 
    }
</style>
"""
    
    show_script = """
<script>
(function() {
    function showContent() {
        const style = document.getElementById('font-loading-hide');
        if (style) {
            style.remove();
        }
        document.body.style.visibility = 'visible';
        document.body.style.opacity = '1';
    }
    
    // Check if Font Loading API is available
    if (document.fonts && document.fonts.ready) {
        // Wait for all fonts to be ready (works for both inlined base64 and URL fonts)
        document.fonts.ready.then(function() {
            // Additional verification: small delay to ensure fonts are parsed
            // For base64 fonts, this should be nearly instant
            setTimeout(function() {
                showContent();
            }, 50);
        }).catch(function(err) {
            console.warn('Font loading error:', err);
            // Fallback: show after timeout
            setTimeout(showContent, 100);
        });
        
        // Safety timeout: show content after 3 seconds max (prevents indefinite hiding)
        setTimeout(showContent, 3000);
    } else {
        // Fallback for browsers without Font Loading API
        // For base64 fonts, they should parse almost instantly
        setTimeout(showContent, 100);
    }
})();
</script>
"""
    
    # Inject CSS and script into HTML
    # Insert CSS in <head>
    if '<head>' in encrypted_html:
        encrypted_html = encrypted_html.replace('<head>', f'<head>{hide_css}', 1)
    elif '<html>' in encrypted_html:
        encrypted_html = encrypted_html.replace('<html>', f'<html>{hide_css}', 1)
    else:
        encrypted_html = hide_css + encrypted_html
    
    # Insert script before </body> or after </head>
    if '</body>' in encrypted_html:
        encrypted_html = encrypted_html.replace('</body>', f'{show_script}</body>', 1)
    elif '</head>' in encrypted_html:
        encrypted_html = encrypted_html.replace('</head>', f'</head>{show_script}', 1)
    else:
        encrypted_html = encrypted_html + show_script
    
    # R2 path: storage/{storage_id}/html_cache/{html_hash}.html
    r2_key = f"storage/{storage_id}/html_cache/{html_hash}.html"
    
    try:
        # Upload encrypted HTML to R2
        s3_client.put_object(
            Bucket=r2_bucket,
            Key=r2_key,
            Body=encrypted_html.encode('utf-8'),
            ContentType='text/html; charset=utf-8'
        )
        
        if DEBUG_MODE:
            size_kb = len(encrypted_html.encode('utf-8')) / 1024
            print(f"✅ Stored encrypted HTML in R2 cache for storage {storage_id} (hash: {html_hash[:16]}..., size: {size_kb:.1f} KB)")
        
        return True
    except Exception as e:
        error_msg = f"❌ CRITICAL: Failed to store encrypted HTML for {storage_id}: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e


def inline_fonts_as_base64(html_content: str, storage_id: str = None, max_retries: int = 5, retry_delay: float = 0.5) -> str:
    """
    Replace font URLs in HTML with base64 data URIs for instant loading.
    This makes fonts load with the HTML, eliminating separate network requests.
    
    Will retry fetching fonts from R2 with exponential backoff to handle cases
    where fonts are still being uploaded.
    
    Args:
        html_content: HTML content with font URLs
        storage_id: Optional storage ID for R2 font paths
        max_retries: Maximum number of retry attempts for each font (default: 5)
        retry_delay: Initial delay between retries in seconds, doubles each retry (default: 0.5)
    
    Returns:
        HTML with font URLs replaced by base64 data URIs
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    r2_public_url = os.environ.get('R2_PUBLIC_URL', '').rstrip('/')
    
    if not r2_public_url:
        return html_content
    
    # Find all font URLs in @font-face rules
    fontface_pattern = r'@font-face\s*\{([^}]+)\}'
    
    def fetch_font_with_retry(r2_key: str, font_path: str, max_retries: int, retry_delay: float):
        """
        Fetch font from R2 with retry logic and exponential backoff.
        Returns font_data if successful, None if all retries failed.
        """
        for attempt in range(max_retries):
            try:
                response = s3_client.get_object(Bucket=r2_bucket, Key=r2_key)
                font_data = response['Body'].read()
                
                if not font_data:
                    raise RuntimeError(f"Font {font_path} exists but returned empty data")
                
                if DEBUG_MODE and attempt > 0:
                    print(f"✅ Font {font_path} fetched after {attempt} retry(ies)")
                
                return font_data
                
            except ClientError as e:
                error_code = e.response.get('Error', {}).get('Code', '')
                if error_code in ('404', 'NoSuchKey'):
                    # Font not found - retry if we have attempts left
                    if attempt < max_retries - 1:
                        delay = retry_delay * (2 ** attempt)  # Exponential backoff
                        if DEBUG_MODE:
                            print(f"⏳ Font {font_path} not found in R2 (attempt {attempt + 1}/{max_retries}), retrying in {delay:.2f}s...")
                        time.sleep(delay)
                        continue
                    else:
                        # All retries exhausted
                        if DEBUG_MODE:
                            print(f"⚠️ Font {font_path} not found in R2 after {max_retries} attempts - keeping original URL")
                        return None
                else:
                    # Other error - don't retry, just return None
                    error_msg = f"❌ Error fetching font {font_path} from R2: {type(e).__name__}: {e}"
                    print(error_msg)
                    return None
            except Exception as e:
                # Other exception - don't retry, just return None
                error_msg = f"❌ Failed to inline font {font_path}: {type(e).__name__}: {e}"
                print(error_msg)
                return None
        
        return None
    
    def replace_with_base64(match):
        font_rule = match.group(1)
        
        # Extract ALL font properties (not just src) to preserve them
        family_match = re.search(r'font-family\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
        weight_match = re.search(r'font-weight\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
        style_match = re.search(r'font-style\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
        src_match = re.search(r'src\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
        
        if not src_match:
            return match.group(0)
        
        src_value = src_match.group(1).strip()
        url_pattern = r'url\s*\(\s*([^)]+)\s*\)'
        url_matches = list(re.finditer(url_pattern, src_value, re.IGNORECASE))
        
        if not url_matches:
            return match.group(0)
        
        new_src_parts = []
        for url_match in url_matches:
            font_url = url_match.group(1).strip().strip("'\"")
            
            # Skip if already a data URI
            if font_url.startswith('data:'):
                # Check if it already has format() - if not, add it
                url_str = url_match.group(0)
                if 'format(' not in url_str.lower():
                    # Extract the data URI part
                    data_match = re.search(r'url\s*\(\s*([^)]+)\s*\)', url_str, re.IGNORECASE)
                    if data_match:
                        data_uri = data_match.group(1).strip().strip("'\"")
                        new_src_parts.append(f"url('{data_uri}') format('woff2')")
                    else:
                        new_src_parts.append(url_str)
                else:
                    new_src_parts.append(url_str)
                continue
            
            # Extract font path from URL
            # Handle both proxy-font URLs and direct R2 URLs
            font_path = None
            if '/proxy-font/' in font_url:
                # Extract path after /proxy-font/
                font_path = font_url.split('/proxy-font/')[-1].split('?')[0]  # Remove query params
            elif r2_public_url in font_url:
                # Direct R2 URL - extract path after public URL
                font_path = font_url.replace(r2_public_url, '').lstrip('/').split('?')[0]
            elif storage_id and 'decryption_' in font_url:
                # Try to construct R2 path from filename
                filename = font_url.split('/')[-1].split('?')[0]
                font_path = f"storage/{storage_id}/fonts/{filename}"
            
            if not font_path:
                # Can't determine path, keep original URL
                new_src_parts.append(url_match.group(0))
                continue
            
            # Fetch font from R2 with retry logic
            r2_key = font_path
            font_data = fetch_font_with_retry(r2_key, font_path, max_retries, retry_delay)
            
            if font_data:
                # Convert to base64
                font_base64 = base64.b64encode(font_data).decode('utf-8')
                data_uri = f"data:font/woff2;base64,{font_base64}"
                
                # Replace URL with data URI - CRITICAL: include format('woff2')
                new_src_parts.append(f"url('{data_uri}') format('woff2')")
                
                if DEBUG_MODE:
                    print(f"✅ Inlined font as base64: {font_path} ({len(font_data)} bytes)")
            else:
                # Font not available after retries - keep original URL
                new_src_parts.append(url_match.group(0))
        
        # Reconstruct @font-face rule with ALL properties preserved
        new_src = ', '.join(new_src_parts)
        new_font_rule = font_rule.replace(src_match.group(0), f"src: {new_src}")
        
        # CRITICAL: Ensure font-display: block is present (prevents FOUT)
        if 'font-display' not in new_font_rule.lower():
            new_font_rule = f"{new_font_rule}; font-display: block"
        else:
            # Replace any existing font-display with block
            new_font_rule = re.sub(r'font-display\s*:\s*\w+', 'font-display: block', new_font_rule, flags=re.IGNORECASE)
        
        return f"@font-face {{{new_font_rule}}}"
    
    # Replace all @font-face rules
    modified_html = re.sub(fontface_pattern, replace_with_base64, html_content, flags=re.IGNORECASE | re.DOTALL)
    
    return modified_html


def list_website_files(storage_id: str) -> dict:
    """
    List all files stored in R2 for a given storage_id.
    
    Args:
        storage_id: Storage ID (hash of nonce + secret_key)
    
    Returns:
        dict with keys:
            - metadata: dict with metadata info if exists, None otherwise
            - fonts: list of font filenames with size info
            - html_cache: list of cached HTML files (with hash prefixes)
            - total_files: total count
            - total_size: total size in bytes
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    
    result = {
        'storage_id': storage_id,
        'metadata': None,
        'fonts': [],
        'html_cache': [],
        'total_files': 0,
        'total_size': 0
    }
    
    try:
        # List all objects with prefix
        prefix = f"storage/{storage_id}/"
        response = s3_client.list_objects_v2(Bucket=r2_bucket, Prefix=prefix)
        
        if 'Contents' not in response:
            return result
        
        for obj in response['Contents']:
            key = obj['Key']
            size = obj.get('Size', 0)
            result['total_size'] += size
            
            # Parse key to determine type
            if key.endswith('metadata.json'):
                # Try to read metadata
                try:
                    metadata_obj = s3_client.get_object(Bucket=r2_bucket, Key=key)
                    metadata_json = metadata_obj['Body'].read().decode('utf-8')
                    result['metadata'] = json.loads(metadata_json)
                except Exception as e:
                    result['metadata'] = {'error': f'Failed to read: {e}'}
                result['total_files'] += 1
            elif '/fonts/' in key:
                # Font file
                font_filename = key.split('/fonts/')[-1]
                result['fonts'].append({
                    'filename': font_filename,
                    'key': key,
                    'size': size,
                    'size_kb': round(size / 1024, 2)
                })
                result['total_files'] += 1
            elif '/html_cache/' in key:
                # Cached HTML file
                html_filename = key.split('/html_cache/')[-1]
                result['html_cache'].append({
                    'filename': html_filename,
                    'hash': html_filename.replace('.html', ''),
                    'key': key,
                    'size': size,
                    'size_kb': round(size / 1024, 2)
                })
                result['total_files'] += 1
        
        # Sort lists
        result['fonts'].sort(key=lambda x: x['filename'])
        result['html_cache'].sort(key=lambda x: x['filename'])
        
    except Exception as e:
        result['error'] = f"Error listing files: {type(e).__name__}: {e}"
        if DEBUG_MODE:
            import traceback
            traceback.print_exc()
    
    return result


def delete_website_files(storage_id: str) -> bool:
    """
    Delete ALL files for a storage ID from R2 (fonts, HTML cache, and metadata).
    
    Args:
        storage_id: Storage ID (hash of nonce + secret_key)
    
    Returns:
        True if successful, False otherwise (but R2 must be configured)
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    
    try:
        prefix = f"storage/{storage_id}/"
        deleted_count = 0
        
        # List all objects with prefix
        paginator = s3_client.get_paginator('list_objects_v2')
        
        for page in paginator.paginate(Bucket=r2_bucket, Prefix=prefix):
            if 'Contents' not in page:
                continue
            
            # Get all keys for this storage
            keys = [obj['Key'] for obj in page['Contents']]
            
            if keys:
                # Delete in batches of 1000 (S3 limit)
                for i in range(0, len(keys), 1000):
                    batch = keys[i:i+1000]
                    response = s3_client.delete_objects(
                        Bucket=r2_bucket,
                        Delete={
                            'Objects': [{'Key': key} for key in batch],
                            'Quiet': True
                        }
                    )
                    deleted_count += len(batch)
        
        if DEBUG_MODE:
            print(f"✅ Deleted {deleted_count} files for storage {storage_id}")
        
        return True
    except Exception as e:
        error_msg = f"❌ CRITICAL: Failed to delete storage files for {storage_id}: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e


def delete_all_r2_files() -> bool:
    """
    Delete ALL files from R2 bucket (all websites, fonts, HTML cache, and metadata).
    
    WARNING: This is a destructive operation that will delete everything in the R2 bucket.
    
    Returns:
        True if successful, False otherwise (but R2 must be configured)
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    
    try:
        deleted_count = 0
        
        # List all objects in the bucket
        paginator = s3_client.get_paginator('list_objects_v2')
        
        for page in paginator.paginate(Bucket=r2_bucket):
            if 'Contents' not in page:
                continue
            
            # Get all keys
            keys = [obj['Key'] for obj in page['Contents']]
            
            if keys:
                # Delete in batches of 1000 (S3 limit)
                for i in range(0, len(keys), 1000):
                    batch = keys[i:i+1000]
                    response = s3_client.delete_objects(
                        Bucket=r2_bucket,
                        Delete={
                            'Objects': [{'Key': key} for key in batch],
                            'Quiet': True
                        }
                    )
                    deleted_count += len(batch)
                    if DEBUG_MODE:
                        print(f"   Deleted {len(batch)} files...")
        
        if DEBUG_MODE:
            print(f"✅ Deleted {deleted_count} total files from R2 bucket")
        
        return True
    except Exception as e:
        error_msg = f"❌ CRITICAL: Failed to delete all R2 files: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e


def store_nonce_sk_hash(nonce: int, secret_key: int) -> str:
    """
    Store nonce and secret_key in R2 using a hash as the key.
    This allows client-side code to use only the hash without exposing actual values.
    
    Args:
        nonce: Encryption nonce
        secret_key: Encryption secret key
    
    Returns:
        Hash string (SHA256 hex digest)
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    
    # Compute hash: SHA256(secret_key_nonce)
    hash_input = f"{secret_key}_{nonce}"
    hash_value = hashlib.sha256(hash_input.encode()).hexdigest()
    
    # R2 path: HashedNonceSK/{hash}.json
    r2_key = f"HashedNonceSK/{hash_value}.json"
    
    # Create JSON content
    hash_data = {
        'nonce': nonce,
        'secret_key': secret_key
    }
    hash_json = json.dumps(hash_data, indent=2)
    
    try:
        # Upload to R2
        s3_client.put_object(
            Bucket=r2_bucket,
            Key=r2_key,
            Body=hash_json.encode('utf-8'),
            ContentType='application/json'
        )
        
        if DEBUG_MODE:
            print(f"✅ Stored nonce/secret_key hash: {hash_value[:16]}...")
        
        return hash_value
    except Exception as e:
        error_msg = f"❌ CRITICAL: Failed to store nonce/secret_key hash: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e


def get_nonce_sk_from_hash(hash_value: str) -> dict:
    """
    Retrieve nonce and secret_key from R2 using hash.
    
    Args:
        hash_value: Hash string (SHA256 hex digest)
    
    Returns:
        dict with keys: nonce, secret_key
        Returns None if not found
    """
    r2_client_info = get_r2_client()  # Will raise error if R2 not configured
    
    s3_client, r2_bucket = r2_client_info
    
    # R2 path: HashedNonceSK/{hash}.json
    r2_key = f"HashedNonceSK/{hash_value}.json"
    
    try:
        # Optimize: Skip head_object check, go straight to get_object
        # If it doesn't exist, get_object will raise ClientError with 404
        # This saves one R2 API call and reduces latency
        response = s3_client.get_object(Bucket=r2_bucket, Key=r2_key)
        hash_json = response['Body'].read().decode('utf-8')
        hash_data = json.loads(hash_json)
        
        if DEBUG_MODE:
            print(f"✅ Retrieved nonce/secret_key from hash: {hash_value[:16]}...")
        
        return hash_data
    except ClientError as e:
        # Check if it's a 404 (Not Found) - this is expected when hash doesn't exist
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code in ('404', 'NoSuchKey'):
            if DEBUG_MODE:
                print(f"📝 No nonce/secret_key found for hash: {hash_value[:16]}...")
            return None
        # Other ClientErrors are real errors
        error_msg = f"❌ CRITICAL: Failed to retrieve nonce/secret_key from hash {hash_value[:16]}...: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e
    except s3_client.exceptions.NoSuchKey:
        if DEBUG_MODE:
            print(f"📝 No nonce/secret_key found for hash: {hash_value[:16]}...")
        return None
    except Exception as e:
        error_msg = f"❌ CRITICAL: Failed to retrieve nonce/secret_key from hash {hash_value[:16]}...: {type(e).__name__}: {e}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        raise RuntimeError(error_msg) from e

