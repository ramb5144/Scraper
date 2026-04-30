---
status: investigating
trigger: "debug-panel-encrypted: The debug panel text on encrypted pages is being encrypted/garbled instead of remaining readable"
created: 2026-01-22T10:00:00Z
updated: 2026-01-22T10:00:00Z
---

## Current Focus

hypothesis: Debug panel is missing data-cloak-exclude attribute or exclusion logic is not working
test: Read cloak-sdk.js to find debug panel creation and exclusion logic
expecting: Find where debug panel is created and whether it has proper exclusion attributes
next_action: Read client/cloak-sdk.js to understand debug panel creation

## Symptoms

expected: Debug panel should show readable text like "Cloak SDK Debug", "SDK: Disabled (Plain Mode)", "Font: Web fonts loaded", "Encryption: OFF"
actual: Debug panel shows encrypted/garbled text like "DCFJo eEy EAKWP", "eEy: MFJXAX", "GFrV: 46 CFJXAX", "irLIatVmFr: BLVmzA"
errors: No console errors, the encryption is working - just encrypting text it shouldn't
reproduction: Visit http://localhost:8001/test-webfonts and look at debug panel in bottom-right corner
started: On newly created test page, but likely affects all pages with debug panels

## Eliminated

## Evidence

- timestamp: 2026-01-22T10:05:00Z
  checked: test_localhost_webfonts.html debug panel structure
  found: Debug panel is a div with class="debug-panel" and id="debugPanel" (lines 1075-1083). It does NOT have data-cloak-exclude attribute.
  implication: Debug panel text will be encrypted because it's not excluded

- timestamp: 2026-01-22T10:05:00Z
  checked: cloak-sdk.js exclusion logic (lines 131-214)
  found: shouldExcludeNode() checks for data-cloak-exclude attribute on elements and ancestors. The debug panel in the HTML does not have this attribute.
  implication: ROOT CAUSE IDENTIFIED - Debug panel missing data-cloak-exclude attribute

- timestamp: 2026-01-22T10:05:00Z
  checked: cloak-sdk.js CSS exclusion rules (lines 1002-1012, 1021-1034)
  found: CSS includes [data-cloak-exclude] font-family override to use system fonts, but this only affects font rendering, not encryption exclusion. The encryption exclusion happens in shouldExcludeNode() which checks for the attribute.
  implication: CSS override exists but is useless without the attribute on the element

## Resolution

root_cause:
fix:
verification:
files_changed: []
