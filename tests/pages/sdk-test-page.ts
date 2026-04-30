import { Page } from '@playwright/test';

/**
 * Page Object Model for sdk_test.html
 *
 * Encapsulates all interactions with the SDK test page including:
 * - Navigation and font loading
 * - SDK initialization
 * - Text encryption verification
 * - Statistics retrieval
 */
export class SdkTestPage {
  constructor(private page: Page) {}

  /**
   * Navigate to the SDK test page
   * Waits until the page is fully loaded
   */
  async goto() {
    await this.page.goto('/sdk-test', { waitUntil: 'load' });
  }

  /**
   * Wait for fonts to be ready before proceeding
   * Critical for accurate text rendering tests
   */
  async waitForFontsReady() {
    await this.page.waitForFunction(() => document.fonts.ready);
  }

  /**
   * Click the Initialize SDK button and wait for success
   * The SDK creates API key automatically if needed
   * Increased timeout to 30s for API key creation on first run
   */
  async initializeSDK() {
    await this.page.click('#btn-init');
    // Wait for status element to show success class
    // Longer timeout needed for first-time API key creation
    await this.page.waitForSelector('#status.success', { timeout: 30000 });

    // Wait for decrypt-interceptor to be injected and loaded
    // The SDK injects it dynamically after initialization
    await this.page.waitForFunction(() => {
      // Check if encryptionConfig is set (sign that decrypt-interceptor is ready)
      return window.encryptionConfig && window.encryptionConfig.hash;
    }, { timeout: 5000 });

    // Give decrypt-interceptor a moment to set up event listeners
    await this.page.waitForTimeout(500);
  }

  /**
   * Get SDK statistics via CloakSDK.getStats()
   * Returns: { initialized: boolean, totalCharacters: number, nodeCount: number }
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

  /**
   * Get the encrypted text content of an element
   * This is what a scraper would see
   */
  async getEncryptedText(selector: string): Promise<string> {
    return await this.page.evaluate((sel) => {
      const element = document.querySelector(sel);
      return element?.textContent || '';
    }, selector);
  }

  /**
   * Get the original plaintext stored in _cloakOriginal
   * This is what the user sees (via the custom font)
   * Returns normalized whitespace to match copy handler behavior
   */
  async getPlaintext(selector: string): Promise<string> {
    const rawText = await this.page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return '';

      // Collect all text nodes' original text
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null
      );

      let fullText = '';
      let node;
      while (node = walker.nextNode()) {
        // @ts-ignore - _cloakOriginal is added by SDK
        const originalText = node._cloakOriginal || '';
        if (originalText) {
          fullText += originalText;
        }
      }

      return fullText;
    }, selector);

    // Normalize whitespace to match copy handler behavior
    // See client/decrypt/src/copy.js lines 279-283
    return rawText
      .split('\n')
      .map(line => line.replace(/[ \t]+/g, ' ').trim())
      .filter(line => line.length > 0)
      .join('\n');
  }

  /**
   * Check if an element's text is encrypted
   * Returns true if encrypted text differs from plaintext
   */
  async isEncrypted(selector: string): Promise<boolean> {
    const encrypted = await this.getEncryptedText(selector);
    const plaintext = await this.getPlaintext(selector);

    // If they're different and both non-empty, text is encrypted
    return encrypted !== plaintext && encrypted.length > 0 && plaintext.length > 0;
  }

  /**
   * Click "Add Dynamic Content" button
   */
  async addDynamicContent() {
    await this.page.click('#btn-add-content');
  }

  /**
   * Click "Simulate Lazy Load" button
   */
  async showLazyContent() {
    await this.page.click('#btn-lazy-load');
  }

  /**
   * Click "Show Stats" button and wait for stats display
   */
  async showStatsDisplay() {
    await this.page.click('#btn-stats');
    await this.page.waitForSelector('#stats-display', { state: 'visible' });
  }

  /**
   * Disable all animations and transitions for visual regression testing
   * Ensures consistent screenshots by preventing animation-based differences
   */
  async disableAnimations() {
    await this.page.addStyleTag({
      content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }'
    });
  }

  /**
   * Select all text within an element using Range API
   * This simulates user text selection behavior
   */
  async selectText(selector: string) {
    await this.page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) throw new Error(`Element not found: ${sel}`);

      const range = document.createRange();
      range.selectNodeContents(element);

      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }, selector);
  }

  /**
   * Select a specific character range within an element
   * @param selector - CSS selector for the element
   * @param start - Starting character offset
   * @param end - Ending character offset
   */
  async selectTextRange(selector: string, start: number, end: number) {
    await this.page.evaluate(({ sel, startOffset, endOffset }) => {
      const element = document.querySelector(sel);
      if (!element) throw new Error(`Element not found: ${sel}`);

      // Find the first text node
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null
      );
      const textNode = walker.nextNode();
      if (!textNode) throw new Error('No text node found');

      const range = document.createRange();
      range.setStart(textNode, startOffset);
      range.setEnd(textNode, endOffset);

      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }, { sel: selector, startOffset: start, endOffset: end });
  }

  /**
   * Copy the currently selected text and capture what was copied
   * Returns the text that was put on the clipboard by the copy event handler
   */
  async copySelectedText(): Promise<string> {
    // Trigger copy using keyboard shortcut (simulates real user action)
    // This triggers a proper copy event with clipboardData that event listeners can modify
    await this.page.keyboard.press('ControlOrMeta+C');

    // Wait a moment for copy to complete and clipboard to be populated
    // Increased from 200ms to 500ms to allow async clipboard.writeText() to complete
    await this.page.waitForTimeout(500);

    // Read from clipboard using async API
    return await this.readClipboard();
  }

  /**
   * Read text from the clipboard (legacy method, use copySelectedText instead)
   * Uses Playwright's clipboard API via CDP (Chrome DevTools Protocol)
   */
  async readClipboard(): Promise<string> {
    // Use Playwright's evaluate to access the clipboard via async Clipboard API
    // Grant permissions programmatically
    const context = this.page.context();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Wait for clipboard to be written (decrypt-interceptor uses async writeText)
    await this.page.waitForTimeout(300);

    // Try reading from clipboard using multiple methods
    // Method 1: navigator.clipboard.readText() (standard but may not work in all contexts)
    let clipboardContent = await this.page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch (e) {
        return '';
      }
    });

    if (clipboardContent && clipboardContent.length > 0) {
      return clipboardContent;
    }

    // Method 2: Use CDP (Chrome DevTools Protocol) to read clipboard directly
    // This bypasses browser security restrictions
    try {
      const cdpSession = await context.newCDPSession(this.page);
      // First, simulate a paste to get clipboard contents into a hidden element
      // Create a hidden textarea and paste into it
      clipboardContent = await this.page.evaluate(() => {
        return new Promise((resolve) => {
          const textarea = document.createElement('textarea');
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.focus();

          // Listen for paste event
          textarea.addEventListener('paste', (e) => {
            const text = e.clipboardData?.getData('text/plain') || '';
            document.body.removeChild(textarea);
            resolve(text);
          });

          // Trigger paste
          document.execCommand('paste');

          // Fallback if paste doesn't work
          setTimeout(() => {
            const value = textarea.value;
            if (document.body.contains(textarea)) {
              document.body.removeChild(textarea);
            }
            resolve(value);
          }, 500);
        });
      });

      await cdpSession.detach();
    } catch (e) {
      // CDP or paste method failed
      console.log('CDP clipboard read failed:', e);
    }

    return clipboardContent;
  }
}
