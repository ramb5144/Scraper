#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backend API Server for Article Encryption
Uses Feistel cipher encryption (utils.encryption module)
"""
from flask import Flask
from flask_cors import CORS
import os
import logging

# Load environment variables from .env file if it exists
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv not installed, that's okay

# Initialize Sentry for error tracking (production only)
SENTRY_DSN = os.environ.get('SENTRY_DSN')
if SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.flask import FlaskIntegration
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            integrations=[FlaskIntegration()],
            traces_sample_rate=0.1,  # 10% of transactions for performance monitoring
            environment=os.environ.get('ENVIRONMENT', 'production'),
        )
        print(f"[SENTRY] Error tracking enabled")
    except ImportError:
        print("[SENTRY] sentry-sdk not installed, skipping")
else:
    print("[SENTRY] No SENTRY_DSN set, error tracking disabled")

# Set up logging - single log file that resets on reload
LOG_FILE = 'app.log'
# Reset log file on startup (truncate to 0 bytes)
with open(LOG_FILE, 'w') as f:
    pass  # Truncate file

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()  # Also print to console
    ],
    force=True  # Override any existing configuration
)

# Redirect stdout and stderr to also log to file
import sys
class TeeOutput:
    """Tee output to both console and log file"""
    def __init__(self, file, stream):
        self.file = file
        self.stream = stream
    
    def write(self, data):
        self.file.write(data)
        self.stream.write(data)
        self.file.flush()
        self.stream.flush()
    
    def flush(self):
        self.file.flush()
        self.stream.flush()

log_file_handle = open(LOG_FILE, 'a', encoding='utf-8')
sys.stdout = TeeOutput(log_file_handle, sys.__stdout__)
sys.stderr = TeeOutput(log_file_handle, sys.__stderr__)

# Import route handlers
from routes.registry import register_routes

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from news websites

# Register all routes
register_routes(app)

if __name__ == '__main__':
    # Configuration
    # Default to 8001
    port = int(os.environ.get('PORT', 8001))
    host = os.environ.get('HOST', '0.0.0.0')
    debug = os.environ.get('DEBUG', 'False').lower() == 'true'
    
    logger = logging.getLogger(__name__)
    logger.info(f"Starting Article Encryption API on {host}:{port}")
    logger.info(f"Debug mode: {debug}")
    logger.info(f"API endpoint: http://{host}:{port}/api/encrypt")
    logger.info(f"Test page: http://{host}:{port}/")
    logger.info(f"Log file: {LOG_FILE} (resets on reload)")
    
    print(f"Starting Article Encryption API on {host}:{port}")
    print(f"Debug mode: {debug}")
    print(f"API endpoint: http://{host}:{port}/api/encrypt")
    print(f"Test page: http://{host}:{port}/")
    print(f"Log file: {LOG_FILE} (resets on reload)")
    
    app.run(host=host, port=port, debug=debug, use_reloader=False)

