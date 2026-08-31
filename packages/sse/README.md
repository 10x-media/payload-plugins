# @10x-media/sse

Server-Sent Events for opted-in Payload collections: live list updates, viewer presence, and thin realtime notifications. The collection document is the source of truth. This plugin stores no event log. Reconnect means refetch, not replay.

[![npm](https://img.shields.io/npm/v/@10x-media/sse?style=flat-square)](https://www.npmjs.com/package/@10x-media/sse)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Features

- **Opt-in collections** publish create, update, and delete over SSE (thin id-only events by default).
- **No event log.** The Payload document is the source of truth. Reconnect means refetch, not replay.
- **In-process broker by default.** Multi-instance needs a host-supplied `broker` implementing `EventBroker`, or other nodes' clients are only as fresh as their refetch interval. Long-lived Node is required; serverless function duration caps terminate streams (clients reconnect with backoff).
- **Viewer presence** (optional): who is looking at a document, and whether they are viewing or editing. Advisory only; not a lock. Document locking stays Payload's `lockDocuments`.
- **Dirty-document conflict banner** (admin, default on): warns when someone else saved or deleted the open document while the form is dirty. Reload or keep editing. Does not block save. Same-user other tabs do not banner. Presence plus conflict uses two SSE connections per edit view.
- **Live admin list** flashes rows when documents change.
- **Client hooks** via `@10x-media/sse/client` (`usePayloadDocument`, `usePayloadList`, `useDocumentPresence`, `useDocumentConflict`, `usePayloadSubscription`).
- **`getSSE(payload).emit`** for custom realtime events from your server code.
- **Scope** (optional): namespaces collection-wide topics per tenant. `scope: true` ships a `@payloadcms/plugin-multi-tenant` adapter; client topic strings do not change.
- **No job progress UI.** `payload-jobs` has no progress value, so there is no percentage display.

Local playground: `pnpm dev sse`, then open `/` (client SDK) and `/admin`.

## Quick start

```bash
pnpm add @10x-media/sse
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { sse } from '@10x-media/sse'

export default buildConfig({
  plugins: [
    sse({
      collections: { posts: true },
      presence: true,
      admin: true,
      // scope: true, // multi-tenant: see docs
    }),
  ],
})
```

Stream URL (authenticated): `/api/realtime/stream?topics=posts` or `posts:docId`. Client hooks:

```ts
import {
  usePayloadDocument,
  usePayloadList,
  useDocumentPresence,
  useDocumentConflict,
} from '@10x-media/sse/client'
```

`useDocumentConflict` returns `{ conflict, dismiss }` for custom admin UIs (`DocumentConflictState`).

Emit from the server:

```ts
import { getSSE } from '@10x-media/sse'

getSSE(payload).emit({
  id: 'custom-1',
  topic: 'posts',
  event: 'update',
  timestamp: Date.now(),
})
```

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/sse):

- [Overview](https://docs.10xmedia.de/sse)
- [Quick start](https://docs.10xmedia.de/sse/quick-start)
- [Security model](https://docs.10xmedia.de/sse/security)
- [Multi-tenancy](https://docs.10xmedia.de/sse/multi-tenancy)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
