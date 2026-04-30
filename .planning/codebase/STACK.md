# Technology Stack

**Analysis Date:** 2026-01-21

## Languages

**Primary:**
- Python 3.14.0 - Core backend API and all server logic

**Secondary:**
- JavaScript/TypeScript - Frontend client-side encryption libraries (referenced but not explored in detail)

## Runtime

**Environment:**
- Python 3.14.0

**Package Manager:**
- pip
- Lockfile: `requirements.txt` (present)

## Frameworks

**Core:**
- Flask 3.1.2 - HTTP API framework
- Flask-CORS 6.0.1 - Cross-Origin Resource Sharing support

**Testing:**
- pytest (implied from test files but not in requirements.txt)

**Build/Dev:**
- Gunicorn 21.2.0 - WSGI HTTP server (production)

## Key Dependencies

**Critical:**
- boto3 1.35.0 - AWS S3 API client for Cloudflare R2 storage (required for font and metadata storage)
- SQLAlchemy 2.0.23 - ORM for database models and queries
- psycopg2-binary 2.9.9 - PostgreSQL adapter (required for Supabase production database)
- python-dotenv 1.0.0 - Environment variable loading from .env files

**Content Processing:**
- fonttools 4.60.0 - Font file manipulation (TrueType and CFF formats)
- PyMuPDF 1.24.0 (fitz) - PDF file reading and processing
- beautifulsoup4 4.12.3 - HTML parsing and manipulation

**HTTP/Networking:**
- requests 2.31.0 - HTTP client for external API calls
- playwright (optional, not in requirements.txt) - Headless browser automation for URL rendering

**Observability:**
- sentry-sdk 1.39.1 - Error tracking and performance monitoring (production)

## Configuration

**Environment:**
- Configuration via `.env` file using python-dotenv
- Key environment variables:
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` - Cloudflare R2 credentials
  - `USE_R2_FONTS` - Toggle between R2 and local font serving
  - `DATABASE_URL` - Supabase PostgreSQL connection string (production)
  - `SECRET_KEY` - Encryption key (numeric)
  - `ADMIN_SECRET` - API admin authentication
  - `SENTRY_DSN` - Error tracking DSN (optional)
  - `ENVIRONMENT` - Environment name (production/development)
  - `PORT` - Server port (default: 8001)
  - `HOST` - Server host (default: 0.0.0.0)
  - `DEBUG` - Debug mode flag
  - `BASE_URL` - Base URL for API (local deployment)

**Build:**
- Procfile for Heroku deployment
- Gunicorn configuration: 2 workers, 4 threads, 120s timeout

## Platform Requirements

**Development:**
- Python 3.14.0
- pip package manager
- .env file with credentials for R2 and Supabase (optional for local dev)

**Production:**
- Heroku (deployment target indicated by Procfile)
- Cloudflare R2 (required for storage)
- Supabase PostgreSQL (production database)
- Python runtime with all dependencies installed

---

*Stack analysis: 2026-01-21*
