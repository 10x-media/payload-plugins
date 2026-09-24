# @10x-media/conversations

Conversations for Payload: messages bound to any document, global or custom key, with channels that decide who reads what, one-level threads, mentions and per-user read state. Comments on documents are the first extension; tickets and rooms are built from the same primitives.

[![npm](https://img.shields.io/npm/v/@10x-media/conversations?style=flat-square)](https://www.npmjs.com/package/@10x-media/conversations)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Features

- **Bound to targets, not to a conversations table**: a conversation is a key (`collection:persons:42`, `global:settings`, `custom:room:general`). The target document holds no reference to it.
- **Channels with their own access**: `internal` for staff, `shared` for the customer, each with `read` / `create` / `update` / `delete`. A cue above the composer says who will read what you write.
- **Threads** one level deep, with atomic reply counts on Mongo and Postgres.
- **Mentions** through a Lexical feature with a typeahead. Only users who can read the channel are offered, and `afterMention` fires once per new mention, never on edits. Delivering notifications is left to your project.
- **Unread state** per user and channel, and per thread.
- **Polling that stays cheap**: only mounted conversations, one tab per key across the browser, and nothing while the tab is hidden. Tokens are signed, so a poll tick runs no access code. The client transport can be swapped for a realtime one.
- **Fail-closed access**: batch conversation access is required, and both collections are closed over REST. Everything goes through the instance endpoints.
- **Primitives, not a page**: headless hooks for a website (`/react`), admin components on `@payloadcms/ui` (`/client`), and slots for your own client or server components.
- **Several instances**: call `conversations()` once per use case (`comments`, `tickets`), each with its own collections and endpoints.

## Quick start

```bash
pnpm add @10x-media/conversations@beta
```

```ts
// payload.config.ts
import { conversations, perTarget } from '@10x-media/conversations'
import { comments } from '@10x-media/conversations/comments'

const isStaff = ({ req }) => req.user?.collection === 'users'

export default buildConfig({
  plugins: [
    conversations({
      slug: 'comments',
      access: perTarget(({ req }) => Boolean(req.user)),
      channels: [
        {
          slug: 'internal',
          label: 'Internal',
          access: { read: isStaff, create: isStaff },
        },
      ],
      extensions: [comments({ collections: { posts: true } })],
    }),
  ],
})
```

Then run `payload generate:importmap`. Every edit view of `posts` now has a Comments button in its document controls.

## Documentation

Full documentation, covering access, channels, extensions, the React primitives, custom message types, transports and limits, lives at [the docs site](https://github.com/10x-media/payload-plugins/tree/main/apps/docs).

## Development

```bash
pnpm dev conversations      # dev app on :3000, log in as dev@10xmedia.de / password
pnpm test conversations     # unit + integration (Mongo in memory)
pnpm test:matrix conversations
pnpm test:e2e conversations
```

## License

MIT
