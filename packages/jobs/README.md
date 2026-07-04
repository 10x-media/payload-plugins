# @10x-media/jobs

An ops dashboard plus reliability, worker, and queue-control layers for Payload v3's built-in jobs queue. See what the queue is doing, recover jobs that die mid-run, run a proper worker process with graceful drain, and pause or drive the queue from the outside. Every layer is opt-in.

[![npm](https://img.shields.io/npm/v/@10x-media/jobs?style=flat-square)](https://www.npmjs.com/package/@10x-media/jobs)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Features

- **Dashboard**: a derived Status column, a queue-health bar, and error/log panels on the `payload-jobs` collection. On by default.
- **Reliability**: job leases, an orphan sweeper with dead-lettering, leader election with fence tokens, serverless staleness.
- **Workers**: `createWorker` runs jobs as a standalone process and drains gracefully on SIGTERM.
- **Queue control**: cluster-wide pause/resume plus hardened `queue-run`, `queue-sweep`, and `queue-status` endpoints with access guards.
- **Topology presets** for serverless (Vercel Cron), single-node, and multi-node deployments.
- **Typed translations** with per-key overrides via `@10x-media/jobs/i18n`.

## Quick start

```bash
pnpm add @10x-media/jobs
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { jobs, singleNodePreset } from '@10x-media/jobs'

export default buildConfig({
  jobs: {
    tasks: [/* at least one task; payload-jobs does not exist without one */],
  },
  plugins: [jobs({ ...singleNodePreset() })],
})
```

`jobs({})` alone enables the dashboard; the preset also turns on reliability and queue control. Run a worker process for production execution.

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/jobs):

- [Overview](https://docs.10xmedia.de/jobs)
- [Quick start](https://docs.10xmedia.de/jobs/quick-start)
- [Dashboard](https://docs.10xmedia.de/jobs/dashboard)
- [Reliability](https://docs.10xmedia.de/jobs/reliability)
- [Workers](https://docs.10xmedia.de/jobs/workers)
- [Topologies](https://docs.10xmedia.de/jobs/topologies)
- [Queue control](https://docs.10xmedia.de/jobs/queue-control)
- [Testing and local dev](https://docs.10xmedia.de/jobs/testing)
- [i18n](https://docs.10xmedia.de/jobs/i18n)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
