---
"@10x-media/form-builder": patch
---

Correct `payload` and `@payloadcms/ui` peer ranges to `^3.83.0`. The plugin uses `definePlugin`, which shipped in Payload 3.83.0, so 3.82.x installs satisfied the old range but failed at import.
