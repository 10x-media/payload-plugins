# @10x-media/form-builder

An end-to-end forms platform for Payload v3: author, validate, render, collect, aggregate, and act on forms. Built to be the default forms solution for Payload projects, simple by default for non-technical editors, with real depth for power users and developers, and 100% native to Payload.

[![npm](https://img.shields.io/npm/v/@10x-media/form-builder?style=flat-square)](https://www.npmjs.com/package/@10x-media/form-builder)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Status: alpha. Phase 1 ships the field spine: the `defineFormField` primitive, a core field set, native-block authoring, server-validated typed submissions, and a formatted admin answers view. Phase 2 adds the declarative validation subsystem. Phase 3 adds serializable conditional logic: `visibleWhen`/`validateWhen` per field with a native, Payload-style condition builder UI (field/operator/value, the same look as Payload's list filters), enforced server-side by a pure isomorphic engine. Phase 4 ships the headless `@10x-media/form-builder/react` renderer: the renderer contract, registry, accessible primitives, built-in field renderers, an optional container-query layout grid, and the orchestrating `<Form>` with progressive client-side validation, conditional visibility, submission, and lifecycle events. The post-submit action pipeline (email, webhooks) lands in a subsequent phase.

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
- **Native condition builder UI**: conditions are authored with a Payload-style condition builder on each field (field, operator, value, the same look as Payload's list filters), stored as a canonical `Where`, normalized and validated server-side. The serializable format means the renderer reuses the exact same `evaluateCondition` client-side.

## Headless renderer foundation (Phase 4a)

`@10x-media/form-builder/react` exports the headless renderer layer. It has no opinion on styling; bring your own CSS or opt into the included container-query grid.

### Subpath

```ts
import { defineFieldRenderer, resolveRenderers, defaultRenderers } from '@10x-media/form-builder/react'
```

### Renderer contract

A field renderer is a React component that maps `FieldRendererProps` to output. Use `defineFieldRenderer` to pin the type and get prop inference:

```ts
import { defineFieldRenderer } from '@10x-media/form-builder/react'

const myTextRenderer = defineFieldRenderer<string>(({ id, name, value, onChange, onBlur, errors, required, disabled, t }) => (
  <input
    id={id}
    name={name}
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value)}
    onBlur={onBlur}
    required={required}
    disabled={disabled}
    aria-invalid={errors.length > 0 || undefined}
  />
))
```

`FieldRendererProps<TValue>` carries the field instance, stable `id`, machine `name`, `value`, `onChange`/`onBlur`, `errors`/`warnings`, `required`, `disabled`, `locale`, and a `t` translator.

### Renderer registry

`resolveRenderers` merges a base renderer map with a consumer override config. The same `false/true/object` convention used throughout the plugin applies here: `false` removes a type, `true` keeps the default, a renderer adds or replaces one.

```ts
import { defaultRenderers, resolveRenderers } from '@10x-media/form-builder/react'

const registry = resolveRenderers(defaultRenderers, {
  text: myTextRenderer,   // replace the built-in text renderer
  number: false,          // remove the number renderer entirely
  rating: ratingRenderer, // add a custom type
})
```

### Unstyled accessible primitives

The six control primitives are exported for use inside custom renderers. Each is an unstyled, accessible HTML control that wires `aria-invalid` and `aria-describedby` but leaves visual styling to you:

| Primitive | Element |
|---|---|
| `Input` | text, email, or number `<input>` |
| `Textarea` | `<textarea>` |
| `Select` | `<select>` with typed `SelectOption[]` |
| `Checkbox` | `<input type="checkbox">` |
| `FieldShell` | Label + control slot + description + error/warning messages |

Pair them with `FieldShell`, which renders the `<label>`, the control slot, and the description/error/warning region with the matching `aria-describedby` wiring.

### Built-in renderers

`defaultRenderers` is a `Record<string, FieldRenderer>` keyed by field-type slug, covering `text`, `textarea`, `email`, `number`, `select`, and `checkbox`. Each built-in renderer uses `FieldShell` and the matching primitive.

### Optional layout grid

To enable the container-query layout grid, import the stylesheet once at the app boundary:

```ts
import '@10x-media/form-builder/styles.css'
```

Then use `FormLayout` and `widthProps` to place fields in a responsive grid:

```tsx
import { FormLayout, widthProps } from '@10x-media/form-builder/react'

<FormLayout>
  <div {...widthProps('half')}>{/* first name */}</div>
  <div {...widthProps('half')}>{/* last name */}</div>
  <div {...widthProps('full')}>{/* message */}</div>
</FormLayout>
```

`FieldWidth` values: `full`, `half`, `third`, `twoThirds`. Omit the import for your own layout; `FormLayout` still renders a plain container wrapper with no grid class when `enabled={false}`.

## Headless renderer: Form controller (Phase 4b)

Phase 4b ships the orchestrating `<Form>` component and the hooks that power fully custom layouts.

### Basic usage

```tsx
import { Form } from '@10x-media/form-builder/react'

export function MyForm({ form }) {
  return (
    <Form
      form={form}
      onSuccess={(submissionId) => console.log('submitted', submissionId)}
      onError={(message) => console.error(message)}
    />
  )
}
```

`form` is a `FormDocument`: `{ id: string | number; fields: FormFieldInstance[] }`. Pass the document fetched from the Payload API directly.

### Progressive validation

Validation runs on blur, re-validates on change once a field has been touched, then validates all visible fields on submit. Hidden fields (those whose `visibleWhen` condition evaluates false) are excluded from validation and from the submitted values. Server-returned field errors are mapped back to the correct field after submission.

### Submission transport

By default `<Form>` POSTs to `{apiRoute}/form-submissions` (default `/api`). Override the route via `apiRoute`:

```tsx
<Form form={form} apiRoute="/api/v2" />
```

Provide a fully custom transport via `onSubmit`. The handler receives `{ formId, values }` and must return a `SubmitFormResult`:

```tsx
<Form
  form={form}
  onSubmit={async ({ formId, values }) => {
    const res = await myClient.submitForm(formId, values)
    return res.ok ? { ok: true } : { ok: false, message: res.error }
  }}
/>
```

### Lifecycle events

Pass an `events` sink to observe form lifecycle:

```tsx
import type { FormEventSink } from '@10x-media/form-builder/react'

const sink: FormEventSink = {
  emit: (event) => analytics.track(event.type, event),
}

<Form form={form} events={sink} />
```

Events emitted: `form.viewed`, `form.started`, `field.errored`, `submission.created`, `form.abandoned`.

### FormProps reference

| Prop | Type | Default | Description |
|---|---|---|---|
| `form` | `FormDocument` | required | The form document (id + fields). |
| `fieldTypes` | `AnyFormFieldDefinition[]` | `undefined` | Extra field-type definitions to resolve renderers for custom types. |
| `rules` | `AnyValidationRuleDefinition[]` | `undefined` | Extra validation rule definitions. |
| `renderers` | `RenderersConfig` | `undefined` | Renderer overrides (same `false/true/object` convention). |
| `apiRoute` | `string` | `'/api'` | Payload API route prefix for the built-in transport. |
| `onSubmit` | `SubmitHandler` | `undefined` | Custom transport override. |
| `onSuccess` | `(submissionId?: string) => void` | `undefined` | Called after a successful submission. |
| `onError` | `(message: string) => void` | `undefined` | Called when submission fails. |
| `events` | `FormEventSink` | `undefined` | Lifecycle event sink. |
| `t` | `RendererTranslate` | `(key) => key` | Translator for renderer labels. |
| `locale` | `string` | `'en'` | Locale passed to renderers and validation. |
| `layout` | `boolean` | `true` | Pass `false` to disable the container-query grid wrapper. |
| `submitLabel` | `string` | `'Submit'` | Label for the submit button. |
| `successMessage` | `string` | `'Thank you.'` | Message shown after a successful submission. |

### Custom layouts with `useFormState` and `useField`

For fully custom layouts, pass your own markup as `children` of `<Form>` and bind each field with the context hooks. `useFormState` returns the whole `FormState`; `useField(name)` binds one field:

```tsx
import { Form, useField, useFormState } from '@10x-media/form-builder/react'

function NameField() {
  const { value, errors, setValue, onBlur } = useField<string>('name')
  return (
    <label>
      Name
      <input
        value={value ?? ''}
        onChange={(e) => setValue(e.target.value)}
        onBlur={onBlur}
        aria-invalid={errors.length > 0 || undefined}
      />
      {errors.map((e) => <span key={e}>{e}</span>)}
    </label>
  )
}

// Pass fields as children; <Form> provides the context and owns submission.
function ContactForm({ form }) {
  return (
    <Form form={form}>
      <NameField />
      <button type="submit">Send</button>
    </Form>
  )
}
```

When you pass `children`, `<Form>` renders them inside its context (instead of the auto-rendered field loop and default submit button), so you control the entire layout.

`UseFieldResult<TValue>` carries: `value`, `errors`, `warnings`, `touched`, `setValue`, and `onBlur`.

`FormState` carries: `values`, `errors`, `warnings`, `touched`, `submitting`, `submitted`, `submitAttempted`, and `submitError`.

> Multi-step forms and presentation-only steps are a later phase.

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
