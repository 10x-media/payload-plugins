---
"@10x-media/analytics": patch
---

**Fixed (GA4): a private key that cannot be parsed reads as a setup error.** A service account key pasted incompletely answered "The service did not answer. Try again later." It now reads as refused, as a wrong key does.
