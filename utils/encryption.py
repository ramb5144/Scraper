#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Core encryption functions using Feistel cipher.
"""
from collections import Counter
import hashlib
from .generate_font import get_dynamic_mappings

# Ligature mappings
LIGATURES = {"\ufb00":"ff","\ufb01":"fi","\ufb02":"fl","\ufb03":"ffi","\ufb04":"ffl"}

def expand_ligatures(s: str) -> str:
    """Expand Unicode ligatures to ASCII equivalents"""
    return "".join(LIGATURES.get(ch, ch) for ch in s)

def remap_text_ultra_fast(text: str, secret_key: int, nonce: int, precomputed_maps=None, return_maps: bool = False):
    """
    Apply dynamic character remapping using unified Feistel cipher.
    Maps each character using the secret key and nonce.
    
    NOTE: Uses unified mapping for all 54 characters (26 uppercase + 28 lowercase+space+period).
    All characters are in one big cycle based on the Feistel cipher.
    The font handles case differences in rendering.
    
    precomputed_maps may be supplied to avoid recomputing (upper_map, lower_map, space_map).
    If return_maps is True, the tuple of maps is returned alongside the encrypted text.
    """
    if precomputed_maps:
        upper_map, lower_map, space_map = precomputed_maps
    else:
        upper_map, lower_map, space_map = get_dynamic_mappings(secret_key, nonce)
    
    # Combine all mappings (space is already in lower_map, space_map only has special chars)
    combined_map = {**upper_map, **lower_map, **space_map}
    
    # Apply mapping character by character
    result = []
    for char in text:
        if char in combined_map:
            result.append(combined_map[char])
        else:
            # Keep unmapped characters as-is
            result.append(char)
    
    encrypted = ''.join(result)
    
    # Note: Space can appear in encrypted text (as a target from other characters).
    # The font will render spaces correctly by showing the glyph of the character that maps to space.
    if return_maps:
        return encrypted, (upper_map, lower_map, space_map)
    return encrypted

def encrypt_article_text(text: str, secret_key: int, generate_font: bool = False, base_url: str = None):
    """
    Encrypt article text using dynamic Feistel cipher mapping:
    1. Expand ligatures first (handles Unicode ligatures)
    2. Calculate nonce from text
    3. Apply dynamic character remapping using secret key and nonce
    4. Optionally generate the matching decryption font (so tests/debug flows also get a font)
    
    Returns:
        dict with encrypted text, nonce, and optional font metadata
    """
    from font_utils import generate_font_artifacts
    
    expanded = expand_ligatures(text)
    nonce = nonce_creator(expanded)
    encrypted, maps = remap_text_ultra_fast(expanded, secret_key, nonce, return_maps=True)

    font_filename = None
    font_url = None
    space_char = None
    if generate_font:
        upper_map, lower_map, space_map = maps
        font_filename, font_url = generate_font_artifacts(
            secret_key, nonce, upper_map, lower_map, space_map, base_url=base_url
        )
        # Get the character that space maps to (for CSS word-breaking)
        space_char = lower_map.get(' ', None)
    
    return {
        'encrypted': encrypted,
        'nonce': nonce,
        'font_filename': font_filename,
        'font_url': font_url,
        'space_char': space_char,  # Character that space encrypts to (for word-breaking)
    }

def decrypt_article_text(encrypted_text: str, secret_key: int, nonce: int = None) -> str:
    """
    Decrypt article text using unified Feistel cipher mapping.
    Uses the reverse of the unified mapping (all 54 characters in one cycle).
    
    NOTE: Uses unified mapping for all 54 characters (26 uppercase + 28 lowercase+space+period).
    All characters are in one big cycle based on the Feistel cipher.
    
    Args:
        encrypted_text: The encrypted text to decrypt
        secret_key: The secret key used for encryption
        nonce: The nonce used for encryption. If None, will attempt to calculate
               from encrypted text (may not be accurate if text changed significantly)
    
    Returns:
        Decrypted text
    """
    # Step 1: Calculate nonce if not provided
    if nonce is None:
        # Try to calculate nonce from encrypted text (may not be perfect)
        nonce = nonce_creator(encrypted_text)
    
    # Step 2: Get the mappings (space is included in lower_map)
    upper_map, lower_map, space_map = get_dynamic_mappings(secret_key, nonce)
    
    # Step 3: Create reverse mappings for decryption
    # Reverse upper_map: encrypted -> original
    reverse_upper = {v: k for k, v in upper_map.items()}
    # Reverse lower_map: encrypted -> original (includes space)
    reverse_lower = {v: k for k, v in lower_map.items()}
    # Reverse space_map: encrypted -> original (only special chars like null->newline)
    reverse_space = {v: k for k, v in space_map.items()}
    
    # Step 4: Decrypt each character
    result = []
    for char in encrypted_text:
        # Check if it's uppercase
        if char in reverse_upper:
            result.append(reverse_upper[char])
        # Check if it's lowercase or space (space is in lower_map)
        elif char in reverse_lower:
            result.append(reverse_lower[char])
        # Check if it's a special character (like newline)
        elif char in reverse_space:
            result.append(reverse_space[char])
        # Handle null character
        elif char == '\n':
            result.append('\x00')
        else:
            # Keep unmapped characters as-is
            result.append(char)
    
    decrypted = ''.join(result)
    
    # Note: Ligature expansion is one-way, so we can't reverse it
    # The decrypted text will have expanded ligatures (e.g., "ff" instead of ligature character)
    
    return decrypted

def nonce_creator(text: str) -> int:
    """
    Returns a list of the prevalences of each unique character in the input string,
    sorted in descending order (largest count first), with only the counts (not the characters).
    
    Example:
        text = "aabbccac"
        counts: 'a':3, 'b':2, 'c':3  --> output: [3, 3, 2] --> after sorting: [3, 3, 2]

    Then that is concatenated ([3, 3, 2] --> "332") and hashed to an integer.
    """
    
    counts = Counter(text)
    sort = sorted(counts.values(), reverse=True)
    sort_str = "".join(str(i) for i in sort)
    return int(hashlib.md5(sort_str.encode('utf-8')).hexdigest(), 16) % 1000000

