#!/usr/bin/env python3
"""
Generate a static encrypted version of the stackoverflow demo for Vercel deployment.

This script:
1. Loads the stackoverflow.html template
2. Extracts all text content
3. Calls the local encryption API to encrypt it
4. Downloads the decryption font
5. Creates a self-contained HTML with embedded font
"""

import os
import sys
import json
import base64
import requests
from bs4 import BeautifulSoup

# Configuration
API_BASE = "http://localhost:8001"
SOURCE_HTML = "../templates/stackoverflow.html"
OUTPUT_DIR = "."

def extract_text_nodes(soup):
    """Extract all text nodes that should be encrypted."""
    text_nodes = []

    # Tags to skip
    skip_tags = {'script', 'style', 'noscript', 'code', 'pre', 'textarea', 'input'}

    def walk(element):
        if element.name in skip_tags:
            return

        for child in element.children:
            if isinstance(child, str):
                text = child.strip()
                if text and len(text) > 0:
                    text_nodes.append({
                        'text': str(child),
                        'element': child
                    })
            elif hasattr(child, 'children'):
                walk(child)

    walk(soup.body)
    return text_nodes

def encrypt_texts(texts):
    """Call the API to encrypt texts."""
    response = requests.post(
        f"{API_BASE}/api/encrypt/page",
        json={
            'texts': texts,
            'secret_key': 29202393  # Use consistent secret key
        },
        headers={
            'X-API-Key': 'test-key'
        }
    )

    if response.status_code != 200:
        print(f"Error encrypting: {response.text}")
        sys.exit(1)

    return response.json()

def download_font(font_url):
    """Download the decryption font."""
    # Handle relative URLs
    if font_url.startswith('/'):
        font_url = f"{API_BASE}{font_url}"

    response = requests.get(font_url)
    if response.status_code != 200:
        print(f"Error downloading font: {response.status_code}")
        return None

    return response.content

def main():
    print("Loading source HTML...")
    with open(SOURCE_HTML, 'r', encoding='utf-8') as f:
        html_content = f.read()

    soup = BeautifulSoup(html_content, 'html.parser')

    print("Extracting text nodes...")
    text_nodes = extract_text_nodes(soup)
    texts = [node['text'] for node in text_nodes]

    print(f"Found {len(texts)} text nodes to encrypt")

    print("Encrypting texts via API...")
    result = encrypt_texts(texts)

    encrypted_texts = result.get('encrypted_texts', [])
    font_url = result.get('font_url')
    hash_value = result.get('hash')

    print(f"Font URL: {font_url}")
    print(f"Hash: {hash_value}")

    print("Downloading decryption font...")
    font_data = download_font(font_url)
    if not font_data:
        print("Failed to download font")
        sys.exit(1)

    # Save font to file
    font_filename = "decryption_font.woff2"
    with open(os.path.join(OUTPUT_DIR, font_filename), 'wb') as f:
        f.write(font_data)
    print(f"Saved font: {font_filename} ({len(font_data)} bytes)")

    # Replace text nodes with encrypted versions
    print("Replacing text nodes with encrypted versions...")
    for i, node in enumerate(text_nodes):
        if i < len(encrypted_texts) and encrypted_texts[i]:
            node['element'].replace_with(encrypted_texts[i])

    # Remove the SDK script and init code (not needed for static)
    for script in soup.find_all('script'):
        if script.string and ('CloakSDK' in script.string or 'cloak-sdk.js' in str(script.get('src', ''))):
            script.decompose()

    # Add the decryption font CSS
    style_tag = soup.new_tag('style')
    style_tag.string = f'''
@font-face {{
    font-family: 'CloakDecrypt';
    src: url('./{font_filename}') format('woff2');
    font-display: block;
}}

/* Apply to all text elements */
body, p, span, div, a, li, td, th, h1, h2, h3, h4, h5, h6,
article, section, main, aside, nav, header, footer,
.s-prose, .post-text, .comment-copy, .comment-text {{
    font-family: 'CloakDecrypt', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
}}
'''

    # Insert style at the end of head
    if soup.head:
        soup.head.append(style_tag)

    # Save the encrypted HTML
    output_html = os.path.join(OUTPUT_DIR, "index.html")
    with open(output_html, 'w', encoding='utf-8') as f:
        f.write(str(soup))

    print(f"\nSaved encrypted HTML: {output_html}")
    print(f"\nTo deploy to Vercel:")
    print(f"  1. cd {OUTPUT_DIR}")
    print(f"  2. vercel")
    print(f"\nOr test locally:")
    print(f"  python3 -m http.server 8888")
    print(f"  Open http://localhost:8888/")

if __name__ == '__main__':
    main()
