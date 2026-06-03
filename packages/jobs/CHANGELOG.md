# @10x-media/jobs

## 0.1.0-beta.0

### Minor Changes

- [`14f84b7`](https://github.com/10x-media/payload-plugins/commit/14f84b73397eba07816a3b0ccb360ae096cfebc8) Thanks [@HarleySalas](https://github.com/HarleySalas)! - Initial beta of `@10x-media/jobs`: an ops layer over Payload's built-in jobs queue, opt-in and layered, with full multi-node support.

  - **Observability** (always on): a jobs dashboard over `payload-jobs` with a derived status column, a queue-health bar, error and log panels, friendlier labels, and a read-only-record model.
  - **Reliability** (`reliability`): a worker heartbeat lease, a stuck-job sweeper that requeues then dead-letters, and multi-node leader election with fencing tokens, so jobs survive crashes and run safely across replicas. Works on MongoDB and PostgreSQL.
  - **Execution** (`createWorker`): a graceful-drain worker that runs jobs on every node, schedules and sweeps only on the elected leader, and finishes in-flight work on SIGTERM, plus `autoRunConfig` for the simple single-node path.
  - **Queue control** (`queueControl`): durable cluster-wide pause and resume, a queue-health endpoint, and a hardened, pause-aware run endpoint with real access control (including a `CRON_SECRET` checker for serverless).
  - **Deployment presets** for serverless (Vercel), single-node Docker, and multi-node Docker, with a documented worker entrypoint.

  Enable each layer as your topology needs; with none enabled you still get the dashboard. See the README for the per-topology guide.
