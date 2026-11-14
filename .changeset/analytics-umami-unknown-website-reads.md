---
"@10x-media/analytics": patch
---

**Fixed (Umami): a Website ID Umami does not know fails the read.** Self-hosted Umami answers the stats of an unknown website with zeros, so the source read as working and showed no visits. The adapter now asks for the website once before its first read and refuses an unknown one, and the Connection panel says Umami does not know it.
