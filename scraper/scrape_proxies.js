#!/usr/bin/env node
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROXIES_FILE = path.join(__dirname, 'proxies.json');
const MAX_PROXIES = 1000;
const TEST_TIMEOUT = 5000; // 5 seconds timeout for proxy testing
const CONCURRENT_TESTS = 50; // Number of concurrent proxy tests

// Public proxy list sources (APIs that return JSON/plain text)
const PROXY_SOURCES = [
  {
    name: 'ProxyScrape HTTP',
    url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
    parser: parseProxyList,
  },
  {
    name: 'ProxyScrape SOCKS4',
    url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&timeout=10000&country=all',
    parser: parseProxyList,
    type: 'socks4',
  },
  {
    name: 'ProxyScrape SOCKS5',
    url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all',
    parser: parseProxyList,
    type: 'socks5',
  },
  {
    name: 'TheSpeedX HTTP',
    url: 'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
    parser: parseProxyList,
  },
  {
    name: 'TheSpeedX SOCKS5',
    url: 'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
    parser: parseProxyList,
    type: 'socks5',
  },
  {
    name: 'Clarketm Proxy List',
    url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
    parser: parseProxyList,
  },
  {
    name: 'ShiftyTR Proxy List',
    url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
    parser: parseProxyList,
  },
  {
    name: 'ShiftyTR SOCKS5',
    url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt',
    parser: parseProxyList,
    type: 'socks5',
  },
  {
    name: 'MuRongPIG HTTP',
    url: 'https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/http.txt',
    parser: parseProxyList,
  },
  {
    name: 'Monosans HTTP',
    url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    parser: parseProxyList,
  },
  {
    name: 'Monosans SOCKS5',
    url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
    parser: parseProxyList,
    type: 'socks5',
  },
  {
    name: 'Hookzof HTTP',
    url: 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
    parser: parseProxyList,
  },
];

/**
 * Fetch URL content
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: 15000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow redirect
        fetchUrl(response.headers.location).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
  });
}

/**
 * Parse a plain text list of proxies (ip:port format)
 */
function parseProxyList(text, type = 'http') {
  const lines = text.split('\n');
  const proxies = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Match IP:PORT pattern
    const match = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/);
    if (match) {
      const [, ip, port] = match;
      const protocol = type === 'socks5' ? 'socks5' : type === 'socks4' ? 'socks4' : 'http';
      proxies.push({
        server: `${protocol}://${ip}:${port}`,
        username: '',
        password: '',
      });
    }
  }

  return proxies;
}

/**
 * Test if a proxy is working by making a request through it
 */
function testProxy(proxy) {
  return new Promise((resolve) => {
    const serverUrl = new URL(proxy.server);
    const isHttpProxy = serverUrl.protocol === 'http:' || serverUrl.protocol === 'https:';

    if (!isHttpProxy) {
      // For SOCKS proxies, we can't easily test without additional libraries
      // Mark as untested but include them
      resolve({ proxy, working: true, untested: true });
      return;
    }

    const options = {
      hostname: serverUrl.hostname,
      port: serverUrl.port,
      path: 'http://httpbin.org/ip',
      method: 'GET',
      timeout: TEST_TIMEOUT,
      headers: {
        'Host': 'httpbin.org',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 && data.includes('origin')) {
          resolve({ proxy, working: true, response: data });
        } else {
          resolve({ proxy, working: false });
        }
      });
    });

    req.on('error', () => resolve({ proxy, working: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ proxy, working: false });
    });

    req.end();
  });
}

/**
 * Test proxies in batches
 */
async function testProxiesInBatches(proxies, batchSize = CONCURRENT_TESTS) {
  const working = [];
  const total = proxies.length;
  let tested = 0;

  console.log(`\nTesting ${total} proxies (${batchSize} concurrent)...`);

  for (let i = 0; i < proxies.length; i += batchSize) {
    const batch = proxies.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(testProxy));

    for (const result of results) {
      if (result.working) {
        working.push(result.proxy);
      }
    }

    tested += batch.length;
    const percent = ((tested / total) * 100).toFixed(1);
    process.stdout.write(`\rProgress: ${tested}/${total} (${percent}%) - Found ${working.length} working proxies`);
  }

  console.log('\n');
  return working;
}

/**
 * Remove duplicate proxies
 */
function deduplicateProxies(proxies) {
  const seen = new Set();
  return proxies.filter(proxy => {
    if (seen.has(proxy.server)) {
      return false;
    }
    seen.add(proxy.server);
    return true;
  });
}

/**
 * Main function to scrape proxies from all sources
 */
async function scrapeProxies(options = {}) {
  const { test = false, limit = MAX_PROXIES } = options;
  let allProxies = [];

  console.log('='.repeat(60));
  console.log('Public Proxy Scraper');
  console.log('='.repeat(60));
  console.log(`\nFetching proxies from ${PROXY_SOURCES.length} sources...\n`);

  for (const source of PROXY_SOURCES) {
    try {
      process.stdout.write(`Fetching from ${source.name}... `);
      const content = await fetchUrl(source.url);
      const proxies = source.parser(content, source.type);
      console.log(`found ${proxies.length} proxies`);
      allProxies = allProxies.concat(proxies);
    } catch (error) {
      console.log(`failed: ${error.message}`);
    }
  }

  console.log(`\nTotal proxies fetched: ${allProxies.length}`);

  // Remove duplicates
  allProxies = deduplicateProxies(allProxies);
  console.log(`After deduplication: ${allProxies.length}`);

  // Shuffle the proxies for randomness
  allProxies.sort(() => Math.random() - 0.5);

  // Test proxies if requested
  if (test) {
    allProxies = await testProxiesInBatches(allProxies);
    console.log(`Working proxies: ${allProxies.length}`);
  }

  // Limit to max
  if (allProxies.length > limit) {
    allProxies = allProxies.slice(0, limit);
    console.log(`Limited to ${limit} proxies`);
  }

  return allProxies;
}

/**
 * Save proxies to proxies.json
 */
function saveProxies(proxies) {
  const config = {
    proxies,
    rotation: 'random',
    lastUpdated: new Date().toISOString(),
    notes: 'Auto-scraped public proxies. Run `node scrape_proxies.js` to refresh.',
  };

  fs.writeFileSync(PROXIES_FILE, JSON.stringify(config, null, 2));
  console.log(`\nSaved ${proxies.length} proxies to ${PROXIES_FILE}`);
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const showHelp = args.includes('--help') || args.includes('-h');
  const testProxies = args.includes('--test') || args.includes('-t');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : MAX_PROXIES;

  if (showHelp) {
    console.log(`
Usage: node scrape_proxies.js [options]

Options:
  --test, -t      Test each proxy before saving (slower but more reliable)
  --limit=N       Maximum number of proxies to save (default: ${MAX_PROXIES})
  --help, -h      Show this help message

Examples:
  node scrape_proxies.js                    # Scrape up to 1000 proxies
  node scrape_proxies.js --test             # Scrape and test proxies
  node scrape_proxies.js --limit=500        # Scrape up to 500 proxies
  node scrape_proxies.js --test --limit=100 # Scrape, test, keep best 100
`);
    return;
  }

  try {
    const proxies = await scrapeProxies({ test: testProxies, limit });

    if (proxies.length === 0) {
      console.log('\nNo proxies found! Check your internet connection.');
      return;
    }

    saveProxies(proxies);

    // Show sample
    console.log('\nSample proxies:');
    proxies.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.server}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('Done! Your scraper will now use rotating proxies.');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

module.exports = { scrapeProxies, saveProxies, testProxy };

// Run if executed directly
if (require.main === module) {
  main();
}
