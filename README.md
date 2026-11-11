# @10x-media/payload-plugins

> [!IMPORTANT]
> **This is the Payload v4 branch.** Plugins are being ported to Payload `4.0.0-beta` one at a time and released as `4.0.0-alpha.N` under the `alpha` tag (`pnpm add @10x-media/<plugin>@alpha`); each plugin's README says whether it has been ported. The Payload v3 versions live on [`main`](https://github.com/10x-media/payload-plugins/tree/main) and are released as `latest`. The documentation site covers Payload v3.

Open-source plugins for [Payload](https://payloadcms.com) maintained by [10x-media](https://github.com/10x-media). Documentation: [docs.10xmedia.de](https://docs.10xmedia.de).

## Packages

| Package | Description | Version |
|---|---|---|
| [@10x-media/form-builder](./packages/form-builder) | End-to-end forms platform: author, validate, render, collect, aggregate, act | [![npm](https://img.shields.io/npm/v/@10x-media/form-builder/alpha)](https://www.npmjs.com/package/@10x-media/form-builder) |
| [@10x-media/analytics](./packages/analytics) | Adapter-based analytics: native engine or GA4/Plausible/Umami/PostHog, widgets, per-doc stats | [![npm](https://img.shields.io/npm/v/@10x-media/analytics/alpha)](https://www.npmjs.com/package/@10x-media/analytics) |
| [@10x-media/fields](./packages/fields) | Drop-in admin fields that look and behave native: color picker, icon picker, encrypted fields | [![npm](https://img.shields.io/npm/v/@10x-media/fields/alpha)](https://www.npmjs.com/package/@10x-media/fields) |
| [@10x-media/jobs](./packages/jobs) | Ops dashboard plus reliability, worker, and queue-control layers for Payload jobs | [![npm](https://img.shields.io/npm/v/@10x-media/jobs/alpha)](https://www.npmjs.com/package/@10x-media/jobs) |
| [@10x-media/webhooks](./packages/webhooks) | Outbound webhook subscriptions with signing, retries, and a delivery log | [![npm](https://img.shields.io/npm/v/@10x-media/webhooks/alpha)](https://www.npmjs.com/package/@10x-media/webhooks) |
| [@10x-media/admin-wiki](./packages/admin-wiki) | A living wiki inside the admin panel, with guides attached to the collections, fields, and blocks they explain | [![npm](https://img.shields.io/npm/v/@10x-media/admin-wiki/alpha)](https://www.npmjs.com/package/@10x-media/admin-wiki) |
| [@10x-media/undo-redo](./packages/undo-redo) | Client-side undo/redo for admin document forms, independent of document versions | [![npm](https://img.shields.io/npm/v/@10x-media/undo-redo/alpha)](https://www.npmjs.com/package/@10x-media/undo-redo) |
| [@10x-media/audit-logs](./packages/audit-logs) | Audit fields plus a field-level diff per change, with a browsable view and scheduled archiving | [![npm](https://img.shields.io/npm/v/@10x-media/audit-logs/alpha)](https://www.npmjs.com/package/@10x-media/audit-logs) |
| [@10x-media/automations](./packages/automations) | No-code automation engine (beta scaffold) | [![npm](https://img.shields.io/npm/v/@10x-media/automations)](https://www.npmjs.com/package/@10x-media/automations) |
| [@10x-media/folder-picker](./packages/folder-picker) | Folder browsing inside the list drawer, so any field picks documents by folder | [![npm](https://img.shields.io/npm/v/@10x-media/folder-picker/alpha)](https://www.npmjs.com/package/@10x-media/folder-picker) |
| [@10x-media/dual-session](./packages/dual-session) | Give each Payload auth collection its own session cookie, so an admin session and a frontend session can coexist. | [![npm](https://img.shields.io/npm/v/@10x-media/dual-session/alpha)](https://www.npmjs.com/package/@10x-media/dual-session) |
| [@10x-media/form-variants](./packages/form-variants) | Alternative edit forms for a collection: simplified and step-by-step variants over the native form state | [![npm](https://img.shields.io/npm/v/@10x-media/form-variants/alpha)](https://www.npmjs.com/package/@10x-media/form-variants) |
| [@10x-media/settings-overlay](./packages/settings-overlay) | Files any collection, global, admin view or component behind a deep-linkable floating panel | [![npm](https://img.shields.io/npm/v/@10x-media/settings-overlay/alpha)](https://www.npmjs.com/package/@10x-media/settings-overlay) |
| [@10x-media/content-lock](./packages/content-lock) | Maintenance windows that freeze content on every channel, including the Local API: scheduled or immediate, scoped to groups, with an announcement banner and jobs integration | [![npm](https://img.shields.io/npm/v/@10x-media/content-lock/alpha)](https://www.npmjs.com/package/@10x-media/content-lock) |
| [@10x-media/impersonation](./packages/impersonation) | Let an authorised account sign in as another user without their password. After start, `req.user` is the target. | [![npm](https://img.shields.io/npm/v/@10x-media/impersonation/alpha)](https://www.npmjs.com/package/@10x-media/impersonation) |
| [@10x-media/conversations](./packages/conversations) | Conversations bound to any document: channels with their own access, threads, mentions, read state; comments, reactions and attachments as extensions | [![npm](https://img.shields.io/npm/v/@10x-media/conversations/alpha)](https://www.npmjs.com/package/@10x-media/conversations) |
| [@10x-media/dedupe](./packages/dedupe) | Find duplicate documents in any collection and merge them, with pluggable search adapters | [![npm](https://img.shields.io/npm/v/@10x-media/dedupe/alpha)](https://www.npmjs.com/package/@10x-media/dedupe) |
| [@10x-media/document-preview](./packages/document-preview) | Read-only previews of uploads in the admin: images, video, audio, PDF, CSV, code, Markdown, Word, Excel and PowerPoint, lazy-loaded per format, with file-type icons and custom viewers | [![npm](https://img.shields.io/npm/v/@10x-media/document-preview/alpha)](https://www.npmjs.com/package/@10x-media/document-preview) |


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
