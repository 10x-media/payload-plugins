---
'@10x-media/content-lock': patch
---

With the plugin disabled, `getContentLockState` and `isContentLocked` report nothing locked instead of throwing, so host code can call them in every environment.
