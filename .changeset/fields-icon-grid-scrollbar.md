---
'@10x-media/fields': patch
---

The icon picker sizes its columns from the grid's width without the vertical scrollbar. At some widths, common in a nested drawer, it counted one column too many, so the last column was cut off and the grid scrolled sideways.
