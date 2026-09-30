---
'@10x-media/content-lock': patch
---

A kv error while rebuilding the lock snapshot at startup is logged instead of failing the boot. Readers already rebuild a missing or stale snapshot and reject writes until they can, so enforcement is unchanged.
