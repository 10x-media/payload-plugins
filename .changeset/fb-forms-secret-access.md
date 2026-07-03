---
'@10x-media/form-builder': patch
---

Prevent action secrets from leaking to anonymous callers: the `actions` blocks field (which can contain webhook secrets and email recipients) is now restricted to authenticated reads only. The `forms` collection remains publicly readable so forms can be rendered without authentication. Also introduces a shared `isLoggedIn` access helper used across all form-builder collections.
