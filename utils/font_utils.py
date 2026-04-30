#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Font generation, extraction, and R2 upload utilities.
"""
import os
import hashlib
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin, urlparse
from flask import has_request_context, request

# Optional R2 upload support
try:
    import boto3
    from botocore.config import Config
    R2_AVAILABLE = True
except ImportError:
    R2_AVAILABLE = False

from .generate_font import create_decryption_font_from_mappings
from .r2_website_storage import (
    check_font_in_r2,
    upload_font_to_r2_website,
)

# Debug mode - set via environment variable
DEBUG_MODE = os.environ.get('DEBUG', 'false').lower() == 'true'

# In-memory cache for font URLs to avoid repeated R2 lookups
# Key: (storage_id, font_filename) -> Value: font_url
_font_url_cache = {}

# Font algorithm version - BUMP THIS when font generation logic changes
# This ensures cached fonts/HTML are invalidated when we update the algorithm
# v3 = Original TrueType-only support
# v4 = Added CFF/OTF font support (Dec 2024)
# v5 = Fixed kerning remapping (Dec 2024) - now properly remaps kern pairs
FONT_ALGORITHM_VERSION = "v5"

def upload_font_to_r2(font_path: str, font_filename: str) -> str:
    """
    Upload font to Cloudflare R2 and return the public URL.
    Returns None if upload fails or R2 is not configured.
    """
    if not R2_AVAILABLE:
        return None
    
    # Check if R2 credentials are configured
    r2_account_id = os.environ.get('R2_ACCOUNT_ID')
    r2_access_key = os.environ.get('R2_ACCESS_KEY_ID')
    r2_secret_key = os.environ.get('R2_SECRET_ACCESS_KEY')
    r2_bucket = os.environ.get('R2_BUCKET_NAME')
    r2_public_url = os.environ.get('R2_PUBLIC_URL', 'https://pub-5eb60ded9abd4136b4908ea55a742d6e.r2.dev')
    
    if not all([r2_account_id, r2_access_key, r2_secret_key, r2_bucket]):
        return None
    
    try:
        # Create S3-compatible client for R2
        s3_client = boto3.client(
            's3',
            endpoint_url=f'https://{r2_account_id}.r2.cloudflarestorage.com',
            aws_access_key_id=r2_access_key,
            aws_secret_access_key=r2_secret_key,
            config=Config(signature_version='s3v4')
        )
        
        # Upload font to R2
        s3_client.upload_file(
            font_path,
            r2_bucket,
            font_filename,
            ExtraArgs={'ContentType': 'font/woff2'}
        )
        
        # Return public URL
        r2_url = f"{r2_public_url.rstrip('/')}/{font_filename}"
        if DEBUG_MODE:
            print(f"✅ Font uploaded to R2: {r2_url}")
        return r2_url
    except Exception as e:
        if DEBUG_MODE:
            print(f"⚠️ Failed to upload font to R2: {e}")
            import traceback
            traceback.print_exc()
        return None

def generate_font_artifacts(secret_key: int, nonce: int, upper_map, lower_map, space_map, base_url: str = None, base_font_path: str = None, font_family: str = None, font_weight: str = None, font_style: str = None, website_id: str = None, source_url: str = None):
    """
    Note: website_id parameter is now storage_id (hash of nonce + secret_key)
    Keeping parameter name for backward compatibility but it represents storage_id
    """
    """
    Create (or reuse) the decryption font for a secret_key + nonce pair and return its filename + URL.
    Automatically uploads to Cloudflare R2 if configured.
    
    Args:
        secret_key: Secret key for encryption
        nonce: Nonce for encryption
        upper_map: Upper case character mapping
        lower_map: Lower case character mapping
        space_map: Space/special character mapping
        base_url: Base URL for font URLs
        base_font_path: Optional path to base font file (if None, uses Supertest.ttf)
        font_family: Optional font family name (for unique font filename)
        font_weight: Optional font weight (for unique font filename)
        font_style: Optional font style (for unique font filename)
        source_url: Original URL of the source font (CRITICAL for unique hash per font)
    """
    if base_font_path is None:
        base_font_path = os.path.join(os.path.dirname(__file__), 'Supertest.ttf')
    fonts_dir = os.path.join(os.path.dirname(__file__), 'fonts')
    os.makedirs(fonts_dir, exist_ok=True)

    # Add version to hash to force regeneration when mapping logic changes
    # Version 3: Fixed bijectivity to include space as target
    # Include source_url in hash - CRITICAL: ensures each unique font gets its own encrypted file
    # Without source_url, fonts with same family/weight/style would all map to same encrypted font!
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
    font_filename_woff2 = f"decryption_{font_hash}.woff2"
    font_filename_ttf = f"decryption_{font_hash}.ttf"
    font_filename_otf = f"decryption_{font_hash}.otf"  # For CFF fonts
    font_path_woff2 = os.path.join(fonts_dir, font_filename_woff2)
    font_path_ttf = os.path.join(fonts_dir, font_filename_ttf)
    font_path_otf = os.path.join(fonts_dir, font_filename_otf)  # For CFF fonts

    # STEP 1: Check cache first, then R2 (avoid repeated R2 lookups)
    if website_id:  # website_id is actually storage_id now
        cache_key = (website_id, font_filename_woff2)

        # Check in-memory cache first
        if cache_key in _font_url_cache:
            cached_url = _font_url_cache[cache_key]
            if DEBUG_MODE:
                print(f"✅ Font found in cache for storage {website_id}: {cached_url}")
            return font_filename_woff2, cached_url

        # Cache miss - check R2
        existing_font_url = check_font_in_r2(website_id, font_filename_woff2)
        if existing_font_url:
            # Build proxy URL
            r2_path = f"storage/{website_id}/fonts/{font_filename_woff2}"
            if base_url:
                proxy_url = f"{base_url.rstrip('/')}/proxy-font/{r2_path}"
            else:
                proxy_url = existing_font_url

            # Cache it for future requests
            _font_url_cache[cache_key] = proxy_url

            if DEBUG_MODE:
                print(f"✅ Font exists in R2 for storage {website_id}: {proxy_url}")
            return font_filename_woff2, proxy_url

    if not os.path.exists(base_font_path):
        if DEBUG_MODE:
            print(f"❌ Base font not found at {base_font_path} - cannot generate font")
        return None, None

    try:
        font_was_generated = False
        font_filename = None
        font_path = None
        # Always regenerate fonts to ensure they're correct (in case mapping logic changed)
        # This ensures we don't use old fonts with incorrect mappings
        if DEBUG_MODE:
            print(f"Generating decryption font: {font_filename_woff2}")
        # Generate WOFF2 (handles TrueType and CFF fonts automatically)
        # The function returns True if WOFF2 was created, or the intermediate file path if WOFF2 failed
        try:
            result = create_decryption_font_from_mappings(base_font_path, font_path_woff2, upper_map, lower_map, space_map, preserve_font_family=font_family)
            if result == True:
                # WOFF2 created successfully
                font_filename = font_filename_woff2
                font_path = font_path_woff2
                font_was_generated = True
            elif isinstance(result, str) and os.path.exists(result):
                # WOFF2 failed but intermediate format (TTF/OTF) was created
                # The result is the path to the intermediate file
                font_path = result
                font_filename = os.path.basename(result)
                font_was_generated = True
                if DEBUG_MODE:
                    print(f"⚠️  WOFF2 generation failed, using intermediate: {font_filename}")
        except Exception as gen_error:
            if DEBUG_MODE:
                print(f"⚠️  Font generation failed: {gen_error}")
                import traceback
                traceback.print_exc()
        
        # STEP 3: Upload to R2 - REQUIRED, no fallback
        if not font_was_generated:
            # Font generation failed - cannot proceed without font
            if DEBUG_MODE:
                print(f"❌ Font generation failed - cannot serve without R2")
            return None, None
        
        # Validate font filename (must be WOFF2 for web delivery)
        if not font_filename:
            if DEBUG_MODE:
                print(f"❌ Invalid font filename: {font_filename}")
            return None, None
        
        # Prefer WOFF2, but accept TTF/OTF if that's what was generated
        if not font_filename.endswith(('.woff2', '.ttf', '.otf')):
            if DEBUG_MODE:
                print(f"❌ Invalid font format: {font_filename}")
            return None, None
        
        # Require website_id for R2 upload
        if not website_id:
            if DEBUG_MODE:
                print(f"❌ website_id required for R2 font upload")
            return None, None
        
        # Upload to R2 with website-specific path - REQUIRED
        r2_url = upload_font_to_r2_website(website_id, font_path, font_filename)
        if not r2_url:
            # R2 upload failed - cannot serve font
            if DEBUG_MODE:
                print(f"❌ R2 upload failed for {font_filename} - font cannot be served")
            return None, None
        
        if DEBUG_MODE:
            print(f"✅ Font uploaded to R2 with website path: {r2_url}")
        
        # Use proxy endpoint to avoid CORS issues
        # Extract the R2 path from the URL: storage/{storage_id}/fonts/{font_filename}
        r2_path = f"storage/{website_id}/fonts/{font_filename}"
        if base_url:
            proxy_url = f"{base_url.rstrip('/')}/proxy-font/{r2_path}"
            # Cache the URL for future requests
            _font_url_cache[(website_id, font_filename)] = proxy_url
            if DEBUG_MODE:
                print(f"✅ Using proxy URL to avoid CORS: {proxy_url}")
            return font_filename, proxy_url
        else:
            # No base_url - use direct R2 URL (may have CORS issues but still works)
            # Cache the URL for future requests
            _font_url_cache[(website_id, font_filename)] = r2_url
            if DEBUG_MODE:
                print(f"⚠️ No base_url, using direct R2 URL: {r2_url}")
            return font_filename, r2_url
        
    except Exception as e:
        if DEBUG_MODE:
            error_font_name = font_filename if 'font_filename' in locals() else 'unknown'
            print(f"❌ Error generating font {error_font_name}: {e}")
            import traceback
            traceback.print_exc()
        return None, None

def infer_font_family_from_url(url: str) -> str:
    """
    Infer font-family name from a font URL filename.
    
    Examples:
        AGaramondPro-Regular.woff2 -> AGaramondPro
        Graphik-Semibold-Web.woff2 -> Graphik
        LogicMonospace-Medium.woff2 -> LogicMonospace
    """
    try:
        filename = os.path.basename(urlparse(url).path)
        name = os.path.splitext(filename)[0]  # Remove extension
        # Remove common suffixes: -Regular, -Bold, -Italic, -Web, etc.
        for suffix in ['-Regular', '-Bold', '-Italic', '-Semibold', '-Medium', '-Light', '-Web', 
                       '-Normal', '-Thin', '-Black', '-ExtraBold', '-ExtraLight', '-Book']:
            name = name.replace(suffix, '')
        return name if name else 'Unknown'
    except:
        return 'Unknown'


def _download_css_parallel(css_urls: list, base_url: str = None) -> dict:
    """
    Download multiple CSS files in parallel.
    
    Args:
        css_urls: List of CSS URLs to download
        base_url: Base URL for resolving relative URLs
    
    Returns:
        Dictionary mapping URL to CSS content (or None if failed)
    """
    results = {}
    
    if not css_urls:
        return results
    
    def download_single(url):
        return url, download_css(url, base_url=base_url)
    
    # Use ThreadPoolExecutor for parallel downloads
    max_workers = min(len(css_urls), 10)  # Cap at 10 concurrent downloads
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(download_single, url): url for url in css_urls}
        for future in as_completed(futures):
            try:
                url, content = future.result()
                results[url] = content
            except Exception as e:
                url = futures[future]
                if DEBUG_MODE:
                    print(f"⚠️  Error downloading CSS {url}: {e}")
                results[url] = None
    
    return results


def extract_fonts_from_html(soup, base_url: str = None):
    """
    Extract all fonts from HTML by parsing @font-face rules and <link> tags.
    Downloads ALL external CSS files to find @font-face rules (not just ones with 'font' in URL).
    
    Args:
        soup: BeautifulSoup object
        base_url: Base URL for resolving relative URLs
    
    Returns:
        List of font definitions: [{
            'url': str,           # Font file URL
            'family': str,         # Font family name
            'weight': str,         # Font weight (e.g., 'normal', 'bold', '400', '700')
            'style': str,          # Font style (e.g., 'normal', 'italic')
            'source_type': str,    # 'fontface' or 'link'
            'original_rule': str   # Original CSS rule or link href for replacement
        }]
    """
    fonts = []
    preload_fonts = []  # Fonts from <link rel="preload">
    css_urls_to_download = []  # CSS files to download and scan
    
    # Extract from @font-face rules in <style> tags
    for style_tag in soup.find_all('style'):
        if not style_tag.string:
            continue
        
        css_content = style_tag.string
        
        # Parse @font-face rules using regex
        # Match: @font-face { ... }
        fontface_pattern = r'@font-face\s*\{([^}]+)\}'
        matches = re.finditer(fontface_pattern, css_content, re.IGNORECASE | re.DOTALL)
        
        for match in matches:
            font_rule = match.group(1)
            font_info = {}
            
            # Extract font-family
            family_match = re.search(r'font-family\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
            if family_match:
                # Remove quotes and whitespace
                family = family_match.group(1).strip().strip("'\"")
                font_info['family'] = family
            
            # Extract font-weight
            weight_match = re.search(r'font-weight\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
            if weight_match:
                font_info['weight'] = weight_match.group(1).strip()
            else:
                font_info['weight'] = 'normal'
            
            # Extract font-style
            style_match = re.search(r'font-style\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
            if style_match:
                font_info['style'] = style_match.group(1).strip()
            else:
                font_info['style'] = 'normal'
            
            # Extract src URLs
            src_match = re.search(r'src\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
            if src_match:
                src_value = src_match.group(1).strip()
                # Extract URLs from src (can have multiple: url(...), url(...))
                url_pattern = r'url\s*\(\s*([^)]+)\s*\)'
                url_matches = re.finditer(url_pattern, src_value, re.IGNORECASE)
                
                for url_match in url_matches:
                    url = url_match.group(1).strip().strip("'\"")
                    
                    # Check if it's a font file
                    font_extensions = ['.woff2', '.woff', '.ttf', '.otf', '.eot']
                    if any(url.lower().endswith(ext) for ext in font_extensions):
                        # Resolve relative URLs
                        if base_url and not url.startswith(('http://', 'https://', '//', 'data:')):
                            url = urljoin(base_url, url)
                        
                        font_info_copy = font_info.copy()
                        font_info_copy['url'] = url
                        font_info_copy['source_type'] = 'fontface'
                        font_info_copy['original_rule'] = match.group(0)  # Full @font-face rule
                        fonts.append(font_info_copy)
    
    # PHASE 1: Collect all link tags and categorize them
    link_tags_with_css = []  # (link_tag, css_url) pairs for stylesheets
    
    for link_tag in soup.find_all('link'):
        href = link_tag.get('href', '')
        rel = link_tag.get('rel', [])
        as_attr = link_tag.get('as', '')
        
        # Check link type
        is_stylesheet = 'stylesheet' in rel or any(rel_item == 'stylesheet' for rel_item in rel if isinstance(rel_item, str))
        is_preload = 'preload' in rel
        is_font_preload = is_preload and as_attr == 'font'
        is_font_file = any(href.lower().endswith(ext) for ext in ['.woff2', '.woff', '.ttf', '.otf', '.eot'])
        
        # Handle font preload hints - these tell us which fonts the page uses
        if is_font_preload or is_font_file:
            # Resolve URL
            resolved_href = href
            if base_url and not href.startswith(('http://', 'https://', '//', 'data:')):
                resolved_href = urljoin(base_url, href)
            
            # Infer font-family from filename
            inferred_family = infer_font_family_from_url(resolved_href)
            
            # Try to extract font-family from data attributes first
            family = link_tag.get('data-font-family', '')
            if not family:
                family = link_tag.get('class', [''])[0] if link_tag.get('class') else ''
                if not family:
                    family = link_tag.get('id', '')
            if not family:
                family = inferred_family
            
            preload_fonts.append({
                'url': resolved_href,
                'family': family or 'Unknown',
                'weight': link_tag.get('data-font-weight', 'normal'),
                'style': link_tag.get('data-font-style', 'normal'),
                'source_type': 'preload' if is_font_preload else 'link',
                'original_rule': href,
                'inferred_family': inferred_family  # Keep for URL-to-family mapping
            })
        
        # Collect ALL stylesheets for parallel download (no "font" heuristic!)
        elif is_stylesheet:
            # Resolve CSS URL
            if base_url and not href.startswith(('http://', 'https://', '//', 'data:')):
                css_url = urljoin(base_url, href)
            else:
                css_url = href
            
            # Skip data URLs
            if css_url.startswith('data:'):
                continue
            
            css_urls_to_download.append(css_url)
            link_tags_with_css.append((link_tag, css_url))
    
    # PHASE 2: Download ALL CSS files in parallel
    if css_urls_to_download:
        if DEBUG_MODE:
            print(f"🔍 Downloading {len(css_urls_to_download)} CSS file(s) in parallel...")
        
        css_contents = _download_css_parallel(css_urls_to_download, base_url=base_url)
        
        # Build URL-to-family mapping from CSS @font-face rules
        url_to_family = {}
        
        # Process each downloaded CSS file
        for link_tag, css_url in link_tags_with_css:
            css_content = css_contents.get(css_url)
            if not css_content:
                continue
            
            # Quick check: does this CSS contain @font-face?
            if '@font-face' not in css_content.lower():
                if DEBUG_MODE:
                    print(f"⏭️  No @font-face in: {css_url}")
                continue
            
            if DEBUG_MODE:
                print(f"📄 Found @font-face rules in: {css_url}")
            
            # Parse @font-face rules from the CSS
            fontface_pattern = r'@font-face\s*\{([^}]+)\}'
            matches = list(re.finditer(fontface_pattern, css_content, re.IGNORECASE | re.DOTALL))
            
            if DEBUG_MODE:
                print(f"📊 Found {len(matches)} @font-face rule(s) in CSS")
            
            for match in matches:
                font_rule = match.group(1)
                font_info = {}
                
                # Extract font-family
                family_match = re.search(r'font-family\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
                if family_match:
                    family = family_match.group(1).strip().strip("'\"")
                    font_info['family'] = family
                
                # Extract font-weight
                weight_match = re.search(r'font-weight\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
                if weight_match:
                    font_info['weight'] = weight_match.group(1).strip()
                else:
                    font_info['weight'] = 'normal'
                
                # Extract font-style
                style_match = re.search(r'font-style\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
                if style_match:
                    font_info['style'] = style_match.group(1).strip()
                else:
                    font_info['style'] = 'normal'
                
                # Extract src URLs
                src_match = re.search(r'src\s*:\s*([^;]+)', font_rule, re.IGNORECASE)
                if src_match:
                    src_value = src_match.group(1).strip()
                    # Extract URLs from src (can have multiple: url(...), url(...))
                    url_pattern = r'url\s*\(\s*([^)]+)\s*\)'
                    url_matches = re.finditer(url_pattern, src_value, re.IGNORECASE)
                    
                    for url_match in url_matches:
                        url = url_match.group(1).strip().strip("'\"")
                        
                        # Check if it's a font file
                        font_extensions = ['.woff2', '.woff', '.ttf', '.otf', '.eot']
                        if any(url.lower().endswith(ext) for ext in font_extensions):
                            # Resolve relative URLs (relative to CSS file location)
                            css_base = '/'.join(css_url.split('/')[:-1]) + '/' if '/' in css_url else css_url
                            resolved_url = urljoin(css_base, url)
                            
                            # Build URL-to-family mapping
                            if font_info.get('family'):
                                url_to_family[resolved_url] = font_info['family']
                            
                            font_info_copy = font_info.copy()
                            font_info_copy['url'] = resolved_url
                            font_info_copy['source_type'] = 'css'
                            font_info_copy['original_rule'] = match.group(0)
                            font_info_copy['css_url'] = css_url
                            fonts.append(font_info_copy)
            
            # Mark this link for CSS processing
            if any(f.get('css_url') == css_url for f in fonts):
                link_tag['data-encrypt-css'] = 'true'
                link_tag['data-css-url'] = css_url
                if DEBUG_MODE:
                    print(f"✅ Extracted {len([f for f in fonts if f.get('css_url') == css_url])} fonts from CSS: {css_url}")
        
        # PHASE 3: Apply URL-to-family mapping to preload fonts with Unknown family
        if DEBUG_MODE and url_to_family:
            print(f"📋 Built URL-to-family mapping with {len(url_to_family)} entries")
        
        for preload_font in preload_fonts:
            if preload_font.get('family') == 'Unknown' or preload_font.get('family') == preload_font.get('inferred_family'):
                preload_url = preload_font.get('url')
                if preload_url in url_to_family:
                    old_family = preload_font['family']
                    preload_font['family'] = url_to_family[preload_url]
                    if DEBUG_MODE:
                        print(f"🔗 Mapped preload font family: {old_family} -> {preload_font['family']} for {preload_url}")
    
    # Combine preload fonts and CSS fonts
    # Preload fonts should use the family names from CSS @font-face rules
    fonts.extend(preload_fonts)
    
    return fonts

def download_css(url: str, base_url: str = None):
    """
    Download a CSS file from a URL.
    
    Args:
        url: CSS file URL (can be relative or absolute)
        base_url: Base URL for resolving relative URLs
    
    Returns:
        CSS content as string if successful, None if failed
    """
    try:
        import requests
        from urllib.parse import urljoin
    except ImportError:
        if DEBUG_MODE:
            print(f"⚠️  requests library not available, cannot download CSS: {url}")
        return None
    
    # Resolve relative URLs
    if base_url and not url.startswith(('http://', 'https://', '//', 'data:')):
        url = urljoin(base_url, url)
    
    # Skip data URLs
    if url.startswith('data:'):
        if DEBUG_MODE:
            print(f"⚠️  Skipping data URL CSS: {url[:50]}...")
        return None
    
    # Download CSS
    try:
        if DEBUG_MODE:
            print(f"Downloading CSS from: {url}")
        response = requests.get(url, timeout=120, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        response.raise_for_status()
        
        css_content = response.text
        if DEBUG_MODE:
            print(f"✅ CSS downloaded: {len(css_content)} bytes")
        return css_content
    
    except Exception as e:
        if DEBUG_MODE:
            print(f"⚠️  Failed to download CSS from {url}: {e}")
        return None

def download_font(url: str, base_url: str = None, temp_dir: str = None):
    """
    Download a font file from a URL.
    
    Args:
        url: Font file URL (can be relative or absolute)
        base_url: Base URL for resolving relative URLs
        temp_dir: Directory to save downloaded fonts (default: fonts/downloaded/)
    
    Returns:
        Local file path if successful, None if failed
    """
    try:
        import requests
        from urllib.parse import urljoin, urlparse
    except ImportError:
        if DEBUG_MODE:
            print(f"⚠️  requests library not available, cannot download font: {url}")
        return None
    
    # Resolve relative URLs
    if base_url and not url.startswith(('http://', 'https://', '//', 'data:')):
        url = urljoin(base_url, url)
    
    # Skip data URLs
    if url.startswith('data:'):
        if DEBUG_MODE:
            print(f"⚠️  Skipping data URL font: {url[:50]}...")
        return None
    
    # Create temp directory
    if temp_dir is None:
        import tempfile
        temp_dir = os.path.join(tempfile.gettempdir(), 'cloak_fonts')
    os.makedirs(temp_dir, exist_ok=True)
    
    # Generate filename from URL
    parsed_url = urlparse(url)
    filename = os.path.basename(parsed_url.path)
    if not filename or '.' not in filename:
        # Generate filename from URL hash
        url_hash = hashlib.md5(url.encode('utf-8')).hexdigest()[:12]
        filename = f"font_{url_hash}.woff2"
    
    local_path = os.path.join(temp_dir, filename)
    
    # Check if already downloaded
    if os.path.exists(local_path):
        if DEBUG_MODE:
            print(f"✅ Font already downloaded: {filename}")
        return local_path
    
    # Download font
    try:
        if DEBUG_MODE:
            print(f"Downloading font from: {url}")
        response = requests.get(url, timeout=120, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        response.raise_for_status()
        
        # Save to file
        with open(local_path, 'wb') as f:
            f.write(response.content)
        
        if DEBUG_MODE:
            print(f"✅ Font downloaded: {filename} ({len(response.content)} bytes)")
        return local_path
    
    except Exception as e:
        if DEBUG_MODE:
            print(f"⚠️  Failed to download font from {url}: {e}")
        return None

def encrypt_fonts_from_html(soup, secret_key: int, nonce: int, upper_map, lower_map, space_map, base_url: str = None, website_id: str = None):
    """
    Extract fonts from HTML, download them, and generate encrypted versions.
    
    Args:
        soup: BeautifulSoup object
        secret_key: Secret key for encryption
        nonce: Nonce for encryption
        upper_map: Upper case character mapping
        lower_map: Lower case character mapping
        space_map: Space/special character mapping
        base_url: Base URL for resolving relative URLs and generating font URLs
    
    Returns:
        Dictionary mapping original font info to encrypted font URL:
        {
            (family, weight, style, url): encrypted_font_url,
            ...
        }
    """
    font_mapping = {}

    print(f"\n🔍 FONT EXTRACTION FROM HTML:")
    print(f"   Base URL: {base_url}")

    # Extract fonts from HTML
    fonts = extract_fonts_from_html(soup, base_url=base_url)

    if not fonts:
        print("   ❌ NO FONTS FOUND IN HTML!")
        print("   Possible reasons:")
        print("   - Page uses system fonts only")
        print("   - Fonts loaded via JavaScript (not in initial HTML)")
        print("   - @font-face rules in external CSS that wasn't downloaded")
        return font_mapping

    print(f"   ✓ Found {len(fonts)} font(s) in HTML:")
    for font in fonts:
        print(f"      • {font.get('family', 'Unknown')} ({font.get('weight')}, {font.get('style')})")
        print(f"        URL: {font.get('url', 'N/A')[:70]}...")
        print(f"        Source: {font.get('source_type', 'unknown')}")
    
    print(f"\n📥 DOWNLOADING AND ENCRYPTING FONTS:")

    # Process each font
    for font_info in fonts:
        url = font_info.get('url')
        family = font_info.get('family', 'Unknown')
        weight = font_info.get('weight', 'normal')
        style = font_info.get('style', 'normal')

        if not url:
            print(f"   ⚠️  Skipping font with no URL: {family}")
            continue

        # Resolve URL to absolute URL for consistent matching
        # The URL from extract_fonts_from_html is already resolved, but let's ensure it's absolute
        resolved_url = url
        if base_url and not url.startswith(('http://', 'https://', '//', 'data:')):
            resolved_url = urljoin(base_url, url)

        print(f"\n   📥 Processing: {family} ({weight}, {style})")
        print(f"      URL: {resolved_url[:70]}...")

        # Download font
        local_font_path = download_font(resolved_url, base_url=base_url)
        if not local_font_path:
            print(f"      ❌ DOWNLOAD FAILED!")
            continue
        print(f"      ✓ Downloaded to: {local_font_path}")
        
        # Generate encrypted font
        try:
            encrypted_font_filename, encrypted_font_url = generate_font_artifacts(
                secret_key=secret_key,
                nonce=nonce,
                upper_map=upper_map,
                lower_map=lower_map,
                space_map=space_map,
                base_url=base_url,
                base_font_path=local_font_path,
                font_family=family,
                font_weight=weight,
                font_style=style,
                website_id=website_id,
                source_url=resolved_url  # CRITICAL: ensures unique hash per source font
            )

            # Create mapping key using resolved URL for consistent matching
            mapping_key = (family, weight, style, resolved_url)
            font_mapping[mapping_key] = {
                'url': encrypted_font_url,
                'filename': encrypted_font_filename,
                'family': family,
                'weight': weight,
                'style': style
            }

            print(f"      ✓ Encrypted: {encrypted_font_filename}")
            print(f"      ✓ URL: {encrypted_font_url}")

        except Exception as e:
            print(f"      ❌ ENCRYPTION FAILED: {e}")
            import traceback
            traceback.print_exc()
            continue

    print(f"\n📊 FONT ENCRYPTION SUMMARY:")
    print(f"   Total fonts encrypted: {len(font_mapping)}")
    if not font_mapping:
        print(f"   ⚠️  WARNING: No fonts were successfully encrypted!")

    return font_mapping

