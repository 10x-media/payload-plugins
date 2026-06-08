# @10x-media/form-builder

An end-to-end forms platform for Payload v3: author, validate, render, collect, aggregate, and act on forms. Built to be the default forms solution for Payload projects, simple by default for non-technical editors, with real depth for power users and developers, and 100% native to Payload.

[![npm](https://img.shields.io/npm/v/@10x-media/form-builder?style=flat-square)](https://www.npmjs.com/package/@10x-media/form-builder)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Status: alpha. Phase 1 ships the field spine: the `defineFormField` primitive, a core field set, native-block authoring, server-validated typed submissions, and a formatted admin answers view. Phase 2 adds the declarative validation subsystem. Phase 3 adds serializable conditional logic: `visibleWhen`/`validateWhen` per field, enforced server-side by a pure isomorphic engine (conditions are authored as JSON for now; the native Where-style condition builder UI follows in a later release). The renderer, the client-side live-validation adapter, and the post-submit pipeline land in subsequent phases.

## What ships in Phase 1

- **`defineFormField`** defines a field type once and yields four facets from a single object: a Payload `Field[]` for the add-field drawer, a typed isomorphic `validate`, a localized `format`, and a `value` kind that drives the typed value threaded into `validate`/`format`.
- **Core field set**: `text`, `textarea`, `email`, `number`, `select`, and `checkbox`, each authored through the same primitive so custom field types are never second-class.
- **Field-type registry** via the `fields` option: `false` removes a built-in, `true` keeps it, an object adds a new type or replaces one.
- **Authoring via native blocks**: form fields are composed in a Payload blocks array, one block per registered field type.
- **Typed, self-describing, localized submissions**: each submission stores typed values plus a localized descriptor snapshot taken at submit time, validated server-side. The client is never trusted.
- **Formatted admin answers view**: submissions render through a read-only answers view that formats each value with its field type's `format`.

## Validation (Phase 2)

- **Per-field validation rules in the admin**: each field carries a constraint list authored as native blocks. Built-in rules cover `minLength`, `maxLength`, `min`, `max`, `pattern`, `email`, `url`, `oneOf`, `matchesField`, and `notAlreadySubmitted`.
- **Custom localized messages and severity**: every rule instance can override its message with `{var}` interpolation and run as an `error` (blocks submission) or a `warning` (advisory).
- **One server-authoritative engine**: rules run through a single engine, including cross-field rules (`matchesField`) and async server-only rules (`notAlreadySubmitted`). The server is the source of truth; the client is never trusted.
- **Custom rule types** via `defineValidationRule`: define a rule type once and it yields its admin params and a typed `validate` for the engine, exactly like the built-ins. Override the registry through the `rules` option: `false` removes a built-in, `true` keeps it, an object adds a new rule or replaces one.
- **Standard Schema escape hatch**: each field type can validate against any [Standard Schema](https://standardschema.dev) validator (zod, valibot, and others), bypassing the rule list when a schema is the better fit.

## Conditional logic (Phase 3)

- **`visibleWhen` and `validateWhen` per field**: every field can declare two conditions in Payload's `Where` shape over its sibling answers, for example `{ or: [{ and: [{ country: { equals: 'US' } }] }] }`. The same query operators you already use elsewhere in Payload drive form logic.
- **Hidden fields are skipped entirely**: when `visibleWhen` evaluates false, the field is not validated, its value is not stored, and any value the client sent for it is ignored. A hidden field cannot leak data into a submission.
- **`validateWhen` gates validation, not storage**: when `validateWhen` evaluates false, the field's validation rules are skipped but its value is still stored. Use it for answers that are only required under certain conditions.
- **Server-authoritative, pure, and isomorphic**: conditions are enforced server-side by `evaluateCondition`, a pure engine that mirrors Payload's query-operator semantics (coerce then compare) with no `req` or database access. It is exported so the renderer and your own code can reuse the exact same logic client-side.

> In this alpha, conditions are authored as JSON in Payload's `Where` shape. The native Where-style condition builder UI lands in a later release.

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

Add a custom field type with `defineFormField`. The `value` kind types the value passed to `validate` and `format`. Field types are authored with precise generics, so cast each registry entry to `FieldTypeOption` (the registry stores the erased type, the same boundary the built-ins use):

```ts
import { buildConfig } from 'payload'
import { formBuilder, defineFormField, type FieldTypeOption } from '@10x-media/form-builder'

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
				}) as FieldTypeOption,
			},
		}),
	],
})
```

Add a custom validation rule with `defineValidationRule`. Rules are authored with precise generics, so cast each registry entry to `ValidationRuleOption` at the `rules` boundary, the same way field types cast to `FieldTypeOption`:

```ts
import { formBuilder, defineValidationRule, type ValidationRuleOption } from '@10x-media/form-builder'

formBuilder({
	rules: {
		even: defineValidationRule<Record<string, never>, number>({
			type: 'even',
			label: 'Even number',
			appliesTo: ['number'],
			defaultMessage: 'Must be an even number',
			validate: ({ value, message }) => (value == null || value % 2 === 0 ? true : message()),
		}) as ValidationRuleOption,
	},
})
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `disabled` | `boolean` | `false` | When `true`, returns the incoming config unchanged. Useful for toggling the plugin per environment. |
| `fields` | `FieldTypesConfig` | `{}` | Per-type registry override. `false` removes a built-in, `true` keeps it, an object adds a new type or replaces one. |
| `rules` | `ValidationRulesConfig` | `{}` | Per-rule registry override. `false` removes a built-in, `true` keeps it, an object adds a new rule or replaces one. |
| `events` | `FormEventSink` | `undefined` | Pluggable sink for form lifecycle events; defaults to a no-op. Consumed by the submission pipeline in a later phase. |

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
