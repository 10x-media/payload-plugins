---
"@10x-media/analytics": patch
---

**Fixed: a Host that only gains or loses a trailing slash keeps the stored key.** The save counted it as a move to another address and cleared the document's key and connection status.
