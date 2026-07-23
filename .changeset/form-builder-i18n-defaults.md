---
"@10x-media/form-builder": patch
---

Localize the last hard-coded English strings in the public form renderer. The file field's attached-file indicator, in-flight "Uploading" status, upload-failure fallback, and remove control, plus the form's close-control label, success message, and submit-failure fallback, now resolve through the same `t` the rest of the renderer already uses (bundled `en`/`de`, host-overridable per locale) instead of baked-in English. A German (or any) `t` now localizes them; behavior under the default English `t` is unchanged.
