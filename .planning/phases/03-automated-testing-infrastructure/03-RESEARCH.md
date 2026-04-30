# Phase 3: Automated Testing Infrastructure - Research

**Researched:** 2026-01-23
**Domain:** Browser automation testing with Playwright
**Confidence:** HIGH

## Summary

Playwright is the established standard for modern browser testing, providing comprehensive automation for Chromium, Firefox, and WebKit. It offers built-in features for visual regression testing, network mocking, and robust element assertions. The framework's auto-waiting mechanisms and trace viewer make it ideal for autonomous bug investigation, which is the core objective of this phase.

For this project's specific needs (testing text encryption, font rendering, position mapping, and copy/paste), Playwright provides all necessary primitives: `page.evaluate()` for accessing encrypted DOM content, `document.fonts.ready` for font loading verification, `navigator.clipboard` API for clipboard testing, and `toHaveScreenshot()` for visual regression detection.

The standard approach is to use Page Object Model (POM) pattern with custom fixtures for test organization, webServer configuration for local development testing, and trace viewer with `trace: 'on-first-retry'` for CI debugging.

**Primary recommendation:** Use Playwright Test framework with webServer for local Flask server, custom fixtures for SDK initialization verification, and element-level screenshot comparison for detecting gibberish rendering bugs.

## Standard Stack

The established libraries/tools for browser automation testing in 2026:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @playwright/test | 1.58.0+ | End-to-end test framework | Official Microsoft project, cross-browser support, built-in visual testing, auto-waiting |
| Node.js | 20.x/22.x/24.x LTS | Runtime environment | Required by Playwright, modern async/await support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pixelmatch | Built-in | Screenshot comparison | Automatic with toHaveScreenshot(), no manual install needed |
| playwright-lighthouse | Optional | Performance testing | If performance metrics needed (not required for Phase 3) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Playwright | Selenium WebDriver | Selenium more mature but lacks auto-waiting, slower, more flaky tests |
| Playwright | Puppeteer | Puppeteer Chromium-only, no cross-browser support or test framework |
| Playwright | Cypress | Cypress has easier debugging UI but no true multi-browser, runs in-browser (can't test font loading from browser perspective) |

**Installation:**
```bash
npm install -D @playwright/test
npx playwright install --with-deps  # Installs browsers
```

## Architecture Patterns

### Recommended Project Structure
```
tests/
├── fixtures/           # Custom test fixtures
│   └── sdk-page.ts    # Page fixture with SDK initialization helpers
├── pages/             # Page Object Model classes
│   └── test-page.ts   # Represents sdk_test.html page
├── specs/             # Test specifications
│   ├── encryption.spec.ts       # Core encryption verification
│   ├── position-mapping.spec.ts # Copy/paste accuracy
│   ├── visual.spec.ts           # Screenshot regression
│   └── dynamic.spec.ts          # MutationObserver tests
├── utils/             # Test helpers
│   └── crypto-helpers.ts        # DOM inspection utilities
└── playwright.config.ts          # Central configuration
```

### Pattern 1: Page Object Model with Custom Fixtures

**What:** Encapsulate page interactions in classes, provide them via fixtures for automatic setup/teardown

**When to use:** Testing complex applications with repeated interactions (perfect for SDK initialization + encryption verification pattern)

**Example:**
```typescript
// Source: https://playwright.dev/docs/pom + https://playwright.dev/docs/test-fixtures

// fixtures/sdk-page.ts
import { test as base } from '@playwright/test';
import { TestPage } from '../pages/test-page';

export const test = base.extend<{ testPage: TestPage }>({
  testPage: async ({ page }, use) => {
    const testPage = new TestPage(page);
    await testPage.goto();
    await testPage.waitForFontsReady(); // Ensure fonts loaded before tests
    await use(testPage);
    // Teardown happens automatically
  },
});

// pages/test-page.ts
export class TestPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('http://localhost:8001/sdk_test.html', {
      waitUntil: 'load'
    });
  }

  async waitForFontsReady() {
    // CRITICAL: Wait for custom fonts to load before assertions
    await this.page.waitForFunction(() => document.fonts.ready);
  }

  async initializeSDK() {
    await this.page.click('#btn-init');
    await this.page.waitForSelector('#status.success');
  }

  async getEncryptedDOM() {
    return this.page.evaluate(() => {
      // Access actual DOM content (encrypted text)
      return document.querySelector('h1')?.textContent;
    });
  }

  async getPlaintextFromAttribute() {
    return this.page.evaluate(() => {
      // Access stored plaintext
      const h1Node = document.querySelector('h1')?.firstChild;
      return (h1Node as any)?._cloakOriginal;
    });
  }
}
```

### Pattern 2: WebServer Configuration for Local Testing

**What:** Playwright starts/stops your dev server automatically before/after tests

**When to use:** Testing against local development server (required for this project - Flask server on port 8001)

**Example:**
```typescript
// Source: https://playwright.dev/docs/test-webserver

// playwright.config.ts
export default defineConfig({
  webServer: {
    command: 'python -m flask run --port 8001',
    url: 'http://localhost:8001',
    reuseExistingServer: !process.env.CI, // Reuse local server, fresh in CI
    stdout: 'ignore',  // Suppress Flask logs
    stderr: 'pipe',    // Show errors
    timeout: 30000,    // 30s startup timeout
  },
  use: {
    baseURL: 'http://localhost:8001', // All goto() calls use relative URLs
  },
});
```

### Pattern 3: Network Mocking for API Dependencies

**What:** Intercept and mock API responses to avoid dependency on live backend

**When to use:** Testing SDK behavior without hitting real encryption API (useful for CI/CD isolation)

**Example:**
```typescript
// Source: https://playwright.dev/docs/network

test('SDK handles API errors gracefully', async ({ page }) => {
  // Mock API endpoint to return error
  await page.route('**/api/sdk/encrypt', route => route.fulfill({
    status: 500,
    body: JSON.stringify({ error: 'Internal server error' })
  }));

  await page.goto('/sdk_test.html');
  await page.click('#btn-init');

  // Verify error handling
  await expect(page.locator('#status.error')).toBeVisible();
});
```

### Pattern 4: Element-Level Screenshot Testing

**What:** Compare screenshots of specific elements (not full page) to detect visual regressions

**When to use:** Detecting gibberish rendering bugs where plaintext + encrypted fonts = visual garbage

**Example:**
```typescript
// Source: https://playwright.dev/docs/test-snapshots

test('FAQ section renders correctly, not gibberish', async ({ page }) => {
  await page.goto('/dynamic_test.html');
  // Wait for SDK initialization
  await page.waitForFunction(() => (window as any).CloakSDK?.isInitialized);

  const faqSection = page.locator('h2:has-text("Frequently Asked")');

  // Screenshot comparison catches gibberish ("Freqfkntly Asked Qfkstions")
  await expect(faqSection).toHaveScreenshot('faq-header.png', {
    maxDiffPixels: 100  // Allow minor anti-aliasing differences
  });
});
```

### Pattern 5: Trace Viewer for Autonomous Debugging

**What:** Record test execution traces with DOM snapshots, network requests, and screenshots for post-failure analysis

**When to use:** CI environments where you can't debug live (the autonomous debugging goal of Phase 3)

**Example:**
```typescript
// Source: https://playwright.dev/docs/trace-viewer

// playwright.config.ts
export default defineConfig({
  use: {
    trace: 'on-first-retry',  // Capture trace only on first retry
  },
  retries: process.env.CI ? 2 : 0,  // Retry failed tests in CI
});

// After test failure, view trace:
// npx playwright show-trace trace.zip
// Provides time-travel debugging with DOM snapshots, console logs, network requests
```

### Anti-Patterns to Avoid

- **Hard-coded waits:** Never use `page.waitForTimeout(5000)` - use auto-waiting assertions like `toBeVisible()` instead
- **Full-page screenshots:** Too brittle, minor header changes break tests - use element-level screenshots
- **Long test flows:** Each test should verify one behavior, not multi-step user journeys
- **Shared state:** Don't reuse browser context between tests - Playwright isolates by default, keep it that way
- **Testing external APIs:** Mock third-party endpoints, don't depend on external services in tests

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Screenshot comparison | Custom pixel diff algorithm | `toHaveScreenshot()` with pixelmatch | Handles anti-aliasing, platform differences, threshold configuration |
| Clipboard testing | Manual clipboard simulation | `navigator.clipboard` API with `clipboard-read` permission | Cross-browser compatible, handles async clipboard operations |
| Font loading detection | Polling for font metrics | `document.fonts.ready` promise | Native browser API, handles all font sources (local, remote, data URIs) |
| Network stubbing | Custom request interceptor | `page.route()` and `route.fulfill()` | Handles timing, CORS, WebSocket, HAR replay |
| Test server lifecycle | Manual server start/stop | `webServer` config option | Handles port conflicts, startup detection, graceful shutdown |
| Parallel execution | Custom test runner | Built-in `--workers` flag | Handles test isolation, worker crashes, sharding across machines |
| Flaky test retry | Manual retry loops | `retries` config option | Smart retry (on-first-retry), preserves traces, doesn't hide real failures |

**Key insight:** Browser automation edge cases are numerous and subtle. Playwright has solved font timing, clipboard permissions, screenshot platform differences, and network race conditions. Custom solutions will miss edge cases that cause CI flakiness.

## Common Pitfalls

### Pitfall 1: Font Rendering Races

**What goes wrong:** Tests run before custom fonts load, causing false negatives when checking rendered text or screenshots

**Why it happens:** `page.goto()` with `waitUntil: 'load'` doesn't wait for fonts - the `load` event fires before `@font-face` fonts finish downloading

**How to avoid:** Always wait for `document.fonts.ready` before text assertions or screenshots:
```typescript
await page.goto('/test.html');
await page.waitForFunction(() => document.fonts.ready);
// Now safe to check text rendering
```

**Warning signs:**
- Screenshots fail only in CI, pass locally (local has cached fonts)
- Text assertions flaky on first test run, stable on second
- WebKit shows different rendering than Chromium consistently

**Sources:** [GitHub Issue #18640](https://github.com/microsoft/playwright/issues/18640), [TestAutomationMastery Guide](https://testautomationmastery.com/how-to-wait-for-font-loading-to-ensure-complete-page-load-in-playwright-tests/)

### Pitfall 2: Clipboard Permissions Not Granted

**What goes wrong:** `navigator.clipboard.readText()` throws permission error in tests

**Why it happens:** Clipboard API requires explicit permission grant, even in test context

**How to avoid:** Grant permissions in config or per-context:
```typescript
// Global config
use: {
  permissions: ['clipboard-read', 'clipboard-write']
}

// Or per-test
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
```

**Warning signs:**
- Copy/paste tests throw `NotAllowedError: Read permission denied`
- Tests work in headed mode, fail in headless
- Firefox/WebKit require different configuration than Chromium

**Sources:** [PlaywrightSolutions Guide](https://playwrightsolutions.com/how-do-i-access-the-browser-clipboard-with-playwright/)

### Pitfall 3: Evaluating Non-Serializable Values

**What goes wrong:** `page.evaluate()` returns `undefined` instead of expected object/function

**Why it happens:** Playwright serializes return values across Node.js/browser boundary - functions, DOM nodes, Symbols can't serialize

**How to avoid:** Extract serializable properties in evaluate():
```typescript
// WRONG - returns undefined
const element = await page.evaluate(() => document.querySelector('h1'));

// RIGHT - extract textContent (serializable string)
const text = await page.evaluate(() => {
  return document.querySelector('h1')?.textContent;
});
```

**Warning signs:**
- `page.evaluate()` returns undefined unexpectedly
- Can't access DOM nodes outside evaluate context
- TypeScript types don't match runtime values

**Sources:** [Playwright API Docs](https://playwright.dev/docs/api/class-page#page-evaluate)

### Pitfall 4: Screenshot Flakiness from Dynamic Content

**What goes wrong:** Visual regression tests fail randomly on elements with animations, timestamps, or dynamic data

**Why it happens:** Screenshot captures current frame - animations mid-transition, current timestamp, async-loaded content

**How to avoid:**
1. Disable animations with CSS injection
2. Mock time/data for deterministic content
3. Use element-level screenshots, not full page
4. Set appropriate `maxDiffPixels` threshold

```typescript
// Disable animations before screenshot
await page.addStyleTag({
  content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }'
});

// Mock Date for deterministic timestamps
await page.addInitScript(() => {
  Date.now = () => 1640000000000;
});
```

**Warning signs:**
- Screenshots fail ~10% of the time with "1-5% pixel difference"
- Timestamps/counters visible in failed diffs
- Animations captured at different frames

**Sources:** [Playwright Visual Testing Guide](https://playwright.dev/docs/test-snapshots), [BrowserStack Guide](https://www.browserstack.com/guide/visual-regression-testing-using-playwright)

### Pitfall 5: Using Brittle Selectors

**What goes wrong:** Tests break when CSS classes or DOM structure changes, even though functionality works

**Why it happens:** XPath and CSS class selectors tied to implementation details, not user-facing attributes

**How to avoid:** Prefer role-based and text-based locators:
```typescript
// BRITTLE - breaks if class changes
await page.locator('.btn-primary.submit-btn').click();

// ROBUST - uses role and text (user-facing attributes)
await page.getByRole('button', { name: 'Submit' }).click();
```

**Warning signs:**
- Tests break after UI refactoring that doesn't change functionality
- Many `data-testid` attributes added just for tests
- Long XPath or CSS selector chains

**Sources:** [Playwright Best Practices](https://playwright.dev/docs/best-practices), [BrowserStack Selector Guide](https://www.browserstack.com/guide/playwright-selectors-best-practices)

### Pitfall 6: Not Isolating Test State

**What goes wrong:** Tests pass in isolation but fail when run together, or fail randomly depending on execution order

**Why it happens:** Shared browser context, localStorage, cookies, or global JavaScript state leaks between tests

**How to avoid:** Playwright provides fresh context per test by default - don't override this. Clear storage explicitly if needed:
```typescript
test.beforeEach(async ({ context }) => {
  // Clear storage before each test
  await context.clearCookies();
  await context.clearPermissions();
});
```

**Warning signs:**
- `npx playwright test single.spec.ts` passes
- `npx playwright test` (all tests) fails randomly
- Test order affects pass/fail
- Logged-in state from previous test

**Sources:** [Playwright Best Practices](https://playwright.dev/docs/best-practices), [Better Stack Guide](https://betterstack.com/community/guides/testing/playwright-best-practices/)

## Code Examples

Verified patterns from official sources:

### Encryption Verification Test
```typescript
// Source: https://playwright.dev/docs/api/class-page#page-evaluate

test('all visible text is encrypted in DOM', async ({ page }) => {
  await page.goto('/sdk_test.html');
  await page.click('#btn-init');
  await page.waitForSelector('#status.success');

  // Get encrypted DOM content
  const encryptedH1 = await page.evaluate(() => {
    return document.querySelector('h1')?.textContent;
  });

  // Get stored plaintext
  const plaintextH1 = await page.evaluate(() => {
    const h1Node = document.querySelector('h1')?.firstChild;
    return (h1Node as any)?._cloakOriginal;
  });

  // Verify encryption happened
  expect(encryptedH1).toBeTruthy();
  expect(plaintextH1).toBeTruthy();
  expect(encryptedH1).not.toBe(plaintextH1);
  expect(plaintextH1).toBe('The Future of Web Content Protection');
});
```

### Copy/Paste Position Mapping Test
```typescript
// Source: https://playwright.dev/docs/api/class-page#page-evaluate + clipboard API

test('copy/paste returns original plaintext', async ({ page, context }) => {
  // Grant clipboard permissions
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/sdk_test.html');
  await page.click('#btn-init');
  await page.waitForSelector('#status.success');

  // Select text programmatically
  await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const range = document.createRange();
    range.selectNodeContents(h1!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });

  // Trigger copy (decrypt-interceptor should intercept)
  await page.keyboard.press('Control+C');

  // Read clipboard
  const clipboardText = await page.evaluate(() => {
    return navigator.clipboard.readText();
  });

  expect(clipboardText).toBe('The Future of Web Content Protection');
});
```

### Font Application Verification Test
```typescript
// Source: https://playwright.dev/docs/api/class-locatorassertions#locator-assertions-to-have-css

test('encrypted fonts are applied to encrypted text', async ({ page }) => {
  await page.goto('/sdk_test.html');
  await page.click('#btn-init');
  await page.waitForSelector('#status.success');
  await page.waitForFunction(() => document.fonts.ready);

  const h1 = page.locator('h1');

  // Check computed font-family includes encrypted font
  await expect(h1).toHaveCSS('font-family', /CloakFont_Roboto/);
});
```

### Visual Regression Test (No Gibberish)
```typescript
// Source: https://playwright.dev/docs/test-snapshots

test('FAQ section does not show gibberish', async ({ page }) => {
  await page.goto('/dynamic_test.html');

  // Wait for SDK initialization
  await page.waitForFunction(() => {
    return (window as any).CloakSDK?.getStats().initialized === true;
  });

  // Wait for fonts
  await page.waitForFunction(() => document.fonts.ready);

  const faqHeader = page.locator('h2', { hasText: 'Frequently' }).first();

  // Screenshot comparison catches "Freqfkntly Asked Qfkstions" rendering
  await expect(faqHeader).toHaveScreenshot('faq-header.png', {
    maxDiffPixels: 50  // Allow minor anti-aliasing
  });
});
```

### Dynamic Content Encryption Test
```typescript
// Source: https://playwright.dev/docs/api/class-page#page-wait-for-function

test('dynamically added content is encrypted by MutationObserver', async ({ page }) => {
  await page.goto('/sdk_test.html');
  await page.click('#btn-init');
  await page.waitForSelector('#status.success');

  // Add dynamic content
  await page.click('#btn-add-content');

  // Wait for MutationObserver to process (batched with 16ms delay)
  await page.waitForTimeout(100);

  // Verify new content is encrypted
  const dynamicEncrypted = await page.evaluate(() => {
    const container = document.querySelector('#dynamic-content h3');
    return container?.textContent;
  });

  const dynamicPlaintext = await page.evaluate(() => {
    const container = document.querySelector('#dynamic-content h3');
    const textNode = container?.firstChild;
    return (textNode as any)?._cloakOriginal;
  });

  expect(dynamicEncrypted).not.toBe(dynamicPlaintext);
  expect(dynamicPlaintext).toBe('Dynamic Article Section');
});
```

### Network Mocking for API Testing
```typescript
// Source: https://playwright.dev/docs/network

test('SDK handles font API failure gracefully', async ({ page }) => {
  // Mock font endpoint to fail
  await page.route('**/api/sdk/encrypt', route => route.fulfill({
    status: 200,
    body: JSON.stringify({
      // Valid config but bad font
      characterMappings: { 'a': 'b' },
      fonts: 'INVALID_FONT_DATA'
    })
  }));

  await page.goto('/sdk_test.html');
  await page.click('#btn-init');

  // SDK should show error status
  await expect(page.locator('#status.error')).toBeVisible();
  await expect(page.locator('#status')).toContainText('font');
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Selenium WebDriver | Playwright | 2020-2024 transition | Auto-waiting eliminates flaky tests, trace viewer enables autonomous debugging |
| `waitForTimeout()` | Auto-retrying assertions | Playwright 1.0+ (2020) | Tests more reliable, faster feedback on failures |
| Full-page screenshots | Element-level screenshots | Playwright 1.15+ (2021) | Reduced false positives from unrelated UI changes |
| Manual clipboard simulation | `navigator.clipboard` API | Supported since Playwright 1.9+ (2020) | Accurate clipboard testing across browsers |
| Custom test fixtures | Built-in fixture system | Playwright Test 1.10+ (2020) | Better test isolation, TypeScript support, composability |
| Screenshots for debugging | Trace viewer | Playwright 1.11+ (2021) | Time-travel debugging replaces guesswork from static images |

**Deprecated/outdated:**
- **`waitForTimeout()`:** Discouraged in favor of `waitForSelector()`, `waitForFunction()`, and auto-retrying assertions
- **`page.waitForNavigation()`:** Replaced by `waitUntil` option in `page.goto()` and automatic navigation waiting
- **CSS/XPath selectors for buttons:** Use `getByRole('button')` instead for accessibility-aligned testing
- **Video recording for all tests:** Use `trace: 'on-first-retry'` instead - videos consume storage, traces provide more debugging value

## Open Questions

Things that couldn't be fully resolved:

### 1. WebKit Font Rendering Consistency

**What we know:** WebKit has known issues with custom font rendering that differ from Chromium/Firefox, particularly spacing with icon fonts and variable fonts

**What's unclear:** Will encrypted fonts (WOFF2 with swapped glyphs) render identically across browsers, or will WebKit show pixel differences requiring separate baselines?

**Recommendation:** Run initial visual tests on all three browsers (Chromium, Firefox, WebKit) to establish if separate screenshot baselines needed per browser. Use `maxDiffPixels` threshold to allow minor anti-aliasing differences.

**Sources:** [GitHub Issue #2626](https://github.com/microsoft/playwright/issues/2626), [GitHub Issue #22429](https://github.com/microsoft/playwright/issues/22429)

### 2. Text-Transform Position Mapping Verification

**What we know:** SDK applies CSS `text-transform` before encryption and uses transformed text length for position tracking (per encryption-flow.md)

**What's unclear:** Whether current position mapping tests adequately verify this edge case, especially for `text-transform: capitalize` which changes character count in some locales

**Recommendation:** Create dedicated test with `text-transform: uppercase` on various elements, verify copy/paste returns correctly transformed text. Document any discrepancies found.

### 3. CI Environment Font Caching

**What we know:** GitHub Actions ubuntu-latest runners may cache fonts between test runs, potentially masking font loading race conditions

**What's unclear:** Whether `npx playwright install --with-deps` provides consistent font environment, or if additional font cache clearing needed

**Recommendation:** Monitor for flaky font-related tests in CI. If detected, add explicit font cache clearing to CI workflow or use Docker container with controlled font environment.

### 4. Optimal Screenshot Threshold Values

**What we know:** `maxDiffPixels` controls how many pixels can differ before screenshot test fails

**What's unclear:** Optimal threshold for encrypted text rendering - too low causes false positives from anti-aliasing, too high misses real bugs like gibberish

**Recommendation:** Start with `maxDiffPixels: 50` for element-level screenshots, adjust based on false positive rate. Document threshold reasoning in test comments.

## Sources

### Primary (HIGH confidence)

- **Playwright Official Documentation**
  - Introduction and Features: https://playwright.dev/docs/intro
  - Best Practices: https://playwright.dev/docs/best-practices
  - Test Fixtures: https://playwright.dev/docs/test-fixtures
  - Page Object Model: https://playwright.dev/docs/pom
  - Visual Comparisons: https://playwright.dev/docs/test-snapshots
  - WebServer Configuration: https://playwright.dev/docs/test-webserver
  - Network Mocking: https://playwright.dev/docs/network
  - LocatorAssertions API: https://playwright.dev/docs/api/class-locatorassertions
  - page.evaluate() API: https://playwright.dev/docs/api/class-page#page-evaluate
  - Trace Viewer: https://playwright.dev/docs/trace-viewer

- **npm Registry**
  - @playwright/test version 1.58.0 (verified latest: 2026-01-23)

### Secondary (MEDIUM confidence)

- **BrowserStack Testing Guides (2026)**
  - [15 Best Practices for Playwright testing in 2026](https://www.browserstack.com/guide/playwright-best-practices)
  - [Playwright Selector Best Practices in 2026](https://www.browserstack.com/guide/playwright-selectors-best-practices)
  - [Snapshot Testing with Playwright in 2026](https://www.browserstack.com/guide/playwright-snapshot-testing)
  - [Visual Regression Testing Using Playwright](https://www.browserstack.com/guide/visual-regression-testing-using-playwright)
  - [How to get the text of an element using Playwright in 2026](https://www.browserstack.com/guide/playwright-get-text-of-element)
  - [Fixtures in Playwright [2026]](https://www.browserstack.com/guide/fixtures-in-playwright)

- **Testing Community Guides (2025-2026)**
  - [9 Playwright Best Practices and Pitfalls to Avoid](https://betterstack.com/community/guides/testing/playwright-best-practices/)
  - [Playwright End-to-End Testing: A Step-by-Step Guide](https://betterstack.com/community/guides/testing/playwright-end-to-end-testing/)
  - [How to Wait for Font Loading in Playwright Tests](https://testautomationmastery.com/how-to-wait-for-font-loading-to-ensure-complete-page-load-in-playwright-tests/)
  - [How do I access the browser clipboard with Playwright?](https://playwrightsolutions.com/how-do-i-access-the-browser-clipboard-with-playwright/)

- **GitHub Official Resources**
  - [Setup a local dev server for your Playwright tests](https://dev.to/playwright/setup-a-local-dev-server-for-your-playwright-tests-33m9)
  - [Getting Started with Integrating Playwright and GitHub Actions](https://autify.com/blog/playwright-github-actions)

### Tertiary (LOW confidence - for awareness)

- **GitHub Issues (Known Problems)**
  - [Font loading in component tests - Issue #18640](https://github.com/microsoft/playwright/issues/18640)
  - [WebKit font rendering spacing - Issue #2626](https://github.com/microsoft/playwright/issues/2626)
  - [WebKit incorrect font rendering on Ubuntu - Issue #22429](https://github.com/microsoft/playwright/issues/22429)
  - [Variable font rendering in CI - Issue #29596](https://github.com/microsoft/playwright/issues/29596)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Playwright is the established standard, latest version verified from npm registry, official Microsoft project
- Architecture: HIGH - POM + fixtures pattern documented in official Playwright docs, widely adopted in 2026
- Font loading: MEDIUM - `document.fonts.ready` solution verified from official GitHub issue and community guides, but WebKit edge cases exist
- Clipboard testing: MEDIUM - `navigator.clipboard` API is standard, but browser-specific permission config needs testing
- Visual testing: MEDIUM - `toHaveScreenshot()` is built-in, but optimal thresholds and multi-browser consistency need validation
- Pitfalls: MEDIUM - Sourced from official docs + community experience, but project-specific edge cases may emerge

**Research date:** 2026-01-23
**Valid until:** ~60 days (2026-03-24) - Playwright stable with monthly releases, architecture patterns mature
