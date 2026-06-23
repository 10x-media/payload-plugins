# @10x-media/sipgate

Payload plugin for sipgate telephony integration.

[![npm](https://img.shields.io/npm/v/@10x-media/sipgate?style=flat-square)](https://www.npmjs.com/package/@10x-media/sipgate)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Beta scaffold: this plugin currently returns the Payload config unchanged. Replace this note and fill in the sections below as you add behavior.

## Requirements

- Payload v3 (peer: `payload@^3.82.0`)
- React 19 (peer)

## Installation

```bash
pnpm add @10x-media/sipgate
```

## Usage

```ts
import { buildConfig } from 'payload'
import { sipgate } from '@10x-media/sipgate'

export default buildConfig({
  // ...
  plugins: [
    sipgate({
      // options
    }),
  ],
})
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `disabled` | `boolean` | `false` | When `true`, returns the incoming config unchanged. Useful for toggling the plugin per environment. |

<!-- Add new options to this table as you build them. -->

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
