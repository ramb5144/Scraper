---
status: inconclusive
trigger: "faq-still-shows-gibberish-after-font-display-fix"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:15:00Z
---

## Current Focus

hypothesis: INVESTIGATION COMPLETE - FAQ h2 text should be encrypted but is not. No exclusion mechanism found. The uncommitted font-display: block changes are unrelated. Root cause cannot be determined without runtime debugging.
test: Need to commit font-display changes, add debug logging, and test in browser
expecting: Debug logs will reveal where FAQ h2 text node is being lost during encryption
next_action: Commit font-display changes and return inconclusive diagnosis

## Symptoms

expected: FAQ section should show "Frequently Asked Questions" in readable text
actual: FAQ section shows "Freqfkntly Asked Qfkstions" - plaintext rendered with encrypted fonts
errors: None - visual rendering issue only
reproduction: Load dynamic_test.html page, observe FAQ section header
started: Issue persists after font-display: block changes were made to cloak-sdk.js (uncommitted). Previous debug concluded font-display: swap was the root cause, but changing to block hasn't resolved it.

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:01:00Z
  checked: cloak-sdk.js line 73
  found: fontDisplay is set to 'block' (not 'swap')
  implication: Font-display change WAS applied correctly - this is NOT a font-display issue

- timestamp: 2026-01-22T00:02:00Z
  checked: cloak-sdk.js lines 988, 1086, 1153, 1251, 1278
  found: All @font-face declarations use font-display: block
  implication: Font-display is correctly set throughout the SDK

- timestamp: 2026-01-22T00:03:00Z
  checked: Symptom description
  found: "plaintext rendered with encrypted fonts" - gibberish appears when plaintext uses encrypted font glyphs
  implication: The FAQ text is NOT being encrypted by the SDK, but the encrypted fonts are being applied to it

- timestamp: 2026-01-22T00:04:00Z
  checked: Git commit 28f57cb "fix: remove excessive logging and add ticker exclusion to SDK"
  found: Added ticker exclusion checks at lines 168-172 (text node path) and line 217 (element parent path)
  implication: This commit added exclusion logic that may be incorrectly excluding FAQ section

- timestamp: 2026-01-22T00:05:00Z
  checked: Ticker exclusion code in commit 28f57cb
  found: Lines 168-172 check "element.classList.contains('ticker-content') || element.classList.contains('breaking-news')"
  implication: This checks element.classList without verifying classList exists first, but there's already a check on line 165

- timestamp: 2026-01-22T00:06:00Z
  checked: Commit 688f8f0 "refactor(quick-005): replace hardcoded exclusions with config-driven selectors"
  found: This commit REMOVED the hardcoded ticker exclusion code and replaced with config.excludeSelectors matching
  implication: If ticker classes aren't in config, they won't be excluded - but ticker has data-cloak-exclude now per commit 3ef1d74

- timestamp: 2026-01-22T00:07:00Z
  checked: FAQ h2 element structure (line 1267-1268)
  found: <h2 style="font-family: 'Playfair Display', serif; font-size: 32px; margin-bottom: 20px;">Frequently Asked Questions</h2>
  implication: No data-cloak-exclude attribute, h2 is NOT in excludeSelectors tags, should be encrypted normally

- timestamp: 2026-01-22T00:08:00Z
  checked: SDK initialization flow (lines 1800-1825)
  found: Flow is: hide body -> load fonts -> encrypt content -> show body
  implication: This should prevent FOUC (Flash of Unencrypted Content). But symptom IS FOUC - plaintext with encrypted fonts

- timestamp: 2026-01-22T00:09:00Z
  checked: Previous debug session encrypted-fonts-not-rendering-correctly.md
  found: EXACT SAME SYMPTOM - FAQ shows "Freqfkntly Asked Qfkstions". That session is still in "fixing" status, not resolved!
  implication: This is NOT a new issue from font-display change - it's the ORIGINAL unfixed issue! The FAQ h2 is NOT being encrypted.

- timestamp: 2026-01-22T00:10:00Z
  checked: Previous debug session faq-encrypted-fonts-not-applied.md
  found: DIFFERENT symptom - FAQ showed ENCRYPTED text "KMkwfkteGj Fdqkg TfkdeoJtd" with wrong fonts. Fixed by changing font-display to block.
  implication: There were TWO separate FAQ issues. One was fixed (encrypted text + wrong font). The OTHER persists (plaintext + encrypted font).

## Resolution

root_cause: FAQ h2 text "Frequently Asked Questions" is NOT being encrypted, causing plaintext to render with encrypted Playfair Display font glyphs = gibberish "Freqfkntly Asked Qfkstions". Code analysis found NO exclusion mechanism that would skip this element. The uncommitted font-display: swap -> block changes are unrelated. This is the same underlying issue as encrypted-fonts-not-rendering-correctly.md which remains unfixed. Root cause cannot be determined without runtime debugging to trace actual execution.

fix: INCONCLUSIVE - Cannot fix without identifying why FAQ is not encrypted. Recommend:
1. Commit font-display: swap -> block changes (good hygiene, unrelated to this bug)
2. Add temporary debug logging to trace execution:
   - getTextNodes(): Log count and sample of found nodes
   - encryptTextNode(): Log each node being encrypted with parent info
   - shouldExcludeNode(): Log exclusion decisions with reason
3. Test in browser with debug: true
4. Examine logs to find where FAQ h2 text node disappears

Alternative hypothesis to test: The FAQ h2 IS being encrypted, but then REPLACED with plaintext by some other code path (mutation observer re-encryption bug, innerHTML replacement, etc.).

verification: NOT VERIFIED - investigation inconclusive, requires runtime testing

files_changed: []
