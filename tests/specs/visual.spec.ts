import { test, expect } from '../fixtures/test-page';

/**
 * Visual Regression Tests for Cloak SDK
 *
 * Purpose: Detect visual rendering issues including the FAQ gibberish bug
 *
 * These tests use Playwright's screenshot comparison to catch:
 * - Gibberish rendering (plaintext shown with encrypted fonts)
 * - Font rendering issues
 * - UI state regressions
 *
 * First run creates baseline screenshots in visual.spec.ts-snapshots/
 * Subsequent runs compare against baselines with maxDiffPixels tolerance
 *
 * Run with --update-snapshots to regenerate baselines after intentional changes
 */

test.describe('Visual Regression Tests', () => {
  // Disable animations in all visual tests for consistency
  test.beforeEach(async ({ sdkPage }) => {
    await sdkPage.disableAnimations();
  });

  test('h1 renders correctly (not gibberish)', async ({ sdkPage }) => {
    // Initialize SDK to trigger encryption
    await sdkPage.initializeSDK();

    // Wait for fonts to be ready
    await sdkPage.waitForFontsReady();

    // Take screenshot of h1 element
    // High tolerance because encrypted text changes on each run
    // This catches layout/font rendering issues, not encryption differences
    await expect(sdkPage.page.locator('h1')).toHaveScreenshot('h1-encrypted.png', {
      maxDiffPixels: 5000,
      threshold: 0.3
    });

    // Verify text is actually encrypted (not relying only on visual)
    const isEncrypted = await sdkPage.isEncrypted('h1');
    expect(isEncrypted).toBe(true);
  });

  test('article section renders correctly', async ({ sdkPage }) => {
    // Initialize SDK
    await sdkPage.initializeSDK();

    // Wait for fonts
    await sdkPage.waitForFontsReady();

    // Screenshot the main article content section
    // High tolerance for randomized encryption - catches layout issues
    const articleSection = sdkPage.page.locator('article.article').first();
    await expect(articleSection).toHaveScreenshot('article-section.png', {
      maxDiffPixels: 50000,
      threshold: 0.3
    });
  });

  test('status indicator shows success state', async ({ sdkPage }) => {
    // Initialize SDK (should show success state)
    await sdkPage.initializeSDK();

    // Screenshot the status element
    const statusElement = sdkPage.page.locator('#status');
    await expect(statusElement).toHaveScreenshot('status-success.png', {
      maxDiffPixels: 1000,
      threshold: 0.2
    });

    // Verify it has the success class
    const hasSuccessClass = await statusElement.evaluate((el) => el.classList.contains('success'));
    expect(hasSuccessClass).toBe(true);
  });

  test('full page renders without visual regressions', async ({ sdkPage }) => {
    // Initialize SDK
    await sdkPage.initializeSDK();

    // Wait for fonts
    await sdkPage.waitForFontsReady();

    // Full page screenshot to catch any unexpected changes
    // Very high tolerance due to randomized encryption across entire page
    await expect(sdkPage.page).toHaveScreenshot('full-page-encrypted.png', {
      maxDiffPixels: 100000,
      threshold: 0.3,
      fullPage: true
    });
  });
});
