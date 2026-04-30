import { test as base, expect } from '@playwright/test';
import { SdkTestPage } from '../pages/sdk-test-page';
import { DynamicTestPage } from '../pages/dynamic-test-page';

/**
 * Custom fixture that extends Playwright's base test
 *
 * Provides two fixtures:
 * - sdkPage: For testing SDK test page (sdk_test.html)
 * - dynamicPage: For testing dynamic content page (dynamic_test.html)
 *
 * Both fixtures automatically:
 * 1. Navigate to the respective page
 * 2. Wait for fonts to be ready
 * 3. Initialize SDK and wait for completion
 *
 * This ensures every test starts with fonts loaded and SDK initialized,
 * preventing race conditions in text rendering assertions.
 */
type TestFixtures = {
  sdkPage: SdkTestPage;
  dynamicPage: DynamicTestPage;
};

export const test = base.extend<TestFixtures>({
  sdkPage: async ({ page }, use) => {
    // Create page object
    const sdkPage = new SdkTestPage(page);

    // Navigate to test page
    await sdkPage.goto();

    // Wait for fonts to be ready (critical for text rendering)
    await sdkPage.waitForFontsReady();

    // Yield to test
    await use(sdkPage);

    // Cleanup happens automatically
  },

  dynamicPage: async ({ page }, use) => {
    // Create page object
    const dynamicPage = new DynamicTestPage(page);

    // Navigate to dynamic test page
    await dynamicPage.goto();

    // Wait for fonts to be ready
    await dynamicPage.waitForFontsReady();

    // Initialize SDK and wait for it to complete
    await dynamicPage.initializeSDK();

    // Yield to test
    await use(dynamicPage);

    // Cleanup happens automatically
  },
});

// Re-export expect for convenience
export { expect };
