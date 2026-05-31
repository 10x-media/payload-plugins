# @10x-media/jobs

A jobs ops dashboard and a production-grade reliability, execution, and queue-control layer for Payload's built-in `payload-jobs`.

[![npm](https://img.shields.io/npm/v/@10x-media/jobs?style=flat-square)](https://www.npmjs.com/package/@10x-media/jobs)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Requirements

- Payload v3 (peer: `payload@^3.82.0`)
- React 19 (peer)

## Installation

```bash
pnpm add @10x-media/jobs
```

## Usage

```ts
import { buildConfig } from 'payload'
import { jobs } from '@10x-media/jobs'

export default buildConfig({
  // ...
  plugins: [
    jobs({
      // options
    }),
  ],
})
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `disabled` | `boolean` | `false` | When `true`, returns the incoming config unchanged. Useful for toggling the plugin per environment. |
| `reliability` | `ReliabilityOptions \| false` | off | Job leases, the orphan sweeper, leader election, and serverless staleness. Opt in with `{}` (defaults) or a tuned object. |
| `queueControl` | `QueueControlOptions \| false` | off | Cluster-wide pause/resume, hardened run/sweep/status endpoints, and access guards. Opt in with `{}` (defaults) or a tuned object. |

<!-- Add new options to this table as you build them. -->

## Deployment topologies

The plugin ships four opt-in layers. You add only the ones your deployment needs, and you pick a topology preset to wire reliability and queue-control consistently.

### Overview

| Layer | What it adds | How to enable |
|---|---|---|
| Observability | The jobs ops dashboard (status, queue health, error and log panels) and i18n. | Always on (just adding `jobs()`). |
| Reliability | Job leases, an orphan sweeper, leader election, serverless staleness. | `reliability: {}` (or a tuned `ReliabilityOptions`). |
| Execution | A standalone worker (`createWorker`) that runs jobs everywhere and schedules/sweeps only while holding the leader lease, with a graceful SIGTERM drain. | Run the worker entrypoint as its own process. |
| Queue control | Cluster-wide pause/resume plus hardened `/api/payload-jobs/queue-run`, `/queue-sweep`, and `/queue-status` endpoints with access guards. | `queueControl: {}` (or a tuned `QueueControlOptions`). |

Every layer is opt-in. The observability dashboard is always present once the plugin is installed. The other three you turn on as your topology demands.

Three facts shape every topology below.

1. **Reliability and queue-control require at least one configured task.** The `payload-jobs` collection only materializes once you configure at least one task. With zero tasks, `createWorker` throws a clear error telling you to add one, and the lease store has no table to read. Configure your tasks on `jobs.tasks` in `buildConfig` before enabling reliability or running a worker.

2. **The worker is a separate process, not your web server.** The execution layer (`createWorker`) is meant to run as its own long-lived process (a worker container, a separate Vercel-incompatible service). Your Next.js / Payload web server handles HTTP. The worker boots its own Payload instance against the same database and owns the run/schedule/sweep loops. The only topology that does not run a worker process is serverless, which drives everything from cron-hit endpoints instead.

3. **Completed jobs are deleted, not kept.** Payload's `jobs.deleteJobOnComplete` defaults to `true` in v3.85, so a job that finishes successfully is removed from the queue. The dashboard and the `/queue-status` counts therefore reflect pending, processing, failed, and scheduled jobs, never completed ones. Set `jobs.deleteJobOnComplete: false` in `buildConfig` if you want completed jobs to persist for auditing.

Pick a preset:

```ts
import { jobs, serverlessPreset, singleNodePreset, multiNodePreset } from '@10x-media/jobs'

// Serverless (Vercel): cron-driven endpoints, no long-running worker.
jobs({ ...serverlessPreset({ maxDurationMs: 800_000 }) })

// Single-node Docker: one worker container, claim races moot.
jobs({ ...singleNodePreset() })

// Multi-node Docker: many worker replicas, one elected scheduler and sweeper.
jobs({ ...multiNodePreset({ leaderId: process.env.HOSTNAME }) })
```

Each preset returns `{ reliability, queueControl }`, so spreading it into `jobs({ ... })` configures both layers at once. An override after the spread replaces the whole group (it does not deep-merge), so to tweak one field spread the group too: `jobs({ ...multiNodePreset(), reliability: { ...multiNodePreset().reliability, leaderId: 'node-7' } })`.

### Serverless (Vercel)

Serverless functions are killed at their `maxDuration` with no SIGTERM, so there is no long-running worker and heartbeats are meaningless. `serverlessPreset` instead derives job staleness from the platform hard-kill duration and guards the control endpoints with a shared cron secret. You drive the run and sweep from Vercel Cron.

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { jobs, serverlessPreset } from '@10x-media/jobs'

export default buildConfig({
  // ...
  jobs: {
    tasks: [
      // ...your tasks; at least one is required.
    ],
  },
  plugins: [jobs({ ...serverlessPreset({ maxDurationMs: 800_000 }) })],
})
```

`serverlessPreset` sets `reliability.jobLeaseTtlMs` and `reliability.serverless.maxDurationMs` to your `maxDurationMs`, and sets `queueControl.access` to `cronSecretAccess()`. Pass `cronSecretEnvVar` if your secret lives somewhere other than `CRON_SECRET`.

Generate the `vercel.json` crons with `vercelCrons()`:

```ts
// scripts/vercel-crons.ts (or hand-write the array below into vercel.json)
import { vercelCrons } from '@10x-media/jobs'

console.log(JSON.stringify({ crons: vercelCrons() }, null, 2))
```

```json
{
  "crons": [
    { "path": "/api/payload-jobs/queue-run?allQueues=true", "schedule": "* * * * *" },
    { "path": "/api/payload-jobs/queue-sweep", "schedule": "* * * * *" }
  ]
}
```

`vercelCrons()` defaults to every minute (Vercel Pro). Override any path or schedule, for example `vercelCrons({ sweepSchedule: '*/5 * * * *' })`.

**The cron secret.** Set `CRON_SECRET` in your Vercel project. Vercel sends it as `Authorization: Bearer ${CRON_SECRET}` on every cron invocation, and `cronSecretAccess` checks exactly that header (a logged-in admin user also passes, so you can hit the endpoints manually from the panel). Without the secret set, unauthenticated cron requests are rejected.

**The endpoints.** Both are plugin-registered GET endpoints on the `payload-jobs` collection:

- `/api/payload-jobs/queue-run` runs due jobs (pause-aware, mirrors the native run params). `?allQueues=true` runs every queue, `?queue=<name>` runs one, `?limit=<n>` caps jobs per invocation, `?disableScheduling=true` skips schedule handling.
- `/api/payload-jobs/queue-sweep` runs one orphan sweep (a single cron invocation, so no leader election). Requires reliability to be enabled.

**Vercel limits.** Match your plan to a cron cadence and a function duration:

- **Hobby**: crons run at most **once per day** and functions cap at **300s**. That is unusable for real job processing. Use Hobby only for a toy or a demo.
- **Pro**: crons run **per minute** and functions extend to **800s**. That per-minute, 800s window is the practical floor for serverless job processing, which is why `serverlessPreset({ maxDurationMs: 800_000 })` and `vercelCrons()` default to it.

**`limit` guidance.** A serverless run must finish inside `maxDuration`. Set `?limit=<n>` on the run cron (or `vercelCrons({ runPath: '/api/payload-jobs/queue-run?allQueues=true&limit=20' })`) so one batch of jobs comfortably fits the window. Size the limit to `maxDuration / (slowest expected job duration)` with headroom. If a batch risks overrunning, lower the limit and let the next minute's cron pick up the rest.

### Single-node Docker

One worker container claims and runs every job serially, so claim races are moot and leader election is a no-op (the single node always wins). `singleNodePreset()` turns on reliability and queue-control with defaults; the in-process worker runs the scheduler and sweeper directly.

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { jobs, singleNodePreset } from '@10x-media/jobs'

export default buildConfig({
  // ...
  jobs: {
    tasks: [
      // ...your tasks; at least one is required.
    ],
  },
  plugins: [jobs({ ...singleNodePreset() })],
})
```

Run the worker as its own service in `docker-compose.yml`, alongside your web service and database:

```yaml
services:
  web:
    build: .
    command: ['node', 'server.js']
    environment:
      DATABASE_URI: postgres://postgres:postgres@db:5432/app
      PAYLOAD_SECRET: ${PAYLOAD_SECRET}
    depends_on: [db]

  worker:
    build: .
    # Exec-form CMD so Node is PID 1 and receives SIGTERM directly.
    command: ['node', 'dist/worker.js']
    environment:
      DATABASE_URI: postgres://postgres:postgres@db:5432/app
      PAYLOAD_SECRET: ${PAYLOAD_SECRET}
    depends_on: [db]

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_PASSWORD: postgres
```

`dist/worker.js` is your compiled worker entrypoint (see below). In development you can run the TypeScript source directly with `node --import tsx worker.ts`. With one claimer, you do not need to tune leader leases; defaults are fine.

### Multi-node Docker

Many worker replicas share one database. Every replica runs jobs, but only the replica holding the `scheduler` lease handles schedules and only the one holding the `sweeper` lease runs the orphan sweep. `multiNodePreset()` is the default: leader-elected scheduling and sweeping with no extra infrastructure (the leases live in the plugin-owned `payload-jobs-locks` collection).

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { jobs, multiNodePreset } from '@10x-media/jobs'

export default buildConfig({
  // ...
  jobs: {
    tasks: [
      // ...your tasks; at least one is required.
    ],
  },
  // process.env.HOSTNAME is each container's id, a natural stable leader id.
  plugins: [jobs({ ...multiNodePreset({ leaderId: process.env.HOSTNAME }) })],
})
```

`leaderId` is the stable identity this node uses when it acquires a lease. Pass `process.env.HOSTNAME` (or any per-replica stable value); omit it to let the worker generate a `hostname:pid` identity at runtime. Leadership fails over automatically: if the current leader dies, another replica acquires the lease once it expires (`leaderLeaseTtlMs`, default 30s) and a monotonic fence token prevents a revived zombie from acting.

**Env-designated-leader fallback (zero infra).** If you do not want leader election at all, you can designate one replica as the scheduler by environment. Run native auto-scheduling on a single replica and disable scheduling on the rest:

```ts
import { autoRunConfig } from '@10x-media/jobs'

const isScheduler = process.env.JOBS_SCHEDULER === '1'

export default buildConfig({
  // ...
  jobs: {
    tasks: [/* ... */],
    // Only the designated replica handles schedules; the others just run jobs.
    autoRun: autoRunConfig({ disableScheduling: !isScheduler }),
  },
  plugins: [jobs({ ...multiNodePreset() })],
})
```

Set `JOBS_SCHEDULER=1` on exactly one replica (or run a single dedicated scheduler replica). This trades automatic failover for zero coordination state. Leader election (the default) is preferred when you want a replica loss to recover on its own.

**Graceful shutdown is a hard requirement under multi-node.** When an orchestrator rolls or scales down a replica, it sends SIGTERM, then SIGKILLs after a grace period. The worker's drain requeues its in-flight job (so another replica picks it up) and releases its leases, but only if it is given time to finish.

- The orchestrator grace period **must exceed** the worker's `drainTimeoutMs`. In Docker Compose set `stop_grace_period`; in Kubernetes set `terminationGracePeriodSeconds`. If the grace period is shorter, the orchestrator SIGKILLs a still-draining worker and you lose the clean requeue.
- The container `CMD` must be **exec form** (`CMD ["node", "dist/worker.js"]`, not `CMD node dist/worker.js`). Shell form runs Node as a child of `/bin/sh`, which does not forward SIGTERM, so the worker never drains and is hard-killed every time.

```yaml
services:
  worker:
    build: .
    command: ['node', 'dist/worker.js'] # exec form: Node receives SIGTERM
    # Must be greater than the worker's drainTimeoutMs (default 30s here, so 45s of headroom).
    stop_grace_period: 45s
    deploy:
      replicas: 3
    environment:
      DATABASE_URI: postgres://postgres:postgres@db:5432/app
      PAYLOAD_SECRET: ${PAYLOAD_SECRET}
    depends_on: [db]
```

The Kubernetes equivalent: an exec-form `command` in the pod spec and `terminationGracePeriodSeconds: 45` (greater than `drainTimeoutMs`).

### The worker entrypoint

The worker is a thin bootstrap: boot Payload, resolve reliability options, and start the worker. `createWorker` installs SIGTERM/SIGINT drain handlers by default, so the process drains and exits 0 on a real signal. This is the canonical pattern (mirrors `packages/jobs/dev/worker.ts`):

```ts
// worker.ts
import { getPayload } from 'payload'
import { createWorker, resolveReliabilityOptions } from '@10x-media/jobs'

import config from './payload.config'

const RELIABILITY_OPTIONS = {
  jobLeaseTtlMs: 300_000,
  leaderLeaseTtlMs: 30_000,
  sweepIntervalMs: 60_000,
}

const main = async (): Promise<void> => {
  const payload = await getPayload({ config })
  const reliability = resolveReliabilityOptions(RELIABILITY_OPTIONS)
  if (!reliability) {
    throw new Error('@10x-media/jobs worker: reliability resolved to null')
  }
  createWorker({
    payload,
    reliability,
    drainTimeoutMs: 30_000,
    runIntervalMs: 2_000,
  }).start()
  payload.logger.info('@10x-media/jobs worker started; awaiting jobs and signals')
}

main().catch((err) => {
  console.error('@10x-media/jobs worker failed to start', err)
  process.exit(1)
})
```

Notes:

- `resolveReliabilityOptions` fully defaults your `ReliabilityOptions`. It returns `null` when reliability is off (passed `false` or `undefined`), which the worker cannot run with, hence the guard.
- Pass the same reliability tuning you give the plugin (share a constant between `payload.config.ts` and `worker.ts`) so the lease TTLs match across the cluster.
- `createWorker` registers SIGTERM and SIGINT handlers automatically (`installSignals` defaults to `true`). On signal it drains in-flight jobs (within `drainTimeoutMs`), requeues any straggler, releases leases, destroys the Payload instance, and exits 0. Keep your orchestrator grace period above `drainTimeoutMs` (see Multi-node above).
- Run it with `node --import tsx worker.ts` in development, or compile it and run `node dist/worker.js` in production.

### CI-optional e2e recipes

Two real-process scenarios are proven in-process by the test suite, so they are not automated in CI. Both are useful to run by hand against a real database when validating a deployment. Mark them manual / CI-optional.

**Recipe 1: two workers, one elected scheduler.** Run two worker processes against the same database and confirm exactly one holds the `scheduler` lease.

```bash
# Terminal 1 and Terminal 2 (same DATABASE_URI), distinct leader ids:
JOBS_LEADER_ID=node-a node --import tsx worker.ts
JOBS_LEADER_ID=node-b node --import tsx worker.ts
```

Then inspect the leases collection (one row per role, `owner` names the current holder):

```ts
const locks = await payload.find({
  collection: 'payload-jobs-locks',
  where: { role: { equals: 'scheduler' } },
})
// Expect exactly one row whose `owner` is node-a OR node-b, never both.
console.log(locks.docs.map((d) => ({ role: d.role, owner: d.owner, fenceToken: d.fenceToken })))
```

Only the owning worker logs schedule handling; the other runs jobs but never schedules. (Wire `leaderId` into your worker from `process.env.JOBS_LEADER_ID` for this recipe.)

**Recipe 2: kill a worker mid-job, watch the sweeper recover the orphan.** Confirm that a hard-killed worker's in-flight job is reclaimed by another worker's sweeper after the lease expires.

```bash
# Start two workers against the same DB (as above), then queue a long job:
#   await payload.jobs.queue({ task: 'your-slow-task', input: { ... } })
# Find the PID of the worker that claimed it and hard-kill it (no drain):
kill -9 <worker-pid>
```

A `kill -9` skips the graceful drain entirely, so the job stays marked processing with a stale lease. After `jobLeaseTtlMs` elapses, the surviving worker's sweeper detects the orphan and requeues it (up to `maxRecoveries` times, then dead-letters). Watch the job flip back to queued and then get re-claimed:

```ts
const orphans = await payload.find({
  collection: 'payload-jobs',
  where: { and: [{ processing: { equals: false } }, { recoveryAttempts: { greater_than: 0 } }] },
})
// After the lease TTL, the killed worker's job appears here with recoveryAttempts >= 1.
console.log(orphans.totalDocs)
```

Give it at least `jobLeaseTtlMs + sweepIntervalMs` before asserting recovery.

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
