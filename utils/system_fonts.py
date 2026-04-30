#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
System Font Mapping - Maps system fonts to metrically-compatible Google Fonts equivalents.

This allows Cloak to work with any website, even those using system fonts like Arial,
Times New Roman, etc. that cannot be downloaded directly.

The Google Fonts alternatives are:
- Metrically compatible (same character widths) so layout doesn't break
- Freely downloadable via Google Fonts API
- Open source (Apache/OFL licensed)

METRIC-COMPATIBLE MAPPINGS (excellent quality):
- Arial, Helvetica -> Arimo (Croscore)
- Times New Roman -> Tinos (Croscore)
- Courier New -> Cousine (Croscore)
- Georgia -> Gelasio
- Calibri -> Carlito
- Cambria -> Caladea

NO METRIC-COMPATIBLE ALTERNATIVE (use closest category match):
- Verdana -> Arimo (wider x-height in original)
- Trebuchet MS -> Arimo (more distinctive letterforms)
- Impact -> Anton (visual match only)
- Tahoma -> Arimo (narrower in original)

For fonts not in this map, the SDK uses detectFontCategory() to determine
serif/sans-serif/monospace and applies an appropriate encrypted font.
"""

# Mapping of system font names to Google Fonts equivalents
# Format: 'system_font_name': {
#     'google_font': 'Google Font Name',
#     'url': 'Direct URL to font file (woff2)',
#     'weights': { weight: url } for different weights
# }

# These are the Google Fonts "metric-compatible" fonts designed to match system fonts exactly
SYSTEM_FONT_MAP = {
    # Arial family -> Arimo (metric-compatible with Arial)
    'arial': {
        'google_font': 'Arimo',
        'css_url': 'https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },
    'arial black': {
        'google_font': 'Arimo',
        'css_url': 'https://fonts.googleapis.com/css2?family=Arimo:wght@700&display=swap',
    },

    # Times New Roman -> Tinos (metric-compatible with Times New Roman)
    'times new roman': {
        'google_font': 'Tinos',
        'css_url': 'https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'times': {
        'google_font': 'Tinos',
        'css_url': 'https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },

    # Courier New -> Cousine (metric-compatible with Courier New)
    'courier new': {
        'google_font': 'Cousine',
        'css_url': 'https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'courier': {
        'google_font': 'Cousine',
        'css_url': 'https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },

    # Georgia -> Gelasio (metrically compatible, variable font with better weight matching than Tinos)
    'georgia': {
        'google_font': 'Gelasio',
        'css_url': 'https://fonts.googleapis.com/css2?family=Gelasio:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },

    # Verdana -> No exact match, but Arimo is close sans-serif
    'verdana': {
        'google_font': 'Arimo',
        'css_url': 'https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },

    # Trebuchet MS -> No exact match, Arimo is reasonable fallback
    'trebuchet ms': {
        'google_font': 'Arimo',
        'css_url': 'https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },

    # Impact -> Anton is similar bold display font
    'impact': {
        'google_font': 'Anton',
        'css_url': 'https://fonts.googleapis.com/css2?family=Anton&display=swap',
    },

    # Comic Sans MS -> Comic Neue is the open source equivalent
    'comic sans ms': {
        'google_font': 'Comic Neue',
        'css_url': 'https://fonts.googleapis.com/css2?family=Comic+Neue:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700&display=swap',
    },

    # Helvetica -> Arimo (Arial equivalent, Helvetica and Arial are nearly identical)
    'helvetica': {
        'google_font': 'Arimo',
        'css_url': 'https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },
    'helvetica neue': {
        'google_font': 'Arimo',
        'css_url': 'https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },

    # Palatino -> Tinos (general serif, no exact metric clone available)
    # Note: TeX Gyre Pagella is metric-compatible but not on Google Fonts
    'palatino': {
        'google_font': 'Tinos',
        'css_url': 'https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'palatino linotype': {
        'google_font': 'Tinos',
        'css_url': 'https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'book antiqua': {
        'google_font': 'Tinos',
        'css_url': 'https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },

    # Microsoft Office fonts -> Metric-compatible Google alternatives
    # Calibri (default Word font since Office 2007) -> Carlito (metric-compatible)
    'calibri': {
        'google_font': 'Carlito',
        'css_url': 'https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'calibri light': {
        'google_font': 'Carlito',
        'css_url': 'https://fonts.googleapis.com/css2?family=Carlito:wght@400&display=swap',
    },
    # Cambria (Office serif font) -> Caladea (metric-compatible)
    'cambria': {
        'google_font': 'Caladea',
        'css_url': 'https://fonts.googleapis.com/css2?family=Caladea:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'cambria math': {
        'google_font': 'Caladea',
        'css_url': 'https://fonts.googleapis.com/css2?family=Caladea:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },

    # Lucida family
    'lucida console': {
        'google_font': 'Cousine',
        'css_url': 'https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'lucida sans': {
        'google_font': 'Arimo',
        'css_url': 'https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },

    # Tahoma -> Arimo is reasonable match
    'tahoma': {
        'google_font': 'Arimo',
        'css_url': 'https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },

    # System UI fonts (macOS/iOS)
    '-apple-system': {
        'google_font': 'Inter',
        'css_url': 'https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap',
    },
    'blinkmacsystemfont': {
        'google_font': 'Inter',
        'css_url': 'https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap',
    },
    'system-ui': {
        'google_font': 'Inter',
        'css_url': 'https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap',
    },

    # Segoe UI (Windows system font) -> Inter is similar modern sans
    'segoe ui': {
        'google_font': 'Inter',
        'css_url': 'https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap',
    },

    # Roboto is already a Google Font, but handle it in case it's referenced as system
    'roboto': {
        'google_font': 'Roboto',
        'css_url': 'https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,100;1,300;1,400;1,500;1,700;1,900&display=swap',
    },

    # Google Fonts used for category fallback (for zero-degradation font handling)
    'arimo': {
        'google_font': 'Arimo',
        'css_url': 'https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },
    'tinos': {
        'google_font': 'Tinos',
        'css_url': 'https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'roboto mono': {
        'google_font': 'Roboto Mono',
        'css_url': 'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&display=swap',
    },
    'cousine': {
        'google_font': 'Cousine',
        'css_url': 'https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'inter': {
        'google_font': 'Inter',
        'css_url': 'https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap',
    },
    'lora': {
        'google_font': 'Lora',
        'css_url': 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },
    'gelasio': {
        'google_font': 'Gelasio',
        'css_url': 'https://fonts.googleapis.com/css2?family=Gelasio:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },
    # Microsoft Office metric-compatible fonts (for category fallback)
    'carlito': {
        'google_font': 'Carlito',
        'css_url': 'https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'caladea': {
        'google_font': 'Caladea',
        'css_url': 'https://fonts.googleapis.com/css2?family=Caladea:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },

    # San Francisco (macOS) -> Inter
    'sf pro': {
        'google_font': 'Inter',
        'css_url': 'https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap',
    },
    'sf pro display': {
        'google_font': 'Inter',
        'css_url': 'https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap',
    },
    'sf pro text': {
        'google_font': 'Inter',
        'css_url': 'https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap',
    },

    # Monospace system fonts
    'sf mono': {
        'google_font': 'Cousine',
        'css_url': 'https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'menlo': {
        'google_font': 'Cousine',
        'css_url': 'https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'monaco': {
        'google_font': 'Cousine',
        'css_url': 'https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'consolas': {
        'google_font': 'Cousine',
        'css_url': 'https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },

    # Generic families - map to good defaults
    'sans-serif': {
        'google_font': 'Arimo',
        'css_url': 'https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    },
    'serif': {
        'google_font': 'Tinos',
        'css_url': 'https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'monospace': {
        'google_font': 'Cousine',
        'css_url': 'https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    },
    'cursive': {
        'google_font': 'Comic Neue',
        'css_url': 'https://fonts.googleapis.com/css2?family=Comic+Neue:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700&display=swap',
    },
}


def get_system_font_equivalent(font_family: str) -> dict | None:
    """
    Get the Google Fonts equivalent for a system font.

    Args:
        font_family: The font family name (e.g., 'Arial', 'Times New Roman')

    Returns:
        Dict with 'google_font' and 'css_url' keys, or None if no mapping exists
    """
    # Normalize the font name
    normalized = font_family.lower().strip().strip('"\'')

    return SYSTEM_FONT_MAP.get(normalized)


def is_system_font(font_family: str) -> bool:
    """
    Check if a font is a system font (not a web font).

    Args:
        font_family: The font family name

    Returns:
        True if it's a system font that needs mapping
    """
    normalized = font_family.lower().strip().strip('"\'')
    return normalized in SYSTEM_FONT_MAP


def get_all_supported_system_fonts() -> list[str]:
    """
    Get a list of all supported system font names.

    Returns:
        List of font family names that can be mapped
    """
    return list(SYSTEM_FONT_MAP.keys())
