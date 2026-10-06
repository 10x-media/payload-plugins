---
"@10x-media/admin-wiki": patch
"@10x-media/audit-logs": patch
"@10x-media/dual-session": patch
"@10x-media/settings-overlay": patch
---

**Behavioral (build output only):** the shared build now keeps `next` and its subpaths external, so the published files import `next/navigation` as a bare specifier instead of the resolved `next/navigation.js`. Nothing changes at runtime on Next 15 or 16, which resolve both forms; the bare form stays correct if Next ever adds an export map.
