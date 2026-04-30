#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Encryption route handlers.
"""
import os
from flask import request, jsonify
from utils.generate_font import get_dynamic_mappings
from utils.middleware import (
    rate_limit,
    validate_hash,
    validate_text_range,
    validate_api_key,
    log_request,
    MAX_TEXT_RANGE_CHARS,
)
from utils.r2_website_storage import (
    get_storage_id,
    get_website_metadata,
    store_website_metadata,
    store_nonce_sk_hash,
    get_nonce_sk_from_hash,
    get_plaintext_index,
)
from utils.encryption import (
    expand_ligatures,
    remap_text_ultra_fast,
    encrypt_article_text,
    decrypt_article_text,
    nonce_creator,
)
from utils.font_utils import generate_font_artifacts, DEBUG_MODE
from .routes_common import SECRET_KEY
import time

# In-memory cache for plaintext index (avoids R2 calls on repeated searches)
_plaintext_cache = {}  # {storage_id: (plaintext, timestamp)}
_hash_data_cache = {}  # {hash_value: (hash_data, timestamp)}
PLAINTEXT_CACHE_TTL = 3600  # 1 hour


def invalidate_plaintext_cache(storage_id: str):
    """Invalidate cached plaintext for a storage ID. Called when SDK uploads new plaintext."""
    if storage_id in _plaintext_cache:
        del _plaintext_cache[storage_id]
        print(f"[CACHE] Invalidated plaintext cache for {storage_id}")


def get_plaintext_cached(storage_id: str) -> str:
    """Get plaintext from cache, falling back to R2."""
    now = time.time()

    if storage_id in _plaintext_cache:
        plaintext, timestamp = _plaintext_cache[storage_id]
        if now - timestamp < PLAINTEXT_CACHE_TTL:
            return plaintext

    # Cache miss - fetch from R2
    plaintext = get_plaintext_index(storage_id)
    if plaintext:
        _plaintext_cache[storage_id] = (plaintext, now)
    return plaintext


def get_nonce_sk_cached(hash_value: str) -> dict:
    """Get nonce/secret_key from cache, falling back to R2."""
    now = time.time()

    if hash_value in _hash_data_cache:
        data, timestamp = _hash_data_cache[hash_value]
        if now - timestamp < PLAINTEXT_CACHE_TTL:
            return data

    # Cache miss - fetch from R2
    data = get_nonce_sk_from_hash(hash_value)
    if data:
        _hash_data_cache[hash_value] = (data, now)
    return data


def register_encryption_routes(app):
    """Register encryption routes with the Flask app."""
    
    @app.route('/api/get-nonce-sk', methods=['POST'])
    def get_nonce_sk():
        """
        Server-side only endpoint to retrieve nonce and secret_key from hash.
        This endpoint is NOT exposed to clients - it's for internal server use.
        
        Request body:
            {
                "hash": "abc123..."
            }
        
        Response:
            {
                "nonce": 462508,
                "secret_key": 29202393
            }
        """
        try:
            data = request.json
            
            if not data:
                return jsonify({'error': 'No JSON data provided'}), 400
            
            hash_value = data.get('hash')
            
            if not hash_value:
                return jsonify({'error': 'hash is required'}), 400
            
            # Retrieve nonce and secret_key from hash
            hash_data = get_nonce_sk_cached(hash_value)
            
            if not hash_data:
                return jsonify({'error': 'Hash not found'}), 404
            
            return jsonify({
                'nonce': hash_data['nonce'],
                'secret_key': hash_data['secret_key']
            })
        
        except Exception as e:
            import traceback
            error_msg = str(e)
            traceback.print_exc()
            return jsonify({'error': error_msg, 'type': type(e).__name__}), 500
    
    @app.route('/api/encrypt', methods=['POST'])
    @rate_limit('encrypt')
    @validate_api_key(check_domain=True, check_usage=True)
    @log_request()
    def encrypt_article():

        """

        Main API endpoint for encrypting article text.

        Rate limit: 20 requests/minute


        Request body:

            {

                "text": "The article text to encrypt",

                "secret_key": 29202393

            }


        Response:

            {

                "encrypted": "Encrypted text using dynamic Feistel cipher",

                "font_url": "https://your-cdn.com/fonts/encrypted.woff2"

            }

        """

        try:

            data = request.json


            if not data:

                return jsonify({'error': 'No JSON data provided'}), 400


            article_text = data.get('text', '')

            secret_key = data.get('secret_key')


            if not article_text:

                return jsonify({'error': 'No text provided'}), 400


            # Use default secret key if not provided

            if secret_key is None:

                secret_key = SECRET_KEY

            else:

                # Convert secret_key to int if it's a string

                try:

                    secret_key = int(secret_key)

                except (ValueError, TypeError):

                    return jsonify({'error': 'secret_key must be an integer'}), 400


            # Debug: Log the secret_key being used (only in debug mode)

            if DEBUG_MODE:

                print(f"DEBUG: Encrypting text='{article_text[:20]}...' with secret_key={secret_key} (type: {type(secret_key).__name__})")


            base_url = os.environ.get('BASE_URL', request.url_root.rstrip('/'))

            encryption = encrypt_article_text(article_text, secret_key, generate_font=True, base_url=base_url)


            # Debug: Log the result (only in debug mode)

            if DEBUG_MODE:

                print(f"DEBUG: Encrypted result: '{encryption['encrypted']}'")


            return jsonify({

                'encrypted': encryption['encrypted'],

                'nonce': encryption['nonce'],  # Include nonce for decryption

                'secret_key_used': secret_key if DEBUG_MODE else None,  # Only include in debug mode

                'font_url': encryption['font_url'],

                'font_filename': encryption['font_filename'],  # Include filename for reference

                'space_char': encryption['space_char']  # Character that space encrypts to (for word-breaking)

            })


        except Exception as e:

            import traceback

            error_msg = str(e)

            traceback.print_exc()

            return jsonify({'error': error_msg, 'type': type(e).__name__}), 500



    @app.route('/api/encrypt/query', methods=['POST'])
    @validate_api_key(check_domain=True)
    def encrypt_query():

        """

        Encrypt a search query using the same nonce as the page.

        This endpoint is used by the search functionality to encrypt user queries.


        Request body:

            {

                "text": "search query",

                "hash": "abc123..."  # Hash of nonce+secret_key (preferred)

                OR (for backward compatibility):

                "secret_key": 29202393,

                "nonce": 462508

            }


        Response:

            {

                "encrypted": "encrypted query"

            }

        """

        try:

            data = request.json


            if not data:

                return jsonify({'error': 'No JSON data provided'}), 400


            query_text = data.get('text', '')

            hash_value = data.get('hash')
            secret_key = data.get('secret_key')

            nonce = data.get('nonce')


            if not query_text:

                return jsonify({'error': 'No text provided'}), 400


            # If hash is provided, retrieve nonce and secret_key from it
            if hash_value:
                hash_data = get_nonce_sk_cached(hash_value)
                if not hash_data:
                    return jsonify({'error': 'Hash not found'}), 404
                secret_key = hash_data['secret_key']
                nonce = hash_data['nonce']
            else:
                # Backward compatibility: use secret_key and nonce directly
                if secret_key is None:
                    secret_key = SECRET_KEY
                else:
                    try:
                        secret_key = int(secret_key)
                    except (ValueError, TypeError):
                        return jsonify({'error': 'secret_key must be an integer'}), 400

                if nonce is None:
                    return jsonify({'error': 'nonce is required'}), 400
                else:
                    try:
                        nonce = int(nonce)
                    except (ValueError, TypeError):
                        return jsonify({'error': 'nonce must be an integer'}), 400


            # Expand ligatures and encrypt using the provided nonce

            expanded = expand_ligatures(query_text)

            encrypted = remap_text_ultra_fast(expanded, secret_key, nonce)


            return jsonify({

                'encrypted': encrypted

            })


        except Exception as e:

            import traceback

            error_msg = str(e)

            traceback.print_exc()

            return jsonify({'error': error_msg, 'type': type(e).__name__}), 500


    @app.route('/api/search/prefetch', methods=['POST'])
    @validate_api_key(check_domain=True)
    def prefetch_search_index():
        """
        Preload plaintext into cache on page load.
        Called by client on page initialization to warm the cache.
        """
        try:
            data = request.json
            hash_value = data.get('hash') if data else None

            if not hash_value:
                return jsonify({'error': 'Hash required'}), 400

            hash_data = get_nonce_sk_cached(hash_value)
            if not hash_data:
                return jsonify({'error': 'Hash not found'}), 404

            storage_id = get_storage_id(hash_data['nonce'], hash_data['secret_key'])

            # This populates the cache
            plaintext = get_plaintext_cached(storage_id)

            return jsonify({'status': 'ready', 'cached': plaintext is not None})
        except Exception as e:
            return jsonify({'error': str(e)}), 500


    @app.route('/api/search/find-matches', methods=['POST'])
    @rate_limit('search')
    @validate_api_key(check_domain=True)
    @validate_hash('hash')
    @log_request()
    def find_search_matches():
        """
        Server-side case-insensitive search.
        Client sends encrypted text, server decrypts and searches, returns only positions.
        NEVER exposes decrypted content to client.

        Request body:
            {
                "query": "search term",
                "encrypted_text": "bnZglwflTfew...",  # Encrypted text from DOM
                "hash": "abc123..."  # Hash to get secret_key/nonce
            }

        Response:
            {
                "matches": [{"start": 0, "end": 5}, ...],
                "total_matches": 10
            }

        Rate limit: 60 requests/minute
        """
        try:
            data = request.json
            if not data:
                return jsonify({'error': 'No JSON data provided'}), 400

            query = data.get('query', '')
            encrypted_text = data.get('encrypted_text', '')
            hash_value = data.get('hash')

            print(f"[SEARCH] find-matches called: query='{query[:20] if query else ''}...', hash={hash_value[:16] if hash_value else 'None'}...")

            if not query:
                return jsonify({'matches': [], 'total_matches': 0})

            if not hash_value:
                return jsonify({'error': 'Hash required'}), 400

            # Note: encrypted_text is no longer required - server uses R2-stored plaintext
            # The hash is sufficient to look up the pre-stored plaintext index

            # Step 1: Get secret_key and nonce from hash
            hash_data = get_nonce_sk_cached(hash_value)
            if not hash_data:
                print(f"[SEARCH] Hash not found: {hash_value}")
                return jsonify({'error': 'Hash not found'}), 404

            secret_key = hash_data['secret_key']
            nonce = hash_data['nonce']

            # Step 2: Get storage_id and retrieve stored plaintext index (cached)
            # This uses the pre-computed plaintext which avoids decryption bugs
            storage_id = get_storage_id(nonce, secret_key)
            print(f"[SEARCH] storage_id: {storage_id}")
            plaintext = get_plaintext_cached(storage_id)

            if not plaintext:
                print(f"[SEARCH] Plaintext not found for storage_id: {storage_id}")
                return jsonify({'error': 'Plaintext index not found'}), 404

            print(f"[SEARCH] Found plaintext: {len(plaintext)} chars, preview: '{plaintext[:50]}...'")

            # Step 3: Perform case-insensitive search on plaintext
            query_lower = query.lower()
            text_lower = plaintext.lower()

            matches = []
            start_pos = 0
            while True:
                match_index = text_lower.find(query_lower, start_pos)
                if match_index == -1:
                    break

                matches.append({
                    'start': match_index,
                    'end': match_index + len(query)
                })

                start_pos = match_index + 1

            return jsonify({
                'matches': matches,
                'total_matches': len(matches),
                'plaintext_length': len(plaintext)  # Client uses this to detect DOM changes
            })

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'error': str(e), 'type': type(e).__name__}), 500


    @app.route('/api/search/word-boundaries', methods=['POST'])
    @validate_api_key(check_domain=True)
    def get_word_boundaries():
        """
        Get word boundaries at a given position from cached plaintext.
        Used for double-click word selection on encrypted text.

        Request body:
            {
                "position": 123,  # Character position in the text
                "hash": "abc123...",  # Hash to get plaintext
                "mode": "word" | "paragraph"  # "word" for double-click, "paragraph" for triple-click
            }

        Response:
            {
                "start": 120,  # Start position of word/paragraph
                "end": 128,    # End position of word/paragraph
                "text": "example"  # The selected word/paragraph (for debugging)
            }
        """
        try:
            data = request.json
            if not data:
                return jsonify({'error': 'No JSON data provided'}), 400

            position = data.get('position')
            hash_value = data.get('hash')
            mode = data.get('mode', 'word')  # Default to word selection

            print(f"[WORD] word-boundaries called: position={position}, hash={hash_value[:16] if hash_value else 'None'}...")

            if position is None:
                return jsonify({'error': 'position is required'}), 400
            if not hash_value:
                return jsonify({'error': 'hash is required'}), 400

            try:
                position = int(position)
            except (ValueError, TypeError):
                return jsonify({'error': 'position must be an integer'}), 400

            # Get plaintext from cache
            hash_data = get_nonce_sk_cached(hash_value)
            if not hash_data:
                print(f"[WORD] Hash not found: {hash_value}")
                return jsonify({'error': 'Hash not found'}), 404

            storage_id = get_storage_id(hash_data['nonce'], hash_data['secret_key'])
            print(f"[WORD] storage_id: {storage_id}")
            plaintext = get_plaintext_cached(storage_id)

            if not plaintext:
                print(f"[WORD] Plaintext not found for storage_id: {storage_id}")
                return jsonify({'error': 'Plaintext not found'}), 404

            print(f"[WORD] Found plaintext: {len(plaintext)} chars, position={position}, char at pos='{plaintext[position] if position < len(plaintext) else 'OUT OF BOUNDS'}'")

            # Ensure position is within bounds
            if position < 0 or position >= len(plaintext):
                print(f"[WORD] Position {position} out of bounds (plaintext len: {len(plaintext)})")
                return jsonify({'error': 'Position out of bounds'}), 400

            if mode == 'paragraph':
                # Triple-click: select paragraph (text between newlines or block boundaries)
                # Find paragraph start (look for double newline or start of text)
                start = position
                while start > 0:
                    if plaintext[start - 1] == '\n':
                        # Check for paragraph break (double newline or start after newline)
                        if start >= 2 and plaintext[start - 2] == '\n':
                            break
                        # Also break on single newline for simpler paragraph handling
                        break
                    start -= 1

                # Find paragraph end
                end = position
                while end < len(plaintext):
                    if plaintext[end] == '\n':
                        break
                    end += 1

                selected_text = plaintext[start:end]
            else:
                # Double-click: select word
                # Word characters: letters, numbers, apostrophes/quotes (for contractions)
                # Hyphens are NOT included - they separate words (e.g., "well-known")
                # Include straight and curly apostrophes/quotes using Unicode escapes:
                # U+0027 ' straight apostrophe
                # U+2018 ' left single quote, U+2019 ' right single quote
                # U+201C " left double quote, U+201D " right double quote
                def is_word_char(ch):
                    return ch.isalnum() or ch in "'\u2018\u2019\u201C\u201D"

                # If clicked on non-word character
                if not is_word_char(plaintext[position]):
                    char = plaintext[position]
                    if char.isspace() or char == '\n':
                        # Whitespace - select contiguous whitespace
                        start = position
                        while start > 0 and plaintext[start - 1].isspace():
                            start -= 1

                        end = position
                        while end < len(plaintext) and plaintext[end].isspace():
                            end += 1

                        return jsonify({
                            'start': start,
                            'end': end,
                            'text': plaintext[start:end]
                        })
                    else:
                        # Punctuation - select the single character
                        return jsonify({
                            'start': position,
                            'end': position + 1,
                            'text': char
                        })

                # Find word start
                start = position
                while start > 0 and is_word_char(plaintext[start - 1]):
                    start -= 1

                # Find word end
                end = position
                while end < len(plaintext) and is_word_char(plaintext[end]):
                    end += 1

                selected_text = plaintext[start:end]

            return jsonify({
                'start': start,
                'end': end,
                'text': selected_text
            })

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'error': str(e), 'type': type(e).__name__}), 500


    @app.route('/api/search/get-text-range', methods=['POST'])
    @rate_limit('get_text_range')
    @validate_api_key(check_domain=True, check_usage=True)
    @validate_hash('hash')
    @validate_text_range()
    @log_request()
    def get_text_range():
        """
        Get plaintext for a given position range.
        Used for context menu to show decrypted text.

        Request body:
            {
                "start": 10,  # Start position in plaintext
                "end": 50,    # End position in plaintext
                "hash": "abc123..."  # Hash to get plaintext
            }

        Response:
            {
                "text": "the selected plaintext"
            }

        Rate limit: 30 requests/minute
        Max range: 5000 characters
        """
        try:
            data = request.json
            if not data:
                return jsonify({'error': 'No JSON data provided'}), 400

            start = data.get('start')
            end = data.get('end')
            hash_value = data.get('hash')

            if start is None or end is None:
                return jsonify({'error': 'start and end are required'}), 400
            if not hash_value:
                return jsonify({'error': 'hash is required'}), 400

            try:
                start = int(start)
                end = int(end)
            except (ValueError, TypeError):
                return jsonify({'error': 'start and end must be integers'}), 400

            if start < 0 or end < 0 or start > end:
                return jsonify({'error': 'Invalid position range'}), 400

            print(f"[COPY] get-text-range called: start={start}, end={end}, hash={hash_value[:16]}...")

            # Get plaintext from cache (same pattern as word-boundaries)
            hash_data = get_nonce_sk_cached(hash_value)
            if not hash_data:
                print(f"[COPY] Hash not found: {hash_value}")
                return jsonify({'error': 'Hash not found'}), 404

            storage_id = get_storage_id(hash_data['nonce'], hash_data['secret_key'])
            plaintext = get_plaintext_cached(storage_id)

            if not plaintext:
                print(f"[COPY] Plaintext not found for storage_id: {storage_id}")
                return jsonify({'error': 'Plaintext not found'}), 404

            print(f"[COPY] Found plaintext: {len(plaintext)} chars")
            print(f"[COPY] Requested range: [{start}:{end}] = {end - start} chars")

            # Debug: show what's around the end position
            end_context_start = max(0, end - 50)
            end_context_end = min(len(plaintext), end + 20)
            print(f"[COPY] Context around end ({end}): ...'{plaintext[end_context_start:end_context_end]}'")
            if end < len(plaintext):
                print(f"[COPY] Char at end position [{end}]: '{plaintext[end]}' (ord={ord(plaintext[end])})")

            # Clamp positions to valid range
            start = max(0, min(start, len(plaintext)))
            end = max(0, min(end, len(plaintext)))

            # Return substring
            text = plaintext[start:end]
            print(f"[COPY] Returning text ({len(text)} chars):")
            print(f"[COPY]   First 80: '{text[:80]}'")
            print(f"[COPY]   Last 40: '...{text[-40:]}'")
            return jsonify({'text': text})

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'error': str(e), 'type': type(e).__name__}), 500


    @app.route('/api/decrypt', methods=['POST'])
    @validate_api_key(check_domain=True)
    def decrypt_article():

        """

        API endpoint for decrypting article text.


        Request body:

            {

                "encrypted": "Encrypted text to decrypt",

                "hash": "abc123..."  # Hash of nonce+secret_key (preferred)

                OR (for backward compatibility):

                "secret_key": 29202393,

                "nonce": 462508  # optional, will try to calculate if not provided

            }


        Response:

            {

                "decrypted": "Decrypted text",

                "nonce_used": 462508

            }

        """

        try:

            data = request.json


            if not data:

                return jsonify({'error': 'No JSON data provided'}), 400


            encrypted_text = data.get('encrypted', '')

            hash_value = data.get('hash')
            secret_key = data.get('secret_key')
            nonce = data.get('nonce')  # Optional


            if not encrypted_text:

                return jsonify({'error': 'No encrypted text provided'}), 400


            # If hash is provided, retrieve nonce and secret_key from it
            if hash_value:
                hash_data = get_nonce_sk_cached(hash_value)
                if not hash_data:
                    return jsonify({'error': 'Hash not found'}), 404
                secret_key = hash_data['secret_key']
                nonce = hash_data['nonce']
            else:
                # Backward compatibility: use secret_key and nonce directly
                # Use default secret key if not provided
                if secret_key is None:
                    secret_key = SECRET_KEY
                else:
                    # Convert secret_key to int if it's a string
                    try:
                        secret_key = int(secret_key)
                    except (ValueError, TypeError):
                        return jsonify({'error': 'secret_key must be an integer'}), 400

                # Convert nonce to int if provided
                if nonce is not None:
                    try:
                        nonce = int(nonce)
                    except (ValueError, TypeError):
                        return jsonify({'error': 'nonce must be an integer'}), 400


            # Decrypt using dynamic Feistel cipher

            decrypted_text = decrypt_article_text(encrypted_text, secret_key, nonce)


            # If nonce wasn't provided, calculate what was used

            if nonce is None:

                nonce = nonce_creator(encrypted_text)


            return jsonify({

                'decrypted': decrypted_text,

                'nonce_used': nonce

            })


        except Exception as e:

            import traceback

            error_msg = str(e)

            traceback.print_exc()

            return jsonify({'error': error_msg, 'type': type(e).__name__}), 500



    @app.route('/api/encrypt/page', methods=['POST'])
    @validate_api_key(check_domain=True, check_usage=True)
    def encrypt_page():

        """

        Encrypt entire webpage - extracts and encrypts all text content from HTML.

        Designed for single API call per page.


        Request body:

            {

                "html": "<html>...</html>",  # Optional: full HTML

                "texts": ["Text 1", "Text 2", ...],  # All text nodes from page

                "hash": "abc123..."  # Hash of nonce+secret_key (preferred)

                OR (for backward compatibility):

                "secret_key": 29202393

            }


        Response:

            {

                "encrypted_texts": ["Encrypted 1", "Encrypted 2", ...],

                "font_url": "https://your-cdn.com/fonts/encrypted.woff2",

                "hash": "abc123..."  # Hash of nonce+secret_key (preferred)

                OR (for backward compatibility):

                "nonce": 462508

            }

        """

        try:

            data = request.json


            if not data:

                return jsonify({'error': 'No JSON data provided'}), 400


            texts = data.get('texts', [])

            secret_key = data.get('secret_key')


            if not texts or not isinstance(texts, list):

                return jsonify({'error': 'No texts array provided'}), 400


            # Use default secret key if not provided

            if secret_key is None:

                secret_key = SECRET_KEY

            else:

                # Convert secret_key to int if it's a string

                try:

                    secret_key = int(secret_key)

                except (ValueError, TypeError):

                    return jsonify({'error': 'secret_key must be an integer'}), 400


            if len(texts) > 1000:  # Limit batch size for entire pages

                return jsonify({'error': 'Too many text nodes (max 1000)'}), 400


            # Filter out empty or very short texts

            valid_texts = []

            text_indices = []  # Track original indices

            for i, text in enumerate(texts):

                if text and isinstance(text, str) and len(text.strip()) > 0:

                    valid_texts.append(text.strip())

                    text_indices.append(i)


            if len(valid_texts) == 0:

                return jsonify({

                    'encrypted_texts': [],

                    'font_url': None,

                    'nonce': None

                })


            # Calculate nonce from content first (needed for storage_id)
            # This ensures different content = different website IDs
            combined_text = ' '.join(valid_texts)
            expanded = expand_ligatures(combined_text)
            nonce = nonce_creator(expanded)

            # Calculate storage_id from nonce and secret_key
            storage_id = get_storage_id(nonce, secret_key)

            # Check R2 for existing metadata
            existing_metadata = get_website_metadata(storage_id)

            if existing_metadata:
                # Use existing nonce and secret_key from metadata
                stored_nonce = existing_metadata.get('nonce')
                stored_secret_key = existing_metadata.get('secret_key')
                
                if stored_nonce == nonce and stored_secret_key == secret_key:
                    # Everything matches - use stored values
                    nonce = stored_nonce
                    secret_key = stored_secret_key
                    if DEBUG_MODE:
                        print(f"✅ Using existing nonce for storage {storage_id}: {nonce}")
                else:
                    # Nonce or secret_key mismatch - store new metadata
                    if DEBUG_MODE:
                        print(f"⚠️ Nonce or secret_key mismatch for {storage_id}. Stored: nonce={stored_nonce}, key={stored_secret_key}, Requested: nonce={nonce}, key={secret_key}")
                    store_website_metadata(storage_id, nonce, secret_key, overwrite=True)
                    if DEBUG_MODE:
                        print(f"✅ Created new metadata for storage {storage_id}: {nonce}")
            else:
                # First time for this storage - store metadata
                store_website_metadata(storage_id, nonce, secret_key)
                if DEBUG_MODE:
                    print(f"✅ Created new metadata for storage {storage_id}: {nonce}")
            
            # Store hash in R2 (create or update)
            hash_value = store_nonce_sk_hash(nonce, secret_key)


            # Get mappings once for the entire page

            upper_map, lower_map, space_map = get_dynamic_mappings(secret_key, nonce)

            # Combine all mappings (space is in lower_map, space_map only has special chars)

            combined_map = {**upper_map, **lower_map, **space_map}


            # Encrypt all texts using the same mapping

            encrypted_texts = []

            for text in valid_texts:

                expanded_text = expand_ligatures(text)

                # All chars get mapped (spaces are in lower_map)

                encrypted = ''.join(combined_map.get(char, char) for char in expanded_text)

                encrypted_texts.append(encrypted)


            # Generate font for this encryption

            base_url = os.environ.get('BASE_URL', request.url_root.rstrip('/'))

            font_filename, font_url = generate_font_artifacts(

                secret_key, nonce, upper_map, lower_map, space_map, 

                base_url=base_url, website_id=storage_id

            )


            # Create result array matching original indices (with empty strings for filtered texts)

            result_texts = [''] * len(texts)

            for idx, encrypted_text in zip(text_indices, encrypted_texts):

                result_texts[idx] = encrypted_text


            # Get the character that space maps to (for CSS word-breaking)

            space_char = lower_map.get(' ', None)


            # Return hash instead of nonce/secret_key (never expose nonce/secret_key client-side)
            response_data = {
                'encrypted_texts': result_texts,
                'font_url': font_url,
                'font_filename': font_filename,
                'hash': hash_value,  # Only hash, never nonce/secret_key
                'space_char': space_char,  # Character that space encrypts to (for word-breaking)
                # Include mappings for client-side decryption (for copy-paste functionality)
                'upper_map': upper_map,
                'lower_map': lower_map,
                'space_map': space_map
            }
            
            # Do NOT include nonce in response - client should only use hash
            # (Backward compatibility removed - all clients must use hash)
            
            return jsonify(response_data)


        except Exception as e:

            import traceback

            error_msg = str(e)

            traceback.print_exc()

            return jsonify({'error': error_msg, 'type': type(e).__name__}), 500



    @app.route('/api/encrypt/lazy', methods=['POST'])
    @validate_api_key(check_domain=True, check_usage=True)
    def encrypt_lazy():

        """

        Encrypt lazy-loaded content using stored nonce for storage.

        Requires hash (preferred) or nonce and secret_key in request.


        Request body:

            {

                "hash": "abc123..."  # Hash of nonce+secret_key (preferred)

                OR (for backward compatibility):

                "nonce": 462508,

                "secret_key": 29202393,

                "text": "Lazy loaded text"

            }


        Response:

            {

                "encrypted": "Encrypted text",

                "nonce": 462508,  # Same nonce every time for this storage

                "font_url": "https://fonts.cloak.ink/...",

                "storage_id": "abc123..."

            }

        """

        try:

            data = request.json or {}

            hash_value = data.get('hash')
            nonce = data.get('nonce')
            secret_key = data.get('secret_key')
            text = data.get('text', '')

            if not text:
                return jsonify({'error': 'text is required'}), 400

            # If hash is provided, retrieve nonce and secret_key from it
            if hash_value:
                hash_data = get_nonce_sk_cached(hash_value)
                if not hash_data:
                    return jsonify({'error': 'Hash not found'}), 404
                secret_key = hash_data['secret_key']
                nonce = hash_data['nonce']
            else:
                # Backward compatibility: use nonce and secret_key directly
                if not nonce or not secret_key:
                    return jsonify({'error': 'hash or (nonce and secret_key) are required'}), 400

                try:
                    nonce = int(nonce)
                    secret_key = int(secret_key)
                except (ValueError, TypeError):
                    return jsonify({'error': 'nonce and secret_key must be integers'}), 400

            # Calculate storage_id and get stored metadata
            storage_id = get_storage_id(nonce, secret_key)
            metadata = get_website_metadata(storage_id)

            if not metadata:
                return jsonify({
                    'error': f'Storage {storage_id} not found. Encrypt main page first.',
                    'hint': 'Call /api/encrypt/html or /html-encrypt first to create storage metadata'
                }), 404

            # Use stored nonce and secret_key (verify they match)
            stored_nonce = metadata['nonce']
            stored_secret_key = metadata['secret_key']

            if nonce != stored_nonce or secret_key != stored_secret_key:
                if DEBUG_MODE:
                    print(f"⚠️ Nonce or secret_key mismatch for {storage_id}, using stored values")
                nonce = stored_nonce
                secret_key = stored_secret_key


            # Encrypt with stored nonce

            expanded = expand_ligatures(text)

            upper_map, lower_map, space_map = get_dynamic_mappings(secret_key, nonce)

            combined_map = {**upper_map, **lower_map, **space_map}

            encrypted = ''.join(combined_map.get(char, char) for char in expanded)


            # Get font URL for this storage/nonce

            base_url = os.environ.get('BASE_URL', request.url_root.rstrip('/'))

            font_filename, font_url = generate_font_artifacts(

                secret_key, nonce, upper_map, lower_map, space_map,

                base_url=base_url, website_id=storage_id

            )


            return jsonify({

                'encrypted': encrypted,

                'nonce': nonce,  # Same nonce every time

                'font_url': font_url,

                'storage_id': storage_id

            })


        except Exception as e:

            import traceback

            traceback.print_exc()

            return jsonify({'error': str(e), 'type': type(e).__name__}), 500



    @app.route('/api/encrypt/batch', methods=['POST'])
    @validate_api_key(check_domain=True, check_usage=True)
    def encrypt_articles_batch():

        """

        Batch encryption endpoint for encrypting multiple articles at once.

        Much more efficient for high-traffic sites.


        Request body:

            {

                "texts": ["Article 1 text", "Article 2 text", ...],

                "secret_key": 29202393

            }


        Response:

            {

                "encrypted": ["Encrypted text 1", "Encrypted text 2", ...],

                "font_url": "https://your-cdn.com/fonts/encrypted.woff2"

            }

        """

        try:

            data = request.json


            if not data:

                return jsonify({'error': 'No JSON data provided'}), 400


            texts = data.get('texts', [])

            secret_key = data.get('secret_key')


            if not texts or not isinstance(texts, list):

                return jsonify({'error': 'No texts array provided'}), 400


            # Use default secret key if not provided

            if secret_key is None:

                secret_key = SECRET_KEY

            else:

                # Convert secret_key to int if it's a string

                try:

                    secret_key = int(secret_key)

                except (ValueError, TypeError):

                    return jsonify({'error': 'secret_key must be an integer'}), 400


            if len(texts) > 100:  # Limit batch size

                return jsonify({'error': 'Batch size too large (max 100)'}), 400


            # Encrypt all texts using dynamic Feistel cipher

            encrypted_texts = []

            nonces = []

            font_urls = {}  # Map nonce -> font_url

            mappings_cache = {}  # Cache mappings by nonce to avoid recalculation


            base_url = os.environ.get('BASE_URL', request.url_root.rstrip('/'))


            for text in texts:

                if not text or not isinstance(text, str):

                    encrypted_texts.append('')

                    nonces.append(None)

                    continue


                # Expand ligatures and calculate nonce

                expanded = expand_ligatures(text)

                nonce = nonce_creator(expanded)

                nonces.append(nonce)


                # Get mappings (use cache if available)

                if nonce not in mappings_cache:

                    upper_map, lower_map, space_map = get_dynamic_mappings(secret_key, nonce)

                    mappings_cache[nonce] = (upper_map, lower_map, space_map)

                else:

                    upper_map, lower_map, space_map = mappings_cache[nonce]


                # Use mappings to encrypt the text

                # Combine all mappings (space is in lower_map, space_map only has special chars)

                combined_map = {**upper_map, **lower_map, **space_map}

                # All chars get mapped (spaces are in lower_map)

                encrypted = ''.join(combined_map.get(char, char) for char in expanded)

                encrypted_texts.append(encrypted)


                # Generate font for this nonce if we haven't already

                if nonce not in font_urls:

                    font_filename, font_url = generate_font_artifacts(

                        secret_key, nonce, upper_map, lower_map, space_map, base_url=base_url

                    )

                    font_urls[nonce] = font_url


            # Use the first font URL as the primary font_url for backward compatibility

            primary_font_url = font_urls.get(nonces[0] if nonces else None, 

                                            os.environ.get('FONT_URL', 'https://your-cdn.com/fonts/encrypted.woff2'))


            return jsonify({

                'encrypted': encrypted_texts,

                'nonces': nonces,  # Include nonces for each encrypted text

                'font_url': primary_font_url,  # Primary font URL (backward compatibility)

                'font_urls': font_urls  # Map of nonce -> font_url for each unique encryption

            })


        except Exception as e:

            import traceback

            error_msg = str(e)

            traceback.print_exc()

            return jsonify({'error': error_msg, 'type': type(e).__name__}), 500

