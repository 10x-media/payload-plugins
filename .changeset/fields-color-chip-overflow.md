---
'@10x-media/fields': patch
---

`colorField` no longer overflows its input border when squeezed by `admin.width` in a row. The chip, text entry, and format badge now live in a clipping region that fades out at the right edge when (and only when) the run actually overflows, and the clear control keeps its place inside the border at every width. The fade is a CSS mask rather than a background-colored overlay, so it renders correctly over the error, read-only, and hover backgrounds in both themes.
