# @10x-media/dedupe

Find duplicate documents in any Payload collection and merge a group of them into one from the admin.

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection.

## Features

- **Duplicate search** on every save and in a scheduled scan, with a weighted score per field.
- **A queue** of look-alike groups that says why they match; "Not duplicates" sticks.
- **A merge screen**: pick the primary and a value per field for up to `maxGroupSize` documents.
- **A merge spec from the schema**, adjustable per field with `dedupeCustom` or per collection with `fields`.
- **Unique values** are freed on the merged-in documents, so the primary can take them.
- **Multi-tenancy, drafts, locales and access** respected.
- **A pluggable candidate source**: swap the built-in keys for a search engine.

## Quick start

```bash
pnpm add @10x-media/dedupe
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { dedupe } from '@10x-media/dedupe'

export default buildConfig({
  plugins: [
    dedupe({
      collections: {
        customers: {
          match: {
            fields: [
              { path: 'email', weight: 45 },
              { path: 'name', weight: 40, compare: 'text' },
              { path: 'phone', weight: 35, compare: 'phone' },
              { path: 'birthDate', weight: 25, compare: 'date', onDiffer: -25 },
            ],
          },
        },
        leads: { absorbed: 'delete' },
      },
    }),
  ],
})
```

Then run `payload generate:importmap`. The queue is at `/admin/dedupe`. The search runs as jobs on the `dedupe` queue: run a worker for it (`jobs.autoRun: [{ cron: '* * * * *', queue: 'dedupe' }]`) or set `disableJobsQueue: true`.

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/docs/dedupe):

- [Overview](https://docs.10xmedia.de/docs/dedupe)
- [Configuration](https://docs.10xmedia.de/docs/dedupe/configuration)
- [Searching](https://docs.10xmedia.de/docs/dedupe/searching)
- [Merging](https://docs.10xmedia.de/docs/dedupe/merging)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
