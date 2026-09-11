# @10x-media/form-variants

.

[![npm](https://img.shields.io/npm/v/@10x-media/form-variants?style=flat-square)](https://www.npmjs.com/package/@10x-media/form-variants)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Beta scaffold: this plugin currently returns the Payload config unchanged. Replace this note and the feature list below as you add behavior.

## Features

- Replace with 3-6 one-line bullets covering what the plugin adds.
- Typed translations with per-key overrides via `@10x-media/form-variants/i18n`.

## Quick start

```bash
pnpm add @10x-media/form-variants
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { formVariants } from '@10x-media/form-variants'

export default buildConfig({
  plugins: [formVariants({})],
})
```

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/form-variants):

- [Overview](https://docs.10xmedia.de/form-variants)
- [Quick start](https://docs.10xmedia.de/form-variants/quick-start)

Add the plugin's docs tree under `apps/docs/content/docs/form-variants/` and list its pages here. Long-form documentation lives on the docs site, not in this README.

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
