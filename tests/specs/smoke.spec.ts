import { test, expect } from '../fixtures/test-page';

/**
 * Smoke tests for Cloak SDK
 *
 * Verifies:
 * - Flask server connectivity via webServer config
 * - SDK initialization with auto-created API key
 * - Text encryption functionality
 * - Plaintext preservation in _cloakOriginal
 */

test.describe('SDK Smoke Tests', () => {
  test('page loads and SDK initializes', async ({ sdkPage }) => {
    // Initialize the SDK (creates API key if needed)
    await sdkPage.initializeSDK();

    // Get SDK statistics
    const stats = await sdkPage.getStats();

    // Verify SDK is initialized
    expect(stats.initialized).toBe(true);

    // Verify text nodes were processed
    expect(stats.nodeCount).toBeGreaterThan(0);

    // Verify characters were encrypted
    expect(stats.totalCharacters).toBeGreaterThan(0);
  });

  test('h1 text is encrypted after init', async ({ sdkPage }) => {
    // Initialize the SDK
    await sdkPage.initializeSDK();

    // Verify the h1 is encrypted (encrypted text differs from plaintext)
    const isEncrypted = await sdkPage.isEncrypted('h1');
    expect(isEncrypted).toBe(true);

    // Verify the original plaintext is preserved
    const plaintext = await sdkPage.getPlaintext('h1');
    expect(plaintext).toBe('The Future of Web Content Protection');

    // Verify encrypted text is different (what scraper would see)
    const encryptedText = await sdkPage.getEncryptedText('h1');
    expect(encryptedText).not.toBe(plaintext);
    expect(encryptedText.length).toBeGreaterThan(0);
  });
});
