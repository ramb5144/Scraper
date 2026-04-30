import { Page } from '@playwright/test';

/**
 * Page Object Model for dynamic_test.html
 *
 * Encapsulates interactions with the realistic dynamic content test page
 * including navigation, FAQ testing, and dynamic content injection.
 */
export class DynamicTestPage {
  constructor(private page: Page) {}

  /**
   * Navigate to the dynamic test page
   * Flask route is /dynamic-test
   */
  async goto() {
    await this.page.goto('/dynamic-test', { waitUntil: 'load' });
  }

  /**
   * Wait for fonts to be ready before proceeding
   * Critical for accurate text rendering tests
   */
  async waitForFontsReady() {
    await this.page.waitForFunction(() => document.fonts.ready);
  }

  /**
   * Wait for SDK to initialize
   * Checks CloakSDK.getStats().initialized === true
   */
  async waitForSDKInit() {
    await this.page.waitForFunction(
      () => {
        // @ts-ignore - CloakSDK is a global from cloak-sdk.js
        const stats = window.CloakSDK?.getStats();
        return stats?.initialized === true;
      },
      { timeout: 30000 }
    );
  }

  /**
   * Get the FAQ header element (h2 containing "Frequently")
   * This is the element that exhibits the gibberish bug
   */
  getFAQHeader() {
    return this.page.locator('h2:has-text("Frequently")');
  }

  /**
   * Get navigation link elements
   */
  getNavLinks() {
    return this.page.locator('.nav-links a');
  }

  /**
   * Add dynamic content to the page
   * Injects HTML into #dynamic-content container or body
   *
   * @param html - HTML string to inject
   */
  async addDynamicContent(html: string) {
    await this.page.evaluate((content) => {
      const container = document.querySelector('#dynamic-content') || document.body;
      const div = document.createElement('div');
      div.innerHTML = content;
      container.appendChild(div);
    }, html);
  }

  /**
   * Get the encrypted text content of a dynamically added element
   * This is what a scraper would see
   *
   * @param selector - CSS selector for the element
   */
  async getDynamicContentEncrypted(selector: string): Promise<string> {
    return await this.page.evaluate((sel) => {
      const element = document.querySelector(sel);
      return element?.textContent || '';
    }, selector);
  }

  /**
   * Get the original plaintext from _cloakOriginal property
   * This is what the user sees (via the custom font)
   *
   * @param selector - CSS selector for the element
   */
  async getDynamicContentPlaintext(selector: string): Promise<string> {
    return await this.page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return '';

      // Find first text node
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null
      );
      const textNode = walker.nextNode();

      // @ts-ignore - _cloakOriginal is added by SDK
      return textNode?._cloakOriginal || '';
    }, selector);
  }

  /**
   * Click "Load More Articles" button to trigger dynamic content injection
   */
  async clickLoadMore() {
    await this.page.click('#load-more-btn');
  }

  /**
   * Click "Initialize SDK" button in debug panel
   */
  async initializeSDK() {
    await this.page.click('#sdk-init-btn');
    // Wait for SDK to initialize
    await this.waitForSDKInit();
  }

  /**
   * Get SDK statistics via CloakSDK.getStats()
   */
  async getStats(): Promise<{
    initialized: boolean;
    totalCharacters: number;
    nodeCount: number;
  }> {
    return await this.page.evaluate(() => {
      // @ts-ignore - CloakSDK is a global from cloak-sdk.js
      return window.CloakSDK.getStats();
    });
  }
}
