---
'@10x-media/form-builder': minor
---

Consent field source config is now context-sensitive: the `source` select is generated dynamically from the live `consentRegistry` (so custom sources appear without code changes), and each source's config fields use `admin.condition` to show only the fields relevant to the currently selected source. Previously all source config fields were visible at once regardless of the selected source type.
