#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Static route handlers.
"""
import os
from flask import request, jsonify, send_from_directory, Response, redirect
from utils.font_utils import DEBUG_MODE

# Project root directory (parent of routes/)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def register_static_routes(app):
    """Register static routes with the Flask app."""

    # Demos directory for demo HTML files
    demos_dir = os.path.join(PROJECT_ROOT, 'demos')

    @app.route('/', methods=['GET'])

    def root():

        """Root endpoint - serve landing page"""

        return """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloak - Protect Your Content from AI Scrapers</title>
    <meta name="description" content="Protect your web content from AI scrapers and unauthorized data harvesting. Cloak keeps your content readable for humans while blocking LLM training.">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔐</text></svg>">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            color: #1a1a2e;
            background: #fafafa;
        }

        /* Navigation */
        .navbar {
            background: rgba(26, 26, 46, 0.95);
            backdrop-filter: blur(10px);
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 1000;
            padding: 0 20px;
        }

        .nav-container {
            max-width: 1200px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
            height: 70px;
        }

        .nav-logo {
            font-size: 1.5rem;
            font-weight: 700;
            color: white;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .nav-links {
            display: flex;
            align-items: center;
            gap: 30px;
        }

        .nav-links a {
            color: rgba(255,255,255,0.8);
            text-decoration: none;
            font-weight: 500;
            transition: color 0.2s;
        }

        .nav-links a:hover {
            color: white;
        }

        .nav-cta {
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white !important;
            padding: 10px 20px;
            border-radius: 8px;
            font-weight: 600;
        }

        .nav-cta:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
        }

        /* Hero Section */
        .hero {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            color: white;
            padding: 160px 20px 100px;
            text-align: center;
            position: relative;
            overflow: hidden;
        }

        .hero::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: radial-gradient(circle at 30% 20%, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
                        radial-gradient(circle at 70% 80%, rgba(139, 92, 246, 0.1) 0%, transparent 50%);
        }

        .hero-content {
            position: relative;
            z-index: 1;
            max-width: 900px;
            margin: 0 auto;
        }

        .hero-badge {
            display: inline-block;
            background: rgba(233, 69, 96, 0.2);
            color: #e94560;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: 600;
            margin-bottom: 25px;
            border: 1px solid rgba(233, 69, 96, 0.3);
        }

        .hero h1 {
            font-size: 4rem;
            font-weight: 800;
            margin-bottom: 25px;
            letter-spacing: -2px;
            line-height: 1.1;
        }

        .hero h1 span {
            background: linear-gradient(135deg, #e94560, #f472b6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .hero .tagline {
            font-size: 1.35rem;
            opacity: 0.9;
            max-width: 650px;
            margin: 0 auto 45px;
            line-height: 1.7;
        }

        .cta-buttons {
            display: flex;
            gap: 20px;
            justify-content: center;
            flex-wrap: wrap;
        }

        .btn {
            padding: 16px 32px;
            border-radius: 10px;
            font-size: 1.1rem;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .btn:hover {
            transform: translateY(-2px);
        }

        .btn-primary {
            background: linear-gradient(135deg, #e94560, #d63251);
            color: white;
            box-shadow: 0 4px 20px rgba(233, 69, 96, 0.4);
        }

        .btn-primary:hover {
            box-shadow: 0 6px 25px rgba(233, 69, 96, 0.5);
        }

        .btn-secondary {
            background: rgba(255,255,255,0.1);
            color: white;
            border: 2px solid rgba(255,255,255,0.3);
            backdrop-filter: blur(10px);
        }

        .btn-secondary:hover {
            background: rgba(255,255,255,0.15);
            border-color: rgba(255,255,255,0.5);
        }

        /* Stats Banner */
        .trust-banner {
            background: white;
            padding: 50px 20px;
            border-bottom: 1px solid #eee;
        }

        .stats-grid {
            max-width: 900px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 40px;
            text-align: center;
        }

        .stat-item {
            padding: 20px;
        }

        .stat-number {
            font-size: 2.5rem;
            font-weight: 800;
            color: #e94560;
            margin-bottom: 8px;
        }

        .stat-label {
            font-size: 0.95rem;
            color: #666;
            line-height: 1.4;
        }

        /* Problem Section */
        .problem-section {
            background: #fff;
            padding: 100px 20px;
        }

        .section-container {
            max-width: 1100px;
            margin: 0 auto;
        }

        .section-header {
            text-align: center;
            margin-bottom: 60px;
        }

        .section-header h2 {
            font-size: 2.5rem;
            color: #1a1a2e;
            margin-bottom: 15px;
        }

        .section-header p {
            color: #666;
            font-size: 1.15rem;
            max-width: 600px;
            margin: 0 auto;
        }

        .problem-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 30px;
        }

        .problem-card {
            background: #f8f9fa;
            padding: 35px;
            border-radius: 16px;
            border: 1px solid #eee;
        }

        .problem-icon {
            font-size: 2.5rem;
            margin-bottom: 20px;
        }

        .problem-card h3 {
            font-size: 1.25rem;
            color: #1a1a2e;
            margin-bottom: 12px;
        }

        .problem-card p {
            color: #666;
            line-height: 1.7;
        }

        /* Features Section */
        .features {
            padding: 100px 20px;
            background: linear-gradient(180deg, #f8f9fa 0%, #fff 100%);
        }

        .features-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 35px;
            max-width: 1100px;
            margin: 0 auto;
        }

        .feature-card {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 4px 25px rgba(0,0,0,0.06);
            border: 1px solid rgba(0,0,0,0.05);
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .feature-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 8px 35px rgba(0,0,0,0.1);
        }

        .feature-icon {
            width: 60px;
            height: 60px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            border-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.8rem;
            margin-bottom: 25px;
        }

        .feature-card h3 {
            font-size: 1.3rem;
            margin-bottom: 12px;
            color: #1a1a2e;
        }

        .feature-card p {
            color: #666;
            font-size: 1rem;
            line-height: 1.7;
        }

        /* Pricing */
        .pricing {
            background: #f8f9fa;
            padding: 100px 20px;
        }

        .pricing-cards {
            max-width: 1000px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 30px;
        }

        .pricing-card {
            background: white;
            padding: 45px;
            border-radius: 20px;
            box-shadow: 0 4px 25px rgba(0,0,0,0.06);
            text-align: center;
            border: 1px solid rgba(0,0,0,0.05);
            position: relative;
        }

        .pricing-card.featured {
            border: 2px solid #6366f1;
            transform: scale(1.05);
        }

        .pricing-card.featured::before {
            content: 'Most Popular';
            position: absolute;
            top: -12px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white;
            padding: 6px 20px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
        }

        .pricing-card h3 {
            font-size: 1.4rem;
            margin-bottom: 10px;
            color: #1a1a2e;
        }

        .price {
            font-size: 3.5rem;
            font-weight: 800;
            color: #1a1a2e;
            margin: 25px 0;
        }

        .price span {
            font-size: 1rem;
            font-weight: 400;
            color: #666;
        }

        .pricing-features {
            list-style: none;
            margin: 30px 0;
            text-align: left;
        }

        .pricing-features li {
            padding: 12px 0;
            color: #555;
            border-bottom: 1px solid #f0f0f0;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .pricing-features li::before {
            content: "\\2713";
            color: #22c55e;
            font-weight: bold;
            font-size: 1.1rem;
        }

        .pricing-features li:last-child {
            border-bottom: none;
        }

        /* CTA Section */
        .cta-section {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            padding: 100px 20px;
            text-align: center;
        }

        .cta-section h2 {
            color: white;
            font-size: 2.5rem;
            margin-bottom: 20px;
        }

        .cta-section p {
            color: rgba(255,255,255,0.8);
            font-size: 1.15rem;
            margin-bottom: 40px;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
        }

        /* Footer */
        footer {
            background: #0a0a14;
            color: white;
            padding: 60px 20px 40px;
        }

        .footer-container {
            max-width: 1100px;
            margin: 0 auto;
        }

        .footer-grid {
            display: grid;
            grid-template-columns: 2fr 1fr 1fr 1fr;
            gap: 60px;
            margin-bottom: 50px;
        }

        .footer-brand h3 {
            font-size: 1.5rem;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .footer-brand p {
            color: rgba(255,255,255,0.6);
            line-height: 1.7;
        }

        .footer-links h4 {
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 20px;
            color: rgba(255,255,255,0.5);
        }

        .footer-links a {
            display: block;
            color: rgba(255,255,255,0.8);
            text-decoration: none;
            margin-bottom: 12px;
            transition: color 0.2s;
        }

        .footer-links a:hover {
            color: white;
        }

        .footer-bottom {
            border-top: 1px solid rgba(255,255,255,0.1);
            padding-top: 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 20px;
        }

        .footer-bottom p {
            color: rgba(255,255,255,0.5);
            font-size: 0.9rem;
        }

        /* Responsive */
        @media (max-width: 968px) {
            .problem-grid {
                grid-template-columns: 1fr;
            }
            .footer-grid {
                grid-template-columns: 1fr 1fr;
                gap: 40px;
            }
            .stats-grid {
                grid-template-columns: 1fr;
                gap: 20px;
            }
        }

        @media (max-width: 768px) {
            .nav-links {
                display: none;
            }
            .hero { padding: 140px 20px 80px; }
            .hero h1 { font-size: 2.5rem; }
            .hero .tagline { font-size: 1.1rem; }
            .section-header h2 { font-size: 2rem; }
            .pricing-card.featured { transform: scale(1); }
            .footer-grid { grid-template-columns: 1fr; gap: 30px; }
            .footer-bottom { flex-direction: column; text-align: center; }
            .stat-number { font-size: 2rem; }
        }
    </style>
</head>
<body>
    <!-- Navigation -->
    <nav class="navbar">
        <div class="nav-container">
            <a href="/" class="nav-logo">🔐 Cloak</a>
            <div class="nav-links">
                <a href="#features">Features</a>
                <a href="#pricing">Pricing</a>
                <a href="mailto:founders@cloaktext.com">Contact</a>
            </div>
        </div>
    </nav>

    <!-- Hero -->
    <section class="hero">
        <div class="hero-content">
            <div class="hero-badge">Content Protection for the AI Era</div>
            <h1>Cloak</h1>
            <p class="tagline">AI companies are harvesting your content to train their models—without permission or payment. Cloak lets you take back control. Your readers see everything perfectly. Scrapers get nothing.</p>
            <div class="cta-buttons">
                <a href="mailto:founders@cloaktext.com" class="btn btn-primary">Get Early Access →</a>
                <a href="#features" class="btn btn-secondary">Learn More</a>
            </div>
        </div>
    </section>

    <!-- Problem Section -->
    <section class="problem-section">
        <div class="section-container">
            <div class="section-header">
                <h2>The Problem with AI Scraping</h2>
                <p>AI companies are training on your content without permission or compensation</p>
            </div>
            <div class="problem-grid">
                <div class="problem-card">
                    <div class="problem-icon">🤖</div>
                    <h3>LLMs Train on Your Content</h3>
                    <p>GPT-4, Claude, and other LLMs are trained on web content. Your articles become their knowledge without credit or payment.</p>
                </div>
                <div class="problem-card">
                    <div class="problem-icon">⚖️</div>
                    <h3>Legal Battles Are Expensive</h3>
                    <p>The New York Times sued OpenAI, but not everyone can afford legal action. You need protection now.</p>
                </div>
                <div class="problem-card">
                    <div class="problem-icon">🚫</div>
                    <h3>Traditional Methods Fail</h3>
                    <p>Paywalls hurt SEO. CAPTCHAs frustrate users. Bot detection is easily bypassed. You need a better solution.</p>
                </div>
            </div>
        </div>
    </section>

    <!-- Features -->
    <section class="features" id="features">
        <div class="section-header">
            <h2>Why Publishers Choose Cloak</h2>
            <p>Enterprise-grade protection that keeps your content safe</p>
        </div>
        <div class="features-grid">
            <div class="feature-card">
                <div class="feature-icon">🛡️</div>
                <h3>Block AI Training</h3>
                <p>Stop your content from being harvested to train language models. Your intellectual property stays yours.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">👁️</div>
                <h3>Invisible to Readers</h3>
                <p>Your audience reads, copies, searches, and interacts with content normally. Protection happens behind the scenes.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">⚡</div>
                <h3>No Performance Hit</h3>
                <p>Protection adds virtually zero latency. Your pages load just as fast as they did before.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">🔍</div>
                <h3>Preserve SEO Rankings</h3>
                <p>Maintain full search engine visibility. Authorized crawlers see your content, scrapers don't.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">🔧</div>
                <h3>Works Everywhere</h3>
                <p>One integration works with any platform—WordPress, Next.js, custom CMSs. Deploy in minutes.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">📊</div>
                <h3>Complete Visibility</h3>
                <p>See exactly what's protected, track usage, and monitor for suspicious scraping activity.</p>
            </div>
        </div>
    </section>

    <!-- Pricing -->
    <section class="pricing" id="pricing">
        <div class="section-header">
            <h2>Simple, Transparent Pricing</h2>
            <p>Start free, scale as you grow.</p>
        </div>
        <div class="pricing-cards">
            <div class="pricing-card">
                <h3>Free</h3>
                <div class="price">$0<span>/year</span></div>
                <ul class="pricing-features">
                    <li>20 HTML pages/month or less</li>
                    <li>For small websites</li>
                    <li>Publishers, businesses, blogs</li>
                    <li>Standard support</li>
                </ul>
                <a href="mailto:founders@cloaktext.com" class="btn btn-secondary" style="width: 100%; color: #1a1a2e; border-color: #1a1a2e;">Get Started</a>
            </div>
            <div class="pricing-card featured">
                <h3>Enterprise</h3>
                <div class="price">$200k<span>/year</span></div>
                <ul class="pricing-features">
                    <li>2,000 HTML pages/month or less</li>
                    <li>For mid-sized news publishers</li>
                    <li>Priority support</li>
                    <li>Dedicated account manager</li>
                </ul>
                <a href="mailto:founders@cloaktext.com" class="btn btn-primary" style="width: 100%;">Contact Sales</a>
            </div>
            <div class="pricing-card">
                <h3>Enterprise+</h3>
                <div class="price">+$10<span>/page</span></div>
                <ul class="pricing-features">
                    <li>Above 2,000 HTML pages/month</li>
                    <li>Enterprise pricing ($200k/year)</li>
                    <li>Plus $10 per additional page</li>
                    <li>For large publishers</li>
                </ul>
                <a href="mailto:founders@cloaktext.com" class="btn btn-secondary" style="width: 100%; color: #1a1a2e; border-color: #1a1a2e;">Contact Sales</a>
            </div>
        </div>
    </section>

    <!-- CTA Section -->
    <section class="cta-section">
        <h2>Stop Losing Your Content to AI</h2>
        <p>Every day you wait, more of your work gets scraped and used to train AI models. Take back control now.</p>
        <div class="cta-buttons">
            <a href="mailto:founders@cloaktext.com" class="btn btn-primary">Get Early Access →</a>
        </div>
    </section>

    <!-- Footer -->
    <footer>
        <div class="footer-container">
            <div class="footer-grid">
                <div class="footer-brand">
                    <h3>🔐 Cloak</h3>
                    <p>Content protection for the AI era. Keep your intellectual property safe from unauthorized scraping and LLM training.</p>
                </div>
                <div class="footer-links">
                    <h4>Product</h4>
                    <a href="#features">Features</a>
                    <a href="#pricing">Pricing</a>
                </div>
                <div class="footer-links">
                    <h4>Company</h4>
                    <a href="mailto:founders@cloaktext.com">Contact</a>
                </div>
                <div class="footer-links">
                    <h4>Support</h4>
                    <a href="mailto:founders@cloaktext.com">Get Help</a>
                </div>
            </div>
            <div class="footer-bottom">
                <p>&copy; 2025 Cloak. Protect your content.</p>
                <p>Built to stop AI scraping.</p>
            </div>
        </div>
    </footer>
</body>
</html>
        """



    @app.route('/docs', methods=['GET'])
    def docs():
        """Docs page removed - redirects to home"""
        return redirect('/')


    @app.route('/demo', methods=['GET'])
    def demo_page():
        """Demo page removed - redirects to home"""
        return redirect('/')

    @app.route('/customer-discovery', methods=['GET'])
    def customer_discovery():
        """Customer Discovery Summary PDF page"""
        return send_from_directory(PROJECT_ROOT, 'customer_discovery_pdf.html')

    @app.route('/pdf-test', methods=['GET'])
    def pdf_test():
        """PDF encryption API test page"""
        return send_from_directory(demos_dir, 'pdf-test.html')

    @app.route('/test-localhost', methods=['GET'])
    def test_localhost():
        """Comprehensive test page for SDK encryption"""
        return send_from_directory(demos_dir, 'test-localhost.html')

    @app.route('/test-localhost-plain', methods=['GET'])
    def test_localhost_plain():
        """Plain version of test page (no encryption) for comparison"""
        return send_from_directory(demos_dir, 'test-localhost-plain.html')

    @app.route('/test-webfonts', methods=['GET'])
    def test_webfonts():
        """Test page using Google Fonts (Playfair Display, Lora, Inter) - encrypted"""
        return send_from_directory(demos_dir, 'test-localhost-webfonts.html')

    @app.route('/test-webfonts-plain', methods=['GET'])
    def test_webfonts_plain():
        """Plain version of web fonts test page (no encryption) for comparison"""
        return send_from_directory(demos_dir, 'test-localhost-webfonts-plain.html')

    @app.route('/nyt', methods=['GET'])

    def nyt():

        """NYT article page with encryption"""

        return send_from_directory(demos_dir, 'nyt.html')



    @app.route('/client/encrypt-page.js', methods=['GET'])

    def serve_encrypt_page_script():

        """Serve the automatic page encryption client script"""

        client_dir = os.path.join(PROJECT_ROOT, 'client')

        return send_from_directory(client_dir, 'encrypt-page.js', mimetype='application/javascript')



    @app.route('/client/decrypt-interceptor.js', methods=['GET'])

    def serve_decrypt_interceptor_script():

        """Serve the decryption interceptor script for server-side encrypted pages"""

        client_dir = os.path.join(PROJECT_ROOT, 'client')

        return send_from_directory(client_dir, 'decrypt-interceptor.js', mimetype='application/javascript')


    @app.route('/client/cloak-sdk.js', methods=['GET'])
    def serve_cloak_sdk_script():
        """Serve the Cloak SDK for client-side encryption"""
        client_dir = os.path.join(PROJECT_ROOT, 'client')
        return send_from_directory(client_dir, 'cloak-sdk.js', mimetype='application/javascript')


    @app.route('/sdk-test', methods=['GET'])
    def serve_sdk_test_page():
        """Serve the SDK test page"""
        return send_from_directory(demos_dir, 'sdk-test.html', mimetype='text/html')

    @app.route('/dynamic-test', methods=['GET'])
    def serve_dynamic_test_page():
        """Realistic dynamic test page simulating a news site with SDK encryption"""
        return send_from_directory(demos_dir, 'dynamic-test.html', mimetype='text/html')

    @app.route('/dynamic-test-plain', methods=['GET'])
    def serve_dynamic_test_plain_page():
        """Plain version of dynamic test page (no encryption) for comparison"""
        return send_from_directory(demos_dir, 'dynamic-test-plain.html', mimetype='text/html')

    @app.route('/stackoverflow-demo', methods=['GET'])
    def serve_stackoverflow_demo():
        """Stack Overflow demo page with Cloak SDK integration"""
        return send_from_directory(demos_dir, 'stackoverflow.html', mimetype='text/html')

    @app.route('/test-stackoverflow', methods=['GET'])
    def serve_test_stackoverflow():
        """Test page to debug Stack Overflow content"""
        return send_from_directory(demos_dir, 'test-stackoverflow.html', mimetype='text/html')

    @app.route('/stackoverflow-no-sdk', methods=['GET'])
    def serve_stackoverflow_no_sdk():
        """Stack Overflow page without SDK for comparison"""
        return send_from_directory(demos_dir, 'stackoverflow-no-sdk.html', mimetype='text/html')

    @app.route('/test-form-exclusions', methods=['GET'])
    def serve_test_form_exclusions():
        """Test page for form element and contenteditable exclusions"""
        return send_from_directory(demos_dir, 'test-form-exclusions.html', mimetype='text/html')


    # Proxy endpoint to serve R2 fonts with CORS headers
    # NO FALLBACK - only serves from R2
    # Supports both root-level fonts and storage-specific fonts: storage/{storage_id}/fonts/{filename}


    @app.route('/proxy-font/<path:font_path>')
    def proxy_font(font_path):
        """
        Proxy font files from R2 to avoid CORS issues.
        Uses S3 API directly (not public URL) for reliable access.
        Supports both root-level fonts and website-specific fonts.
        NO FALLBACK - only serves from R2.

        Examples:
            /proxy-font/decryption_abc123.woff2
            /proxy-font/storage/abc123/fonts/decryption_abc123.woff2
        """
        from utils.r2_website_storage import get_r2_client
        from botocore.exceptions import ClientError as BotoClientError
        
        try:
            s3_client, r2_bucket = get_r2_client()
            
            # Fetch font directly from R2 via S3 API
            response = s3_client.get_object(Bucket=r2_bucket, Key=font_path)
            font_data = response['Body'].read()
            
            if DEBUG_MODE:
                print(f"✅ Served font from R2: {font_path} ({len(font_data)} bytes)")
            
            # Determine content type based on extension
            content_type = 'font/woff2'
            if font_path.endswith('.woff'):
                content_type = 'font/woff'
            elif font_path.endswith('.ttf'):
                content_type = 'font/ttf'
            elif font_path.endswith('.otf'):
                content_type = 'font/otf'
            
            # Return font with proper headers
            from flask import Response
            return Response(
                font_data,
                mimetype=content_type,
                headers={
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                    'Cache-Control': 'public, max-age=31536000',
                    'Access-Control-Allow-Headers': '*',
                    'Content-Length': str(len(font_data))
                }
            )
        except BotoClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            if error_code == 'NoSuchKey':
                if DEBUG_MODE:
                    print(f"❌ Font not found in R2: {font_path}")
                return jsonify({'error': f'Font not found: {font_path}'}), 404
            else:
                if DEBUG_MODE:
                    print(f"❌ R2 error for {font_path}: {e}")
                return jsonify({'error': f'R2 error: {str(e)}'}), 500
        except Exception as e:
            if DEBUG_MODE:
                print(f"❌ Error serving font {font_path}: {e}")
            return jsonify({'error': f'Error: {str(e)}'}), 500


