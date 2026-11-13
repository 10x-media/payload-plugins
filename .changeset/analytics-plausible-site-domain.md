---
"@10x-media/analytics": minor
---

**Behavioral (Plausible): Site ID and Website address take the site as Plausible stores it.** An address with `https://`, `www.`, a trailing slash or capital letters saved, and every read answered "Invalid API key or site ID". Both fields now refuse it with a field error; a site in a subfolder (`example.com/blog`) is accepted. A stored document with such a value saves again once it is corrected.
