---
"@10x-media/analytics": patch
---

**Fixed: an ID or a key pasted with spaces around it reads.** A Plausible Site ID or an Umami Website ID saved with a space before or after it failed every read, and Plausible's answer pointed at the key. Provider documents now read and capture with their IDs, keys and tokens trimmed, stored documents included.
