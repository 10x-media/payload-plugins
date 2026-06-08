# @10x-media/form-builder

An end-to-end forms platform for Payload v3: author, validate, render, collect, aggregate, and act on forms. Built to be the default forms solution for Payload projects, simple by default for non-technical editors, with real depth for power users and developers, and 100% native to Payload.

[![npm](https://img.shields.io/npm/v/@10x-media/form-builder?style=flat-square)](https://www.npmjs.com/package/@10x-media/form-builder)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Status: alpha. Phase 1 ships the field spine: the `defineFormField` primitive, a core field set, native-block authoring, server-validated typed submissions, and a formatted admin answers view. The renderer, declarative validation builder, and post-submit pipeline land in subsequent phases.

## What ships in Phase 1

- **`defineFormField`** defines a field type once and yields four facets from a single object: a Payload `Field[]` for the add-field drawer, a typed isomorphic `validate`, a localized `format`, and a `value` kind that drives the typed value threaded into `validate`/`format`.
- **Core field set**: `text`, `textarea`, `email`, `number`, `select`, and `checkbox`, each authored through the same primitive so custom field types are never second-class.
- **Field-type registry** via the `fields` option: `false` removes a built-in, `true` keeps it, an object adds a new type or replaces one.
- **Authoring via native blocks**: form fields are composed in a Payload blocks array, one block per registered field type.
- **Typed, self-describing, localized submissions**: each submission stores typed values plus a localized descriptor snapshot taken at submit time, validated server-side. The client is never trusted.
- **Formatted admin answers view**: submissions render through a read-only answers view that formats each value with its field type's `format`.

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

Add a custom field type with `defineFormField`. The `value` kind types the value passed to `validate` and `format`:

```ts
import { buildConfig } from 'payload'
import { formBuilder, defineFormField } from '@10x-media/form-builder'

export default buildConfig({
	plugins: [
		formBuilder({
			fields: {
				rating: defineFormField<'number'>({
					type: 'rating',
					label: 'Star rating',
					value: 'number',
					validate: ({ value }) => (value == null || value <= 5 ? true : 'Too high'),
					format: ({ value }) => `${value ?? 0} / 5`,
				}),
			},
		}),
	],
})
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `disabled` | `boolean` | `false` | When `true`, returns the incoming config unchanged. Useful for toggling the plugin per environment. |
| `fields` | `FieldTypesConfig` | `{}` | Per-type registry override. `false` removes a built-in, `true` keeps it, an object adds a new type or replaces one. |
| `events` | `FormEventSink` | `undefined` | Pluggable sink for form lifecycle events; defaults to a no-op. Consumed by the submission pipeline in a later phase. |

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
