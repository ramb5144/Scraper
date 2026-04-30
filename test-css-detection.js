/**
 * Test script to verify CSS property detection
 * Run in browser console after loading test-css-properties.html
 */

function testCSSPropertyDetection() {
    console.log('=== CSS Property Detection Test ===\n');

    const tests = [
        {
            name: 'text-transform: uppercase',
            selector: '.text-transform-upper',
            expectedExcluded: false,
            expectedTransformed: true
        },
        {
            name: 'font-variant: small-caps',
            selector: '.font-variant-small-caps',
            expectedExcluded: false,
            expectedTransformed: true
        },
        {
            name: '-webkit-text-security: disc',
            selector: '.webkit-text-security-disc',
            expectedExcluded: true,
            expectedTransformed: false
        },
        {
            name: 'writing-mode: vertical-rl',
            selector: '.writing-mode-vertical',
            expectedExcluded: true,
            expectedTransformed: false
        }
    ];

    let passed = 0;
    let failed = 0;

    tests.forEach(test => {
        const element = document.querySelector(test.selector);
        if (!element) {
            console.error(`❌ ${test.name}: Element not found`);
            failed++;
            return;
        }

        const textNode = element.childNodes[0];
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
            console.error(`❌ ${test.name}: Text node not found`);
            failed++;
            return;
        }

        // Check if text was encrypted (has _cloakEncrypted marker)
        const wasEncrypted = textNode._cloakEncrypted === true;
        const wasExcluded = !wasEncrypted;

        // Verify exclusion expectation
        if (test.expectedExcluded && !wasExcluded) {
            console.error(`❌ ${test.name}: Expected EXCLUDED but was ENCRYPTED`);
            failed++;
            return;
        }

        if (!test.expectedExcluded && wasExcluded) {
            console.error(`❌ ${test.name}: Expected ENCRYPTED but was EXCLUDED`);
            failed++;
            return;
        }

        // Verify transformation (check if CSS property was reset)
        if (test.expectedTransformed && wasEncrypted) {
            const parent = textNode.parentElement;
            const hasResetMarker = parent._cloakPropertiesReset === true;

            if (!hasResetMarker) {
                console.error(`❌ ${test.name}: Expected properties to be reset but marker not found`);
                failed++;
                return;
            }
        }

        console.log(`✅ ${test.name}: ${wasExcluded ? 'EXCLUDED' : 'ENCRYPTED'} (correct)`);
        passed++;
    });

    console.log(`\n=== Results ===`);
    console.log(`Passed: ${passed}/${tests.length}`);
    console.log(`Failed: ${failed}/${tests.length}`);

    return { passed, failed, total: tests.length };
}

// Auto-run if in browser
if (typeof window !== 'undefined') {
    // Wait for SDK to initialize and encrypt
    setTimeout(() => {
        testCSSPropertyDetection();
    }, 3000);
}
