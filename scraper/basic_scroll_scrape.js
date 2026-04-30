#!/usr/bin/env node
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { getContextOptionsWithProxy } = require('./proxy_utils');

// Add stealth plugin to avoid bot detection
chromium.use(StealthPlugin());

// Default cookie file path (can be overridden via command line)
const COOKIES_DIR = path.join(__dirname, '..', 'cookies');
const DEFAULT_COOKIE_FILE = 'nyt_cookies.json';

// Realistic browser context options to avoid detection
const BROWSER_CONTEXT_OPTIONS = {
  // Common desktop viewport
  viewport: { width: 1920, height: 1080 },

  // Realistic user agent (Chrome on macOS)
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  // Locale and timezone
  locale: 'en-US',
  timezoneId: 'America/New_York',

  // Geolocation (optional, New York)
  geolocation: { longitude: -73.935242, latitude: 40.730610 },

  // Device scale factor
  deviceScaleFactor: 1,

  // Enable JavaScript
  javaScriptEnabled: true,

  // Bypass CSP for clipboard access
  bypassCSP: true,

  // Ignore HTTPS errors
  ignoreHTTPSErrors: true,
};

// Browser launch args to avoid detection
const BROWSER_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-site-isolation-trials',
  '--disable-web-security',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--window-size=1920,1080',
  '--start-maximized',
];

/**
 * Load cookies from a JSON file into the browser context
 * @param {object} context - Playwright browser context
 * @param {string} cookieFile - Name of the cookie file in the cookies folder
 * @returns {boolean} - True if cookies were loaded successfully
 */
async function loadCookies(context, cookieFile) {
  const cookiePath = path.join(COOKIES_DIR, cookieFile);

  if (!fs.existsSync(cookiePath)) {
    console.log(`Cookie file not found: ${cookiePath}`);
    return false;
  }

  try {
    const cookiesRaw = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));

    // Transform cookies to Playwright format (remove extra fields)
    const cookies = cookiesRaw.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      expires: cookie.expirationDate || -1,
      httpOnly: cookie.httpOnly || false,
      secure: cookie.secure || false,
      sameSite: cookie.sameSite === 'no_restriction' ? 'None' :
                cookie.sameSite === 'lax' ? 'Lax' :
                cookie.sameSite === 'strict' ? 'Strict' : 'Lax'
    }));

    await context.addCookies(cookies);
    console.log(`Loaded ${cookies.length} cookies from ${cookieFile}`);
    return true;
  } catch (error) {
    console.error(`Error loading cookies: ${error.message}`);
    return false;
  }
}

/**
 * Save cookies from the browser context to a JSON file
 * @param {object} context - Playwright browser context
 * @param {string} cookieFile - Name of the cookie file in the cookies folder
 */
async function saveCookies(context, cookieFile) {
  const cookiePath = path.join(COOKIES_DIR, cookieFile);

  try {
    const cookies = await context.cookies();

    // Transform to storage format
    const cookiesForStorage = cookies.map((cookie, index) => ({
      domain: cookie.domain,
      expirationDate: cookie.expires,
      hostOnly: !cookie.domain.startsWith('.'),
      httpOnly: cookie.httpOnly,
      name: cookie.name,
      path: cookie.path,
      sameSite: cookie.sameSite === 'None' ? 'no_restriction' : cookie.sameSite.toLowerCase(),
      secure: cookie.secure,
      session: cookie.expires === -1,
      storeId: '0',
      value: cookie.value,
      id: index + 1
    }));

    fs.writeFileSync(cookiePath, JSON.stringify(cookiesForStorage, null, 2));
    console.log(`Saved ${cookies.length} cookies to ${cookieFile}`);
  } catch (error) {
    console.error(`Error saving cookies: ${error.message}`);
  }
}

async function scrapeWithScrollSelect(url, cookieFile = DEFAULT_COOKIE_FILE) {
  console.log(`Starting scroll-select scrape of: ${url}`);
  console.log(`Using stealth mode to bypass bot detection`);
  console.log(`Cookie file: ${cookieFile}\n`);

  const browser = await chromium.launch({
    headless: false,  // must be false to interact with clipboard
    args: BROWSER_LAUNCH_ARGS,
  });

  // Create context with clipboard permissions, anti-detection options, and proxy
  const contextOptions = getContextOptionsWithProxy({
    ...BROWSER_CONTEXT_OPTIONS,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const context = await browser.newContext(contextOptions);

  // Load cookies if available
  await loadCookies(context, cookieFile);

  const page = await context.newPage();

  // Add anti-detection scripts before page loads
  await page.addInitScript(() => {
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // Override navigator.plugins to look like a real browser
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // Override navigator.languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Override chrome runtime to look like real Chrome
    window.chrome = {
      runtime: {},
    };

    // Override permissions query
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  });

  try {
    // Navigate to the URL
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    // Wait for content to render
    await page.waitForTimeout(3000);

    // Get viewport and page dimensions
    const viewport = page.viewportSize();
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = viewport.height;
    const viewportWidth = viewport.width;

    console.log(`Viewport: ${viewportWidth}x${viewportHeight}`);
    console.log(`Page height: ${pageHeight}`);

    // Scroll to top first
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Calculate scroll parameters
    const scrollSpeed = 500; // pixels per scroll step
    const scrollDelay = 50;  // ms between scroll steps
    const totalScrolls = Math.ceil(pageHeight / scrollSpeed);
    const buffer = 5; // extra scrolls for buffer

    console.log(`Will perform ${totalScrolls + buffer} scroll steps`);

    // Start position: top-left with some margin
    const startX = 10;
    const startY = 10;

    // Click at top-left to start selection
    console.log(`Starting click-drag selection at (${startX}, ${startY})...`);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(200);

    // Drag while scrolling down
    let currentY = startY;
    for (let i = 0; i < totalScrolls + buffer; i++) {
      // Move mouse to bottom-right of current viewport while holding
      currentY = viewportHeight - 20;
      await page.mouse.move(viewportWidth - 20, currentY);

      // Scroll down
      await page.evaluate((speed) => {
        window.scrollBy(0, speed);
      }, scrollSpeed);

      await page.waitForTimeout(scrollDelay);

      // Move mouse back to trigger continued selection
      await page.mouse.move(viewportWidth - 20, viewportHeight - 10);
    }

    // Final move to bottom-right corner
    await page.mouse.move(viewportWidth - 10, viewportHeight - 10);
    await page.waitForTimeout(300);

    // Release mouse button
    console.log('Releasing mouse button...');
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Copy the selected text
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';

    console.log(`Pressing ${modifier}+C to copy...`);
    await page.keyboard.press(`${modifier}+c`);
    await page.waitForTimeout(500);

    // Read from clipboard or selection
    const clipboardText = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch (e) {
        // Fallback: get selected text
        return window.getSelection().toString();
      }
    });

    // Get page title
    const title = await page.title();

    console.log('='.repeat(60));
    console.log(`Page Title: ${title}`);
    console.log('='.repeat(60));
    console.log('\nCopied Text Content:\n');
    console.log(clipboardText);
    console.log('\n' + '='.repeat(60));

    // Save to file
    const outputFile = 'scroll_scraped.txt';
    fs.writeFileSync(outputFile, `Title: ${title}\n\n${clipboardText}`);
    console.log(`\nText saved to: ${outputFile}`);

    // Save updated cookies
    await saveCookies(context, cookieFile);

    return { title, text: clipboardText };

  } catch (error) {
    console.error('Error scraping:', error.message);
  } finally {
    await browser.close();
  }
}

// Parse command line arguments
// Usage: scroll-scrape <url> [cookie_file]
const url = process.argv[2] || 'https://example.com';
const cookieFile = process.argv[3] || DEFAULT_COOKIE_FILE;

scrapeWithScrollSelect(url, cookieFile);
