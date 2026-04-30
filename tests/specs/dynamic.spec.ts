import { test, expect } from '../fixtures/test-page';

/**
 * Dynamic Content and MutationObserver Tests
 *
 * Purpose:
 * - Verify MutationObserver encrypts dynamically added content
 * - Detect the FAQ gibberish bug (plaintext + encrypted fonts)
 * - Test SPA-like dynamic content scenarios
 *
 * The FAQ gibberish bug occurs when:
 * - Text is NOT encrypted by SDK (textContent remains plaintext)
 * - BUT encrypted custom fonts ARE applied
 * - Result: Gibberish like "Freqfkntly Asked Qfkstions" displays
 *
 * These tests verify encryption works for dynamic content and catch
 * cases where fonts are applied without corresponding encryption.
 */

test.describe('Dynamic Content Tests', () => {
  test('SDK initializes on dynamic_test page', async ({ dynamicPage }) => {
    // dynamicPage fixture already initializes SDK
    // Verify page loads without error
    const title = await dynamicPage.page.title();
    expect(title).toContain('Dynamic Content Test');

    // Assert SDK stats show initialized: true
    const stats = await dynamicPage.getStats();
    expect(stats.initialized).toBe(true);
    expect(stats.nodeCount).toBeGreaterThan(0);
    expect(stats.totalCharacters).toBeGreaterThan(0);
  });

  test('dynamically added content is encrypted', async ({ dynamicPage }) => {
    // Add dynamic content
    await dynamicPage.addDynamicContent('<h3 class="dynamic-heading">Breaking News</h3>');

    // Wait 100ms for MutationObserver batch processing (batchDelay: 16ms + buffer)
    await dynamicPage.page.waitForTimeout(100);

    // Get encrypted and plaintext versions
    const encrypted = await dynamicPage.getDynamicContentEncrypted('.dynamic-heading');
    const plaintext = await dynamicPage.getDynamicContentPlaintext('.dynamic-heading');

    // Assert they differ (text is encrypted)
    expect(encrypted).not.toBe(plaintext);

    // Assert plaintext is correct
    expect(plaintext).toBe('Breaking News');

    // Assert encrypted is not empty
    expect(encrypted.length).toBeGreaterThan(0);
  });

  test('multiple dynamic additions are all encrypted', async ({ dynamicPage }) => {
    // Add 3 different pieces of content
    await dynamicPage.addDynamicContent(`
      <div class="dynamic-1">First dynamic paragraph</div>
    `);
    await dynamicPage.addDynamicContent(`
      <div class="dynamic-2">Second dynamic paragraph</div>
    `);
    await dynamicPage.addDynamicContent(`
      <div class="dynamic-3">Third dynamic paragraph</div>
    `);

    // Wait for processing
    await dynamicPage.page.waitForTimeout(150);

    // Assert all 3 are encrypted with correct plaintext
    for (let i = 1; i <= 3; i++) {
      const selector = `.dynamic-${i}`;
      const encrypted = await dynamicPage.getDynamicContentEncrypted(selector);
      const plaintext = await dynamicPage.getDynamicContentPlaintext(selector);

      // Verify encryption
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.length).toBeGreaterThan(0);

      // Verify plaintext
      if (i === 1) expect(plaintext).toContain('First dynamic');
      if (i === 2) expect(plaintext).toContain('Second dynamic');
      if (i === 3) expect(plaintext).toContain('Third dynamic');
    }
  });

  test('FAQ header is encrypted (not gibberish)', async ({ dynamicPage }) => {
    // This tests the known FAQ gibberish bug
    // Get FAQ h2 element - use accordion container as parent to avoid text matching
    const faqHeader = dynamicPage.page.locator('.accordion-container h2').first();

    // Check if element exists
    await expect(faqHeader).toBeVisible();

    // Get text content
    const faqText = await faqHeader.textContent();
    expect(faqText).not.toBeNull();

    // Get encrypted and plaintext versions
    const encrypted = await dynamicPage.page.evaluate(() => {
      const h2 = document.querySelector('.accordion-container h2');
      return h2?.textContent || '';
    });

    const plaintext = await dynamicPage.page.evaluate(() => {
      const h2 = document.querySelector('.accordion-container h2');
      if (!h2) return '';

      const walker = document.createTreeWalker(
        h2,
        NodeFilter.SHOW_TEXT,
        null
      );
      const textNode = walker.nextNode();

      // @ts-ignore - _cloakOriginal is added by SDK
      return textNode?._cloakOriginal || '';
    });

    // If this test fails, the FAQ gibberish bug exists:
    // - encrypted !== plaintext means text WAS encrypted (good)
    // - If they're equal, text was NOT encrypted but fonts ARE applied (gibberish)

    // Assert encrypted !== plaintext (text is actually encrypted)
    expect(encrypted).not.toBe(plaintext);

    // Assert plaintext contains 'Frequently' (not 'Freqfkntly' gibberish)
    expect(plaintext).toContain('Frequently');

    // Assert plaintext contains 'Asked'
    expect(plaintext).toContain('Asked');

    // Log for debugging
    console.log('FAQ header encrypted:', encrypted.substring(0, 50));
    console.log('FAQ header plaintext:', plaintext.substring(0, 50));
  });

  test('visual check - FAQ header renders correctly', async ({ dynamicPage }) => {
    // Get FAQ header - use class selector to avoid text matching encrypted content
    const faqHeader = dynamicPage.page.locator('.accordion-container h2').first();

    // Take screenshot of FAQ header
    // This would catch gibberish rendering visually
    // High tolerance due to randomized encryption
    await expect(faqHeader).toHaveScreenshot('faq-header.png', {
      maxDiffPixels: 2000,
      threshold: 0.3
    });

    // Verify it's visible
    await expect(faqHeader).toBeVisible();
  });

  test('Load More button adds encrypted content', async ({ dynamicPage }) => {
    // Get initial article count
    const initialCount = await dynamicPage.page.locator('.article-card').count();

    // Click Load More
    await dynamicPage.clickLoadMore();

    // Wait for new content to be added and encrypted
    await dynamicPage.page.waitForTimeout(150);

    // Get new article count
    const newCount = await dynamicPage.page.locator('.article-card').count();

    // Assert new articles were added
    expect(newCount).toBeGreaterThan(initialCount);

    // Get the last article (the newly added one)
    const lastArticle = dynamicPage.page.locator('.article-card').last();

    // Get its title
    const titleElement = lastArticle.locator('.article-card-title');
    const encrypted = await titleElement.textContent();
    const plaintext = await titleElement.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      const textNode = walker.nextNode();
      // @ts-ignore
      return textNode?._cloakOriginal || '';
    });

    // Verify the new content is encrypted
    expect(encrypted).not.toBe(plaintext);
    expect(plaintext.length).toBeGreaterThan(0);

    console.log('New article title encrypted:', encrypted?.substring(0, 50));
    console.log('New article title plaintext:', plaintext?.substring(0, 50));
  });
});
