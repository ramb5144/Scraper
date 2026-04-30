#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Debug route handlers.
"""
import os
import hashlib
from flask import request, jsonify
from utils.generate_font import get_dynamic_mappings, UPPERCASE, LOWERCASE
from utils.r2_website_storage import (
    extract_website_id,
    list_website_files,
)
from utils.encryption import (
    expand_ligatures,
    encrypt_article_text,
    decrypt_article_text,
    nonce_creator,
)
from utils.font_utils import DEBUG_MODE
from .routes_common import SECRET_KEY

def register_debug_routes(app):
    """Register debug routes with the Flask app."""
    
    @app.route('/api', methods=['GET'])

    def api_info():

        """API information endpoint"""

        return jsonify({

            'service': 'article-encryption-api',

            'status': 'running',

            'endpoints': {

                'encrypt': '/api/encrypt (POST)',

                'decrypt': '/api/decrypt (POST)',

                'batch': '/api/encrypt/batch (POST)',

                'page': '/api/encrypt/page (POST)',

                'html': '/api/encrypt/html (POST)',

                'pdf': '/api/encrypt/pdf (POST) - Encrypt PDF document',

                'test': '/api/test (POST)',

                'health': '/api/health (GET)',

                'debug_mapping': '/api/debug/mapping (POST)'

            }

        })



    @app.route('/api/health', methods=['GET'])

    def health_check():

        """Health check endpoint"""

        return jsonify({

            'status': 'healthy',

            'service': 'article-encryption-api'

        })



    @app.route('/api/debug/r2/list', methods=['GET'])

    def debug_list_r2_files():

        """

        Debug endpoint to list all files in R2 for a website_id.


        Query parameters:

            - website_id: Website identifier (optional, will extract from request if not provided)

            - domain: Domain name (optional, used to calculate website_id if website_id not provided)


        Returns:

            JSON with list of all files (metadata, fonts, html_cache) for the website

        """

        try:

            # Get website_id from query params or extract from request

            website_id = request.args.get('website_id')

            domain = request.args.get('domain')


            if not website_id:

                if domain:

                    # Calculate website_id from domain

                    import hashlib

                    normalized_domain = domain.lower().replace('www.', '').strip()

                    website_id = hashlib.md5(normalized_domain.encode()).hexdigest()[:16]

                else:

                    # Extract from request

                    website_id, domain = extract_website_id(request)


            if not website_id:

                return jsonify({'error': 'website_id or domain required'}), 400


            # List files

            files_info = list_website_files(website_id)


            # Format response

            response = {

                'website_id': website_id,

                'domain': domain if 'domain' in locals() else None,

                'metadata': files_info.get('metadata'),

                'fonts_count': len(files_info.get('fonts', [])),

                'fonts': files_info.get('fonts', []),

                'html_cache_count': len(files_info.get('html_cache', [])),

                'html_cache': files_info.get('html_cache', []),

                'total_files': files_info.get('total_files', 0),

                'total_size_bytes': files_info.get('total_size', 0),

                'total_size_mb': round(files_info.get('total_size', 0) / (1024 * 1024), 2)

            }


            if 'error' in files_info:

                response['error'] = files_info['error']


            return jsonify(response)


        except Exception as e:

            import traceback

            error_msg = str(e)

            traceback.print_exc()

            return jsonify({'error': error_msg, 'type': type(e).__name__}), 500



    @app.route('/api/test', methods=['POST'])

    def test_encryption():

        """

        Test endpoint to verify algorithm works correctly.

        Useful for debugging and verification.

        """

        try:

            data = request.json

            test_text = data.get('text')

            secret_key = data.get('secret_key')


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

                print(f"DEBUG TEST: Encrypting text='{test_text}' with secret_key={secret_key}")


            base_url = os.environ.get('BASE_URL', request.url_root.rstrip('/'))

            encryption_result = encrypt_article_text(test_text, secret_key, generate_font=True, base_url=base_url)

            encrypted = encryption_result['encrypted']


            # Debug: Log the result (only in debug mode)

            if DEBUG_MODE:

                print(f"DEBUG TEST: Encrypted result: '{encrypted}'")


            nonce = encryption_result['nonce']


            # Decrypt to verify it works

            decrypted = decrypt_article_text(encrypted, secret_key, nonce)


            return jsonify({

                'original': test_text,

                'encrypted': encrypted,

                'decrypted': decrypted,

                'nonce': nonce,

                'font_url': encryption_result['font_url'],

                'font_filename': encryption_result['font_filename'],

                'space_char': encryption_result['space_char'],  # Character that space encrypts to (for word-breaking)

                'algorithm': 'dynamic_feistel_cipher',

                'secret_key': secret_key,

                'secret_key_received': str(data.get('secret_key')),

                'secret_key_type': str(type(data.get('secret_key')).__name__) if data.get('secret_key') is not None else 'None',

                'roundtrip_success': test_text == decrypted

            })


        except Exception as e:

            import traceback

            error_msg = str(e)

            traceback.print_exc()

            return jsonify({'error': error_msg, 'type': type(e).__name__}), 500



    @app.route('/api/mappings', methods=['POST'])

    def get_mappings():

        """

        Get character mappings for a given secret key and nonce.


        Request body:

            {

                "secret_key": 29202393,

                "nonce": 462508  # optional, will calculate from text if provided

                "text": "Hello"  # optional, for nonce calculation

            }

        """

        try:

            data = request.json


            if not data:

                return jsonify({'error': 'No JSON data provided'}), 400


            secret_key = data.get('secret_key')

            nonce = data.get('nonce')

            text = data.get('text', '')


            # Use default secret key if not provided

            if secret_key is None:

                secret_key = SECRET_KEY

            else:

                try:

                    secret_key = int(secret_key)

                except (ValueError, TypeError):

                    return jsonify({'error': 'secret_key must be an integer'}), 400


            # Calculate nonce from text if not provided

            if nonce is None and text:

                expanded = expand_ligatures(text)

                nonce = nonce_creator(expanded)

            elif nonce is None:

                return jsonify({'error': 'Either nonce or text must be provided'}), 400

            else:

                try:

                    nonce = int(nonce)

                except (ValueError, TypeError):

                    return jsonify({'error': 'nonce must be an integer'}), 400


            # Get mappings

            upper_map, lower_map, space_map = get_dynamic_mappings(secret_key, nonce)


            # Combine all mappings for display

            combined_map = {**upper_map, **lower_map, **space_map}


            return jsonify({

                'secret_key': secret_key,

                'nonce': nonce,

                'upper_map': upper_map,

                'lower_map': lower_map,

                'space_map': space_map,

                'combined_map': combined_map

            })


        except Exception as e:

            import traceback

            traceback.print_exc()

            return jsonify({'error': str(e), 'type': type(e).__name__}), 500



    @app.route('/api/debug/mapping', methods=['POST'])

    def debug_mapping():

        """

        Debug endpoint to show character mappings for different secret keys.

        Useful for verifying that mappings change with secret_key.


        Request body:

            {

                "secret_key1": 29202393,

                "secret_key2": 12345,

                "text": "Hello"  # optional, for nonce calculation

            }

        """

        from encryption import encrypt_article_text

        try:

            data = request.json

            sk1 = data.get('secret_key1')

            sk2 = data.get('secret_key2')

            text = data.get('text', 'Hello')


            # Convert to int

            try:

                sk1 = int(sk1)

                sk2 = int(sk2)

            except (ValueError, TypeError):

                return jsonify({'error': 'secret_key1 and secret_key2 must be integers'}), 400


            # Calculate nonce

            expanded = expand_ligatures(text)

            nonce = nonce_creator(expanded)


            # Get mappings

            upper1, lower1, _ = get_dynamic_mappings(sk1, nonce)

            upper2, lower2, _ = get_dynamic_mappings(sk2, nonce)


            # Compare mappings

            upper_diff = {char: (upper1[char], upper2[char]) for char in UPPERCASE if upper1[char] != upper2[char]}

            lower_diff = {char: (lower1[char], lower2[char]) for char in LOWERCASE if lower1[char] != lower2[char]}


            # Test encryption with both keys to show they're different

            enc1 = encrypt_article_text(text, sk1)['encrypted']

            enc2 = encrypt_article_text(text, sk2)['encrypted']


            return jsonify({

                'nonce': nonce,

                'secret_key1': sk1,

                'secret_key2': sk2,

                'encrypted_text_sk1': enc1,

                'encrypted_text_sk2': enc2,

                'encrypted_texts_are_different': enc1 != enc2,

                'mappings_are_different': upper1 != upper2 or lower1 != lower2,

                'uppercase_mappings_different': len(upper_diff),

                'lowercase_mappings_different': len(lower_diff),

                'uppercase_differences': upper_diff,

                'lowercase_differences': lower_diff,

                'sample_uppercase_mapping_sk1': {k: upper1[k] for k in list(UPPERCASE)[:10]},

                'sample_uppercase_mapping_sk2': {k: upper2[k] for k in list(UPPERCASE)[:10]},

            })


        except Exception as e:

            import traceback

            traceback.print_exc()

