// === CONFIG ===
// Configuration proxy, API helpers, decrypt/encrypt functions

// CRITICAL: Access window.encryptionConfig dynamically via getter to ensure we always
// read the current value, not a stale snapshot from module load time.
// This fixes race conditions where cloak-sdk.js sets window.encryptionConfig
// after this script starts loading but before functions are called.
const encryptionConfig = new Proxy({}, {
    get(target, prop) {
        const config = window.encryptionConfig || {};
        return config[prop];
    }
});

// Debug: Log script initialization
console.log('%c\uD83D\uDD13 Decrypt Interceptor Loading...', 'color: #9C27B0; font-weight: bold; font-size: 14px;');

// Validate configuration
const configStatus = {
    'Hash': encryptionConfig.hash ? '\u2705 Set' : '\u274C Missing',
    'Secret Key (backward compat)': encryptionConfig.secretKey ? '\u2705 Set' : '\u26A0\uFE0F Not set',
    'Nonce (backward compat)': encryptionConfig.nonce ? '\u2705 Set' : '\u26A0\uFE0F Not set',
    'Website ID': encryptionConfig.websiteId ? '\u2705 Set' : '\u26A0\uFE0F Not set (lazy encryption disabled)',
    'API Base URL': encryptionConfig.apiBaseUrl ? '\u2705 Set' : '\u274C Missing',
    'API Key': encryptionConfig.apiKey ? '\u2705 Set' : '\u274C Missing (search/copy disabled)'
};

/**
 * Get common headers for API requests including API key
 */
function getApiHeaders() {
    const headers = {
        'Content-Type': 'application/json'
    };
    // Debug: Check what we're getting from the Proxy
    const apiKey = encryptionConfig.apiKey;
    console.log('%c\uD83D\uDD11 getApiHeaders() called', 'color: #E91E63; font-weight: bold;');
    console.log('  - encryptionConfig.apiKey:', apiKey ? `"${apiKey.substring(0, 8)}..."` : 'undefined/null');
    console.log('  - window.encryptionConfig:', window.encryptionConfig);
    console.log('  - window.encryptionConfig?.apiKey:', window.encryptionConfig?.apiKey ? `"${window.encryptionConfig.apiKey.substring(0, 8)}..."` : 'undefined/null');

    if (apiKey) {
        headers['X-API-Key'] = apiKey;
    }
    console.log('  - Headers being returned:', headers);
    return headers;
}

/**
 * Set API headers on an XMLHttpRequest object
 */
function setXhrHeaders(xhr) {
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (encryptionConfig.apiKey) {
        xhr.setRequestHeader('X-API-Key', encryptionConfig.apiKey);
    }
}

console.log('%c\u2699\uFE0F Configuration Status:', 'color: #2196F3; font-weight: bold;');
console.table(configStatus);

if (!encryptionConfig.hash && (!encryptionConfig.secretKey || !encryptionConfig.nonce)) {
    console.error('%c\u274C Critical: Missing encryption configuration!', 'color: #F44336; font-weight: bold; font-size: 14px;');
    console.error('Required: hash OR (secretKey and nonce)');
    console.error('Current config:', encryptionConfig);
}

if (!encryptionConfig.apiBaseUrl) {
    console.warn('%c\u26A0\uFE0F Warning: API Base URL not set. Decryption API calls will fail.', 'color: #FF9800; font-weight: bold;');
}

/**
 * Encrypt lazy-loaded content using stored nonce for website
 * Uses the /api/encrypt/lazy endpoint which uses the persistent nonce
 */
async function encryptLazyContent(text) {
    if (!encryptionConfig.websiteId) {
        console.warn('No websiteId in config, cannot encrypt lazy content');
        return text;
    }

    if (!encryptionConfig.apiBaseUrl) {
        console.warn('No apiBaseUrl in config, cannot encrypt lazy content');
        return text;
    }

    try {
        const response = await fetch(`${encryptionConfig.apiBaseUrl}/api/encrypt/lazy`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                website_id: encryptionConfig.websiteId,
                text: text,
                hash: encryptionConfig.hash || null
            })
        });

        if (!response.ok) {
            console.warn('Lazy encryption failed:', response.status);
            const errorData = await response.json().catch(() => ({}));
            console.warn('Error details:', errorData);
            return text;
        }

        const data = await response.json();
        return data.encrypted || text;
    } catch (error) {
        console.warn('Error encrypting lazy content:', error);
        return text;
    }
}

/**
 * Decrypt text using the decryption API
 * Handles zero-width spaces, non-breaking spaces, and special characters
 */
async function decryptText(encryptedText) {
    if (!encryptionConfig.hash && (!encryptionConfig.secretKey || !encryptionConfig.nonce)) {
        return encryptedText;
    }

    // Remove zero-width spaces (U+200B) that were inserted for word-breaking
    const textWithoutZWSP = encryptedText.replace(/\u200B/g, '');

    // Replace non-breaking spaces (U+00A0) with regular spaces for decryption
    // The font maps both regular spaces and non-breaking spaces to the same glyph
    const normalizedText = textWithoutZWSP.replace(/\u00A0/g, ' ');

    // Call the decryption API
    try {
        const response = await fetch(`${encryptionConfig.apiBaseUrl}/api/decrypt`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
                encrypted: normalizedText,
                hash: encryptionConfig.hash || null,
                // Backward compatibility: include secretKey and nonce if hash not available
                ...(encryptionConfig.hash ? {} : {
                    secret_key: encryptionConfig.secretKey,
                    nonce: encryptionConfig.nonce
                })
            })
        });

        if (!response.ok) {
            console.warn('Decryption API call failed:', response.status);
            return encryptedText; // Return original if API fails
        }

        const data = await response.json();
        return data.decrypted || encryptedText;
    } catch (error) {
        console.warn('Error calling decryption API:', error);
        return encryptedText; // Return original if API call fails
    }
}
