---
"@10x-media/analytics": patch
---

**Fixed: an ID pasted with spaces around it reads.** A Plausible Site ID or an Umami Website ID saved with a space before or after it failed every read, and Plausible's answer pointed at the key. Provider documents now read and capture with their IDs, tokens and labels trimmed, stored documents included.
