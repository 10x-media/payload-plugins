# @10x-media/automations

A no-code automation engine for Payload v3: editors will compose automations from triggers and actions in the admin panel, with each action running as a Payload task. Beta scaffold; the engine is being built on top of [@10x-media/jobs](https://www.npmjs.com/package/@10x-media/jobs).

[![npm](https://img.shields.io/npm/v/@10x-media/automations?style=flat-square)](https://www.npmjs.com/package/@10x-media/automations)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Beta scaffold: installing the plugin today registers translations and records the resolved trigger catalog on the config. It adds no collections, no UI, and runs nothing yet.

## What exists today

- The `automations(options)` factory with `disabled`, `translations`, and `triggers` options.
- A trigger catalog seam: sibling plugins contribute trigger slugs before the plugin resolves them (`@10x-media/webhooks` pushes `webhook`).
- Standard subpath exports: `./types`, `./client`, `./i18n`.

## Quick start

```bash
pnpm add @10x-media/automations
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { automations } from '@10x-media/automations'

export default buildConfig({
  plugins: [automations({})],
})
```

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/docs/automations):

- [Overview and status](https://docs.10xmedia.de/docs/automations)
- [Jobs family interop](https://docs.10xmedia.de/docs/concepts/jobs-family)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
