const fs = require('fs');
const path = require('path');

const PROXIES_FILE = path.join(__dirname, 'proxies.json');

// Track last used proxy index for round-robin rotation
let lastProxyIndex = -1;

// Cache for loaded proxies
let proxyCache = null;
let proxyCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute cache

// Auto-refresh threshold (24 hours)
const AUTO_REFRESH_HOURS = 24;

/**
 * Check if proxies need refreshing based on lastUpdated timestamp
 * @param {object} config - Proxy config with lastUpdated field
 * @returns {boolean} True if proxies are stale
 */
function isProxyListStale(config) {
  if (!config || !config.lastUpdated) return true;

  const lastUpdated = new Date(config.lastUpdated);
  const now = new Date();
  const hoursSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60);

  return hoursSinceUpdate > AUTO_REFRESH_HOURS;
}

/**
 * Auto-refresh proxies if stale
 * @returns {Promise<boolean>} True if refresh was performed
 */
async function autoRefreshProxies() {
  try {
    const { scrapeProxies, saveProxies } = require('./scrape_proxies');
    console.log('Auto-refreshing proxy list...');
    const proxies = await scrapeProxies({ test: false, limit: 1000 });
    if (proxies.length > 0) {
      saveProxies(proxies);
      proxyCache = null; // Clear cache to reload
      return true;
    }
  } catch (error) {
    console.log(`Could not auto-refresh proxies: ${error.message}`);
  }
  return false;
}

/**
 * Load proxies from the proxies.json file
 * @param {boolean} checkStale - Whether to check for stale proxies
 * @returns {object|null} Proxy configuration or null if not found
 */
function loadProxyConfig(checkStale = false) {
  const now = Date.now();

  // Return cached config if still valid
  if (proxyCache && (now - proxyCacheTime) < CACHE_TTL) {
    return proxyCache;
  }

  if (!fs.existsSync(PROXIES_FILE)) {
    console.log('No proxies.json found. Run `node scrape_proxies.js` to fetch proxies.');
    return null;
  }

  try {
    const config = JSON.parse(fs.readFileSync(PROXIES_FILE, 'utf-8'));

    // Filter out example/placeholder proxies
    const validProxies = config.proxies.filter(p =>
      p.server && !p.server.includes('example.com')
    );

    if (validProxies.length === 0) {
      console.log('No valid proxies configured. Run `node scrape_proxies.js` to fetch proxies.');
      return null;
    }

    const result = { ...config, proxies: validProxies };

    // Check if stale and warn user
    if (checkStale && isProxyListStale(config)) {
      console.log(`Proxy list is over ${AUTO_REFRESH_HOURS}h old. Consider running: node scrape_proxies.js`);
    }

    // Update cache
    proxyCache = result;
    proxyCacheTime = now;

    return result;
  } catch (error) {
    console.error(`Error loading proxies: ${error.message}`);
    return null;
  }
}

/**
 * Get a random proxy from the list
 * @param {Array} proxies - Array of proxy objects
 * @returns {object} Selected proxy
 */
function getRandomProxy(proxies) {
  const index = Math.floor(Math.random() * proxies.length);
  return proxies[index];
}

/**
 * Get the next proxy in round-robin order
 * @param {Array} proxies - Array of proxy objects
 * @returns {object} Selected proxy
 */
function getRoundRobinProxy(proxies) {
  lastProxyIndex = (lastProxyIndex + 1) % proxies.length;
  return proxies[lastProxyIndex];
}

/**
 * Get a proxy for use with Playwright
 * @param {string} rotation - Rotation strategy: 'random' or 'round-robin'
 * @returns {object|null} Playwright proxy config or null
 */
function getProxy(rotation = 'random') {
  const config = loadProxyConfig(true); // Check if stale

  if (!config || config.proxies.length === 0) {
    return null;
  }

  const proxy = rotation === 'round-robin'
    ? getRoundRobinProxy(config.proxies)
    : getRandomProxy(config.proxies);

  console.log(`Using proxy: ${proxy.server}`);

  // Build Playwright proxy config
  const proxyConfig = {
    server: proxy.server,
  };

  if (proxy.username && proxy.password) {
    proxyConfig.username = proxy.username;
    proxyConfig.password = proxy.password;
  }

  return proxyConfig;
}

/**
 * Get browser context options with proxy
 * @param {object} baseOptions - Base context options
 * @param {string} rotation - Rotation strategy
 * @returns {object} Context options with proxy if available
 */
function getContextOptionsWithProxy(baseOptions, rotation = 'random') {
  const proxy = getProxy(rotation);

  if (proxy) {
    return {
      ...baseOptions,
      proxy,
    };
  }

  return baseOptions;
}

/**
 * Fetch and display current public IP (for verification)
 * @param {object} page - Playwright page object
 */
async function verifyIP(page) {
  try {
    await page.goto('https://api.ipify.org?format=json', { timeout: 10000 });
    const content = await page.textContent('body');
    const { ip } = JSON.parse(content);
    console.log(`Current public IP: ${ip}`);
    return ip;
  } catch (error) {
    console.log('Could not verify IP address');
    return null;
  }
}

module.exports = {
  loadProxyConfig,
  getProxy,
  getContextOptionsWithProxy,
  verifyIP,
  autoRefreshProxies,
  isProxyListStale,
};
