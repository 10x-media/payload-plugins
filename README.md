# @10x-media/payload-plugins

Open-source plugins for [Payload v3](https://payloadcms.com) maintained by [10x-media](https://github.com/10x-media). Documentation: [docs.10xmedia.de](https://docs.10xmedia.de).

## Packages

| Package | Description | Version |
|---|---|---|
| [@10x-media/form-builder](./packages/form-builder) | End-to-end forms platform: author, validate, render, collect, aggregate, act | [![npm](https://img.shields.io/npm/v/@10x-media/form-builder)](https://www.npmjs.com/package/@10x-media/form-builder) |
| [@10x-media/analytics](./packages/analytics) | Adapter-based analytics: native engine or GA4/Plausible/Umami/PostHog, widgets, per-doc stats | [![npm](https://img.shields.io/npm/v/@10x-media/analytics)](https://www.npmjs.com/package/@10x-media/analytics) |
| [@10x-media/fields](./packages/fields) | Drop-in admin fields that look and behave native: color picker, icon picker, encrypted fields | [![npm](https://img.shields.io/npm/v/@10x-media/fields)](https://www.npmjs.com/package/@10x-media/fields) |
| [@10x-media/jobs](./packages/jobs) | Ops dashboard plus reliability, worker, and queue-control layers for Payload jobs | [![npm](https://img.shields.io/npm/v/@10x-media/jobs)](https://www.npmjs.com/package/@10x-media/jobs) |
| [@10x-media/webhooks](./packages/webhooks) | Outbound webhook subscriptions with signing, retries, and a delivery log | [![npm](https://img.shields.io/npm/v/@10x-media/webhooks)](https://www.npmjs.com/package/@10x-media/webhooks) |
| [@10x-media/admin-wiki](./packages/admin-wiki) | A living wiki inside the admin panel, with guides attached to the collections, fields, and blocks they explain | [![npm](https://img.shields.io/npm/v/@10x-media/admin-wiki)](https://www.npmjs.com/package/@10x-media/admin-wiki) |
| [@10x-media/undo-redo](./packages/undo-redo) | Client-side undo/redo for admin document forms, independent of document versions | [![npm](https://img.shields.io/npm/v/@10x-media/undo-redo)](https://www.npmjs.com/package/@10x-media/undo-redo) |
| [@10x-media/automations](./packages/automations) | No-code automation engine (beta scaffold) | [![npm](https://img.shields.io/npm/v/@10x-media/automations)](https://www.npmjs.com/package/@10x-media/automations) |
| [@10x-media/folder-picker](./packages/folder-picker) | Folder browsing inside the list drawer, so any field picks documents by folder | [![npm](https://img.shields.io/npm/v/@10x-media/folder-picker)](https://www.npmjs.com/package/@10x-media/folder-picker) |
| [@10x-media/dual-session](./packages/dual-session) | Give each Payload auth collection its own session cookie, so an admin session and a frontend session can coexist. | [![npm](https://img.shields.io/npm/v/@10x-media/folder-picker)](https://www.npmjs.com/package/@10x-media/dual-session) |


## Status

Beta. Packages publish as `*-beta.N` until 1.0. See [CHANGELOG entries](./packages/) per plugin.

## Contributing

This is a Turborepo using pnpm 10 (Node 22+, Docker for the Postgres and e2e test tiers). To get started:

```bash
pnpm install
pnpm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow and [CLAUDE.md](./CLAUDE.md) for the architecture overview.

## License

MIT
