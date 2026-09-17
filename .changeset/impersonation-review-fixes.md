---
'@10x-media/impersonation': patch
---

Fix empty JWT/Bearer origin skip, stop leaking password hashes from start, and keep the impersonator cookie when a parallel session hits maxDuration.
