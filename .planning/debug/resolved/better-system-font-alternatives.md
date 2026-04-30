---
status: resolved
trigger: "Investigate issue: better-system-font-alternatives"
created: 2026-01-22T00:00:00Z
updated: 2026-01-22T00:06:30Z
---

## Current Focus

hypothesis: There are multiple approaches to achieve better system font matching - (1) better substitute fonts, (2) Local Font Access API, (3) visual adjustment techniques
test: Research each approach's feasibility, accuracy, and legal/technical constraints
expecting: Find 2-3 viable approaches with trade-offs documented
next_action: Research font alternatives and browser APIs

## Symptoms

expected: Find and implement font sources that provide closer visual matches to system fonts like Georgia, Arial, Times New Roman, Helvetica, etc. Ideally pixel-perfect or near-identical rendering.

actual: Currently using Google's "Liberation" fonts (Tinos, Arimo) which are metrically compatible but have visual differences (stroke weight, curves, etc.). This causes subtle but noticeable differences between encrypted and plain text.

errors: Not a bug - this is a research/improvement task.

reproduction: N/A - research task

started: Ongoing issue since system font support was added.

## Eliminated

## Evidence

- timestamp: 2026-01-22T00:01:00Z
  checked: Current implementation in system_fonts.py
  found: Using Google's Croscore fonts (Tinos, Arimo, Cousine) which are metrically compatible with Times/Georgia, Arial/Helvetica, Courier respectively. Comment on line 54 notes "Tinos is closest, but not exact" for Georgia. Line 1016-1033 in cloak-sdk.js shows weight compensation (font-weight: 500) applied for Tinos because it renders lighter than Georgia.
  implication: Current solution acknowledges visual differences and attempts CSS-based compensation for weight mismatch.

- timestamp: 2026-01-22T00:02:00Z
  checked: Liberation fonts vs Croscore fonts comparison
  found: Both share same origin (Steve Matteson designs). Croscore is the more recent version (2012+). Apache OpenOffice replaced Liberation with Croscore in v3.4. Users report Croscore has better visualization, more compatible metrics, increased glyph support, better language coverage (Hebrew, Pinyin, African alphabets).
  implication: Current choice of Croscore (Tinos/Arimo) is already the BETTER option vs Liberation fonts. No upgrade path here.

- timestamp: 2026-01-22T00:03:00Z
  checked: Gelasio as Georgia alternative
  found: Gelasio is metrically compatible with Georgia and designed by Eben Sorkin. Available on Google Fonts. Has additional weights (Medium, SemiBold) beyond Georgia's Regular/Bold. Converted to variable font in Oct 2023 (v1.008). Visual difference: "Georgia is simpler and warmer, Gelasio is a bit stricter and more sophisticated."
  implication: Gelasio is a potential UPGRADE for Georgia substitute - same metrics, more weights, variable font support, but DIFFERENT visual character (stricter vs warmer).

- timestamp: 2026-01-22T00:04:00Z
  checked: Local Font Access API browser support
  found: Available in Chrome/Chromium 103+ on desktop (2026). Requires user permission prompt via Permissions API. Firefox has no support (standards-positions issue #401). Safari has no support. API is WICG experimental spec, not W3C standard. Allows enumeration of local fonts and raw font data access via queryLocalFonts().
  implication: Local Font Access API is Chromium-only, requires user permission, would break Firefox/Safari. NOT a viable universal solution for Cloak.

- timestamp: 2026-01-22T00:05:00Z
  checked: Variable fonts for weight adjustment
  found: Variable fonts support fine-grained weight control via font-weight: 625 or font-variation-settings: "wght" 625. Weight axis (wght) typically ranges 100-900. Modern CSS supports this across all browsers in 2026. Gelasio was converted to variable font in Oct 2023.
  implication: IF we use Gelasio (variable font), we could programmatically adjust weight to better match Georgia's visual weight without synthetic bolding.

- timestamp: 2026-01-22T00:06:00Z
  checked: Font redistribution legal requirements
  found: System fonts (Arial, Times New Roman, Georgia) are protected. Font design NOT copyrightable in US, but font programs ARE. Microsoft fonts require licensing for redistribution/commercial use ($210-$340 per font). Open source alternatives use SIL OFL allowing free use/modification/redistribution. Cannot legally extract and serve system fonts.
  implication: Cannot use Local Font Access API to extract and redistribute system fonts - licensing violation. Must use open source alternatives (current approach is correct).

## Resolution

root_cause: Current Croscore fonts (Tinos/Arimo/Cousine) are already the best freely available metric-compatible alternatives. The visual differences (especially Tinos being lighter than Georgia) are inherent to the substitute fonts' design, not a solvable technical problem. Other approaches (Local Font Access API, system font extraction) are either browser-limited or legally prohibited.

recommended_approaches:
1. **BEST: Switch Georgia → Gelasio (variable font)** - Gelasio is metrically compatible with Georgia, has more weights, is a variable font (fine-grained weight control), and is visually closer to Georgia than Tinos. Can use font-variation-settings to dial in exact visual weight match.

2. **KEEP: Arimo for Arial/Helvetica** - Already using the best option (Croscore Arimo). No better alternative exists.

3. **KEEP: Tinos for Times New Roman** - Tinos is metrically compatible and visually acceptable. Times New Roman is less commonly used than Georgia, so lower priority for improvement.

4. **ENHANCEMENT: Variable font weight tuning** - For fonts that support variable weights, use CSS font-variation-settings to fine-tune visual weight matching without synthetic bolding.

5. **NOT VIABLE: Local Font Access API** - Chromium-only (breaks Firefox/Safari), requires user permission prompt, legally cannot redistribute extracted fonts. Rejected.

6. **NOT VIABLE: Server-side font extraction** - Legally prohibited to extract and redistribute Microsoft system fonts. Server wouldn't have access to user's fonts anyway. Rejected.

priority_recommendation: Implement approach #1 (Gelasio for Georgia) as it directly addresses the main complaint (Tinos being lighter than Georgia) with a better, legally compliant alternative that's already on Google Fonts.

trade_offs:
- Gelasio is "stricter and more sophisticated" vs Georgia's "simpler and warmer" character - visually closer weight but different personality
- Variable font weight tuning adds CSS complexity but enables precise visual matching
- Perfect pixel-identical matching is impossible without using actual system fonts (which is legally/technically infeasible)

verification:
files_changed: []
