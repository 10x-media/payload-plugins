# @10x-media/wildix

Payload plugin for Wildix Unified Communications telephony integration.

[![npm](https://img.shields.io/npm/v/@10x-media/wildix?style=flat-square)](https://www.npmjs.com/package/@10x-media/wildix)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Beta scaffold: this plugin currently returns the Payload config unchanged. Replace this note and the feature list below as you add behavior.

## Features

- Replace with 3-6 one-line bullets covering what the plugin adds.
- Typed translations with per-key overrides via `@10x-media/wildix/i18n`.

## Quick start

```bash
pnpm add @10x-media/wildix
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { wildix } from '@10x-media/wildix'

export default buildConfig({
  plugins: [wildix({})],
})
```

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/wildix):

- [Overview](https://docs.10xmedia.de/wildix)
- [Quick start](https://docs.10xmedia.de/wildix/quick-start)

Add the plugin's docs tree under `apps/docs/content/docs/wildix/` and list its pages here. Long-form documentation lives on the docs site, not in this README.

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
