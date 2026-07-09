---
"@10x-media/jobs": minor
---

Ops feedback round: standalone `queues` option with automatic queue discovery from task and workflow schedules and workflow queues; task and workflow labels render across the log timeline, document header, and Job column (inline steps render as `inline: <id>`); `createWorker({ scheduling: false })` for worker fleets that must never register crons; list search matches workflow, task, and queue slugs so runtime-queued and scheduled jobs are found; the total jobs chip clears search and filters; scheduled rows show their next run time, cron-created documents carry a Cron badge, and the Attempts column explains itself on hover. New client exports: `JobsTotalChip` and `AttemptsCell`.

**Behavior change:** when `queueControl` is off and `jobs.access.run` is unset, the plugin now denies Payload's native run and handle-schedules endpoints (Payload otherwise allows any logged-in user to trigger them). Set `jobs.access.run` explicitly to opt back in.
