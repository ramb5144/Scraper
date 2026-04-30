#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Database module for Cloak API.
Uses SQLAlchemy for ORM with PostgreSQL (Supabase) or SQLite for local dev.

Setup for Supabase:
1. Create account at supabase.com
2. Create new project
3. Go to Settings > Database > Connection string
4. Copy the URI and set DATABASE_URL environment variable

For local development, leave DATABASE_URL unset to use SQLite.
"""
import os
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from contextlib import contextmanager

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime, Boolean,
    ForeignKey, Text, BigInteger, Index, JSON
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship, Session
from sqlalchemy.pool import StaticPool
from werkzeug.security import generate_password_hash, check_password_hash

# =============================================================================
# DATABASE CONFIGURATION
# =============================================================================

# Track database availability
DATABASE_AVAILABLE = False
engine = None
SessionLocal = None
Base = declarative_base()

def _init_engine():
    """Initialize database engine. Returns True if successful."""
    global engine, SessionLocal, DATABASE_AVAILABLE

    DATABASE_URL = os.environ.get('DATABASE_URL')

    try:
        if DATABASE_URL:
            # Production: PostgreSQL (Supabase)
            # Supabase URLs start with postgres://, SQLAlchemy needs postgresql://
            if DATABASE_URL.startswith('postgres://'):
                DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
            engine = create_engine(
                DATABASE_URL,
                pool_pre_ping=True,
                connect_args={'connect_timeout': 5}
            )
            # Test the connection
            with engine.connect() as conn:
                conn.execute("SELECT 1")
            print(f"[DATABASE] Connected to PostgreSQL")
        else:
            # Development: SQLite
            SQLITE_PATH = os.path.join(os.path.dirname(__file__), 'cloak.db')
            engine = create_engine(
                f'sqlite:///{SQLITE_PATH}',
                connect_args={'check_same_thread': False},
                poolclass=StaticPool
            )
            print(f"[DATABASE] Using SQLite at {SQLITE_PATH}")

        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        DATABASE_AVAILABLE = True
        return True
    except Exception as e:
        print(f"[DATABASE] Connection failed: {e}")
        print("[DATABASE] Running without database - dashboard features disabled")
        DATABASE_AVAILABLE = False
        return False

# Try to initialize on import, but don't fail if database is unavailable
_init_engine()

# =============================================================================
# MODELS
# =============================================================================

class User(Base):
    """User model for dashboard authentication."""
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=True)

    # Status
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

    # Plan/subscription
    plan = Column(String(20), default='free')  # free, pro, enterprise

    # Relationships
    api_keys = relationship('APIKey', back_populates='user', lazy='dynamic')

    def __repr__(self):
        return f"<User {self.email}>"

    def set_password(self, password: str):
        """Hash and set the user's password."""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        """Check if the provided password matches."""
        return check_password_hash(self.password_hash, password)


class APIKey(Base):
    """API Key model - stores hashed keys with metadata."""
    __tablename__ = 'api_keys'

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Owner (optional - keys can exist without user for admin-created keys)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True, index=True)

    # Key identification (we store hash, not the actual key)
    key_prefix = Column(String(20), nullable=False)  # e.g., "cloak_live_abc1" for display
    key_hash = Column(String(64), unique=True, nullable=False, index=True)  # SHA-256 hash

    # Metadata
    name = Column(String(255), nullable=True)  # User-friendly name
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=True)

    # Status
    is_active = Column(Boolean, default=True)
    revoked_at = Column(DateTime, nullable=True)

    # Permissions & Limits
    allowed_domains = Column(JSON, default=list)  # ["example.com", "*.example.com"]
    rate_limit_tier = Column(String(20), default='free')  # free, pro, enterprise
    monthly_char_limit = Column(BigInteger, default=10000)  # chars per month

    # Usage tracking
    total_chars_encrypted = Column(BigInteger, default=0)
    total_requests = Column(BigInteger, default=0)
    chars_this_month = Column(BigInteger, default=0)
    month_reset_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    usage_logs = relationship('UsageLog', back_populates='api_key', lazy='dynamic')
    user = relationship('User', back_populates='api_keys')

    def __repr__(self):
        return f"<APIKey {self.key_prefix}... ({self.name})>"

    def check_monthly_reset(self):
        """Reset monthly counter if we're in a new month."""
        now = datetime.utcnow()
        if self.month_reset_at is None or now.month != self.month_reset_at.month or now.year != self.month_reset_at.year:
            self.chars_this_month = 0
            self.month_reset_at = now


class UsageLog(Base):
    """Usage log for analytics and billing."""
    __tablename__ = 'usage_logs'

    id = Column(Integer, primary_key=True, autoincrement=True)
    api_key_id = Column(Integer, ForeignKey('api_keys.id'), nullable=False, index=True)

    # Request details
    endpoint = Column(String(100), nullable=False)
    method = Column(String(10), nullable=False)

    # Metrics
    chars_requested = Column(Integer, default=0)
    response_time_ms = Column(Integer, nullable=True)
    status_code = Column(Integer, nullable=True)

    # Context
    ip_address = Column(String(45), nullable=True)  # IPv6 can be up to 45 chars
    origin_domain = Column(String(255), nullable=True)
    user_agent = Column(String(500), nullable=True)

    # Timestamp
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    # Relationships
    api_key = relationship('APIKey', back_populates='usage_logs')

    __table_args__ = (
        Index('idx_usage_api_key_date', 'api_key_id', 'created_at'),
    )


class Website(Base):
    """Encrypted website records."""
    __tablename__ = 'websites'

    id = Column(Integer, primary_key=True, autoincrement=True)
    api_key_id = Column(Integer, ForeignKey('api_keys.id'), nullable=True, index=True)

    # Identifiers
    storage_id = Column(String(64), unique=True, nullable=False, index=True)
    hash_value = Column(String(64), unique=True, nullable=False, index=True)

    # Metadata
    url = Column(String(2000), nullable=True)
    title = Column(String(500), nullable=True)
    plaintext_length = Column(Integer, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    last_accessed_at = Column(DateTime, nullable=True)
    access_count = Column(Integer, default=0)


# =============================================================================
# DATABASE UTILITIES
# =============================================================================

def init_db():
    """Create all database tables."""
    if not DATABASE_AVAILABLE or engine is None:
        print("[DATABASE] Skipping table creation - no database connection")
        return False
    Base.metadata.create_all(bind=engine)
    print("[DATABASE] Tables created successfully")
    return True


def drop_db():
    """Drop all database tables. USE WITH CAUTION."""
    Base.metadata.drop_all(bind=engine)
    print("[DATABASE] Tables dropped")


@contextmanager
def get_db() -> Session:
    """Get database session with automatic cleanup."""
    if not DATABASE_AVAILABLE or SessionLocal is None:
        raise RuntimeError("Database not available")
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_db_session() -> Session:
    """Get a database session (caller must close)."""
    return SessionLocal()


# =============================================================================
# API KEY FUNCTIONS
# =============================================================================

def hash_api_key(api_key: str) -> str:
    """Hash an API key using SHA-256."""
    return hashlib.sha256(api_key.encode()).hexdigest()


def generate_api_key(environment: str = 'test') -> str:
    """
    Generate a new API key.

    Format: cloak_{env}_{32 random hex chars}
    Example: cloak_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
    """
    random_part = secrets.token_hex(16)  # 32 hex chars
    return f"cloak_{environment}_{random_part}"


def create_api_key(
    name: str = None,
    environment: str = 'test',
    allowed_domains: List[str] = None,
    rate_limit_tier: str = 'free',
    monthly_char_limit: int = 10000
) -> tuple[str, Dict[str, Any]]:
    """
    Create a new API key and store it in the database.

    Returns:
        (plaintext_key, api_key_info) - The plaintext key is only returned once!
        api_key_info is a dict with id, name, allowed_domains, etc.
    """
    # Generate the key
    plaintext_key = generate_api_key(environment)
    key_hash = hash_api_key(plaintext_key)
    key_prefix = plaintext_key[:20]  # e.g., "cloak_live_a1b2c3d4"

    with get_db() as db:
        api_key = APIKey(
            key_prefix=key_prefix,
            key_hash=key_hash,
            name=name,
            allowed_domains=allowed_domains or [],
            rate_limit_tier=rate_limit_tier,
            monthly_char_limit=monthly_char_limit
        )
        db.add(api_key)
        db.commit()
        db.refresh(api_key)

        # Return as dict to avoid detached instance issues
        api_key_info = {
            'id': api_key.id,
            'key_prefix': api_key.key_prefix,
            'name': api_key.name,
            'allowed_domains': api_key.allowed_domains,
            'rate_limit_tier': api_key.rate_limit_tier,
            'monthly_char_limit': api_key.monthly_char_limit,
            'created_at': api_key.created_at.isoformat() if api_key.created_at else None
        }

        print(f"[DATABASE] Created API key: {key_prefix}... (ID: {api_key.id})")
        return plaintext_key, api_key_info


def get_api_key_by_hash(key_hash: str) -> Optional[Dict[str, Any]]:
    """Look up an API key by its hash. Returns dict to avoid session issues."""
    with get_db() as db:
        api_key = db.query(APIKey).filter(
            APIKey.key_hash == key_hash,
            APIKey.is_active == True
        ).first()

        if not api_key:
            return None

        return {
            'id': api_key.id,
            'key_prefix': api_key.key_prefix,
            'name': api_key.name,
            'allowed_domains': api_key.allowed_domains,
            'rate_limit_tier': api_key.rate_limit_tier,
            'monthly_char_limit': api_key.monthly_char_limit,
            'chars_this_month': api_key.chars_this_month,
            'total_chars_encrypted': api_key.total_chars_encrypted,
            'total_requests': api_key.total_requests,
        }


def validate_api_key(plaintext_key: str) -> Optional[Dict[str, Any]]:
    """
    Validate an API key and return its info if valid.
    Also updates last_used_at.
    """
    key_hash = hash_api_key(plaintext_key)

    with get_db() as db:
        api_key = db.query(APIKey).filter(
            APIKey.key_hash == key_hash,
            APIKey.is_active == True
        ).first()

        if not api_key:
            return None

        api_key.last_used_at = datetime.utcnow()
        api_key.total_requests += 1
        db.commit()

        return {
            'id': api_key.id,
            'key_prefix': api_key.key_prefix,
            'name': api_key.name,
            'allowed_domains': api_key.allowed_domains,
            'rate_limit_tier': api_key.rate_limit_tier,
            'monthly_char_limit': api_key.monthly_char_limit,
            'chars_this_month': api_key.chars_this_month,
            'total_chars_encrypted': api_key.total_chars_encrypted,
            'total_requests': api_key.total_requests,
        }


def check_domain_allowed(api_key_info: Dict[str, Any], domain: str) -> bool:
    """
    Check if a domain is allowed for this API key.
    Supports wildcards like "*.example.com".
    """
    allowed_domains = api_key_info.get('allowed_domains', [])
    if not allowed_domains:
        return True  # No restrictions

    domain = domain.lower()

    for allowed in allowed_domains:
        allowed = allowed.lower()

        if allowed == domain:
            return True

        # Wildcard matching
        if allowed.startswith('*.'):
            suffix = allowed[2:]  # Remove "*."
            if domain == suffix or domain.endswith('.' + suffix):
                return True

    return False


def check_usage_limit(api_key_info: Dict[str, Any], chars_requested: int = 0) -> tuple[bool, str]:
    """
    Check if the API key has exceeded its usage limits.

    Returns:
        (allowed, message)
    """
    with get_db() as db:
        # Get fresh record
        api_key = db.query(APIKey).get(api_key_info['id'])
        if not api_key:
            return False, "API key not found"

        api_key.check_monthly_reset()

        # Check monthly limit
        if api_key.chars_this_month + chars_requested > api_key.monthly_char_limit:
            remaining = api_key.monthly_char_limit - api_key.chars_this_month
            return False, f"Monthly character limit exceeded. Remaining: {remaining}"

        db.commit()
        return True, "OK"


def record_usage(
    api_key_info: Dict[str, Any],
    chars: int,
    endpoint: str,
    method: str = 'POST',
    response_time_ms: int = None,
    status_code: int = None,
    ip_address: str = None,
    origin_domain: str = None,
    user_agent: str = None
):
    """Record API usage for analytics and billing."""
    with get_db() as db:
        # Update API key counters
        api_key = db.query(APIKey).get(api_key_info['id'])
        if api_key:
            api_key.total_chars_encrypted += chars
            api_key.chars_this_month += chars

            # Create usage log
            log = UsageLog(
                api_key_id=api_key.id,
                endpoint=endpoint,
                method=method,
                chars_requested=chars,
                response_time_ms=response_time_ms,
                status_code=status_code,
                ip_address=ip_address,
                origin_domain=origin_domain,
                user_agent=user_agent
            )
            db.add(log)
            db.commit()


def revoke_api_key(key_id: int) -> bool:
    """Revoke an API key."""
    with get_db() as db:
        api_key = db.query(APIKey).get(key_id)
        if api_key:
            api_key.is_active = False
            api_key.revoked_at = datetime.utcnow()
            db.commit()
            print(f"[DATABASE] Revoked API key ID: {key_id}")
            return True
        return False


def get_usage_stats(api_key_id: int, days: int = 30) -> Dict[str, Any]:
    """Get usage statistics for an API key."""
    with get_db() as db:
        api_key = db.query(APIKey).get(api_key_id)
        if not api_key:
            return None

        since = datetime.utcnow() - timedelta(days=days)

        logs = db.query(UsageLog).filter(
            UsageLog.api_key_id == api_key_id,
            UsageLog.created_at >= since
        ).all()

        total_chars = sum(log.chars_requested for log in logs)
        total_requests = len(logs)

        # Group by endpoint
        by_endpoint = {}
        for log in logs:
            if log.endpoint not in by_endpoint:
                by_endpoint[log.endpoint] = {'requests': 0, 'chars': 0}
            by_endpoint[log.endpoint]['requests'] += 1
            by_endpoint[log.endpoint]['chars'] += log.chars_requested

        return {
            'api_key_id': api_key_id,
            'name': api_key.name,
            'tier': api_key.rate_limit_tier,
            'period_days': days,
            'total_requests': total_requests,
            'total_chars': total_chars,
            'monthly_limit': api_key.monthly_char_limit,
            'chars_this_month': api_key.chars_this_month,
            'by_endpoint': by_endpoint
        }


# =============================================================================
# USER FUNCTIONS
# =============================================================================

def create_user(email: str, password: str, name: str = None) -> Optional[Dict[str, Any]]:
    """Create a new user account."""
    with get_db() as db:
        # Check if email already exists
        existing = db.query(User).filter(User.email == email.lower()).first()
        if existing:
            return None

        user = User(
            email=email.lower(),
            name=name
        )
        user.set_password(password)
        db.add(user)
        db.commit()
        db.refresh(user)

        print(f"[DATABASE] Created user: {email}")
        return {
            'id': user.id,
            'email': user.email,
            'name': user.name,
            'plan': user.plan,
            'created_at': user.created_at.isoformat() if user.created_at else None
        }


def authenticate_user(email: str, password: str) -> Optional[Dict[str, Any]]:
    """Authenticate a user by email and password."""
    with get_db() as db:
        user = db.query(User).filter(
            User.email == email.lower(),
            User.is_active == True
        ).first()

        if not user or not user.check_password(password):
            return None

        # Update last login
        user.last_login_at = datetime.utcnow()
        db.commit()

        return {
            'id': user.id,
            'email': user.email,
            'name': user.name,
            'plan': user.plan,
            'is_verified': user.is_verified,
            'created_at': user.created_at.isoformat() if user.created_at else None
        }


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    """Get user by ID."""
    with get_db() as db:
        user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
        if not user:
            return None

        return {
            'id': user.id,
            'email': user.email,
            'name': user.name,
            'plan': user.plan,
            'is_verified': user.is_verified,
            'created_at': user.created_at.isoformat() if user.created_at else None,
            'last_login_at': user.last_login_at.isoformat() if user.last_login_at else None
        }


def get_user_api_keys(user_id: int) -> List[Dict[str, Any]]:
    """Get all API keys for a user."""
    with get_db() as db:
        keys = db.query(APIKey).filter(
            APIKey.user_id == user_id
        ).order_by(APIKey.created_at.desc()).all()

        return [{
            'id': key.id,
            'key_prefix': key.key_prefix,
            'name': key.name,
            'is_active': key.is_active,
            'created_at': key.created_at.isoformat() if key.created_at else None,
            'last_used_at': key.last_used_at.isoformat() if key.last_used_at else None,
            'allowed_domains': key.allowed_domains,
            'rate_limit_tier': key.rate_limit_tier,
            'monthly_char_limit': key.monthly_char_limit,
            'chars_this_month': key.chars_this_month,
            'total_chars_encrypted': key.total_chars_encrypted,
            'total_requests': key.total_requests
        } for key in keys]


def create_user_api_key(
    user_id: int,
    name: str = None,
    environment: str = 'live',
    allowed_domains: List[str] = None
) -> Optional[tuple[str, Dict[str, Any]]]:
    """Create an API key for a user. Returns (plaintext_key, key_info)."""
    with get_db() as db:
        # Get user to determine limits based on plan
        user = db.query(User).get(user_id)
        if not user:
            return None

        # Set limits based on user plan
        plan_limits = {
            'free': 10000,
            'pro': 1000000,
            'enterprise': 100000000
        }
        monthly_limit = plan_limits.get(user.plan, 10000)

        # Generate the key
        plaintext_key = generate_api_key(environment)
        key_hash = hash_api_key(plaintext_key)
        key_prefix = plaintext_key[:20]

        api_key = APIKey(
            user_id=user_id,
            key_prefix=key_prefix,
            key_hash=key_hash,
            name=name or f"API Key {datetime.utcnow().strftime('%Y-%m-%d')}",
            allowed_domains=allowed_domains or [],
            rate_limit_tier=user.plan,
            monthly_char_limit=monthly_limit
        )
        db.add(api_key)
        db.commit()
        db.refresh(api_key)

        key_info = {
            'id': api_key.id,
            'key_prefix': api_key.key_prefix,
            'name': api_key.name,
            'allowed_domains': api_key.allowed_domains,
            'rate_limit_tier': api_key.rate_limit_tier,
            'monthly_char_limit': api_key.monthly_char_limit,
            'created_at': api_key.created_at.isoformat() if api_key.created_at else None
        }

        print(f"[DATABASE] Created API key for user {user_id}: {key_prefix}...")
        return plaintext_key, key_info


def revoke_user_api_key(user_id: int, key_id: int) -> bool:
    """Revoke an API key (user must own it)."""
    with get_db() as db:
        api_key = db.query(APIKey).filter(
            APIKey.id == key_id,
            APIKey.user_id == user_id
        ).first()

        if not api_key:
            return False

        api_key.is_active = False
        api_key.revoked_at = datetime.utcnow()
        db.commit()
        print(f"[DATABASE] User {user_id} revoked API key ID: {key_id}")
        return True


def update_user(user_id: int, name: str = None, email: str = None) -> Optional[Dict[str, Any]]:
    """Update user profile."""
    with get_db() as db:
        user = db.query(User).get(user_id)
        if not user:
            return None

        if name is not None:
            user.name = name
        if email is not None:
            # Check if email is taken by another user
            existing = db.query(User).filter(
                User.email == email.lower(),
                User.id != user_id
            ).first()
            if existing:
                return None
            user.email = email.lower()

        db.commit()
        return {
            'id': user.id,
            'email': user.email,
            'name': user.name,
            'plan': user.plan
        }


def update_user_password(user_id: int, current_password: str, new_password: str) -> bool:
    """Update user password."""
    with get_db() as db:
        user = db.query(User).get(user_id)
        if not user:
            return False

        if not user.check_password(current_password):
            return False

        user.set_password(new_password)
        db.commit()
        return True


def get_user_dashboard_stats(user_id: int) -> Dict[str, Any]:
    """Get dashboard statistics for a user."""
    with get_db() as db:
        keys = db.query(APIKey).filter(APIKey.user_id == user_id).all()

        total_keys = len(keys)
        active_keys = sum(1 for k in keys if k.is_active)
        total_chars = sum(k.total_chars_encrypted or 0 for k in keys)
        total_requests = sum(k.total_requests or 0 for k in keys)
        chars_this_month = sum(k.chars_this_month or 0 for k in keys)

        # Get recent usage (last 7 days)
        week_ago = datetime.utcnow() - timedelta(days=7)
        key_ids = [k.id for k in keys]

        if key_ids:
            recent_logs = db.query(UsageLog).filter(
                UsageLog.api_key_id.in_(key_ids),
                UsageLog.created_at >= week_ago
            ).all()
            recent_requests = len(recent_logs)
            recent_chars = sum(log.chars_requested or 0 for log in recent_logs)
        else:
            recent_requests = 0
            recent_chars = 0

        return {
            'total_keys': total_keys,
            'active_keys': active_keys,
            'total_chars_encrypted': total_chars,
            'total_requests': total_requests,
            'chars_this_month': chars_this_month,
            'requests_last_7_days': recent_requests,
            'chars_last_7_days': recent_chars
        }


# =============================================================================
# INITIALIZATION
# =============================================================================

# Auto-initialize tables on import
init_db()
