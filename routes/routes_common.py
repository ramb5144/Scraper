#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Common imports and constants for route modules.
"""
import os

# Secret key - can be overridden via SECRET_KEY environment variable
SECRET_KEY = int(os.environ.get('SECRET_KEY', '99887766'))

# PDF processing limits
PDF_MAX_SIZE = 50 * 1024 * 1024  # 50MB max file size

# Optional dependencies
try:
    from bs4 import BeautifulSoup
    BS4_AVAILABLE = True
except ImportError:
    BS4_AVAILABLE = False

try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False
