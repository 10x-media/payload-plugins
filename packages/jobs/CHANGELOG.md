# @10x-media/jobs

## 0.1.0-beta.8

### Minor Changes

- The create form pre-fills `input` from the selected task's or workflow's `inputSchema`: a field with a static `defaultValue` contributes that, otherwise scalars get an empty value of their kind, a `hasMany` field, an array or blocks one sample element, a relationship the name of the collection it expects an id from, and groups nest. Each task and workflow keeps its own draft while the form is open, so switching parks and restores what was typed; clearing the selection resets the field to `{}`; existing jobs are not touched. `input.examples` merges hand-written top-level values over the derived placeholder of a slug. The field renders through `JobInputField`, exported from `@10x-media/jobs/client`; new type `JobInputExamples`.

  `input.components` swaps that JSON editor for a component of yours per task or workflow slug, with `'*'` for every slug and `false` to keep JSON. The editor receives `JobInputComponentProps` (`path`, `slug`, `kind`, `placeholder`, `readOnly`) and reads and writes the field through `useField`, so the pre-filled placeholder reaches it and the selection switches editors live. `JobInputFieldServer` (exported from `@10x-media/jobs/rsc`) wraps `JobInputField` and resolves the paths against the import map; they are registered with `admin.dependencies`, so adopters re-run `payload generate:importmap` after changing one. New types: `JobInputComponents` and `JobInputComponentProps`.

## 0.1.0-beta.7

### Minor Changes

- Custom components for job log blocks: `log.entryComponents` registers your own renderer for an attempt's `input`, `output`, or `error`, keyed by task slug with `'*'` as the fallback for every task and `false` opting one slot back out to the default JSON. The component replaces only the JSON body; the label, the frame, and the show rules stay the plugin's. It also renders for an empty value (an attempt that returned `{}`), and never for a value the attempt does not carry, so a succeeded attempt gets no error block under a wildcard `error`.

  The `log` field now renders through `JobLogTimelineServer` (exported from `@10x-media/jobs/rsc`), so a renderer may be a server or a client component; `JobLogTimeline` stays exported from `@10x-media/jobs/client` and still falls back to JSON when mounted directly. Configured paths are registered with `admin.dependencies`, so adopters re-run `payload generate:importmap` after adding or changing one. New types: `JobLogEntry`, `JobLogEntryComponents`, `JobLogSlot`, `JobLogSlotComponents`, and `JobLogSlotProps`.

## 0.1.0-beta.6

### Patch Changes

- Correct `payload` and `@payloadcms/ui` peer ranges to `^3.83.0`. The plugin uses `definePlugin`, which shipped in Payload 3.83.0, so 3.82.x installs satisfied the old range but failed at import.

## 0.1.0-beta.5

### Minor Changes

- Ops feedback round: standalone `queues` option with automatic queue discovery from task and workflow schedules and workflow queues; task and workflow labels render across the log timeline, document header, and Job column (inline steps render as `inline: <id>`); `createWorker({ scheduling: false })` for worker fleets that must never register crons; list search matches workflow, task, and queue slugs so runtime-queued and scheduled jobs are found; the total jobs chip clears search and filters; scheduled rows show their next run time, cron-created documents carry a Cron badge, and the Attempts column explains itself on hover. New client exports: `JobsTotalChip` and `AttemptsCell`.

  **Behavior change:** when `queueControl` is off and `jobs.access.run` is unset, the plugin now denies Payload's native run and handle-schedules endpoints (Payload otherwise allows any logged-in user to trigger them). Set `jobs.access.run` explicitly to opt back in.

## 0.1.0-beta.4

### Minor Changes

- Dashboard UX: clickable queue-health badges that filter the list, a linked Job title column (workflow or task), readable relative timestamps for started, lease-expires, and scheduled dates (no clear button on runner-owned fields), scheduled jobs show their run time, workflow and task selects populated from config with an exclusive workflow-or-task create form, a native-looking queue select over the text field (programmatic queue names stay unrestricted), localized relative time, and a collection-level overrides.jobs seam (CollectionOverride and FieldsOverride types are exported).

  Fix: worker stop and drainWorker now await the in-flight run tick before returning, so no job write can land after teardown (this was the source of CI-only test flakes, including transaction aborts and MongoNotConnectedError during shutdown).

## 0.1.0-beta.3

### Minor Changes

- Add a typed `translations` option to every plugin factory and make translation keys a stable public API. Each plugin's `./i18n` subpath now exports the `keys` object, the `TranslationKey` union, and the `TranslationsOption` shape. Overrides are flat and per-locale: values win over the built-in locales key-by-key, locales a plugin does not ship are added whole, and app-level `i18n.translations` still wins over everything.

  ```ts
  import { analytics } from "@10x-media/analytics";
  import { keys } from "@10x-media/analytics/i18n";

  analytics({
    adapters: [nativeAdapter()],
    translations: {
      de: { [keys.pluginName]: "Analytik" },
    },
  });
  ```

  A typo'd key inside `translations` is a compile error.

### Patch Changes

- Restructure README: features, quick start, and links into the documentation site at https://docs.10xmedia.de. Long-form documentation moved out of the package README.

- Update README documentation links: the docs site now serves from the domain root, so `docs.10xmedia.de/docs/<plugin>` links became `docs.10xmedia.de/<plugin>`.

- Ship per-file dist output instead of bundled chunks. Bundling merged client components into shared chunks and dropped their 'use client' directives, so Next.js lost the RSC boundary and the admin panel crashed with "useRef only works in Client Components" when rendering components imported through such a chunk (for analytics: every chart-based dashboard widget). Dist now mirrors src one file at a time, directives stay exactly where they were authored, and file names are stable across releases. A repo-level `check:dist` verification (directive parity, no inlined dependencies, exports resolution, publint) now runs in CI so this class of regression cannot ship again.

## 0.1.0-beta.2

### Minor Changes

- Fix a batch of functional and security issues found in the jobs plugin review:

  - Sweeper processes jobs oldest-first via `sort: 'updatedAt'` (item 5)
  - `acquireOrSteal` treats `leaseExpiresAt: null` as stealable, preventing dead-lock on first-boot rows (item 6)
  - `start()` is a no-op when a drain is already in progress, preventing loop restart during shutdown (item 7)
  - Signal handler exits with code 1 on drain timeout, 0 on clean drain (item 8)
  - `runControlEndpoint` returns 400 for non-finite `?limit=` values (item 9)
  - Drain loop checks the deadline after each poll sleep to avoid overrunning the budget (item 10)
  - Leadership is released immediately after stopping loops, before the poll-wait phase (item 11)
  - Cron secret comparison uses `crypto.timingSafeEqual` to prevent timing attacks (item 12)
  - `applyResume` / `PauseStore.resume` accept `{ all: true }` to reset both global and per-queue pause state (item 13)
  - `stop()` removed from the public `Worker` type; accessible via `WorkerTestHandle` cast for tests (item 14)
  - KV-stored pause state is validated on read; corrupt or missing values fall back to empty state (item 16)
  - `config.jobs.access.run` is composed with the plugin's built-in checker (both must pass) instead of replacing it; the same composed checker also guards the plugin's own `/queue-run` and `/queue-sweep` endpoints, so a stricter `jobs.access.run` cannot be bypassed through them (item 17)
  - `LeaseStore.release` returns `{ ok: boolean }`; `leaderController` drops local leading state after any `release()`, since an unconfirmed release means the node no longer owns the lease (item 18)
  - `renew` filter includes `leaseExpiresAt >= now`; on failed renew while leading, the controller falls through to `acquireOrSteal` with a fence bump (item 19)
  - `createWorker` throws when signal handlers are already installed, enforcing the one-worker-per-process constraint (item 21)
  - `createWorker` defaults `pauseStore` to `createPauseStore(payload)`, eliminating the footgun where preset-enabled queue control was silently ignored (item 22)
  - `sweepCycle` re-ticks the sweeper leadership before acting so the check is always fresh (item 23)
  - `stampClaim` guards against double-claiming: a second owner cannot claim a job already held by a different node (item 24)
  - `/queue-status` reports the seven canonical job states (`queued`, `scheduled`, `retrying`, `processing`, `succeeded`, `failed`, `cancelled`) plus an orthogonal `recovered` count (`recoveryAttempts > 0`, when reliability is enabled) (item 25, breaking change)
  - In-flight job count is now process-local (incremented/decremented in `withHeartbeat`) instead of a DB query; on drain, `requeueStragglers` runs only when the wall-clock budget is exceeded, so a just-completed job is never spuriously requeued (genuinely orphaned claims are recovered by the sweeper) (item 26)

## 0.1.0-beta.1

### Minor Changes

- Opt-in layers accept `true`: pass `reliability: true` or `queueControl: true` to enable a layer with its defaults, matching Payload's `false`/`true`/object option form. Empty objects and tuned objects still work.

## 0.1.0-beta.0

### Minor Changes

- Initial beta of `@10x-media/jobs`: an ops layer over Payload's built-in jobs queue, opt-in and layered, with full multi-node support.

  - **Observability** (always on): a jobs dashboard over `payload-jobs` with a derived status column, a queue-health bar, error and log panels, friendlier labels, and a read-only-record model.
  - **Reliability** (`reliability`): a worker heartbeat lease, a stuck-job sweeper that requeues then dead-letters, and multi-node leader election with fencing tokens, so jobs survive crashes and run safely across replicas. Works on MongoDB and PostgreSQL.
  - **Execution** (`createWorker`): a graceful-drain worker that runs jobs on every node, schedules and sweeps only on the elected leader, and finishes in-flight work on SIGTERM, plus `autoRunConfig` for the simple single-node path.
  - **Queue control** (`queueControl`): durable cluster-wide pause and resume, a queue-health endpoint, and a hardened, pause-aware run endpoint with real access control (including a `CRON_SECRET` checker for serverless).
  - **Deployment presets** for serverless (Vercel), single-node Docker, and multi-node Docker, with a documented worker entrypoint.

  Enable each layer as your topology needs; with none enabled you still get the dashboard. See the README for the per-topology guide.
