---
"@10x-media/analytics": patch
---

**Fixed: credential fields are labelled in the reader's language.** The **API key**, **API token** and **Private key** fields kept their English label in every admin language, because Payload drops a function label from the client field the write-only editor renders. They now carry a label per locale, as their help already did.
