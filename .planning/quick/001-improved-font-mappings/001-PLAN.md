# Quick Task 001: Improved Font Mappings

## Objective
Add improved metric-compatible font mappings and document all font handling work for GSD context.

## Tasks

1. **Add new metric-compatible font mappings** to `utils/system_fonts.py`:
   - Calibri -> Carlito (Microsoft Office default)
   - Cambria -> Caladea (Microsoft Office serif)
   - Book Antiqua (Palatino variant)
   - Gelasio, Carlito, Caladea for category fallback

2. **Create font handling documentation** in `.planning/docs/`:
   - Document the three-tier font handling architecture
   - List all metric-compatible mappings
   - Explain zero-degradation font handling
   - Document font licensing constraints

3. **Update STATE.md** with quick task completion

## Files Modified
- `utils/system_fonts.py` - Add new font mappings
- `.planning/docs/FONT_HANDLING.md` - New documentation
- `.planning/ROADMAP.md` - Already created with font context
- `.planning/STATE.md` - Update with completion
