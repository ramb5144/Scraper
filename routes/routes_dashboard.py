#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Dashboard routes for user authentication and API key management.
"""
import os
import re
from functools import wraps
from flask import request, jsonify, session, redirect, url_for, make_response
from utils.database import (
    DATABASE_AVAILABLE,
    create_user, authenticate_user, get_user_by_id,
    get_user_api_keys, create_user_api_key, revoke_user_api_key,
    update_user, update_user_password, get_user_dashboard_stats,
    get_usage_stats
)

# Session configuration
SESSION_SECRET = os.environ.get('SESSION_SECRET', os.environ.get('SECRET_KEY', 'dev-secret-key-change-me'))


def require_database(f):
    """Decorator to check database availability before route execution."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not DATABASE_AVAILABLE:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Database temporarily unavailable'}), 503
            # For page routes, show a user-friendly message
            return make_response(DATABASE_UNAVAILABLE_HTML), 503
        return f(*args, **kwargs)
    return decorated_function


def login_required(f):
    """Decorator to require authentication for routes."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get('user_id')
        if not user_id:
            # For API endpoints, return JSON error
            if request.path.startswith('/api/') or request.headers.get('Accept') == 'application/json':
                return jsonify({'error': 'Authentication required'}), 401
            # For page routes, redirect to login
            return redirect('/login')

        # Get user info
        user = get_user_by_id(user_id)
        if not user:
            session.clear()
            if request.path.startswith('/api/'):
                return jsonify({'error': 'User not found'}), 401
            return redirect('/login')

        # Add user to request context
        request.current_user = user
        return f(*args, **kwargs)
    return decorated_function


def register_dashboard_routes(app):
    """Register all dashboard routes."""

    # Configure session
    app.secret_key = SESSION_SECRET

    # =========================================================================
    # AUTHENTICATION PAGES
    # =========================================================================

    @app.route('/signup', methods=['GET'])
    @require_database
    def signup_page():
        """Signup page."""
        if session.get('user_id'):
            return redirect('/dashboard')
        return make_response(SIGNUP_PAGE_HTML)

    @app.route('/login', methods=['GET'])
    @require_database
    def login_page():
        """Login page."""
        if session.get('user_id'):
            return redirect('/dashboard')
        return make_response(LOGIN_PAGE_HTML)

    @app.route('/logout', methods=['GET', 'POST'])
    def logout():
        """Logout and clear session."""
        session.clear()
        return redirect('/login')

    # =========================================================================
    # AUTHENTICATION API
    # =========================================================================

    @app.route('/api/auth/signup', methods=['POST'])
    @require_database
    def api_signup():
        """Create a new user account."""
        data = request.get_json() or {}

        email = data.get('email', '').strip()
        password = data.get('password', '')
        name = data.get('name', '').strip()

        # Validation
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400

        if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
            return jsonify({'error': 'Invalid email format'}), 400

        if len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400

        # Create user
        user = create_user(email, password, name or None)
        if not user:
            return jsonify({'error': 'Email already registered'}), 409

        # Log them in
        session['user_id'] = user['id']
        session.permanent = True

        return jsonify({
            'success': True,
            'user': user
        })

    @app.route('/api/auth/login', methods=['POST'])
    @require_database
    def api_login():
        """Authenticate user."""
        data = request.get_json() or {}

        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400

        user = authenticate_user(email, password)
        if not user:
            return jsonify({'error': 'Invalid email or password'}), 401

        # Create session
        session['user_id'] = user['id']
        session.permanent = True

        return jsonify({
            'success': True,
            'user': user
        })

    @app.route('/api/auth/me', methods=['GET'])
    @login_required
    def api_get_current_user():
        """Get current authenticated user."""
        return jsonify({'user': request.current_user})

    # =========================================================================
    # DASHBOARD PAGES
    # =========================================================================

    @app.route('/dashboard', methods=['GET'])
    @login_required
    def dashboard_page():
        """Main dashboard page."""
        return make_response(get_dashboard_html(request.current_user, 'overview'))

    @app.route('/dashboard/keys', methods=['GET'])
    @login_required
    def dashboard_keys_page():
        """API Keys management page."""
        return make_response(get_dashboard_html(request.current_user, 'keys'))

    @app.route('/dashboard/usage', methods=['GET'])
    @login_required
    def dashboard_usage_page():
        """Usage statistics page."""
        return make_response(get_dashboard_html(request.current_user, 'usage'))

    @app.route('/dashboard/account', methods=['GET'])
    @login_required
    def dashboard_account_page():
        """Account settings page."""
        return make_response(get_dashboard_html(request.current_user, 'account'))

    # =========================================================================
    # DASHBOARD API
    # =========================================================================

    @app.route('/api/dashboard/stats', methods=['GET'])
    @login_required
    def api_dashboard_stats():
        """Get dashboard statistics."""
        stats = get_user_dashboard_stats(request.current_user['id'])
        return jsonify(stats)

    @app.route('/api/dashboard/keys', methods=['GET'])
    @login_required
    def api_list_keys():
        """List user's API keys."""
        keys = get_user_api_keys(request.current_user['id'])
        return jsonify({'keys': keys})

    @app.route('/api/dashboard/keys', methods=['POST'])
    @login_required
    def api_create_key():
        """Create a new API key."""
        data = request.get_json() or {}
        name = data.get('name', '').strip()
        domains = data.get('allowed_domains', [])

        # Validate domains
        if domains and not isinstance(domains, list):
            return jsonify({'error': 'allowed_domains must be a list'}), 400

        result = create_user_api_key(
            user_id=request.current_user['id'],
            name=name or None,
            allowed_domains=domains
        )

        if not result:
            return jsonify({'error': 'Failed to create API key'}), 500

        plaintext_key, key_info = result

        return jsonify({
            'success': True,
            'key': plaintext_key,  # Only returned once!
            'key_info': key_info
        })

    @app.route('/api/dashboard/keys/<int:key_id>', methods=['DELETE'])
    @login_required
    def api_revoke_key(key_id):
        """Revoke an API key."""
        success = revoke_user_api_key(request.current_user['id'], key_id)
        if not success:
            return jsonify({'error': 'Key not found or already revoked'}), 404

        return jsonify({'success': True})

    @app.route('/api/dashboard/keys/<int:key_id>/stats', methods=['GET'])
    @login_required
    def api_key_stats(key_id):
        """Get usage statistics for a specific key."""
        # Verify ownership
        keys = get_user_api_keys(request.current_user['id'])
        if not any(k['id'] == key_id for k in keys):
            return jsonify({'error': 'Key not found'}), 404

        days = request.args.get('days', 30, type=int)
        stats = get_usage_stats(key_id, days)
        return jsonify(stats)

    @app.route('/api/dashboard/account', methods=['PUT'])
    @login_required
    def api_update_account():
        """Update account settings."""
        data = request.get_json() or {}

        name = data.get('name')
        email = data.get('email')

        result = update_user(request.current_user['id'], name=name, email=email)
        if not result:
            return jsonify({'error': 'Email already taken or update failed'}), 400

        return jsonify({'success': True, 'user': result})

    @app.route('/api/dashboard/account/password', methods=['PUT'])
    @login_required
    def api_update_password():
        """Update password."""
        data = request.get_json() or {}

        current = data.get('current_password', '')
        new = data.get('new_password', '')

        if not current or not new:
            return jsonify({'error': 'Current and new password required'}), 400

        if len(new) < 8:
            return jsonify({'error': 'New password must be at least 8 characters'}), 400

        success = update_user_password(request.current_user['id'], current, new)
        if not success:
            return jsonify({'error': 'Current password is incorrect'}), 401

        return jsonify({'success': True})


# =============================================================================
# HTML TEMPLATES
# =============================================================================

# Common styles used across all pages
COMMON_STYLES = '''
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            color: #e4e4e7;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }
        .card {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 1.5rem;
            backdrop-filter: blur(10px);
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.9rem;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            text-decoration: none;
        }
        .btn-primary {
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white;
        }
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
        }
        .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: #e4e4e7;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        .btn-danger {
            background: rgba(239, 68, 68, 0.2);
            color: #fca5a5;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .btn-danger:hover {
            background: rgba(239, 68, 68, 0.3);
        }
        .input {
            width: 100%;
            padding: 0.75rem 1rem;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.05);
            color: #e4e4e7;
            font-size: 1rem;
            transition: border-color 0.2s;
        }
        .input:focus {
            outline: none;
            border-color: #6366f1;
        }
        .input::placeholder {
            color: #71717a;
        }
        label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 500;
            color: #a1a1aa;
        }
        .form-group {
            margin-bottom: 1.25rem;
        }
        .error-message {
            color: #fca5a5;
            font-size: 0.875rem;
            margin-top: 0.5rem;
        }
        .success-message {
            color: #86efac;
            font-size: 0.875rem;
            margin-top: 0.5rem;
        }
        .text-muted {
            color: #71717a;
        }
        .text-center {
            text-align: center;
        }
        a {
            color: #818cf8;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
'''

DATABASE_UNAVAILABLE_HTML = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Service Unavailable - Cloak</title>
    {COMMON_STYLES}
    <style>
        .error-container {{
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 2rem;
            text-align: center;
        }}
        .error-icon {{
            font-size: 4rem;
            margin-bottom: 1rem;
        }}
        .error-title {{
            font-size: 2rem;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }}
        .error-message {{
            color: #a1a1aa;
            max-width: 400px;
            margin-bottom: 2rem;
        }}
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">⚙️</div>
        <h1 class="error-title">Service Temporarily Unavailable</h1>
        <p class="error-message">
            The dashboard is temporarily unavailable while we perform maintenance.
            Please try again in a few moments.
        </p>
        <a href="/" class="btn btn-primary">Return to Home</a>
    </div>
</body>
</html>
'''

LOGIN_PAGE_HTML = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - Cloak API</title>
    {COMMON_STYLES}
    <style>
        .auth-container {{
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 1rem;
        }}
        .auth-card {{
            width: 100%;
            max-width: 420px;
        }}
        .auth-header {{
            text-align: center;
            margin-bottom: 2rem;
        }}
        .auth-header h1 {{
            font-size: 1.75rem;
            margin-bottom: 0.5rem;
        }}
        .logo {{
            font-size: 2.5rem;
            margin-bottom: 1rem;
        }}
    </style>
</head>
<body>
    <div class="auth-container">
        <div class="auth-card card">
            <div class="auth-header">
                <div class="logo">🔐</div>
                <h1>Welcome back</h1>
                <p class="text-muted">Sign in to your Cloak account</p>
            </div>

            <form id="loginForm">
                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" class="input" placeholder="you@example.com" required>
                </div>

                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" class="input" placeholder="••••••••" required>
                </div>

                <div id="errorMessage" class="error-message" style="display: none;"></div>

                <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">
                    Sign In
                </button>
            </form>

            <p class="text-center text-muted" style="margin-top: 1.5rem;">
                Don't have an account? <a href="/signup">Sign up</a>
            </p>
        </div>
    </div>

    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {{
            e.preventDefault();
            const errorDiv = document.getElementById('errorMessage');
            errorDiv.style.display = 'none';

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {{
                const res = await fetch('/api/auth/login', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ email, password }})
                }});

                const data = await res.json();

                if (res.ok) {{
                    window.location.href = '/dashboard';
                }} else {{
                    errorDiv.textContent = data.error || 'Login failed';
                    errorDiv.style.display = 'block';
                }}
            }} catch (err) {{
                errorDiv.textContent = 'Network error. Please try again.';
                errorDiv.style.display = 'block';
            }}
        }});
    </script>
</body>
</html>
'''

SIGNUP_PAGE_HTML = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign Up - Cloak API</title>
    {COMMON_STYLES}
    <style>
        .auth-container {{
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 1rem;
        }}
        .auth-card {{
            width: 100%;
            max-width: 420px;
        }}
        .auth-header {{
            text-align: center;
            margin-bottom: 2rem;
        }}
        .auth-header h1 {{
            font-size: 1.75rem;
            margin-bottom: 0.5rem;
        }}
        .logo {{
            font-size: 2.5rem;
            margin-bottom: 1rem;
        }}
    </style>
</head>
<body>
    <div class="auth-container">
        <div class="auth-card card">
            <div class="auth-header">
                <div class="logo">🔐</div>
                <h1>Create your account</h1>
                <p class="text-muted">Start protecting your content today</p>
            </div>

            <form id="signupForm">
                <div class="form-group">
                    <label for="name">Name (optional)</label>
                    <input type="text" id="name" class="input" placeholder="John Doe">
                </div>

                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" class="input" placeholder="you@example.com" required>
                </div>

                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" class="input" placeholder="At least 8 characters" required minlength="8">
                </div>

                <div id="errorMessage" class="error-message" style="display: none;"></div>

                <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">
                    Create Account
                </button>
            </form>

            <p class="text-center text-muted" style="margin-top: 1.5rem;">
                Already have an account? <a href="/login">Sign in</a>
            </p>
        </div>
    </div>

    <script>
        document.getElementById('signupForm').addEventListener('submit', async (e) => {{
            e.preventDefault();
            const errorDiv = document.getElementById('errorMessage');
            errorDiv.style.display = 'none';

            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {{
                const res = await fetch('/api/auth/signup', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ name, email, password }})
                }});

                const data = await res.json();

                if (res.ok) {{
                    window.location.href = '/dashboard';
                }} else {{
                    errorDiv.textContent = data.error || 'Signup failed';
                    errorDiv.style.display = 'block';
                }}
            }} catch (err) {{
                errorDiv.textContent = 'Network error. Please try again.';
                errorDiv.style.display = 'block';
            }}
        }});
    </script>
</body>
</html>
'''


def get_dashboard_html(user, active_page):
    """Generate dashboard HTML with the appropriate content."""

    nav_items = [
        ('overview', 'Overview', '/dashboard'),
        ('keys', 'API Keys', '/dashboard/keys'),
        ('usage', 'Usage', '/dashboard/usage'),
        ('account', 'Account', '/dashboard/account'),
    ]

    nav_html = ''
    for page_id, label, href in nav_items:
        active_class = 'active' if page_id == active_page else ''
        nav_html += f'<a href="{href}" class="nav-item {active_class}">{label}</a>'

    content_html = {
        'overview': get_overview_content(),
        'keys': get_keys_content(),
        'usage': get_usage_content(),
        'account': get_account_content(user),
    }.get(active_page, get_overview_content())

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - Cloak API</title>
    {COMMON_STYLES}
    <style>
        .dashboard-layout {{
            display: flex;
            min-height: 100vh;
        }}
        .sidebar {{
            width: 250px;
            background: rgba(0, 0, 0, 0.3);
            border-right: 1px solid rgba(255, 255, 255, 0.1);
            padding: 1.5rem;
            position: fixed;
            height: 100vh;
            overflow-y: auto;
        }}
        .sidebar-logo {{
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 2rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }}
        .nav-item {{
            display: block;
            padding: 0.75rem 1rem;
            color: #a1a1aa;
            text-decoration: none;
            border-radius: 8px;
            margin-bottom: 0.25rem;
            transition: all 0.2s;
        }}
        .nav-item:hover {{
            background: rgba(255, 255, 255, 0.1);
            color: #e4e4e7;
            text-decoration: none;
        }}
        .nav-item.active {{
            background: rgba(99, 102, 241, 0.2);
            color: #818cf8;
        }}
        .main-content {{
            flex: 1;
            margin-left: 250px;
            padding: 2rem;
        }}
        .page-header {{
            margin-bottom: 2rem;
        }}
        .page-header h1 {{
            font-size: 1.75rem;
            margin-bottom: 0.5rem;
        }}
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }}
        .stat-card {{
            padding: 1.25rem;
        }}
        .stat-value {{
            font-size: 2rem;
            font-weight: 700;
            color: #818cf8;
        }}
        .stat-label {{
            color: #71717a;
            font-size: 0.875rem;
            margin-top: 0.25rem;
        }}
        .user-menu {{
            margin-top: auto;
            padding-top: 2rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }}
        .user-email {{
            font-size: 0.875rem;
            color: #71717a;
            margin-bottom: 0.5rem;
            word-break: break-all;
        }}
        .key-item {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }}
        .key-item:last-child {{
            border-bottom: none;
        }}
        .key-prefix {{
            font-family: monospace;
            background: rgba(0, 0, 0, 0.3);
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.875rem;
        }}
        .key-status {{
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
        }}
        .key-status.active {{
            background: rgba(34, 197, 94, 0.2);
            color: #86efac;
        }}
        .key-status.revoked {{
            background: rgba(239, 68, 68, 0.2);
            color: #fca5a5;
        }}
        .modal {{
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }}
        .modal.active {{
            display: flex;
        }}
        .modal-content {{
            background: #1a1a2e;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 1.5rem;
            max-width: 500px;
            width: 90%;
        }}
        .modal-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }}
        .modal-close {{
            background: none;
            border: none;
            color: #71717a;
            font-size: 1.5rem;
            cursor: pointer;
        }}
        .key-display {{
            background: rgba(0, 0, 0, 0.3);
            padding: 1rem;
            border-radius: 8px;
            font-family: monospace;
            word-break: break-all;
            margin: 1rem 0;
        }}
        .copy-btn {{
            background: rgba(99, 102, 241, 0.2);
            color: #818cf8;
            border: 1px solid rgba(99, 102, 241, 0.3);
            padding: 0.5rem 1rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.875rem;
        }}
        .warning {{
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.3);
            color: #fbbf24;
            padding: 0.75rem 1rem;
            border-radius: 8px;
            font-size: 0.875rem;
            margin-bottom: 1rem;
        }}
        @media (max-width: 768px) {{
            .sidebar {{
                display: none;
            }}
            .main-content {{
                margin-left: 0;
            }}
        }}
    </style>
</head>
<body>
    <div class="dashboard-layout">
        <aside class="sidebar">
            <div class="sidebar-logo">
                🔐 Cloak
            </div>
            <nav>
                {nav_html}
            </nav>
            <div class="user-menu">
                <div class="user-email">{user['email']}</div>
                <a href="/logout" class="nav-item">Logout</a>
            </div>
        </aside>

        <main class="main-content">
            {content_html}
        </main>
    </div>
</body>
</html>
'''


def get_overview_content():
    return '''
    <div class="page-header">
        <h1>Dashboard</h1>
        <p class="text-muted">Overview of your Cloak API usage</p>
    </div>

    <div class="stats-grid" id="statsGrid">
        <div class="card stat-card">
            <div class="stat-value" id="activeKeys">-</div>
            <div class="stat-label">Active API Keys</div>
        </div>
        <div class="card stat-card">
            <div class="stat-value" id="totalRequests">-</div>
            <div class="stat-label">Total Requests</div>
        </div>
        <div class="card stat-card">
            <div class="stat-value" id="charsThisMonth">-</div>
            <div class="stat-label">Characters This Month</div>
        </div>
        <div class="card stat-card">
            <div class="stat-value" id="requestsWeek">-</div>
            <div class="stat-label">Requests (7 days)</div>
        </div>
    </div>

    <div class="card">
        <h3 style="margin-bottom: 1rem;">Quick Start</h3>
        <p class="text-muted" style="margin-bottom: 1rem;">
            Get started by creating an API key and integrating Cloak into your website.
        </p>
        <a href="/dashboard/keys" class="btn btn-primary">Create API Key</a>
        <a href="/docs" class="btn btn-secondary" style="margin-left: 0.5rem;">View Documentation</a>
    </div>

    <script>
        async function loadStats() {
            try {
                const res = await fetch('/api/dashboard/stats');
                const stats = await res.json();

                document.getElementById('activeKeys').textContent = stats.active_keys || 0;
                document.getElementById('totalRequests').textContent = formatNumber(stats.total_requests || 0);
                document.getElementById('charsThisMonth').textContent = formatNumber(stats.chars_this_month || 0);
                document.getElementById('requestsWeek').textContent = formatNumber(stats.requests_last_7_days || 0);
            } catch (err) {
                console.error('Failed to load stats:', err);
            }
        }

        function formatNumber(num) {
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toString();
        }

        loadStats();
    </script>
    '''


def get_keys_content():
    return '''
    <div class="page-header">
        <h1>API Keys</h1>
        <p class="text-muted">Manage your API keys for accessing Cloak</p>
    </div>

    <div style="margin-bottom: 1.5rem;">
        <button class="btn btn-primary" onclick="showCreateModal()">+ Create New Key</button>
    </div>

    <div class="card" id="keysContainer">
        <p class="text-muted text-center" style="padding: 2rem;">Loading keys...</p>
    </div>

    <!-- Create Key Modal -->
    <div class="modal" id="createModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Create API Key</h3>
                <button class="modal-close" onclick="hideCreateModal()">&times;</button>
            </div>
            <form id="createKeyForm">
                <div class="form-group">
                    <label for="keyName">Key Name (optional)</label>
                    <input type="text" id="keyName" class="input" placeholder="e.g., Production Site">
                </div>
                <div class="form-group">
                    <label for="domains">Allowed Domains (optional, comma-separated)</label>
                    <input type="text" id="domains" class="input" placeholder="e.g., example.com, *.example.com">
                </div>
                <div id="createError" class="error-message" style="display: none;"></div>
                <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">Create Key</button>
            </form>
        </div>
    </div>

    <!-- Show Key Modal -->
    <div class="modal" id="keyModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>API Key Created</h3>
                <button class="modal-close" onclick="hideKeyModal()">&times;</button>
            </div>
            <div class="warning">
                ⚠️ Copy this key now. You won't be able to see it again!
            </div>
            <div class="key-display" id="newKeyDisplay"></div>
            <button class="copy-btn" onclick="copyKey()">Copy to Clipboard</button>
        </div>
    </div>

    <script>
        let newKey = '';

        async function loadKeys() {
            try {
                const res = await fetch('/api/dashboard/keys');
                const data = await res.json();

                const container = document.getElementById('keysContainer');

                if (!data.keys || data.keys.length === 0) {
                    container.innerHTML = '<p class="text-muted text-center" style="padding: 2rem;">No API keys yet. Create one to get started.</p>';
                    return;
                }

                let html = '';
                for (const key of data.keys) {
                    const statusClass = key.is_active ? 'active' : 'revoked';
                    const statusText = key.is_active ? 'Active' : 'Revoked';
                    const revokeBtn = key.is_active
                        ? `<button class="btn btn-danger" onclick="revokeKey(${key.id})">Revoke</button>`
                        : '';

                    html += `
                        <div class="key-item">
                            <div>
                                <div style="margin-bottom: 0.5rem;">
                                    <strong>${key.name || 'Unnamed Key'}</strong>
                                    <span class="key-status ${statusClass}">${statusText}</span>
                                </div>
                                <code class="key-prefix">${key.key_prefix}...</code>
                                <span class="text-muted" style="margin-left: 1rem; font-size: 0.875rem;">
                                    Created: ${new Date(key.created_at).toLocaleDateString()}
                                </span>
                            </div>
                            <div>
                                ${revokeBtn}
                            </div>
                        </div>
                    `;
                }

                container.innerHTML = html;
            } catch (err) {
                console.error('Failed to load keys:', err);
            }
        }

        function showCreateModal() {
            document.getElementById('createModal').classList.add('active');
        }

        function hideCreateModal() {
            document.getElementById('createModal').classList.remove('active');
            document.getElementById('createKeyForm').reset();
        }

        function hideKeyModal() {
            document.getElementById('keyModal').classList.remove('active');
            loadKeys();
        }

        function copyKey() {
            navigator.clipboard.writeText(newKey);
            document.querySelector('.copy-btn').textContent = 'Copied!';
            setTimeout(() => {
                document.querySelector('.copy-btn').textContent = 'Copy to Clipboard';
            }, 2000);
        }

        async function revokeKey(keyId) {
            if (!confirm('Are you sure you want to revoke this key? This action cannot be undone.')) {
                return;
            }

            try {
                const res = await fetch(`/api/dashboard/keys/${keyId}`, { method: 'DELETE' });
                if (res.ok) {
                    loadKeys();
                } else {
                    alert('Failed to revoke key');
                }
            } catch (err) {
                alert('Network error');
            }
        }

        document.getElementById('createKeyForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const errorDiv = document.getElementById('createError');
            errorDiv.style.display = 'none';

            const name = document.getElementById('keyName').value.trim();
            const domainsRaw = document.getElementById('domains').value.trim();
            const allowed_domains = domainsRaw ? domainsRaw.split(',').map(d => d.trim()).filter(d => d) : [];

            try {
                const res = await fetch('/api/dashboard/keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, allowed_domains })
                });

                const data = await res.json();

                if (res.ok) {
                    hideCreateModal();
                    newKey = data.key;
                    document.getElementById('newKeyDisplay').textContent = newKey;
                    document.getElementById('keyModal').classList.add('active');
                } else {
                    errorDiv.textContent = data.error || 'Failed to create key';
                    errorDiv.style.display = 'block';
                }
            } catch (err) {
                errorDiv.textContent = 'Network error';
                errorDiv.style.display = 'block';
            }
        });

        loadKeys();
    </script>
    '''


def get_usage_content():
    return '''
    <div class="page-header">
        <h1>Usage</h1>
        <p class="text-muted">Monitor your API usage and statistics</p>
    </div>

    <div class="stats-grid" id="usageStats">
        <div class="card stat-card">
            <div class="stat-value" id="totalChars">-</div>
            <div class="stat-label">Total Characters Encrypted</div>
        </div>
        <div class="card stat-card">
            <div class="stat-value" id="monthlyChars">-</div>
            <div class="stat-label">Characters This Month</div>
        </div>
        <div class="card stat-card">
            <div class="stat-value" id="totalReqs">-</div>
            <div class="stat-label">Total API Requests</div>
        </div>
        <div class="card stat-card">
            <div class="stat-value" id="weekReqs">-</div>
            <div class="stat-label">Requests (Last 7 Days)</div>
        </div>
    </div>

    <div class="card">
        <h3 style="margin-bottom: 1rem;">Usage by API Key</h3>
        <div id="keyUsage">
            <p class="text-muted">Loading...</p>
        </div>
    </div>

    <script>
        async function loadUsage() {
            try {
                const [statsRes, keysRes] = await Promise.all([
                    fetch('/api/dashboard/stats'),
                    fetch('/api/dashboard/keys')
                ]);

                const stats = await statsRes.json();
                const { keys } = await keysRes.json();

                document.getElementById('totalChars').textContent = formatNumber(stats.total_chars_encrypted || 0);
                document.getElementById('monthlyChars').textContent = formatNumber(stats.chars_this_month || 0);
                document.getElementById('totalReqs').textContent = formatNumber(stats.total_requests || 0);
                document.getElementById('weekReqs').textContent = formatNumber(stats.requests_last_7_days || 0);

                // Key usage breakdown
                const container = document.getElementById('keyUsage');
                if (!keys || keys.length === 0) {
                    container.innerHTML = '<p class="text-muted">No API keys yet.</p>';
                    return;
                }

                let html = '<table style="width: 100%; border-collapse: collapse;">';
                html += '<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);"><th style="text-align: left; padding: 0.75rem;">Key</th><th style="text-align: right; padding: 0.75rem;">Requests</th><th style="text-align: right; padding: 0.75rem;">Characters</th><th style="text-align: right; padding: 0.75rem;">This Month</th></tr>';

                for (const key of keys) {
                    html += `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <td style="padding: 0.75rem;">${key.name || key.key_prefix + '...'}</td>
                            <td style="text-align: right; padding: 0.75rem;">${formatNumber(key.total_requests || 0)}</td>
                            <td style="text-align: right; padding: 0.75rem;">${formatNumber(key.total_chars_encrypted || 0)}</td>
                            <td style="text-align: right; padding: 0.75rem;">${formatNumber(key.chars_this_month || 0)}</td>
                        </tr>
                    `;
                }

                html += '</table>';
                container.innerHTML = html;

            } catch (err) {
                console.error('Failed to load usage:', err);
            }
        }

        function formatNumber(num) {
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toString();
        }

        loadUsage();
    </script>
    '''


def get_account_content(user):
    return f'''
    <div class="page-header">
        <h1>Account Settings</h1>
        <p class="text-muted">Manage your account information</p>
    </div>

    <div class="card" style="margin-bottom: 1.5rem;">
        <h3 style="margin-bottom: 1rem;">Profile</h3>
        <form id="profileForm">
            <div class="form-group">
                <label for="name">Name</label>
                <input type="text" id="name" class="input" value="{user.get('name', '') or ''}" placeholder="Your name">
            </div>
            <div class="form-group">
                <label for="email">Email</label>
                <input type="email" id="email" class="input" value="{user['email']}" required>
            </div>
            <div id="profileMessage" style="display: none;"></div>
            <button type="submit" class="btn btn-primary">Save Changes</button>
        </form>
    </div>

    <div class="card" style="margin-bottom: 1.5rem;">
        <h3 style="margin-bottom: 1rem;">Change Password</h3>
        <form id="passwordForm">
            <div class="form-group">
                <label for="currentPassword">Current Password</label>
                <input type="password" id="currentPassword" class="input" required>
            </div>
            <div class="form-group">
                <label for="newPassword">New Password</label>
                <input type="password" id="newPassword" class="input" required minlength="8" placeholder="At least 8 characters">
            </div>
            <div id="passwordMessage" style="display: none;"></div>
            <button type="submit" class="btn btn-primary">Update Password</button>
        </form>
    </div>

    <div class="card">
        <h3 style="margin-bottom: 1rem;">Plan</h3>
        <p>Current plan: <strong style="color: #818cf8;">{user.get('plan', 'free').title()}</strong></p>
        <p class="text-muted" style="margin-top: 0.5rem;">Contact us to upgrade your plan.</p>
    </div>

    <script>
        document.getElementById('profileForm').addEventListener('submit', async (e) => {{
            e.preventDefault();
            const msgDiv = document.getElementById('profileMessage');

            const name = document.getElementById('name').value.trim();
            const email = document.getElementById('email').value.trim();

            try {{
                const res = await fetch('/api/dashboard/account', {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ name, email }})
                }});

                const data = await res.json();

                if (res.ok) {{
                    msgDiv.className = 'success-message';
                    msgDiv.textContent = 'Profile updated successfully';
                }} else {{
                    msgDiv.className = 'error-message';
                    msgDiv.textContent = data.error || 'Update failed';
                }}
                msgDiv.style.display = 'block';
            }} catch (err) {{
                msgDiv.className = 'error-message';
                msgDiv.textContent = 'Network error';
                msgDiv.style.display = 'block';
            }}
        }});

        document.getElementById('passwordForm').addEventListener('submit', async (e) => {{
            e.preventDefault();
            const msgDiv = document.getElementById('passwordMessage');

            const current_password = document.getElementById('currentPassword').value;
            const new_password = document.getElementById('newPassword').value;

            try {{
                const res = await fetch('/api/dashboard/account/password', {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ current_password, new_password }})
                }});

                const data = await res.json();

                if (res.ok) {{
                    msgDiv.className = 'success-message';
                    msgDiv.textContent = 'Password updated successfully';
                    document.getElementById('passwordForm').reset();
                }} else {{
                    msgDiv.className = 'error-message';
                    msgDiv.textContent = data.error || 'Update failed';
                }}
                msgDiv.style.display = 'block';
            }} catch (err) {{
                msgDiv.className = 'error-message';
                msgDiv.textContent = 'Network error';
                msgDiv.style.display = 'block';
            }}
        }});
    </script>
    '''
