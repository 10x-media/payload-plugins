---
"@10x-media/analytics": patch
---

**Fixed (Umami): a Website ID Umami does not know fails the read.** Self-hosted Umami answers the stats of an unknown website with zeros, so the source read as working and showed no visits. The adapter now asks for the website before it reads, until Umami has answered once, and refuses an unknown one. An adapter that `providers.resolve` builds for each read asks on each read.
