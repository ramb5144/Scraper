/**
 * Test suite for Shadow DOM encryption
 * Verifies that text inside Shadow DOM is properly encrypted
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('Shadow DOM Encryption', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to the shadow DOM test page
        const testPagePath = path.join(__dirname, '..', 'test-shadow-dom.html');
        await page.goto(`file://${testPagePath}`);

        // Wait for SDK initialization
        await page.waitForTimeout(1000);
    });

    test('should encrypt text in basic open shadow root', async ({ page }) => {
        // Run test 1
        await page.click('button:has-text("Run Test 1")');
        await page.waitForTimeout(200);

        // Check the result
        const result = await page.locator('#test1-result').textContent();
        expect(result).toContain('PASS');

        // Verify the shadow DOM text is actually encrypted
        const shadowText = await page.evaluate(() => {
            const component = document.querySelector('basic-shadow');
            return component.shadowRoot.querySelector('p').textContent;
        });

        expect(shadowText).not.toBe('Secret plaintext in shadow DOM');
        expect(shadowText.length).toBeGreaterThan(0);
    });

    test('should encrypt text in nested shadow roots', async ({ page }) => {
        // Run test 2
        await page.click('button:has-text("Run Test 2")');
        await page.waitForTimeout(200);

        // Check the result
        const result = await page.locator('#test2-result').textContent();
        expect(result).toContain('PASS');

        // Verify both outer and inner shadow text is encrypted
        const { outerText, innerText } = await page.evaluate(() => {
            const outer = document.querySelector('nested-outer');
            const outerP = outer.shadowRoot.querySelector('p');
            const inner = outer.shadowRoot.querySelector('nested-inner');
            const innerP = inner.shadowRoot.querySelector('p');

            return {
                outerText: outerP.textContent,
                innerText: innerP.textContent
            };
        });

        expect(outerText).not.toBe('Outer shadow text');
        expect(innerText).not.toBe('Inner shadow text (nested)');
    });

    test('should encrypt dynamically created shadow roots', async ({ page }) => {
        // Run test 3
        await page.click('button:has-text("Run Test 3")');
        await page.waitForTimeout(200);

        // Check the result
        const result = await page.locator('#test3-result').textContent();
        expect(result).toContain('PASS');

        // Verify the dynamically created shadow DOM is encrypted
        const shadowText = await page.evaluate(() => {
            const component = document.querySelector('#test3-container basic-shadow');
            return component.shadowRoot.querySelector('p').textContent;
        });

        expect(shadowText).not.toBe('Secret plaintext in shadow DOM');
    });

    test('should handle closed shadow roots gracefully', async ({ page }) => {
        // Run test 4
        await page.click('button:has-text("Run Test 4")');
        await page.waitForTimeout(200);

        // Check the result - closed shadow roots should be handled without errors
        const result = await page.locator('#test4-result').textContent();
        expect(result).toContain('PASS');

        // Verify no errors were thrown
        const consoleErrors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        // The closed shadow root should not cause any errors
        expect(consoleErrors).toHaveLength(0);
    });

    test('should encrypt dynamic content added to shadow root', async ({ page }) => {
        // Run test 5
        await page.click('button:has-text("Run Test 5")');
        await page.waitForTimeout(300);

        // Check the result
        const result = await page.locator('#test5-result').textContent();
        expect(result).toContain('PASS');

        // Verify the dynamically added content is encrypted
        const shadowText = await page.evaluate(() => {
            const component = document.querySelector('#test5-container dynamic-content');
            return component.shadowRoot.querySelector('p').textContent;
        });

        expect(shadowText).not.toBe('Dynamically added shadow text');
    });

    test('should encrypt both regular DOM and shadow DOM', async ({ page }) => {
        // Run test 6
        await page.click('button:has-text("Run Test 6")');
        await page.waitForTimeout(200);

        // Check the result
        const result = await page.locator('#test6-result').textContent();
        expect(result).toContain('PASS');

        // Verify both are encrypted
        const { regularText, shadowText } = await page.evaluate(() => {
            const container = document.querySelector('#test6-container');
            const regularP = container.querySelector('p');
            const component = container.querySelector('basic-shadow');
            const shadowP = component.shadowRoot.querySelector('p');

            return {
                regularText: regularP.textContent,
                shadowText: shadowP.textContent
            };
        });

        expect(regularText).not.toBe('Regular DOM text that should be encrypted');
        expect(shadowText).not.toBe('Secret plaintext in shadow DOM');
    });

    test('should observe mutations in shadow roots', async ({ page }) => {
        // Create a component and add content to its shadow root after a delay
        const wasEncrypted = await page.evaluate(async () => {
            const component = document.createElement('dynamic-content');
            document.body.appendChild(component);

            // Wait for initial observation setup
            await new Promise(r => setTimeout(r, 150));

            // Add content to shadow root
            const p = document.createElement('p');
            p.textContent = 'Mutation test text';
            component.shadowRoot.getElementById('dynamic-content').appendChild(p);

            // Wait for mutation observer to encrypt
            await new Promise(r => setTimeout(r, 150));

            // Check if encrypted
            const actualText = component.shadowRoot.querySelector('p').textContent;
            return actualText !== 'Mutation test text';
        });

        expect(wasEncrypted).toBe(true);
    });

    test('should not leave plaintext extractable from shadow DOM', async ({ page }) => {
        // Add various shadow components
        await page.evaluate(() => {
            const container = document.createElement('div');
            container.innerHTML = `
                <basic-shadow></basic-shadow>
                <nested-outer></nested-outer>
            `;
            document.body.appendChild(container);
        });

        await page.waitForTimeout(200);

        // Try to extract all plaintext from shadow roots
        const plaintextFound = await page.evaluate(() => {
            const plaintextFragments = [];
            const secretPhrases = [
                'Secret plaintext in shadow DOM',
                'Outer shadow text',
                'Inner shadow text (nested)'
            ];

            // Scan all elements for shadow roots
            document.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) {
                    const shadowText = el.shadowRoot.textContent;
                    // Check if any secret phrase is still in plaintext
                    for (const phrase of secretPhrases) {
                        if (shadowText.includes(phrase)) {
                            plaintextFound.push(phrase);
                        }
                    }
                }
            });

            return plaintextFragments;
        });

        // All plaintext should be encrypted
        expect(plaintextFound).toHaveLength(0);
    });
});
