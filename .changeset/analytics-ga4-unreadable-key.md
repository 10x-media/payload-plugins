---
"@10x-media/analytics": patch
---

**Fixed (GA4): a private key that cannot be parsed reads as a setup error.** A service account key pasted incompletely read as an outage ("The analytics tool is busy right now.") and was retried. It now reads as not set up correctly, as a wrong key does.
