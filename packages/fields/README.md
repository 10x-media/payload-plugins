# @10x-media/fields

Reusable admin fields for Payload: color picker, icon picker, encrypted fields, and more.

[![npm](https://img.shields.io/npm/v/@10x-media/fields?style=flat-square)](https://www.npmjs.com/package/@10x-media/fields)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Beta scaffold: this plugin currently returns the Payload config unchanged. Replace this note and the feature list below as you add behavior.

## Features

- Replace with 3-6 one-line bullets covering what the plugin adds.
- Typed translations with per-key overrides via `@10x-media/fields/i18n`.

## Quick start

```bash
pnpm add @10x-media/fields
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { fields } from '@10x-media/fields'

export default buildConfig({
  plugins: [fields({})],
})
```

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/fields):

- [Overview](https://docs.10xmedia.de/fields)
- [Quick start](https://docs.10xmedia.de/fields/quick-start)

Add the plugin's docs tree under `apps/docs/content/docs/fields/` and list its pages here. Long-form documentation lives on the docs site, not in this README.

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
