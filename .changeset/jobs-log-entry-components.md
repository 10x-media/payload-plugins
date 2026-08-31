---
"@10x-media/jobs": minor
---

Custom components for job log blocks: `log.entryComponents` registers your own renderer for an attempt's `input`, `output`, or `error`, keyed by task slug with `'*'` as the fallback for every task and `false` opting one slot back out to the default JSON. The component replaces only the JSON body; the label, the frame, and the show rules stay the plugin's. It also renders for an empty value (an attempt that returned `{}`), and never for a value the attempt does not carry, so a succeeded attempt gets no error block under a wildcard `error`.

The `log` field now renders through `JobLogTimelineServer` (exported from `@10x-media/jobs/rsc`), so a renderer may be a server or a client component; `JobLogTimeline` stays exported from `@10x-media/jobs/client` and still falls back to JSON when mounted directly. Configured paths are registered with `admin.dependencies`, so adopters re-run `payload generate:importmap` after adding or changing one. New types: `JobLogEntry`, `JobLogEntryComponents`, `JobLogSlot`, `JobLogSlotComponents`, and `JobLogSlotProps`.
