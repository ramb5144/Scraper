#!/usr/bin/env node
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

const PROXIES_FILE = path.join(__dirname, 'proxies.json');


/**
 * Get the next proxy using persistent round-robin rotation
 * Saves the index to proxies.json so it persists across runs
 */
function getNextProxy() {
  if (!fs.existsSync(PROXIES_FILE)) {
    console.log('No proxies.json found.');
    return null;
  }

  try {
    const config = JSON.parse(fs.readFileSync(PROXIES_FILE, 'utf-8'));
    const proxies = config.proxies.filter(p => p.server && !p.server.includes('example.com'));

    if (proxies.length === 0) {
      console.log('No valid proxies configured.');
      return null;
    }

    // Get current index and increment (with wrap-around)
    const currentIndex = (config.lastProxyIndex ?? -1);
    const nextIndex = (currentIndex + 1) % proxies.length;

    // Save the new index back to the file
    config.lastProxyIndex = nextIndex;
    fs.writeFileSync(PROXIES_FILE, JSON.stringify(config, null, 2));

    const selected = proxies[nextIndex];
    console.log(`Using proxy ${nextIndex + 1}/${proxies.length}: ${selected.server}`);

    return {
      server: selected.server,
      username: selected.username || undefined,
      password: selected.password || undefined,
    };
  } catch (error) {
    console.error(`Error loading proxy: ${error.message}`);
    return null;
  }
}

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

  // Bypass CSP
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

async function scrapeText(url, cookieFile = DEFAULT_COOKIE_FILE) {
  console.log(`Starting innerText scrape of: ${url}`);
  console.log(`Using stealth mode to bypass bot detection`);
  console.log(`Cookie file: ${cookieFile}\n`);

  // Get proxy using persistent round-robin (rotates on each run)
  const proxy = getNextProxy();

  const browser = await chromium.launch({
    headless: false,
    args: BROWSER_LAUNCH_ARGS,
  });

  // Create browser context with anti-detection options and proxy
    const contextOptions = {
      ...BROWSER_CONTEXT_OPTIONS,
      ...(proxy && { proxy }),
    };
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
      // Navigate to the URL (use 'load' instead of 'networkidle' for heavy sites with ads)
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });

      // Wait for content to render
      await page.waitForTimeout(3000);

      // Scroll down 567 pixels to get past header ads/overlays
      console.log('Scrolling down 567 pixels to bypass header ads...');
      await page.evaluate(() => window.scrollBy(0, 567));
      await page.waitForTimeout(500);

      // Try to focus on the article container
      console.log('Attempting to focus on article container...');
      const articleSelectors = [
        'article',
        'main',
        '[role="main"]',
        '[role="article"]',
        '.article-body',
        '.story-body',
        '.post-content',
        '.entry-content',
        '.article-content',
        '.story-content',
        '#article-body',
        '#story-body',
      ];

      let focusedOnArticle = false;
      for (const selector of articleSelectors) {
        const el = await page.$(selector);
        if (el) {
          await el.click();
          console.log(`Focused on article container: ${selector}`);
          focusedOnArticle = true;
          break;
        }
      }

      if (!focusedOnArticle) {
        // Fallback: click on body
        console.log('No article container found, falling back to body click');
        await page.click('body');
      }

      await page.waitForTimeout(300);

      // Extract all visible text from the page using innerText
      const pageText = await page.evaluate(() => {
        return document.body.innerText;
      });

      // Get page title
      const title = await page.title();

      console.log('='.repeat(60));
      console.log(`Page Title: ${title}`);
      console.log('='.repeat(60));
      console.log('\nPage Text Content:\n');
      console.log(pageText);
      console.log('\n' + '='.repeat(60));

      // Save to file
      const outputFile = 'scraped_text.txt';
      fs.writeFileSync(outputFile, `Title: ${title}\n\n${pageText}`);
      console.log(`\nText saved to: ${outputFile}`);

      // Save updated cookies
      await saveCookies(context, cookieFile);

      await browser.close();
      return { title, text: pageText };

    } catch (error) {
      await browser.close();
      console.error('Error scraping:', error.message);
      return null;
    }
}

// Parse command line arguments
// Usage: node innertext_scrape.js <url> [cookie_file]
const url = process.argv[2] || 'https://example.com';
const cookieFile = process.argv[3] || DEFAULT_COOKIE_FILE;

scrapeText(url, cookieFile);
