#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Automated Font Generation Script
Builds a font whose glyphs are remapped based on the Feistel cipher output so
encrypted text renders as the original characters.
"""
import sys
import os
import copy
import hashlib

try:
    from fontTools.ttLib import TTFont
except ImportError:
    print("ERROR: fonttools not installed!")
    print("Installing fonttools and brotli...")
    os.system("pip install fonttools brotli")
    from fontTools.ttLib import TTFont

# Import encryption functions for dynamic mapping
from .Fiesty import enc54
UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
LOWERCASE = "abcdefghijklmnopqrstuvwxyz ."  # Includes space and period (28 characters)
# Unified character set: uppercase (0-25) + lowercase+space+period (26-53) = 54 total
UNIFIED_CHARS = UPPERCASE + LOWERCASE  # 26 + 28 = 54 characters
NBSP = '\u00A0'

# Flag to track if we've logged mappings once (only log at first font creation)
_MAPPINGS_LOGGED = False

def generate_unified_mapping(sk: int, nonce: int, exclude_space: bool = False) -> dict:
    """
    Generate unified character mapping using Feistel cipher for all characters.
    Maps each character in the character set to its encrypted version.

    Args:
        sk: Secret key
        nonce: Nonce value
        exclude_space: If True, use 52 characters (no space, no period) for SDK mode.
                       If False, use all 54 characters.

    Returns:
        Dictionary mapping original char -> encrypted char
    """
    # Choose character set based on exclude_space flag
    if exclude_space:
        # SDK mode: 52 characters (no space, no period)
        # Period is excluded because browsers use it for list markers (1. 2. 3.)
        # and other auto-generated content that shouldn't be affected by glyph swapping
        chars = UPPERCASE + "abcdefghijklmnopqrstuvwxyz"  # 26 + 26 = 52 characters
    else:
        # Normal mode: all 54 characters including space and period
        chars = UNIFIED_CHARS

    mapping = {}
    used_chars = set()  # Track which characters are already mapped to

    # First pass: map all positions that encrypt to valid range
    for i, char in enumerate(chars):
        encrypted_pos = enc54(sk, nonce, i) % len(chars)  # Mod by actual char count
        if encrypted_pos < len(chars):
            target_char = chars[encrypted_pos]
            mapping[char] = target_char
            used_chars.add(target_char)

    # Second pass: handle positions that encrypt outside range (shouldn't happen with enc54, but safety)
    for i, char in enumerate(chars):
        if char not in mapping:
            encrypted_pos = enc54(sk, nonce, i)
            # Wrap to valid range
            target_pos = encrypted_pos % len(chars)
            target_char = chars[target_pos]
            # If target is already used, find first unused
            if target_char in used_chars:
                for j in range(len(chars)):
                    candidate = chars[j]
                    if candidate not in used_chars:
                        target_char = candidate
                        break
            mapping[char] = target_char
            used_chars.add(target_char)

    return mapping

def get_dynamic_mappings(sk: int, nonce: int, exclude_space: bool = False) -> tuple:
    """
    Get unified dynamic mapping for characters.
    Returns (upper_map, lower_map, space_map) for compatibility.

    Uses a single Feistel cipher cycle for all characters.
    The font will handle case differences in rendering.

    Args:
        sk: Secret key
        nonce: Nonce value
        exclude_space: If True, use 52 characters (no space, no period) for SDK mode.
                       If False, use all 54 characters.

    If exclude_space=False (default):
        All 54 characters (including space and period) are in the cycle.
        Space can be a target (other characters can map to it).

    If exclude_space=True (SDK mode):
        Only 52 characters (no space, no period). No character maps TO space or period.
        This allows browser whitespace and punctuation (list markers like 1. 2. 3.)
        to work normally without being affected by glyph swapping.
    """
    # Generate unified mapping
    unified_map = generate_unified_mapping(sk, nonce, exclude_space=exclude_space)

    # Choose character set for bijectivity fixing
    if exclude_space:
        # SDK mode: 52 characters (no space, no period)
        chars_for_fix = UPPERCASE + "abcdefghijklmnopqrstuvwxyz"
    else:
        # Normal mode: all 54 characters including space
        chars_for_fix = UNIFIED_CHARS

        # CRITICAL: Ensure space does not map to itself (to prevent CSS line breaks).
        # But space CAN be used as a target by other characters - all 54 characters must be in the cycle.
        # Only relevant when space is in the character set
        if unified_map.get(' ', ' ') == ' ':
            # Space maps to itself - we need to swap it with another character
            # Find a character that doesn't map to space, and swap their targets
            for char in UNIFIED_CHARS:
                if char != ' ' and unified_map.get(char) != ' ':
                    # Swap: space -> char's target, char -> space
                    char_target = unified_map[char]
                    unified_map[' '] = char_target
                    unified_map[char] = ' '
                    break

    # Fix bijectivity issues (duplicates) in a loop
    # This ensures the mapping is one-to-one (bijective) so decryption works correctly
    # Key insight: All characters in the set must be used as both sources and targets
    # The only constraint (when space is included) is that space should not map to itself
    max_iterations = 100
    iterations_used = 0
    for iteration in range(max_iterations):
        iterations_used = iteration + 1
        # CRITICAL: Snapshot current state before checking for duplicates
        # This ensures we're working with consistent data
        current_state = dict(unified_map)
        
        # Build target -> sources mapping to find duplicates
        # Use the snapshot to ensure consistency
        target_to_sources = {}
        for source, target in current_state.items():
            if target not in target_to_sources:
                target_to_sources[target] = []
            target_to_sources[target].append(source)
        
        # Collect all sources that need reassignment (duplicates and space->space)
        sources_to_reassign = []
        for target, sources in target_to_sources.items():
            if not exclude_space and target == ' ' and ' ' in sources:
                # Space is mapping to itself - reassign space (keep others that map to space)
                # Only relevant when space is in the character set
                sources_to_reassign.append(' ')
            elif len(sources) > 1:
                # Multiple sources map to same target - keep first, reassign ALL others
                sources_to_reassign.extend(sources[1:])
        
        # If no issues found, we're done
        if not sources_to_reassign:
            break
        
        # Remove duplicates from sources_to_reassign (a source might appear multiple times)
        sources_to_reassign = list(dict.fromkeys(sources_to_reassign))
        
        # Reassign each problematic source
        # Process in a stable order to ensure deterministic results
        # CRITICAL: Rebuild used_targets for each source to account for previous reassignments
        current_duplicate_targets = {target for target, sources in target_to_sources.items() 
                                    if len(sources) > 1}
        
        # CRITICAL: Process sources one at a time and rebuild state after each reassignment
        # This ensures we're always working with the current state, not stale data
        for source in sorted(sources_to_reassign):
            old_target = unified_map[source]
            
            # Build used_targets: all targets currently used by other sources
            # Exclude the current source from consideration
            # CRITICAL: Rebuild this from the CURRENT state of unified_map (which may have been modified by previous reassignments)
            used_targets = {t for s, t in unified_map.items() if s != source}
            
            # Find an unused target
            # For space: can use any target except space itself
            # For others: can use any target (including space, but not the old_target)
            reassigned = False
            # First try: unused targets without duplicates
            for candidate in chars_for_fix:
                if not exclude_space and source == ' ':
                    # Space cannot map to itself (only when space is in set)
                    if candidate == ' ':
                        continue
                else:
                    # Other characters cannot map to their old target
                    if candidate == old_target:
                        continue

                if candidate not in used_targets and candidate not in current_duplicate_targets:
                    unified_map[source] = candidate
                    reassigned = True
                    break

            # Second try: unused targets even if they have duplicates (will create new duplicate, but next iteration fixes)
            if not reassigned:
                for candidate in chars_for_fix:
                    if not exclude_space and source == ' ':
                        # Space cannot map to itself (only when space is in set)
                        if candidate == ' ':
                            continue
                    else:
                        # Other characters cannot map to their old target
                        if candidate == old_target:
                            continue

                    if candidate not in used_targets:
                        unified_map[source] = candidate
                        reassigned = True
                        break
            
            # If no unused target available, we need to do a swap
            # This happens when all targets are already used
            # Strategy: Swap source with ANY other source to break the duplicate
            if not reassigned:
                # Find any source we can swap with (excluding source itself)
                for swap_source in chars_for_fix:
                    if swap_source == source:
                        continue

                    swap_source_target = current_state.get(swap_source)
                    if swap_source_target is None:
                        continue

                    # For space: cannot swap to space (only when space is in set)
                    if not exclude_space and source == ' ' and swap_source_target == ' ':
                        continue

                    # For others: cannot swap to old_target
                    if (exclude_space or source != ' ') and swap_source_target == old_target:
                        continue

                    # Direct swap: source -> swap_source_target, swap_source -> old_target
                    # This will work as long as swap_source_target != old_target
                    if swap_source_target != old_target:
                        unified_map[source] = swap_source_target
                        unified_map[swap_source] = old_target
                        reassigned = True
                        break

            # Last resort: assign to any target (will create duplicate, next iteration fixes it)
            if not reassigned:
                for candidate in chars_for_fix:
                    if not exclude_space and source == ' ':
                        # Space cannot map to itself (only when space is in set)
                        if candidate == ' ':
                            continue
                    else:
                        # Other characters cannot map to their old target
                        if candidate == old_target:
                            continue

                    unified_map[source] = candidate
                    reassigned = True
                    break
    
    # Split unified_map into upper_map and lower_map for compatibility
    # But they're actually the same unified mapping
    upper_map = {char: unified_map[char] for char in UPPERCASE if char in unified_map}

    # Use appropriate lowercase set based on exclude_space flag
    if exclude_space:
        lowercase_chars = "abcdefghijklmnopqrstuvwxyz"  # 26 characters, no space, no period
    else:
        lowercase_chars = LOWERCASE  # 28 characters including space and period

    lower_map = {char: unified_map[char] for char in lowercase_chars if char in unified_map}

    # Special characters (null -> newline) - kept for font display purposes
    space_map = {"\x00": "\n"}

    return upper_map, lower_map, space_map

def remap_kerning_tables(font, unified_encryption_map, char_to_glyph, verbose=False):
    """
    Extract kerning pairs from original font and remap them to encrypted character pairs.
    This allows kerning to work on the displayed text (original characters) while the
    actual text remains encrypted.
    
    Logic:
    - Original kerning: glyph 'A' + glyph 'V' = -50 (when 'A' and 'V' are displayed)
    - After encryption: original 'A' -> encrypted 'N', original 'V' -> encrypted 'g'
    - After glyph swap: encrypted 'N' uses glyph 'N' (shows A shape), encrypted 'g' uses glyph 'g' (shows V shape)
    - Remapped kerning: glyph 'N' + glyph 'g' = -50 (so when N and g are displayed, they get the same kerning as A and V)
    
    Args:
        font: TTFont object (original font, before glyph swapping)
        unified_encryption_map: dict mapping original -> encrypted characters
        char_to_glyph: dict mapping character -> glyph name
        verbose: If True, print debug information
    
    Returns:
        dict: remapped_kern_pairs mapping (left_glyph, right_glyph) -> kerning_value, or {} if none found
    """
    remapped_kern_pairs = {}

    # Create glyph to character mapping from font's cmap (ALL characters, not filtered)
    # We need to map glyph names to characters first, then filter during remapping
    glyph_to_char = {}
    for char, glyph_name in char_to_glyph.items():
        if glyph_name not in glyph_to_char:
            glyph_to_char[glyph_name] = char

    # Add validation - if no glyphs found, we can't remap
    if not glyph_to_char:
        if verbose:
            print("⚠️  WARNING: glyph_to_char is EMPTY - no glyphs found in font!")
        return {}

    if verbose:
        print(f"  Built glyph_to_char mapping with {len(glyph_to_char)} entries")
        # Show which encryption chars are available
        encryption_chars = set(unified_encryption_map.keys())
        font_chars = set(char_to_glyph.keys())
        overlap = encryption_chars & font_chars
        print(f"  Encryption map has {len(encryption_chars)} chars, font has {len(font_chars)} chars, overlap: {len(overlap)}")

    # Extract and remap 'kern' table (simpler, older format)
    if 'kern' in font:
        try:
            kern_table = font['kern']
            original_pairs_count = 0
            if hasattr(kern_table, 'kernTables'):
                for subtable in kern_table.kernTables:
                    if hasattr(subtable, 'kernTable') and subtable.kernTable:
                        original_pairs_count = len(subtable.kernTable)
                        if verbose:
                            print(f"  Found {original_pairs_count} kerning pairs in original 'kern' table")
                        
                        # kernTable is a dict mapping (left_glyph, right_glyph) -> kerning_value
                        for (left_glyph, right_glyph), kerning_value in subtable.kernTable.items():
                            # Find characters that use these glyphs (from unfiltered glyph_to_char)
                            left_char = glyph_to_char.get(left_glyph)
                            right_char = glyph_to_char.get(right_glyph)

                            # If we found both characters, check if they're in our encryption map
                            if left_char and right_char:
                                if left_char in unified_encryption_map and right_char in unified_encryption_map:
                                    # Map to encrypted characters
                                    encrypted_left = unified_encryption_map[left_char]
                                    encrypted_right = unified_encryption_map[right_char]

                                    # Get glyph names for encrypted characters
                                    encrypted_left_glyph = char_to_glyph.get(encrypted_left)
                                    encrypted_right_glyph = char_to_glyph.get(encrypted_right)

                                    if encrypted_left_glyph and encrypted_right_glyph:
                                        remapped_kern_pairs[(encrypted_left_glyph, encrypted_right_glyph)] = kerning_value
                                        if verbose:
                                            print(f"  Remapped kerning: '{left_char}'+'{right_char}' "
                                                  f"({left_glyph}+{right_glyph}) -> "
                                                  f"'{encrypted_left}'+'{encrypted_right}' "
                                                  f"({encrypted_left_glyph}+{encrypted_right_glyph}) = {kerning_value}")
                                # Skip silently if not in encryption map - these are chars we don't encrypt
                            # Skip silently if glyph not found - these might be ligatures or special glyphs
            
            if verbose and original_pairs_count > 0:
                print(f"  Original 'kern' table had {original_pairs_count} pairs, remapped {len(remapped_kern_pairs)} pairs")
            
            if verbose:
                if remapped_kern_pairs:
                    print(f"  Extracted {len(remapped_kern_pairs)} remapped kerning pairs from 'kern' table")
                else:
                    print(f"  No kerning pairs could be remapped from 'kern' table")
        except Exception as e:
            if verbose:
                print(f"  ⚠️  Error extracting 'kern' table: {e}")
                import traceback
                traceback.print_exc()
    
    # Extract and remap GPOS table (modern format)
    if 'GPOS' in font:
        try:
            gpos_table = font['GPOS'].table
            original_pairs_count = 0
            
            if verbose:
                print(f"  Extracting kerning from GPOS table...")
            
            # GPOS has LookupList with Lookups, each Lookup has SubTables
            # We need to find Pair Adjustment (type 2) lookups
            if hasattr(gpos_table, 'LookupList') and gpos_table.LookupList:
                for lookup_index, lookup in enumerate(gpos_table.LookupList.Lookup):
                    if lookup.LookupType == 2:  # Pair Adjustment
                        if verbose:
                            print(f"  Found GPOS Pair Adjustment Lookup #{lookup_index}")
                        
                        for subtable in lookup.SubTable:
                            # Pair Adjustment subtables can be format 1 or 2
                            # Format 1 uses PairSet (array), Format 2 uses ClassDef1/ClassDef2
                            subtable_format = getattr(subtable, 'Format', None)
                            if verbose:
                                print(f"    Processing subtable Format {subtable_format}...")
                            
                            if hasattr(subtable, 'PairSet') or (subtable_format == 1):  # Format 1
                                # Format 1: Coverage table + PairSet array
                                if verbose:
                                    print(f"    Format 1 detected: Has PairSet={hasattr(subtable, 'PairSet')}, Has Coverage={hasattr(subtable, 'Coverage')}")
                                
                                if hasattr(subtable, 'Coverage') and subtable.Coverage:
                                    coverage_glyphs = subtable.Coverage.glyphs if hasattr(subtable.Coverage, 'glyphs') else []
                                    pair_set_array = subtable.PairSet if hasattr(subtable, 'PairSet') else []
                                    
                                    if verbose:
                                        print(f"      Coverage glyphs: {len(coverage_glyphs)}")
                                        print(f"      PairSet array length: {len(pair_set_array) if pair_set_array else 0}")
                                    
                                    for glyph_index, glyph_name in enumerate(coverage_glyphs):
                                        if glyph_index < len(pair_set_array) if pair_set_array else False:
                                            pair_set = pair_set_array[glyph_index]
                                            if pair_set and hasattr(pair_set, 'PairValueRecord'):
                                                if verbose and glyph_index < 3:
                                                    print(f"        Glyph {glyph_name} (index {glyph_index}): {len(pair_set.PairValueRecord)} pairs")
                                                
                                                for pair_value in pair_set.PairValueRecord:
                                                    right_glyph = pair_value.SecondGlyph
                                                    # Get kerning value (XAdvance adjustment)
                                                    kerning_value = 0
                                                    if hasattr(pair_value, 'Value1') and pair_value.Value1:
                                                        if hasattr(pair_value.Value1, 'XAdvance'):
                                                            kerning_value = pair_value.Value1.XAdvance or 0
                                                    
                                                    if kerning_value != 0:
                                                        original_pairs_count += 1
                                                        # Find characters for these glyphs
                                                        left_char = glyph_to_char.get(glyph_name)
                                                        right_char = glyph_to_char.get(right_glyph)

                                                        if left_char and right_char:
                                                            if left_char in unified_encryption_map and right_char in unified_encryption_map:
                                                                encrypted_left = unified_encryption_map[left_char]
                                                                encrypted_right = unified_encryption_map[right_char]
                                                                encrypted_left_glyph = char_to_glyph.get(encrypted_left)
                                                                encrypted_right_glyph = char_to_glyph.get(encrypted_right)

                                                                if encrypted_left_glyph and encrypted_right_glyph:
                                                                    remapped_kern_pairs[(encrypted_left_glyph, encrypted_right_glyph)] = kerning_value
                                                                    if verbose and original_pairs_count <= 5:
                                                                        print(f"  Remapped GPOS Format 1 kerning: '{left_char}'+'{right_char}' "
                                                                              f"({glyph_name}+{right_glyph}) -> "
                                                                              f"'{encrypted_left}'+'{encrypted_right}' "
                                                                              f"({encrypted_left_glyph}+{encrypted_right_glyph}) = {kerning_value}")
                                            elif verbose and glyph_index < 3:
                                                print(f"        Glyph {glyph_name} (index {glyph_index}): No PairSet or no PairValueRecord")
                                        elif verbose and glyph_index < 3:
                                            print(f"        Glyph {glyph_name} (index {glyph_index}): Index out of range for PairSet array")
                            
                            elif hasattr(subtable, 'ClassDef1'):  # Format 2
                                # Format 2: Class-based pair adjustment (more complex)
                                if verbose:
                                    print(f"  Found GPOS Format 2 (class-based) - extracting pairs...")
                                
                                # Format 2 uses class definitions and a 2D array
                                # We need to iterate through all class combinations
                                if verbose:
                                    print(f"    DEBUG: Checking Format 2 subtable structure...")
                                    print(f"      Has Coverage: {hasattr(subtable, 'Coverage')}")
                                    print(f"      Has ClassDef1: {hasattr(subtable, 'ClassDef1')}")
                                    print(f"      Has ClassDef2: {hasattr(subtable, 'ClassDef2')}")
                                    print(f"      Has Class1Record: {hasattr(subtable, 'Class1Record')}")
                                
                                if (hasattr(subtable, 'Coverage') and subtable.Coverage and
                                    hasattr(subtable, 'ClassDef1') and subtable.ClassDef1 and
                                    hasattr(subtable, 'ClassDef2') and subtable.ClassDef2 and
                                    hasattr(subtable, 'Class1Record') and subtable.Class1Record):
                                    
                                    # Get all glyphs in coverage
                                    coverage_glyphs = subtable.Coverage.glyphs if hasattr(subtable.Coverage, 'glyphs') else []
                                    if verbose:
                                        print(f"    DEBUG: Coverage has {len(coverage_glyphs)} glyphs")
                                        if coverage_glyphs:
                                            print(f"      First 5: {coverage_glyphs[:5]}")
                                    
                                    # Build class to glyph mapping
                                    class1_to_glyphs = {}
                                    class2_to_glyphs = {}
                                    
                                    if verbose:
                                        print(f"    DEBUG: Building class mappings...")
                                        print(f"      ClassDef1.classDefs type: {type(subtable.ClassDef1.classDefs)}")
                                        print(f"      ClassDef1.classDefs has {len(subtable.ClassDef1.classDefs) if hasattr(subtable.ClassDef1, 'classDefs') else 0} entries")
                                    
                                    for glyph_name in coverage_glyphs:
                                        class1 = subtable.ClassDef1.classDefs.get(glyph_name, 0)
                                        if class1 not in class1_to_glyphs:
                                            class1_to_glyphs[class1] = []
                                        class1_to_glyphs[class1].append(glyph_name)
                                    
                                    if verbose:
                                        print(f"    DEBUG: Class1 mapping: {len(class1_to_glyphs)} classes")
                                        for cls, glyphs in list(class1_to_glyphs.items())[:3]:
                                            print(f"      Class {cls}: {len(glyphs)} glyphs")
                                    
                                    # For class2, we need to check all glyphs in the font
                                    # ClassDef2.classDefs is a dict mapping glyph names to class indices
                                    if hasattr(subtable.ClassDef2, 'classDefs'):
                                        if verbose:
                                            print(f"      ClassDef2.classDefs type: {type(subtable.ClassDef2.classDefs)}")
                                            print(f"      ClassDef2.classDefs has {len(subtable.ClassDef2.classDefs)} entries")
                                        for glyph_name, class2 in subtable.ClassDef2.classDefs.items():
                                            if class2 not in class2_to_glyphs:
                                                class2_to_glyphs[class2] = []
                                            class2_to_glyphs[class2].append(glyph_name)
                                    
                                    if verbose:
                                        print(f"    DEBUG: Class2 mapping: {len(class2_to_glyphs)} classes")
                                        for cls, glyphs in list(class2_to_glyphs.items())[:3]:
                                            print(f"      Class {cls}: {len(glyphs)} glyphs")
                                    
                                    # Iterate through class combinations
                                    for class1_idx, class1_record in enumerate(subtable.Class1Record):
                                        if class1_idx in class1_to_glyphs and hasattr(class1_record, 'Class2Record'):
                                            for class2_idx, class2_record in enumerate(class1_record.Class2Record):
                                                if class2_idx in class2_to_glyphs:
                                                    # Get kerning value
                                                    kerning_value = 0
                                                    if hasattr(class2_record, 'Value1') and class2_record.Value1:
                                                        if hasattr(class2_record.Value1, 'XAdvance'):
                                                            kerning_value = class2_record.Value1.XAdvance or 0
                                                    
                                                    if kerning_value != 0:
                                                        # Create pairs for all glyph combinations in these classes
                                                        for left_glyph in class1_to_glyphs[class1_idx]:
                                                            for right_glyph in class2_to_glyphs[class2_idx]:
                                                                original_pairs_count += 1
                                                                # Find characters for these glyphs
                                                                left_char = glyph_to_char.get(left_glyph)
                                                                right_char = glyph_to_char.get(right_glyph)

                                                                if left_char and right_char:
                                                                    if left_char in unified_encryption_map and right_char in unified_encryption_map:
                                                                        encrypted_left = unified_encryption_map[left_char]
                                                                        encrypted_right = unified_encryption_map[right_char]
                                                                        encrypted_left_glyph = char_to_glyph.get(encrypted_left)
                                                                        encrypted_right_glyph = char_to_glyph.get(encrypted_right)

                                                                        if encrypted_left_glyph and encrypted_right_glyph:
                                                                            remapped_kern_pairs[(encrypted_left_glyph, encrypted_right_glyph)] = kerning_value
                                                                            if verbose and original_pairs_count <= 10:  # Limit verbose output
                                                                                print(f"  Remapped GPOS Format 2 kerning: '{left_char}'+'{right_char}' -> '{encrypted_left}'+'{encrypted_right}' = {kerning_value}")
                                
                                if verbose and original_pairs_count > 10:
                                    print(f"  ... and {original_pairs_count - 10} more GPOS Format 2 pairs")
            
            if verbose and original_pairs_count > 0:
                print(f"  Original GPOS table had {original_pairs_count} pairs, remapped {len(remapped_kern_pairs)} pairs")
            elif verbose:
                if 'GPOS' in font:
                    print(f"  ⚠️  GPOS table exists but no kerning pairs could be extracted")
            
        except Exception as e:
            if verbose:
                print(f"  ⚠️  Error extracting GPOS table: {e}")
                import traceback
                traceback.print_exc()
    
    return remapped_kern_pairs

def get_font_type(font):
    """
    Detect font type: TrueType (glyf), CFF, or CFF2.
    
    Returns:
        tuple: (font_type_name, glyph_container, is_cff)
        - font_type_name: "TrueType", "CFF", "CFF2", or None
        - glyph_container: The table/dict containing glyphs
        - is_cff: True if CFF/CFF2 (PostScript outlines), False if TrueType
    """
    if 'glyf' in font:
        return ("TrueType", font['glyf'], False)
    elif 'CFF ' in font:
        # CFF fonts store glyphs in CharStrings
        cff = font['CFF '].cff
        if hasattr(cff, 'topDictIndex') and len(cff.topDictIndex) > 0:
            return ("CFF", cff.topDictIndex[0].CharStrings, True)
        elif len(cff) > 0:
            return ("CFF", cff[0].CharStrings, True)
        else:
            return (None, None, False)
    elif 'CFF2' in font:
        # CFF2 fonts also use CharStrings but with different structure
        cff2 = font['CFF2'].cff
        if hasattr(cff2, 'topDictIndex') and len(cff2.topDictIndex) > 0:
            return ("CFF2", cff2.topDictIndex[0].CharStrings, True)
        else:
            return (None, None, False)
    else:
        return (None, None, False)

def ensure_nbsp_mapping(font, verbose=False):
    """
    Ensure NBSP (U+00A0) maps to the same glyph as space (U+0020) in the font's cmap.
    Some source fonts omit NBSP, which breaks rendering after we swap glyphs and replace
    spaces with NBSP in the DOM. We alias NBSP to the space glyph so both codepoints
    render identically.
    """
    if 'cmap' not in font:
        return False
    
    best_cmap = font.getBestCmap() or {}
    space_glyph = best_cmap.get(ord(' '))
    if not space_glyph:
        if verbose:
            print("  ⚠️  Cannot add NBSP mapping: space glyph not found in cmap")
        return False
    
    added = False
    for subtable in getattr(font['cmap'], 'tables', []):
        try:
            is_unicode = subtable.isUnicode()
        except Exception:
            is_unicode = False
        
        if is_unicode and hasattr(subtable, 'cmap'):
            # Always force NBSP to map to the space glyph (even if it already existed)
            subtable.cmap[ord(NBSP)] = space_glyph
            added = True
    
    # For CFF fonts, also alias the NBSP charstring and metrics to the space glyph
    if 'CFF ' in font:
        try:
            cff = font['CFF '].cff[0]
            charstrings = cff.CharStrings.charStrings
            # Force uni00A0 to use the same charstring as space
            if space_glyph in charstrings:
                charstrings['uni00A0'] = charstrings[space_glyph]
                added = True
            if 'hmtx' in font and space_glyph in font['hmtx'].metrics:
                font['hmtx'].metrics['uni00A0'] = font['hmtx'].metrics[space_glyph]
        except Exception as e:
            if verbose:
                print(f"  ⚠️  Failed to alias NBSP charstring/metrics to space: {e}")
    
    if added and verbose:
        print(f"  Added NBSP mapping to cmap: U+00A0 -> glyph '{space_glyph}' (alias of space)")
    elif verbose:
        print("  ⚠️  Could not add NBSP mapping (no Unicode cmap tables found)")
    
    return added


def copy_cff_charstring(charstring):
    """
    Create a deep copy of a CFF CharString.
    
    CFF CharStrings contain PostScript-like bytecode programs that define glyph outlines.
    We need to copy the program list and preserve references to subroutines.
    
    Args:
        charstring: The source T2CharString to copy
    
    Returns:
        A new T2CharString with copied program
    """
    from fontTools.misc.psCharStrings import T2CharString
    
    # Create new CharString
    new_charstring = T2CharString()
    
    # Copy the program (bytecode) - this is the main glyph data
    # CRITICAL: Check for empty list too - CFF charstrings have program=[] before decompile
    # An empty list is "not None" but means the charstring hasn't been decompiled yet
    if hasattr(charstring, 'program') and charstring.program is not None and len(charstring.program) > 0:
        new_charstring.program = list(charstring.program)
    else:
        # Decompile to get program if not yet decompiled (or if program is empty)
        charstring.decompile()
        new_charstring.program = list(charstring.program)
    
    # Copy references to subroutines (these are shared, not copied)
    if hasattr(charstring, 'private'):
        new_charstring.private = charstring.private
    if hasattr(charstring, 'globalSubrs'):
        new_charstring.globalSubrs = charstring.globalSubrs
    
    return new_charstring


def glyph_has_outline(glyph_container, glyph_name, is_cff):
    """
    Check if a glyph has actual outline data (is not empty/blank).
    
    Args:
        glyph_container: The glyf table or CFF CharStrings dict
        glyph_name: Name of the glyph to check
        is_cff: True if this is a CFF/CFF2 font
    
    Returns:
        tuple: (has_outline: bool, outline_info: str)
    """
    if glyph_name not in glyph_container:
        return (False, "glyph not found")
    
    glyph = glyph_container[glyph_name]
    
    if is_cff:
        # CFF: check if program has drawing commands
        # Empty glyphs typically have very short programs (just 'endchar')
        try:
            if hasattr(glyph, 'program'):
                if glyph.program is None:
                    glyph.decompile()
                program_len = len(glyph.program) if glyph.program else 0
                if program_len > 1:
                    return (True, f"has {program_len} program ops")
                else:
                    return (False, "EMPTY OUTLINE - program too short")
            else:
                # Try to get bytecode length
                if hasattr(glyph, 'bytecode') and glyph.bytecode:
                    return (True, f"has {len(glyph.bytecode)} bytes")
                return (False, "no program data")
        except Exception as e:
            return (False, f"error checking: {e}")
    else:
        # TrueType: check numberOfContours or data
        if hasattr(glyph, 'numberOfContours'):
            if glyph.numberOfContours > 0:
                return (True, f"has {glyph.numberOfContours} contours")
            elif glyph.numberOfContours == -1:
                # Composite glyph
                return (True, "composite glyph")
            else:
                return (False, "EMPTY OUTLINE - no contours")
        elif hasattr(glyph, 'data') and glyph.data:
            return (True, "has outline data")
        else:
            return (False, "NO OUTLINE DATA")


def swap_glyphs_in_font(font, font_mapping_upper, font_mapping_lower, font_mapping_special, verbose=False):
    """
    Apply the encrypted->original permutation at the glyph level.
    Works with TrueType (glyf), CFF, and CFF2 fonts.
    
    We take a snapshot of all source glyphs/metrics first, then rewrite the
    destination glyphs from the snapshot so cycles don't overwrite each other.
    Returns the number of successful swaps.
    """
    # Ensure NBSP maps to the space glyph before building the character map
    ensure_nbsp_mapping(font, verbose=verbose)
    cmap = font.getBestCmap()
    char_to_glyph = {chr(unicode_val): glyph_name for unicode_val, glyph_name in cmap.items()}
    if NBSP not in char_to_glyph and ' ' in char_to_glyph:
        char_to_glyph[NBSP] = char_to_glyph[' ']
        if verbose:
            print("  Added NBSP alias to character map (using space glyph)")
    hmtx = font['hmtx'] if 'hmtx' in font else None

    # Detect font type (TrueType vs CFF vs CFF2)
    font_type, glyph_container, is_cff = get_font_type(font)
    
    if font_type is None or glyph_container is None:
        if verbose:
            print(f"  ⚠️  Unsupported font type - no glyf, CFF, or CFF2 table found")
            print(f"     Available tables: {list(font.keys())}")
        return 0
    
    if verbose:
        print(f"  Font type detected: {font_type}")
        if is_cff:
            print(f"  Using CFF CharStrings for glyph manipulation")

    # DEBUG: Check if space is in character map (only if verbose)
    if verbose:
        if ' ' in char_to_glyph:
            print(f"  DEBUG: Space found in font character map: ' ' -> glyph '{char_to_glyph[' ']}'")
        else:
            print(f"  ⚠️  WARNING: Space NOT found in font character map!")
            print(f"     Available characters in font: {sorted([c for c in char_to_glyph.keys() if c.isprintable()])[:20]}...")
    
    # Build a unified mapping list (dest_glyph, src_glyph, display strings)
    mappings = []
    dest_glyph_seen = {}  # Track which dest_glyphs we've seen to detect duplicates
    for mapping in (font_mapping_upper, font_mapping_lower, font_mapping_special):
        for encrypted_char, original_char in mapping.items():
            if original_char in char_to_glyph and encrypted_char in char_to_glyph:
                src_glyph = char_to_glyph[original_char]
                dest_glyph = char_to_glyph[encrypted_char]
                # Check for duplicate dest_glyph (shouldn't happen if bijective, but verify)
                if dest_glyph in dest_glyph_seen:
                    if verbose:
                        prev_enc, prev_orig = dest_glyph_seen[dest_glyph]
                        print(f"  ⚠️  WARNING: Duplicate dest_glyph '{dest_glyph}':")
                        print(f"     Previously: {repr(prev_enc)} -> {repr(prev_orig)}")
                        print(f"     Now: {repr(encrypted_char)} -> {repr(original_char)}")
                        print(f"     This will cause the second mapping to overwrite the first!")
                else:
                    dest_glyph_seen[dest_glyph] = (encrypted_char, original_char)
                mappings.append((dest_glyph, src_glyph, encrypted_char, original_char))
            else:
                missing = []
                if original_char not in char_to_glyph:
                    missing.append(f"original {repr(original_char)}")
                if encrypted_char not in char_to_glyph:
                    missing.append(f"encrypted {repr(encrypted_char)}")
                # Special debug for space
                if encrypted_char == ' ' or original_char == ' ':
                    if verbose:
                        print(f"  ⚠️  CRITICAL: Space mapping skipped!")
                        print(f"     encrypted_char: {repr(encrypted_char)}, original_char: {repr(original_char)}")
                        print(f"     missing: {', '.join(missing)}")
                        print(f"     char_to_glyph has space: {' ' in char_to_glyph}")
                else:
                    if verbose:
                        print(f"  Skipped: {repr(encrypted_char)} -> {repr(original_char)} (missing: {', '.join(missing)})")

    # Snapshot source glyphs and metrics so cycles can't clobber later copies
    # Also store original character widths for verification
    glyph_snapshot = {}
    metrics_snapshot = {}
    original_widths = {}  # Store original char -> width mapping for verification
    
    for _, src_glyph, _, original_char in mappings:
        if src_glyph in glyph_container:
            if is_cff:
                # CFF: copy the CharString (PostScript bytecode)
                glyph_snapshot[src_glyph] = copy_cff_charstring(glyph_container[src_glyph])
            else:
                # TrueType: deep copy the glyph object
                glyph_snapshot[src_glyph] = copy.deepcopy(glyph_container[src_glyph])
        
        if hmtx and src_glyph in hmtx.metrics:
            # hmtx.metrics is a dict mapping glyph names to (advanceWidth, leftSideBearing) tuples
            metrics_snapshot[src_glyph] = copy.deepcopy(hmtx.metrics[src_glyph])
            # Store original width for this character (for verification)
            original_widths[original_char] = hmtx.metrics[src_glyph][0]  # advanceWidth
    
    # Pre-calculate fallback metrics once (for efficiency)
    fallback_metrics = {}
    if hmtx:
        # Get actual space metrics if available
        space_glyph = char_to_glyph.get(' ')
        if space_glyph and space_glyph in hmtx.metrics:
            fallback_metrics['space'] = copy.deepcopy(hmtx.metrics[space_glyph])
        
        # Calculate average letter metrics
        letter_glyphs = [char_to_glyph.get(c) for c in UPPERCASE + LOWERCASE 
                        if c in char_to_glyph and char_to_glyph[c] in hmtx.metrics]
        if letter_glyphs:
            letter_widths = [hmtx.metrics[g][0] for g in letter_glyphs]
            letter_lsbs = [hmtx.metrics[g][1] for g in letter_glyphs]
            fallback_metrics['letter'] = (
                sum(letter_widths) // len(letter_widths),
                sum(letter_lsbs) // len(letter_lsbs) if letter_lsbs else 0
            )
        
        # Font defaults as last resort
        units_per_em = font['head'].unitsPerEm if 'head' in font else 1000
        if 'space' not in fallback_metrics:
            fallback_metrics['space'] = (int(units_per_em * 0.2), 0)
        if 'letter' not in fallback_metrics:
            fallback_metrics['letter'] = (int(units_per_em * 0.5), 0)

    # Store metric mappings to apply after all glyph swaps are done
    # Key by encrypted_char to ensure each encrypted character gets correct metrics
    # This prevents conflicts and ensures consistent sizing regardless of processing order
    metric_mappings = {}  # encrypted_char -> (source_metrics, original_char, dest_glyph, src_glyph, used_fallback)
    
    swaps_made = 0
    # Helper to copy CFF outlines via a draw pen when direct program copy is unavailable
    def copy_cff_outline_via_pen(font, src_name, dest_name):
        """
        Some WOFF2/CFF fonts expose charstrings as ints/indices instead of T2CharString
        objects. This fallback uses a T2CharStringPen to re-draw the source outline into
        a fresh charstring for the destination glyph, ensuring swaps work for all CFF fonts.
        """
        try:
            from fontTools.pens.t2CharStringPen import T2CharStringPen
            cff_font = font['CFF '].cff[0]
            private = getattr(cff_font, "Private", None)
            if private is None:
                return False
            subrs = getattr(private, "Subrs", [])
            global_subrs = getattr(cff_font, "GlobalSubrs", [])
            glyph_set = font.getGlyphSet()
            if src_name not in glyph_set or dest_name not in glyph_set:
                return False
            pen = T2CharStringPen(glyph_set, subrs=subrs, globalSubrs=global_subrs)
            glyph_set[src_name].draw(pen)
            new_cs = pen.getCharString(private, global_subrs)
            # Install the new charstring
            cff_font.CharStrings.charStrings[dest_name] = new_cs
            return True
        except Exception:
            return False

    # Phase 1: Copy glyph outlines only (no metrics yet)
    for dest_glyph, src_glyph, encrypted_char, original_char in mappings:
        try:
            if src_glyph in glyph_snapshot and dest_glyph in glyph_container:
                # Copy the glyph outline
                src_glyph_obj = glyph_snapshot[src_glyph]
                
                if is_cff:
                    # CFF: try program-level copy first; fallback to pen-based redraw
                    copied = False
                    dest_charstring = glyph_container[dest_glyph]
                    try:
                        if hasattr(src_glyph_obj, 'program') and src_glyph_obj.program is not None:
                            dest_charstring.program = list(src_glyph_obj.program)
                            copied = True
                        else:
                            src_glyph_obj.decompile()
                            dest_charstring.program = list(src_glyph_obj.program)
                            copied = True
                    except Exception:
                        copied = False
                    
                    if not copied:
                        copied = copy_cff_outline_via_pen(font, src_glyph, dest_glyph)
                    
                    if not copied and verbose:
                        print(f"  ⚠️  CFF swap fallback failed for {repr(encrypted_char)} -> {repr(original_char)}")
                else:
                    # TrueType: directly assign the glyph from snapshot
                    glyph_container[dest_glyph] = copy.deepcopy(src_glyph_obj)
                
                # Store metric mapping to apply later (after all swaps are done)
                if hmtx:
                    source_metrics = None
                    used_fallback = False
                    
                    # CRITICAL: Always use snapshot - never read from hmtx.metrics after modifications
                    # The snapshot was taken BEFORE any modifications, so it's the source of truth
                    if src_glyph in metrics_snapshot:
                        source_metrics = copy.deepcopy(metrics_snapshot[src_glyph])
                    
                    # Fallback only if source glyph wasn't in snapshot (shouldn't happen, but safety)
                    if not source_metrics:
                        used_fallback = True
                        if original_char == ' ':
                            # Use actual space metrics if available, otherwise fallback
                            source_metrics = fallback_metrics.get('space', (500, 0))
                        elif original_char.isalpha():
                            # Use average letter metrics
                            source_metrics = fallback_metrics.get('letter', (500, 0))
                        else:
                            # For other characters, use letter metrics as default
                            source_metrics = fallback_metrics.get('letter', (500, 0))
                    
                    # Store metric mapping keyed by encrypted_char to prevent conflicts
                    # Each encrypted character is unique, so no overwrites can occur
                    metric_mappings[encrypted_char] = (source_metrics, original_char, dest_glyph, src_glyph, used_fallback)
                
                swaps_made += 1
                enc_disp = repr(encrypted_char) if encrypted_char in [' ', '\x00', '\n'] else f"'{encrypted_char}'"
                orig_disp = repr(original_char) if original_char in [' ', '\x00', '\n'] else f"'{original_char}'"
                
                # Check if glyph has outline (is not empty)
                if encrypted_char == ' ':
                    has_outline, outline_info = glyph_has_outline(glyph_container, dest_glyph, is_cff)
                    if verbose:
                        print(f"  Swapped: {enc_disp} now shows {orig_disp} glyph ({outline_info})")
                else:
                    if verbose:
                        print(f"  Swapped: {enc_disp} now shows {orig_disp} glyph")
        except Exception as e:
            if verbose:
                print(f"  Warning: Could not swap {repr(encrypted_char)} -> {repr(original_char)}: {e}")
                import traceback
                traceback.print_exc()

    # Phase 2: Apply all metrics after all glyph swaps are complete
    # This ensures consistent sizing and prevents conflicts from duplicate dest_glyphs
    if hmtx:
        # Build size mapping dictionary for logging
        size_mappings = {}  # encrypted_char -> (original_char, width)
        
        for encrypted_char, (source_metrics, original_char, dest_glyph, src_glyph, used_fallback) in metric_mappings.items():
            # Apply metrics from snapshot (taken before any modifications)
            # Use dest_glyph from the stored tuple to apply metrics to the correct glyph
            # source_metrics is (advanceWidth, leftSideBearing)
            # IMPORTANT: Preserve the leftSideBearing to maintain correct glyph positioning
            hmtx.metrics[dest_glyph] = source_metrics
            
            # Store size mapping for logging
            width = source_metrics[0]  # advanceWidth
            size_mappings[encrypted_char] = (original_char, width)
            
            # Verify exact width preservation (for zero visual change)
            if not used_fallback and original_char in original_widths:
                expected_width = original_widths[original_char]
                actual_width = source_metrics[0]
                if expected_width != actual_width:
                    if verbose:
                        print(f"  ⚠️  Width mismatch: {repr(original_char)} expected {expected_width}, got {actual_width}")
            
            # Warn if we used fallback (helps debug layout issues)
            if used_fallback and verbose:
                print(f"  Warning: Used fallback metrics for {repr(original_char)} -> {repr(encrypted_char)} "
                      f"(source glyph {src_glyph} had no metrics)")
        
        # Log size mappings after all metrics are applied
        if verbose:
            print(f"\n{'='*70}")
            print("SIZE MAPPINGS (encrypted -> original character and width):")
            print(f"{'='*70}")
            # Sort by encrypted character for readability
            sorted_mappings = sorted(size_mappings.items(), key=lambda x: (x[0].isupper(), x[0].lower() if x[0].isalpha() else x[0]))
            for encrypted_char, (original_char, width) in sorted_mappings:
                enc_disp = repr(encrypted_char) if encrypted_char in [' ', '\x00', '\n'] else f"'{encrypted_char}'"
                orig_disp = repr(original_char) if original_char in [' ', '\x00', '\n'] else f"'{original_char}'"
                print(f"  {enc_disp} -> {orig_disp} (width: {width})")
            print(f"{'='*70}\n")

    return swaps_made

def create_decryption_font_from_mappings(input_font_path, output_font_path, upper_map, lower_map, space_map, preserve_font_family=None):
    """
    Create a decryption font using pre-computed unified mappings.
    This avoids recalculating mappings that were already computed during encryption.
    
    Args:
        input_font_path: Path to the base font file
        output_font_path: Path where the decryption font will be saved
        upper_map: Dictionary mapping original -> encrypted for uppercase (from get_dynamic_mappings)
        lower_map: Dictionary mapping original -> encrypted for lowercase + space (from get_dynamic_mappings)
        space_map: Dictionary mapping original -> encrypted for special chars only (from get_dynamic_mappings)
        preserve_font_family: Optional font family name to preserve (if None, uses 'EncryptedFont')
    """
    global _MAPPINGS_LOGGED

    if not _MAPPINGS_LOGGED:
        print(f"Loading font: {input_font_path}")
    font = TTFont(input_font_path)

    # CRITICAL: Remove variable font tables before glyph swapping
    # Variable fonts have gvar/fvar/avar/HVAR tables that map glyph IDs to variation data.
    # When we swap glyphs, glyph A gets glyph B's outline but keeps glyph A's variation data,
    # which causes rendering corruption at non-default weights (green artifacts, wrong shapes).
    # Removing these tables converts the variable font to a static font at the default weight.
    variable_tables = ['fvar', 'gvar', 'avar', 'HVAR', 'VVAR', 'MVAR', 'STAT', 'cvar']
    removed_tables = []
    for table in variable_tables:
        if table in font:
            del font[table]
            removed_tables.append(table)

    if removed_tables and not _MAPPINGS_LOGGED:
        print(f"  Removed variable font tables: {', '.join(removed_tables)}")
        print(f"  Font converted to static (single weight) for glyph swapping compatibility")

    # Make sure NBSP is present and points at the space glyph before any mapping work
    added_nbsp = ensure_nbsp_mapping(font, verbose=not _MAPPINGS_LOGGED)
    if added_nbsp and not _MAPPINGS_LOGGED:
        print("  NBSP mapping added to base font cmap (alias of space glyph)")
    
    # Get character to glyph mapping before any modifications
    cmap = font.getBestCmap()
    char_to_glyph = {chr(unicode_val): glyph_name for unicode_val, glyph_name in cmap.items()}
    
    # Create unified encryption map for kerning remapping and font mapping
    unified_encryption_map = {**upper_map, **lower_map}
    
    # Extract and remap kerning pairs BEFORE removing the tables
    # This allows kerning to work on displayed text (original characters) while text remains encrypted
    remapped_kern_pairs = {}
    has_kern = 'kern' in font
    has_gpos = 'GPOS' in font
    
    if has_kern or has_gpos:
        if not _MAPPINGS_LOGGED:
            print("Extracting and remapping kerning pairs from original font...")
            print(f"  Font tables: kern={has_kern}, GPOS={has_gpos}")
        
        remapped_kern_pairs = remap_kerning_tables(font, unified_encryption_map, char_to_glyph, verbose=not _MAPPINGS_LOGGED)
        
        if remapped_kern_pairs and not _MAPPINGS_LOGGED:
            print(f"  ✅ Successfully extracted {len(remapped_kern_pairs)} kerning pairs to remap")
        elif not remapped_kern_pairs and not _MAPPINGS_LOGGED:
            print(f"  ⚠️  No kerning pairs could be extracted/remapped")
            if has_gpos and not has_kern:
                print(f"  ⚠️  Font only has GPOS (not 'kern') - GPOS extraction may have failed")
    
    # ALWAYS remove original GPOS and kern tables for encrypted fonts
    # The original pairs are WRONG for encrypted text (e.g., kern(A,D) instead of kern(G,p))
    # Wrong kerning is worse than no kerning - it causes visible spacing issues
    # We'll add a new 'kern' table with remapped pairs if extraction succeeded
    if 'GPOS' in font:
        if not _MAPPINGS_LOGGED:
            if remapped_kern_pairs:
                print("Removing original GPOS table (will add remapped kerning later)")
            else:
                print("⚠️  Removing original GPOS table (no pairs remapped - wrong kerning is worse than none)")
        del font['GPOS']

    if 'kern' in font:
        if not _MAPPINGS_LOGGED:
            if remapped_kern_pairs:
                print("Removing original 'kern' table (will add remapped kerning later)")
            else:
                print("⚠️  Removing original 'kern' table (no pairs remapped - wrong kerning is worse than none)")
        del font['kern']
    
    # Create unified reverse mapping for the font (encrypted -> original)
    # With unified mapping, we need to combine all mappings into one
    # When encrypted text is displayed, we want to show original glyphs
    # Since we have cross-case mappings, we need a unified font mapping
    #
    # CRITICAL: If space is NOT in lower_map (SDK mode), we must NOT swap the space glyph.
    # This is because in SDK mode, spaces in the DOM remain as spaces (not encrypted),
    # so the space glyph must render as a normal space for word wrapping to work.
    # If space IS in lower_map (static HTML mode), we DO want to swap it.
    #
    # Check if space was included in the passed lower_map
    space_included = ' ' in lower_map

    # Build reverse mapping, but exclude space if it wasn't in lower_map
    unified_font_mapping = {}
    for k, v in unified_encryption_map.items():
        # v is the encrypted character (becomes key in font mapping)
        # k is the original character (becomes value in font mapping)
        if v == ' ' and not space_included:
            # Skip - don't swap space glyph in SDK mode
            continue
        unified_font_mapping[v] = k
    
    # Split into upper/lower for compatibility with swap_glyphs_in_font
    # But we need to ensure all encrypted characters are covered
    font_mapping_upper = {}
    font_mapping_lower = {}
    
    # Populate font mappings based on the encrypted character's case
    # This ensures cross-case mappings are handled correctly
    # CRITICAL: Space CAN appear in encrypted text (as a target), so we need to handle it
    # If space appears in encrypted text, it should show the glyph of whatever character maps to space
    # CRITICAL: Include period (.) and other non-alphabetic characters from LOWERCASE
    for encrypted_char, original_char in unified_font_mapping.items():
        if encrypted_char.isupper():
            font_mapping_upper[encrypted_char] = original_char
        elif encrypted_char.islower() or encrypted_char in LOWERCASE or encrypted_char == ' ':
            # Include lowercase letters, non-alphabetic chars from LOWERCASE (like period), and space
            font_mapping_lower[encrypted_char] = original_char
    
    # DEBUG: Print space mapping to verify it's included (only once at startup)
    if not _MAPPINGS_LOGGED:
        print(f"  DEBUG: space_included={space_included} (space in lower_map)")
        if ' ' in font_mapping_lower:
            space_target = font_mapping_lower[' ']
            print(f"  DEBUG: Space in font_mapping_lower: ' ' -> {repr(space_target)}")
            print(f"         This means when space appears in encrypted text, it should show the '{space_target}' glyph")
            # Check if space_target is also in the font mapping (shouldn't be, but verify)
            if space_target in unified_font_mapping:
                print(f"  ⚠️  WARNING: '{space_target}' is also in unified_font_mapping as a key!")
                print(f"         This could cause conflicts. Space should map to a character that doesn't appear in encrypted text.")
        else:
            if not space_included:
                # This is expected in SDK mode - space glyph intentionally NOT swapped
                print(f"  ✅ Space NOT in font_mapping (SDK mode) - space glyph will render normally for word wrapping")
            else:
                print(f"  ⚠️  WARNING: Space NOT in font_mapping_lower!")
                print(f"     unified_font_mapping keys: {sorted(unified_font_mapping.keys())}")
                if ' ' in unified_font_mapping:
                    print(f"     Space IS in unified_font_mapping: ' ' -> {repr(unified_font_mapping[' '])}")
                    print(f"     But it wasn't added to font_mapping_lower - this is a bug!")
        
        # Log the complete mappings once
        print(f"\n{'='*70}")
        print("ENCRYPTION MAPPINGS (logged once at startup):")
        print(f"{'='*70}")
        print(f"Upper case mapping (original -> encrypted): {upper_map}")
        print(f"Lower case mapping (original -> encrypted): {lower_map}")
        print(f"Space/special mapping (original -> encrypted): {space_map}")
        print(f"Font mapping (encrypted -> original): {unified_font_mapping}")
        print(f"{'='*70}\n")
    
    font_mapping_special = {v: k for k, v in space_map.items()}  # encrypted -> original

    # NOTE: Do NOT add NBSP mapping to font_mapping_lower before glyph swapping!
    # This was causing a duplicate dest_glyph bug where both ' ' and '\xa0' mapped to
    # the same 'space' glyph, causing the second swap to overwrite the first.
    # NBSP is handled correctly via cmap aliasing in ensure_nbsp_mapping() which runs
    # before swap_glyphs_in_font() - it aliases codepoint 160 to the space glyph.
    # After the space glyph is swapped, the NBSP codepoint automatically gets the
    # swapped glyph visual since it points to the same glyph name.

    if not _MAPPINGS_LOGGED:
        print("Swapping glyphs...")
    swaps_made = swap_glyphs_in_font(font, font_mapping_upper, font_mapping_lower, font_mapping_special, verbose=not _MAPPINGS_LOGGED)
    
    # Add remapped kerning table back to font (after glyph swapping)
    # Store the count of successfully converted pairs for verification later
    remapped_kern_pairs_count = 0
    if remapped_kern_pairs and len(remapped_kern_pairs) > 0:
        try:
            # Import kern table classes
            from fontTools.ttLib.tables._k_e_r_n import table__k_e_r_n, KernTable_format_0
            
            # Create new kern table
            kern_table = table__k_e_r_n()
            kern_table.version = 0
            kern_table.kernTables = []
            
            # CRITICAL: Use glyph names (strings) in kernTable, not indices (integers)
            # fontTools' compile() method expects glyph names and will convert them to indices
            # during compilation. The binary format uses indices, but the Python API uses names.
            
            if not _MAPPINGS_LOGGED:
                print(f"  DEBUG: Starting kern table creation with {len(remapped_kern_pairs)} pairs")
                print(f"  DEBUG: Sample pair types: {type(list(remapped_kern_pairs.keys())[0][0])}, {type(list(remapped_kern_pairs.keys())[0][1])}")
                sample_key = list(remapped_kern_pairs.keys())[0]
                print(f"  DEBUG: Sample pair: {sample_key} -> {remapped_kern_pairs[sample_key]}")
            
            # Validate that all glyph names exist in the font
            validated_kern_pairs = {}
            failed_validations = 0
            validation_details = []
            
            for (left_glyph_name, right_glyph_name), kerning_value in remapped_kern_pairs.items():
                try:
                    # Verify glyphs exist in font
                    left_glyph_id = font.getGlyphID(left_glyph_name)
                    right_glyph_id = font.getGlyphID(right_glyph_name)
                    # Store with glyph names (fontTools will convert to indices during compile)
                    validated_kern_pairs[(left_glyph_name, right_glyph_name)] = kerning_value
                    if not _MAPPINGS_LOGGED and len(validation_details) < 5:
                        validation_details.append(f"  ✓ ({left_glyph_name}, {right_glyph_name}) -> IDs: ({left_glyph_id}, {right_glyph_id})")
                except (KeyError, AttributeError) as e:
                    failed_validations += 1
                    if not _MAPPINGS_LOGGED and failed_validations <= 5:  # Only log first few failures
                        print(f"  ⚠️  Warning: Could not validate glyph pair ({left_glyph_name}, {right_glyph_name}): {e}")
            
            if not _MAPPINGS_LOGGED and validation_details:
                print(f"  DEBUG: Validation examples (first 5):")
                for detail in validation_details:
                    print(detail)
            
            if not validated_kern_pairs:
                if not _MAPPINGS_LOGGED:
                    print(f"  ⚠️  ERROR: No valid kerning pairs after validation!")
                raise ValueError("No valid kerning pairs after glyph validation")
            
            # Store count for verification
            remapped_kern_pairs_count = len(validated_kern_pairs)
            
            if failed_validations > 0 and not _MAPPINGS_LOGGED:
                print(f"  ⚠️  Warning: {failed_validations} pairs failed glyph validation")
            
            # Create format 0 subtable (most common, simple format)
            subtable = KernTable_format_0()
            subtable.version = 0
            subtable.coverage = 1  # Horizontal kerning
            subtable.format = 0
            subtable.nPairs = len(validated_kern_pairs)
            # searchRange, entrySelector, and rangeShift are calculated automatically by fontTools
            # during compilation, so we don't need to set them manually
            subtable.searchRange = 0
            subtable.entrySelector = 0
            subtable.rangeShift = 0
            # CRITICAL: Use glyph names (strings), not indices (integers)
            # fontTools will convert names to indices during compilation
            subtable.kernTable = validated_kern_pairs
            
            kern_table.kernTables.append(subtable)
            font['kern'] = kern_table
            
            # CRITICAL: Explicitly compile the kern table to:
            # 1. Convert glyph names to glyph indices (fontTools does this automatically)
            # 2. Calculate searchRange, entrySelector, and rangeShift correctly
            # 3. Validate the table structure
            try:
                if not _MAPPINGS_LOGGED:
                    print(f"  DEBUG: Before compilation:")
                    print(f"    subtable.nPairs: {subtable.nPairs}")
                    print(f"    subtable.searchRange: {subtable.searchRange}")
                    print(f"    subtable.entrySelector: {subtable.entrySelector}")
                    print(f"    subtable.rangeShift: {subtable.rangeShift}")
                    print(f"    kernTable type: {type(subtable.kernTable)}")
                    print(f"    kernTable length: {len(subtable.kernTable) if subtable.kernTable else 0}")
                    if subtable.kernTable:
                        sample = list(subtable.kernTable.items())[0]
                        print(f"    Sample pair before compile: {sample[0]} -> {sample[1]}")
                        print(f"    Sample key types: {type(sample[0][0])}, {type(sample[0][1])}")
                
                # Compile the kern table - this prepares it for binary serialization
                # fontTools will automatically convert glyph names to indices here
                font['kern'].compile(font)
                
                if not _MAPPINGS_LOGGED:
                    print(f"  DEBUG: After compilation:")
                    compiled_subtable = font['kern'].kernTables[0]
                    print(f"    Compiled subtable type: {type(compiled_subtable)}")
                    print(f"    Has kernTable attr: {hasattr(compiled_subtable, 'kernTable')}")
                    if hasattr(compiled_subtable, 'kernTable'):
                        print(f"    kernTable value: {compiled_subtable.kernTable}")
                        if compiled_subtable.kernTable:
                            print(f"    kernTable type: {type(compiled_subtable.kernTable)}")
                            print(f"    kernTable length: {len(compiled_subtable.kernTable)}")
                            sample = list(compiled_subtable.kernTable.items())[0]
                            print(f"    Sample pair after compile: {sample[0]} -> {sample[1]}")
                            print(f"    Sample key types: {type(sample[0][0])}, {type(sample[0][1])}")
                            # Check all attributes
                            print(f"    All subtable attributes: {[a for a in dir(compiled_subtable) if not a.startswith('_') and not callable(getattr(compiled_subtable, a, None))]}")
                            for attr in ['nPairs', 'searchRange', 'entrySelector', 'rangeShift', 'format', 'version', 'coverage']:
                                if hasattr(compiled_subtable, attr):
                                    print(f"    {attr}: {getattr(compiled_subtable, attr)}")
                
                # Verify compilation worked
                compiled_subtable = font['kern'].kernTables[0]
                if hasattr(compiled_subtable, 'kernTable') and compiled_subtable.kernTable:
                    actual_pairs = len(compiled_subtable.kernTable)
                    if not _MAPPINGS_LOGGED:
                        print(f"  ✅ Compiled kern table successfully ({actual_pairs} pairs)")
                        # Check if searchRange was calculated (should be > 0 if pairs > 0)
                        if hasattr(compiled_subtable, 'nPairs') and compiled_subtable.nPairs > 0:
                            if hasattr(compiled_subtable, 'searchRange'):
                                if compiled_subtable.searchRange == 0:
                                    print(f"  ⚠️  Warning: searchRange is still 0 after compilation (may be calculated during save)")
                                else:
                                    print(f"  ✅ searchRange calculated: {compiled_subtable.searchRange}")
                else:
                    if not _MAPPINGS_LOGGED:
                        print(f"  ⚠️  Warning: Compiled kern table has no pairs")
            except Exception as compile_error:
                if not _MAPPINGS_LOGGED:
                    print(f"  ⚠️  Warning: Kern table compilation had issues: {compile_error}")
                    import traceback
                    traceback.print_exc()
                    # Continue anyway - font.save() might still work
            
            if not _MAPPINGS_LOGGED:
                print(f"✅ Added remapped kerning table with {len(validated_kern_pairs)} pairs (will be converted to glyph indices during compilation)")
                
                # Log all remapped kerning pairs in a formatted way
                print(f"\n{'='*70}")
                print("REMAPPED KERNING PAIRS (encrypted glyph pairs -> kerning value):")
                print(f"{'='*70}")
                # Sort pairs for readability
                sorted_pairs = sorted(remapped_kern_pairs.items(), key=lambda x: (x[0][0], x[0][1]))
                for (left_glyph, right_glyph), kerning_value in sorted_pairs:
                    # Try to find the encrypted characters for these glyphs (reverse lookup)
                    left_encrypted_char = None
                    right_encrypted_char = None
                    for char, glyph_name in char_to_glyph.items():
                        if glyph_name == left_glyph:
                            left_encrypted_char = char
                        if glyph_name == right_glyph:
                            right_encrypted_char = char
                    
                    if left_encrypted_char and right_encrypted_char:
                        # Find original characters (what these encrypted chars display as)
                        left_original_char = unified_font_mapping.get(left_encrypted_char, '?')
                        right_original_char = unified_font_mapping.get(right_encrypted_char, '?')
                        print(f"  '{left_encrypted_char}'+'{right_encrypted_char}' ({left_glyph}+{right_glyph}) "
                              f"-> displays as '{left_original_char}'+'{right_original_char}' = {kerning_value}")
                    else:
                        print(f"  {left_glyph}+{right_glyph} = {kerning_value}")
                print(f"{'='*70}\n")
        except Exception as e:
            if not _MAPPINGS_LOGGED:
                print(f"⚠️  Could not add remapped kerning table: {e}")
                import traceback
                traceback.print_exc()
    
    if not _MAPPINGS_LOGGED:
        print(f"\nMade {swaps_made} glyph swaps")
        _MAPPINGS_LOGGED = True  # Mark as logged, suppress future verbose output
    
    # Update font family name
    if 'name' in font:
        name_table = font['name']
        font_family_name = preserve_font_family if preserve_font_family else 'EncryptedFont'
        for record in name_table.names:
            if record.nameID == 1:  # Family name
                record.string = font_family_name
        if not _MAPPINGS_LOGGED:
            if preserve_font_family:
                print(f"Preserved font family name: '{font_family_name}'")
            else:
                print("Updated font family name to 'EncryptedFont'")
    
    # Detect font type to determine the appropriate intermediate file extension
    # CFF fonts should use .otf, TrueType fonts should use .ttf
    font_type, _, is_cff = get_font_type(font)
    intermediate_ext = '.otf' if is_cff else '.ttf'
    
    # Save as intermediate format first (OTF for CFF, TTF for TrueType)
    intermediate_output = output_font_path.replace('.woff2', intermediate_ext)
    if not _MAPPINGS_LOGGED:
        print(f"Saving {font_type} font: {intermediate_output}")
    font.save(intermediate_output)
    
    # Verify kern table was saved correctly
    if remapped_kern_pairs_count > 0:
        try:
            if not _MAPPINGS_LOGGED:
                print(f"  DEBUG: Verifying kern table in saved font: {intermediate_output}")
            verify_font = TTFont(intermediate_output)
            if 'kern' in verify_font:
                kern_table = verify_font['kern']
                if not _MAPPINGS_LOGGED:
                    print(f"  DEBUG: Kern table found in saved font")
                    print(f"    Kern table type: {type(kern_table)}")
                    print(f"    Has kernTables attr: {hasattr(kern_table, 'kernTables')}")
                
                if hasattr(kern_table, 'kernTables') and kern_table.kernTables:
                    total_pairs = 0
                    for i, st in enumerate(kern_table.kernTables):
                        if not _MAPPINGS_LOGGED:
                            print(f"    Subtable {i}: type={type(st)}, format={getattr(st, 'format', 'N/A')}")
                        if hasattr(st, 'kernTable') and st.kernTable:
                            pairs_in_subtable = len(st.kernTable)
                            total_pairs += pairs_in_subtable
                            if not _MAPPINGS_LOGGED:
                                print(f"      kernTable has {pairs_in_subtable} pairs")
                                sample = list(st.kernTable.items())[0] if st.kernTable else None
                                if sample:
                                    print(f"      Sample pair: {sample[0]} -> {sample[1]}")
                                    print(f"      Key types: {type(sample[0][0])}, {type(sample[0][1])}")
                                    # Check if keys are indices (int) or names (str)
                                    if isinstance(sample[0][0], int):
                                        print(f"      ✅ Keys are glyph indices (correct for binary format)")
                                    else:
                                        print(f"      ⚠️  Keys are still glyph names (should be indices in binary)")
                    
                    if not _MAPPINGS_LOGGED:
                        print(f"  ✅ Verified: Kern table in saved font has {total_pairs} pairs")
                        if total_pairs != remapped_kern_pairs_count:
                            print(f"  ⚠️  WARNING: Expected {remapped_kern_pairs_count} pairs, found {total_pairs}")
                else:
                    if not _MAPPINGS_LOGGED:
                        print(f"  ⚠️  WARNING: Kern table in font has no subtables!")
            else:
                if not _MAPPINGS_LOGGED:
                    print(f"  ⚠️  WARNING: Kern table missing from saved font!")
                    print(f"    Available tables: {list(verify_font.keys())}")
        except Exception as verify_error:
            if not _MAPPINGS_LOGGED:
                print(f"  ⚠️  Could not verify kern table: {verify_error}")
                import traceback
                traceback.print_exc()
    
    # Convert to WOFF2
    if not _MAPPINGS_LOGGED:
        print(f"Converting to WOFF2: {output_font_path}")
    try:
        woff2_font = TTFont(intermediate_output)
        
        # The remapped kern table should already be in the TTF, so it will be preserved in WOFF2
        # GPOS table should not be present (we removed it and only added remapped kern)
        if 'GPOS' in woff2_font:
            if not _MAPPINGS_LOGGED:
                print("⚠️  GPOS table found in TTF (shouldn't be present) - removing it")
            del woff2_font['GPOS']
        
        # Remapped kern table should be present and should be preserved
        if not _MAPPINGS_LOGGED:
            print(f"  DEBUG: Checking kern table in WOFF2 font before saving...")
            print(f"    Has 'kern' table: {'kern' in woff2_font}")
            if 'kern' in woff2_font:
                kern_table = woff2_font['kern']
                print(f"    Kern table type: {type(kern_table)}")
                print(f"    Has kernTables: {hasattr(kern_table, 'kernTables')}")
                if hasattr(kern_table, 'kernTables'):
                    print(f"    Number of subtables: {len(kern_table.kernTables) if kern_table.kernTables else 0}")
        
        if 'kern' in woff2_font:
            kern_table = woff2_font['kern']
            if hasattr(kern_table, 'kernTables') and kern_table.kernTables:
                total_pairs = 0
                for i, st in enumerate(kern_table.kernTables):
                    if hasattr(st, 'kernTable') and st.kernTable:
                        pairs_in_subtable = len(st.kernTable)
                        total_pairs += pairs_in_subtable
                        if not _MAPPINGS_LOGGED:
                            print(f"    Subtable {i}: {pairs_in_subtable} pairs")
                            sample = list(st.kernTable.items())[0] if st.kernTable else None
                            if sample:
                                print(f"      Sample: {sample[0]} -> {sample[1]}")
                                print(f"      Key types: {type(sample[0][0])}, {type(sample[0][1])}")
                
                if not _MAPPINGS_LOGGED:
                    print(f"  ✅ Preserving remapped kern table in WOFF2 (has {total_pairs} pairs)")
                    if remapped_kern_pairs_count > 0 and total_pairs != remapped_kern_pairs_count:
                        print(f"  ⚠️  WARNING: Expected {remapped_kern_pairs_count} pairs, found {total_pairs}")
            else:
                if not _MAPPINGS_LOGGED:
                    print(f"  ⚠️  WARNING: Kern table in WOFF2 has no subtables!")
        else:
            if not _MAPPINGS_LOGGED:
                print(f"  ⚠️  WARNING: Kern table missing from WOFF2 font!")
                print(f"    Available tables: {list(woff2_font.keys())}")
        
        woff2_font.flavor = 'woff2'
        woff2_font.save(output_font_path)
        if not _MAPPINGS_LOGGED:
            print(f"✅ Decryption font created successfully: {output_font_path}")
        return True
    except Exception as e:
        print(f"⚠️  Could not create WOFF2, but {font_type} font was saved: {e}")
        print(f"   Will use {intermediate_ext} file instead: {intermediate_output}")
        # Return intermediate path instead of WOFF2 path
        return intermediate_output  # Return intermediate path so caller knows to use it

def create_decryption_font(input_font_path, output_font_path, secret_key: int, nonce: int):
    """
    Create a decryption font using dynamic mappings from get_dynamic_mappings.
    This font will reverse the encryption mapping, so when encrypted characters
    are displayed in Unicode, they will show the decrypted (original) glyphs.
    
    NOTE: This function recalculates mappings. For better performance, use
    create_decryption_font_from_mappings() with pre-computed mappings.
    
    Args:
        input_font_path: Path to the base font file
        output_font_path: Path where the decryption font will be saved
        secret_key: Secret key used for encryption
        nonce: Nonce value used for encryption
    """
    print(f"Generating dynamic mappings with secret_key={secret_key}, nonce={nonce}...")
    # Get the encryption mappings (original -> encrypted)
    upper_map, lower_map, space_map = get_dynamic_mappings(secret_key, nonce)
    
    # Use the optimized function that takes mappings directly
    return create_decryption_font_from_mappings(input_font_path, output_font_path, upper_map, lower_map, space_map)

if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Generate a dynamic decryption font based on secret key + nonce')
    parser.add_argument('--input', type=str, default=None,
                        help='Input font path (default: Supertest.ttf)')
    parser.add_argument('--output', type=str, default=None,
                        help='Output font path (default: fonts/decryption_<hash>.woff2)')
    parser.add_argument('--secret-key', type=int, required=True,
                        help='Secret key for dynamic mapping')
    parser.add_argument('--nonce', type=int, required=True,
                        help='Nonce for dynamic mapping')
    
    args = parser.parse_args()
    
    # Set default paths
    if args.input is None:
        input_font = os.path.join(os.path.dirname(__file__), 'Supertest.ttf')
    else:
        input_font = args.input
    
    if args.output is None:
        font_hash = hashlib.md5(f"{args.secret_key}_{args.nonce}".encode('utf-8')).hexdigest()[:12]
        output_font = os.path.join(os.path.dirname(__file__), 'fonts', f'decryption_{font_hash}.woff2')
    else:
        output_font = args.output
    
    # Create fonts directory if it doesn't exist
    os.makedirs(os.path.dirname(output_font), exist_ok=True)
    
    if not os.path.exists(input_font):
        print(f"ERROR: Input font not found: {input_font}")
        sys.exit(1)
    
    print("=" * 70)
    print("DYNAMIC FONT GENERATION (Feistel-based mappings)")
    print("=" * 70)
    print()
    
    success = create_decryption_font(input_font, output_font, args.secret_key, args.nonce)
    
    if success:
        print()
        print("=" * 70)
        print("✅ Font generation complete!")
        print(f"   Font saved to: {output_font}")
        print("=" * 70)
    else:
        print()
        print("=" * 70)
        print("⚠️  Font generation completed with warnings")
        print("   Check output above for details")
        print("=" * 70)
