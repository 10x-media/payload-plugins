---
"@10x-media/analytics": patch
---

**Fixed (Umami): the key fields say which key goes where.** **API token** said "Umami Cloud token" though it is the self-hosted key, sent as `Bearer`. It now names self-hosted Umami, and **API key** on an Umami document names Umami Cloud, in all 11 locales.
