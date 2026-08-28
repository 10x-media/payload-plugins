# @10x-media/sse

Server-Sent Events, presence, and live admin updates for Payload.

[![npm](https://img.shields.io/npm/v/@10x-media/sse?style=flat-square)](https://www.npmjs.com/package/@10x-media/sse)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Beta scaffold: this plugin currently returns the Payload config unchanged. Replace this note and the feature list below as you add behavior.

## Features

- Replace with 3-6 one-line bullets covering what the plugin adds.
- Typed translations with per-key overrides via `@10x-media/sse/i18n`.

## Quick start

```bash
pnpm add @10x-media/sse
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { sse } from '@10x-media/sse'

export default buildConfig({
  plugins: [sse({})],
})
```

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/sse):

- [Overview](https://docs.10xmedia.de/sse)
- [Quick start](https://docs.10xmedia.de/sse/quick-start)

Add the plugin's docs tree under `apps/docs/content/docs/sse/` and list its pages here. Long-form documentation lives on the docs site, not in this README.

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
