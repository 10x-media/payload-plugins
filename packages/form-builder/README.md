# @10x-media/form-builder

An end-to-end forms platform for Payload v3: author, validate, render, collect, aggregate, and act on forms. Built to be the default forms solution for Payload projects, simple by default for non-technical editors, with real depth for power users and developers, and 100% native to Payload.

[![npm](https://img.shields.io/npm/v/@10x-media/form-builder?style=flat-square)](https://www.npmjs.com/package/@10x-media/form-builder)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Status: alpha. Foundation only. The plugin currently registers a `definePlugin` factory, skeletal `forms` and `form-submissions` collections, the i18n setup, and a pluggable (no-op by default) event-sink seam. The field-type registry, validation subsystem, renderer, and post-submit pipeline land in subsequent phases.

## Requirements

- Payload v3 (peer: `payload@^3.82.0`)
- React 19 (peer: `react@^19.0.0`, `react-dom@^19.0.0`)
- `@payloadcms/ui@^3.82.0` (peer)

## Installation

```bash
pnpm add @10x-media/form-builder
```

## Usage

```ts
import { buildConfig } from 'payload'
import { formBuilder } from '@10x-media/form-builder'

export default buildConfig({
  plugins: [formBuilder({})],
})
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `disabled` | `boolean` | `false` | When `true`, returns the incoming config unchanged. Useful for toggling the plugin per environment. |
| `events` | `FormEventSink` | `undefined` | Pluggable sink for form lifecycle events; defaults to a no-op. Consumed by the submission pipeline in a later phase. |

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
