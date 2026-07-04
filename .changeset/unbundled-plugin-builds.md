---
'@10x-media/analytics': patch
'@10x-media/automations': patch
'@10x-media/form-builder': patch
'@10x-media/jobs': patch
'@10x-media/webhooks': patch
---

Ship per-file dist output instead of bundled chunks. Bundling merged client components into shared chunks and dropped their 'use client' directives, so Next.js lost the RSC boundary and the admin panel crashed with "useRef only works in Client Components" when rendering components imported through such a chunk (for analytics: every chart-based dashboard widget). Dist now mirrors src one file at a time, directives stay exactly where they were authored, and file names are stable across releases. A repo-level `check:dist` verification (directive parity, no inlined dependencies, exports resolution, publint) now runs in CI so this class of regression cannot ship again.
