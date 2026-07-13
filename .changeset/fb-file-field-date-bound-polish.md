---
'@10x-media/form-builder': patch
---

The registry (shadcn-style) file field now matches the built-in file renderer: a client-side max-size pre-check rejects oversized files before uploading, and an accepted-types/max-size hint line renders under the input.

`minDate`/`maxDate` rule bounds are now validated as real `YYYY-MM-DD` calendar dates in the admin UI, so a malformed bound (e.g. `abc` or `2024-02-30`) is rejected at config time instead of silently breaking the rule's comparisons.
