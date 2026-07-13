---
'@10x-media/analytics': patch
---

Preserve `'use client'` directives in shared build chunks so the `/client` and `/rsc` entries expose correct React Server Component boundaries. Client widgets (`RealtimeCounter`, `TrendChart`, `BarList`) that get hoisted into a shared chunk now keep their directive, preventing "use client" boundary errors in Next.js consumers.
