---
'@10x-media/jobs': patch
---

A task running inside a workflow no longer re-stamps the workflow's job lease.

- Fixed: the task's stamp moved the job's fence token, so the workflow's first heartbeat renew missed, logged `lost lease for job <id> (reclaimed)` one heartbeat interval into every workflow run, and stopped renewing for the rest of the run. Nothing had been reclaimed. The workflow's heartbeat now holds the lease for the whole run, including its tasks.
- Single-task jobs, and tasks inside workflows whose handler is a path rather than a function (which are not wrapped), still heartbeat themselves as before.
