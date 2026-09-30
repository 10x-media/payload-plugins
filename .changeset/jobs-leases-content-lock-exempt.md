---
'@10x-media/jobs': patch
---

The `payload-jobs-locks` lease collection exempts itself from `@10x-media/content-lock`. With reliability on, the app seeds its lease rows through the Local API at startup, and an active lock on everything rejected that write before the duplicate-row check, so the app failed to start in `onInit`.
