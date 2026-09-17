---
'@10x-media/impersonation': patch
---

Fix empty JWT/Bearer origin skip, stop leaking password hashes from start, keep the impersonator cookie when a parallel session hits maxDuration, and close a session when Postgres CASCADE-deletes its impersonator relationship.
