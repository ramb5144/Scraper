const { test, expect } = require('@playwright/test');

/**
 * Test form element and contenteditable exclusions from encryption.
 *
 * Verifies that:
 * 1. Form inputs (<input>, <textarea>) show plain text
 * 2. Select options (<option>) show plain text
 * 3. Buttons show plain text
 * 4. Contenteditable regions show plain text
 * 5. Regular paragraph text IS encrypted (shows font-family: "Decryption Font")
 * 6. Labels ARE encrypted (intentional - see note in debug file)
 */

test.describe('Form Element Exclusions', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to test page
        await page.goto('http://localhost:8001/test-form-exclusions');

        // Wait for SDK to load and process
        await page.waitForLoadState('networkidle');

        // Wait a bit for encryption to complete
        await page.waitForTimeout(1000);
    });

    test('text inputs should show plain text (not encrypted)', async ({ page }) => {
        // Check input placeholder
        const input = page.locator('input[placeholder*="placeholder should NOT be encrypted"]').first();
        const placeholder = await input.getAttribute('placeholder');

        // Placeholder should be readable plain text, not encrypted
        expect(placeholder).toContain('placeholder');
        expect(placeholder).toContain('encrypted');

        // Check computed font - should NOT be "Decryption Font"
        const computedFont = await input.evaluate(el =>
            window.getComputedStyle(el).fontFamily
        );
        expect(computedFont).not.toContain('Decryption Font');
    });

    test('textarea content should show plain text (not encrypted)', async ({ page }) => {
        // Get textarea element
        const textarea = page.locator('textarea').first();

        // Get text content
        const content = await textarea.inputValue();

        // Should be readable plain text
        expect(content).toContain('default');
        expect(content).toContain('textarea');

        // Computed font should NOT be Decryption Font
        const computedFont = await textarea.evaluate(el =>
            window.getComputedStyle(el).fontFamily
        );
        expect(computedFont).not.toContain('Decryption Font');
    });

    test('select options should show plain text (not encrypted)', async ({ page }) => {
        // Get select element
        const select = page.locator('select').first();

        // Get option text
        const options = await select.locator('option').allTextContents();

        // All options should be readable
        for (const optionText of options) {
            expect(optionText).toContain('Option');
            expect(optionText).toContain('should');
            expect(optionText).toContain('NOT');
        }

        // Computed font should NOT be Decryption Font
        const computedFont = await select.evaluate(el =>
            window.getComputedStyle(el).fontFamily
        );
        expect(computedFont).not.toContain('Decryption Font');
    });

    test('button text should show plain text (not encrypted)', async ({ page }) => {
        // Get button elements
        const buttons = page.locator('button[type="button"], button[type="submit"]');
        const buttonTexts = await buttons.allTextContents();

        // All buttons should have readable text
        for (const buttonText of buttonTexts) {
            expect(buttonText).toContain('button');
            expect(buttonText).toContain('text');
            expect(buttonText).toContain('should');
        }

        // Computed font should NOT be Decryption Font
        const firstButton = buttons.first();
        const computedFont = await firstButton.evaluate(el =>
            window.getComputedStyle(el).fontFamily
        );
        expect(computedFont).not.toContain('Decryption Font');
    });

    test('contenteditable regions should show plain text (not encrypted)', async ({ page }) => {
        // Get contenteditable elements
        const editableTrue = page.locator('[contenteditable="true"]').first();
        const editableEmpty = page.locator('[contenteditable=""]').first();

        // Check contenteditable="true"
        const textTrue = await editableTrue.textContent();
        expect(textTrue).toContain('contenteditable');
        expect(textTrue).toContain('text');
        expect(textTrue).toContain('should');

        const fontTrue = await editableTrue.evaluate(el =>
            window.getComputedStyle(el).fontFamily
        );
        expect(fontTrue).not.toContain('Decryption Font');

        // Check contenteditable="" (empty string also means true)
        const textEmpty = await editableEmpty.textContent();
        expect(textEmpty).toContain('contenteditable');
        expect(textEmpty).toContain('text');

        const fontEmpty = await editableEmpty.evaluate(el =>
            window.getComputedStyle(el).fontFamily
        );
        expect(fontEmpty).not.toContain('Decryption Font');
    });

    test('regular paragraph text SHOULD be encrypted', async ({ page }) => {
        // Find the regular content test section
        const regularText = page.locator('.regular-text p').first();

        // Get text content
        const text = await regularText.textContent();
        expect(text).toBeTruthy();

        // Check that font IS "Decryption Font" (meaning it was encrypted)
        const computedFont = await regularText.evaluate(el =>
            window.getComputedStyle(el).fontFamily
        );

        // This should be encrypted, so it should use the Decryption Font
        expect(computedFont).toContain('Decryption Font');
    });

    test('labels SHOULD be encrypted (intentional)', async ({ page }) => {
        // Get label elements
        const labels = page.locator('label');
        const firstLabel = labels.first();

        // Get text
        const labelText = await firstLabel.textContent();
        expect(labelText).toBeTruthy();

        // Labels should be encrypted (using Decryption Font)
        // This is intentional - labels are part of page content that should be protected
        const computedFont = await firstLabel.evaluate(el =>
            window.getComputedStyle(el).fontFamily
        );

        expect(computedFont).toContain('Decryption Font');
    });

    test('user can type into contenteditable without encryption interfering', async ({ page }) => {
        // Get contenteditable element
        const editable = page.locator('[contenteditable="true"]').first();

        // Clear existing content
        await editable.clear();

        // Type new content
        const testText = 'This is user input that should not be encrypted';
        await editable.fill(testText);

        // Wait a moment for any SDK processing
        await page.waitForTimeout(500);

        // Verify text is still plain
        const content = await editable.textContent();
        expect(content).toBe(testText);

        // Font should still not be Decryption Font
        const computedFont = await editable.evaluate(el =>
            window.getComputedStyle(el).fontFamily
        );
        expect(computedFont).not.toContain('Decryption Font');
    });
});
