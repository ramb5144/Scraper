#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF route handlers for PDF encryption API.
"""
import os
import tempfile
import base64
from flask import request, jsonify, Response
from .routes_common import SECRET_KEY, PYMUPDF_AVAILABLE, PDF_MAX_SIZE
from utils.font_utils import DEBUG_MODE


def register_pdf_routes(app):
    """Register PDF routes with the Flask app."""

    @app.route('/api/encrypt/pdf', methods=['POST'])
    def encrypt_pdf():
        """
        Encrypt PDF document by replacing text with encrypted versions.

        Request (multipart/form-data):
            - pdf: PDF file to encrypt (required)
            - secret_key: Secret key for encryption (optional, defaults to SECRET_KEY)
            - output_format: Response format - 'binary' (default) or 'json'
            - base_font: Base font file path (optional, will extract from PDF if not provided)
            - regular: Custom regular font file (optional)
            - bold: Custom bold font file (optional)
            - italic: Custom italic font file (optional)
            - bold_italic: Custom bold-italic font file (optional)

        Response (binary mode - default):
            Returns encrypted PDF file as download.

        Response (json mode):
            {
                "success": true,
                "pdf_base64": "JVBERi0x...",
                "filename": "encrypted_document.pdf",
                "size_bytes": 12345,
                "stats": {
                    "pages": 5,
                    "nonce": 462508,
                    "fonts_extracted": ["regular", "bold"],
                    "fonts_used": ["regular", "bold"]
                }
            }
        """
        if not PYMUPDF_AVAILABLE:
            return jsonify({
                'error': 'PyMuPDF (fitz) is required for PDF encryption. Install with: pip install pymupdf'
            }), 500

        try:
            # Import PDF encryption function
            try:
                from utils.pdf_encryption import redact_and_overwrite, FONT_CACHE
            except ImportError as e:
                return jsonify({'error': f'Could not import PDF encryption module: {e}'}), 500

            # Clear font cache for new request
            try:
                FONT_CACHE.clear()
                if DEBUG_MODE:
                    print("[INFO] Cleared font cache for new API request")
            except:
                pass

            # Check if PDF file was uploaded
            if 'pdf' not in request.files:
                return jsonify({
                    'error': 'No PDF file provided. Use multipart/form-data with "pdf" field.'
                }), 400

            pdf_file = request.files['pdf']
            if pdf_file.filename == '':
                return jsonify({'error': 'No PDF file selected'}), 400

            # Get output format preference
            output_format = request.form.get('output_format', 'binary').lower()
            if output_format not in ('binary', 'json'):
                return jsonify({'error': 'output_format must be "binary" or "json"'}), 400

            # Validate file size
            pdf_file.seek(0, 2)  # Seek to end
            file_size = pdf_file.tell()
            pdf_file.seek(0)  # Seek back to start

            if file_size > PDF_MAX_SIZE:
                max_mb = PDF_MAX_SIZE // (1024 * 1024)
                return jsonify({
                    'error': f'PDF too large. Maximum size: {max_mb}MB. Your file: {file_size / (1024 * 1024):.1f}MB'
                }), 400

            if file_size == 0:
                return jsonify({'error': 'PDF file is empty'}), 400

            # Check PDF magic bytes
            header = pdf_file.read(5)
            pdf_file.seek(0)
            if header != b'%PDF-':
                return jsonify({
                    'error': 'Invalid PDF file. File does not start with PDF header.'
                }), 400

            # Get secret key
            secret_key = request.form.get('secret_key')
            if secret_key is None:
                secret_key = SECRET_KEY
            else:
                try:
                    secret_key = int(secret_key)
                except (ValueError, TypeError):
                    return jsonify({'error': 'secret_key must be an integer'}), 400

            # Get optional base font path
            base_font_path = request.form.get('base_font')
            if base_font_path and not os.path.exists(base_font_path):
                return jsonify({'error': f'Base font file not found: {base_font_path}'}), 400

            # Get optional custom font files
            font_paths = {}
            for style in ['regular', 'bold', 'italic', 'bold_italic']:
                font_file = request.files.get(style)
                if font_file and font_file.filename:
                    temp_font = tempfile.NamedTemporaryFile(delete=False, suffix='.ttf')
                    font_file.save(temp_font.name)
                    temp_font.close()
                    font_paths[style] = temp_font.name

            # Save uploaded PDF to temporary file
            temp_input = tempfile.NamedTemporaryFile(delete=False, suffix='.pdf')
            pdf_file.save(temp_input.name)
            temp_input.close()

            # Create temporary output file
            temp_output = tempfile.NamedTemporaryFile(delete=False, suffix='.pdf')
            temp_output.close()

            try:
                # Encrypt the PDF
                result = redact_and_overwrite(
                    temp_input.name,
                    font_paths,
                    temp_output.name,
                    secret_key=secret_key,
                    base_font_path=base_font_path
                )

                # Read the encrypted PDF
                with open(temp_output.name, 'rb') as f:
                    pdf_data = f.read()

                # Clean up temporary files
                cleanup_files = [temp_input.name, temp_output.name] + list(font_paths.values())
                for filepath in cleanup_files:
                    try:
                        if os.path.exists(filepath):
                            os.unlink(filepath)
                    except Exception as cleanup_error:
                        if DEBUG_MODE:
                            print(f"Warning: Error cleaning up {filepath}: {cleanup_error}")

                # Return response based on format
                if output_format == 'json':
                    # Get original filename for response
                    original_filename = pdf_file.filename or 'document.pdf'
                    encrypted_filename = f"encrypted_{original_filename}"

                    response_data = {
                        'success': True,
                        'pdf_base64': base64.b64encode(pdf_data).decode('utf-8'),
                        'filename': encrypted_filename,
                        'size_bytes': len(pdf_data),
                        'stats': result if isinstance(result, dict) else {
                            'text_encrypted': True
                        }
                    }
                    return jsonify(response_data)
                else:
                    # Return binary PDF
                    original_filename = pdf_file.filename or 'document.pdf'
                    encrypted_filename = f"encrypted_{original_filename}"

                    return Response(
                        pdf_data,
                        mimetype='application/pdf',
                        headers={
                            'Content-Disposition': f'attachment; filename="{encrypted_filename}"'
                        }
                    )

            except Exception as processing_error:
                # Clean up on error
                cleanup_files = [temp_input.name, temp_output.name] + list(font_paths.values())
                for filepath in cleanup_files:
                    try:
                        if os.path.exists(filepath):
                            os.unlink(filepath)
                    except:
                        pass
                raise processing_error

        except ValueError as e:
            error_msg = str(e)
            if 'no text' in error_msg.lower():
                return jsonify({
                    'error': 'PDF contains no extractable text. The PDF may be image-based or empty.'
                }), 400
            return jsonify({'error': error_msg}), 400

        except Exception as e:
            import traceback
            error_msg = str(e)
            traceback.print_exc()

            # Check for specific error types
            if 'password' in error_msg.lower() or 'encrypted' in error_msg.lower():
                return jsonify({
                    'error': 'PDF is password-protected. Please provide an unprotected PDF.'
                }), 400
            elif 'corrupt' in error_msg.lower() or 'invalid' in error_msg.lower():
                return jsonify({
                    'error': 'PDF file appears to be corrupted or invalid.'
                }), 400

            return jsonify({
                'error': f'Failed to encrypt PDF: {error_msg}'
            }), 500
