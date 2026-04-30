#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Flask API route handlers - main registration module.
Imports and registers all route modules.
"""
from routes.routes_encryption import register_encryption_routes
from routes.routes_pdf import register_pdf_routes
from routes.routes_static import register_static_routes
from routes.routes_debug import register_debug_routes
from routes.routes_sdk import register_sdk_routes
from routes.routes_dashboard import register_dashboard_routes

def register_routes(app):
    """Register all API routes with the Flask app."""
    register_encryption_routes(app)
    register_pdf_routes(app)
    register_static_routes(app)
    register_debug_routes(app)
    register_sdk_routes(app)
    register_dashboard_routes(app)
