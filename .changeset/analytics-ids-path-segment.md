---
"@10x-media/analytics": patch
---

**Fixed (Umami, PostHog): an ID with `/`, `?` or `#` no longer breaks the request path.** Umami's website ID and PostHog's project ID are sent URL-encoded.
