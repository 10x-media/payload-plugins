---
'@10x-media/sipgate': patch
---

Ship per-file dist output via `definePluginBuild` so client UI modules keep their `'use client'` directive. The previous bundled build dropped the directive from `ClickToDialFieldClient` chunks and broke the RSC boundary in Next.js admin.
