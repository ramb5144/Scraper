
// Debug helper - only runs when explicitly called
window.debugEncryption = function() {
    console.log('%c🔧 Encryption Debug Information', 'color: #4CAF50; font-weight: bold; font-size: 16px;');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    console.log('%c1. Configuration', 'color: #2196F3; font-weight: bold; font-size: 14px;');
    console.table(window.encryptionConfig || { error: 'Not set' });

    console.log('%c2. Available Functions', 'color: #9C27B0; font-weight: bold; font-size: 14px;');
    console.log({
        'decryptText': typeof window.decryptText,
        'encryptLazyContent': typeof window.encryptLazyContent,
        'searchEncryptedContent': typeof window.searchEncryptedContent,
        'showSearchOverlay': typeof window.showSearchOverlay
    });

    console.log('%c3. Font Status', 'color: #FF9800; font-weight: bold; font-size: 14px;');
    if (document.fonts) {
        const allFonts = Array.from(document.fonts);
        const encryptedFontsByName = allFonts.filter(f =>
            f.family.includes('Encrypted') || f.family.includes('decryption')
        );

        // Check for font sources in CSS (base64 vs URLs)
        const styleTags = document.querySelectorAll('style');
        let base64InlinedFonts = 0;
        let urlBasedFonts = 0;

        styleTags.forEach(style => {
            const css = style.textContent || '';

            // Check for base64 inlined fonts
            const base64Matches = css.match(/data:font\/woff2;base64,[A-Za-z0-9+\/=]+/g);
            if (base64Matches) base64InlinedFonts += base64Matches.length;

            // Check for URL-based fonts
            if (css.includes('proxy-font') || css.includes('decryption_') || css.includes('/fonts/decryption_')) {
                const urlMatches = css.match(/url\(['"]?([^'"]*(?:proxy-font|decryption_)[^'"]*)['"]?\)/g);
                if (urlMatches) urlBasedFonts += urlMatches.length;
            }
        });

        const fontLinks = document.querySelectorAll('link[rel="preload"][as="font"], link[href*="decryption_"], link[href*="proxy-font"]');

        const loadingMethod = base64InlinedFonts > 0
            ? '✅ Base64 Inlined (instant)'
            : urlBasedFonts > 0
            ? '🌐 URL-Based (network)'
            : '⚠️ Unknown';

        console.log({
            'Total fonts': allFonts.length,
            'Encrypted fonts (by name)': encryptedFontsByName.length,
            'Base64 inlined fonts': base64InlinedFonts,
            'URL-based fonts': urlBasedFonts,
            'Font preload links': fontLinks.length,
            'Loading Method': loadingMethod,
            'Fonts ready': document.fonts.check('1em EncryptedFont') || base64InlinedFonts > 0 || urlBasedFonts > 0
        });

        if (base64InlinedFonts > 0) {
            console.log('%c⚡ Fonts inlined as base64 - loaded instantly!', 'color: #4CAF50; font-weight: bold;');
        } else if (urlBasedFonts > 0) {
            console.log('%c⏳ Fonts loaded from URLs - network request required', 'color: #FF9800; font-weight: bold;');
        }
    }

    console.log('%c4. DOM Analysis', 'color: #00BCD4; font-weight: bold; font-size: 14px;');
    const encryptedElements = document.querySelectorAll('[style*="font-family"][style*="Encrypted"], span[style*="word-break"]');
    console.log({
        'Encrypted elements': encryptedElements.length,
        'Sample elements': Array.from(encryptedElements).slice(0, 3).map(el => ({
            tag: el.tagName,
            text: el.textContent.substring(0, 50) + '...',
            hasEncryptedFont: getComputedStyle(el).fontFamily.includes('Encrypted')
        }))
    });

    console.log('%c5. API Connectivity', 'color: #F44336; font-weight: bold; font-size: 14px;');
    if (window.encryptionConfig && window.encryptionConfig.apiBaseUrl) {
        fetch(window.encryptionConfig.apiBaseUrl + '/api/health')
            .then(res => res.json())
            .then(data => console.log({ status: '✅ Connected', service: data.service }))
            .catch(err => console.error({ status: '❌ Failed', error: err.message }));
    } else {
        console.warn('API Base URL not configured');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('%c💡 Run debugEncryption() anytime to see this information', 'color: #607D8B; font-style: italic;');
};
