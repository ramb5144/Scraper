import { test, expect } from '../fixtures/test-page';

/**
 * Encryption Verification Tests
 *
 * Validates that the Cloak SDK correctly encrypts text content while:
 * - Preserving plaintext in _cloakOriginal
 * - Applying encrypted fonts
 * - Respecting exclusion patterns
 *
 * These tests detect the most critical failure mode: text not being encrypted.
 */

test.describe('Encryption Verification', () => {
  test('all headings are encrypted', async ({ sdkPage }) => {
    // Initialize the SDK
    await sdkPage.initializeSDK();

    // Test all heading levels - get encrypted and plaintext in one evaluate call
    const headings = await sdkPage.page.evaluate(() => {
      const results: Array<{
        selector: string;
        encrypted: string;
        plaintext: string;
      }> = [];

      // Get all headings from article (excluding control panel)
      const article = document.querySelector('.article');
      if (!article) return results;

      const headingSelectors = ['h1', 'h2', 'h3'];
      for (const selector of headingSelectors) {
        const elements = Array.from(article.querySelectorAll(selector));

        for (const el of elements) {
          const walker = document.createTreeWalker(
            el,
            NodeFilter.SHOW_TEXT,
            null
          );
          const textNode = walker.nextNode();

          results.push({
            selector,
            encrypted: el.textContent || '',
            // @ts-ignore - _cloakOriginal added by SDK
            plaintext: textNode?._cloakOriginal || '',
          });
        }
      }

      return results;
    });

    // Verify we have headings
    expect(headings.length).toBeGreaterThan(0);

    // Verify each heading is encrypted
    for (const heading of headings) {
      // Assert encrypted differs from plaintext
      expect(heading.encrypted).not.toBe(heading.plaintext);
      expect(heading.encrypted.length).toBeGreaterThan(0);

      // Assert plaintext is real English (not empty, not just symbols)
      expect(heading.plaintext.length).toBeGreaterThan(0);
      expect(heading.plaintext).toMatch(/[a-zA-Z]+/); // Contains letters
    }
  });

  test('paragraph text is encrypted', async ({ sdkPage }) => {
    // Initialize the SDK
    await sdkPage.initializeSDK();

    // Get first 3 paragraphs from article with encrypted/plaintext
    const paragraphs = await sdkPage.page.evaluate(() => {
      const article = document.querySelector('.article');
      const pElements = Array.from(article?.querySelectorAll('p') || []).slice(0, 3);

      return pElements.map(p => {
        const walker = document.createTreeWalker(
          p,
          NodeFilter.SHOW_TEXT,
          null
        );
        const textNode = walker.nextNode();

        return {
          encrypted: p.textContent || '',
          // @ts-ignore - _cloakOriginal added by SDK
          plaintext: textNode?._cloakOriginal || '',
        };
      });
    });

    expect(paragraphs.length).toBeGreaterThanOrEqual(3);

    // Verify each paragraph is encrypted
    for (const para of paragraphs) {
      // Assert encrypted !== plaintext
      expect(para.encrypted).not.toBe(para.plaintext);
      expect(para.encrypted.length).toBeGreaterThan(0);
      expect(para.plaintext.length).toBeGreaterThan(0);
    }
  });

  test('encrypted fonts are applied', async ({ sdkPage }) => {
    // Initialize the SDK
    await sdkPage.initializeSDK();

    // Wait for fonts to be ready (already done by fixture, but be explicit)
    await sdkPage.waitForFontsReady();

    // Check that CloakFont was injected and is available
    const fontCheck = await sdkPage.page.evaluate(async () => {
      // Check for style elements containing CloakFont
      const styles = Array.from(document.querySelectorAll('style'));
      const hasFontFace = styles.some(style => {
        const content = style.textContent || '';
        return content.includes('@font-face') && content.includes('CloakFont');
      });

      // Check if font is actually loaded in document.fonts
      const fonts = Array.from(document.fonts);
      const fontLoaded = fonts.some(font =>
        font.family.includes('CloakFont') && font.status === 'loaded'
      );

      return {
        hasFontFace,
        fontLoaded,
        totalFonts: fonts.length,
      };
    });

    // Assert CloakFont was injected and loaded
    expect(fontCheck.hasFontFace).toBe(true);
    expect(fontCheck.fontLoaded).toBe(true);
  });

  test('script and style elements are not encrypted', async ({ sdkPage }) => {
    // Initialize the SDK
    await sdkPage.initializeSDK();

    // Check that script/style text nodes don't have _cloakOriginal
    const hasEncryptedScriptOrStyle = await sdkPage.page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script'));
      const styles = Array.from(document.querySelectorAll('style'));

      const checkElement = (el: Element) => {
        const walker = document.createTreeWalker(
          el,
          NodeFilter.SHOW_TEXT,
          null
        );
        let node = walker.nextNode();
        while (node) {
          // @ts-ignore - _cloakOriginal added by SDK
          if (node._cloakOriginal) {
            return true;
          }
          node = walker.nextNode();
        }
        return false;
      };

      return scripts.some(checkElement) || styles.some(checkElement);
    });

    // Assert script/style elements are NOT encrypted
    expect(hasEncryptedScriptOrStyle).toBe(false);
  });

  test('data-cloak-exclude elements are not encrypted', async ({ sdkPage }) => {
    // Initialize the SDK
    await sdkPage.initializeSDK();

    // Check control panel (has data-cloak-exclude) is not encrypted
    const controlPanelEncrypted = await sdkPage.page.evaluate(() => {
      const controlPanel = document.querySelector('[data-cloak-exclude]');
      if (!controlPanel) return false;

      const walker = document.createTreeWalker(
        controlPanel,
        NodeFilter.SHOW_TEXT,
        null
      );
      let node = walker.nextNode();
      while (node) {
        // @ts-ignore - _cloakOriginal added by SDK
        if (node._cloakOriginal) {
          return true;
        }
        node = walker.nextNode();
      }
      return false;
    });

    // Assert control panel is NOT encrypted
    expect(controlPanelEncrypted).toBe(false);
  });

  test('code and pre elements are encrypted', async ({ sdkPage }) => {
    // Initialize the SDK
    await sdkPage.initializeSDK();

    // Get code blocks from page
    const codeBlocks = await sdkPage.page.evaluate(() => {
      const codes = Array.from(document.querySelectorAll('code'));
      const pres = Array.from(document.querySelectorAll('pre'));
      return {
        codeCount: codes.length,
        preCount: pres.length,
      };
    });

    // If code blocks exist, verify they're encrypted
    if (codeBlocks.codeCount > 0) {
      const encrypted = await sdkPage.getEncryptedText('code');
      const plaintext = await sdkPage.getPlaintext('code');

      expect(encrypted).not.toBe(plaintext);
      expect(plaintext.length).toBeGreaterThan(0);
    }

    if (codeBlocks.preCount > 0) {
      const encrypted = await sdkPage.getEncryptedText('pre');
      const plaintext = await sdkPage.getPlaintext('pre');

      expect(encrypted).not.toBe(plaintext);
      expect(plaintext.length).toBeGreaterThan(0);
    }
  });
});
