---
'@10x-media/fields': patch
---

Fix icon drawer rail and footer text contrast to WCAG AA (elevation-600 to elevation-700). The drawer axe scan now waits for the grid to settle before analyzing, which is what surfaced the miss; the search test gains the same wait, removing a load-dependent flake.

Behavioral: the rail and footer text in the icon picker render one elevation step darker (lighter in dark mode). No API changes.
