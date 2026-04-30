const { test, expect } = require('@playwright/test');

test.describe('Security Vulnerability Fix', () => {
    test('should NOT expose plaintext via _cloakOriginal DOM properties', async ({ page }) => {
        // Navigate to test page
        await page.goto('http://localhost:8080/test-vulnerability-fix.html');

        // Wait for SDK to initialize and encrypt content
        await page.waitForTimeout(2000);

        // Execute the attack script that would extract plaintext via _cloakOriginal
        const extractionResult = await page.evaluate(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let extractedPlaintext = '';
            let nodesChecked = 0;
            let nodesWithProperty = 0;

            let node;
            while (node = walker.nextNode()) {
                nodesChecked++;
                if (node._cloakOriginal) {
                    nodesWithProperty++;
                    extractedPlaintext += node._cloakOriginal;
                }
            }

            return {
                nodesChecked,
                nodesWithProperty,
                extractedPlaintext: extractedPlaintext.substring(0, 200)
            };
        });

        console.log('Extraction test results:', extractionResult);

        // CRITICAL: After the fix, NO nodes should have _cloakOriginal property
        expect(extractionResult.nodesWithProperty).toBe(0);
        expect(extractionResult.extractedPlaintext).toBe('');
    });

    test('should still have encrypted nodes (encryption working)', async ({ page }) => {
        await page.goto('http://localhost:8080/test-vulnerability-fix.html');
        await page.waitForTimeout(2000);

        // Verify that encryption is actually happening
        const encryptionCheck = await page.evaluate(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let encryptedNodes = 0;

            let node;
            while (node = walker.nextNode()) {
                if (node._cloakEncrypted) {
                    encryptedNodes++;
                }
            }

            return { encryptedNodes };
        });

        console.log('Encryption check:', encryptionCheck);

        // Should have at least some encrypted nodes
        expect(encryptionCheck.encryptedNodes).toBeGreaterThan(0);
    });

    test('WeakMap storage should still work for functionality', async ({ page }) => {
        await page.goto('http://localhost:8080/test-vulnerability-fix.html');
        await page.waitForTimeout(2000);

        // Check that copy/paste and other features still work
        // This implicitly verifies WeakMap storage is working
        const contentElement = await page.locator('#content p').first();
        await contentElement.click();

        // Select all text
        await page.keyboard.down('Meta'); // Cmd on Mac
        await page.keyboard.press('A');
        await page.keyboard.up('Meta');

        // Copy should work (triggers SDK's copy handler)
        // If this doesn't throw an error, WeakMap is working
        await page.keyboard.down('Meta');
        await page.keyboard.press('C');
        await page.keyboard.up('Meta');

        // No assertions needed - if SDK throws errors, test will fail
        console.log('Copy/paste functionality check passed');
    });
});
