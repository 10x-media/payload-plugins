# @10x-media/form-builder

An end-to-end forms platform for Payload v3: author, validate, render, collect, aggregate, and act on forms. Built to be the default forms solution for Payload projects, simple by default for non-technical editors, with real depth for power users and developers, and 100% native to Payload.

[![npm](https://img.shields.io/npm/v/@10x-media/form-builder?style=flat-square)](https://www.npmjs.com/package/@10x-media/form-builder)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Status: beta, feature-complete v1. Published under the `beta` dist-tag until a stable 1.0. The per-phase sections below double as the detailed feature reference; start with [Features](#features) and [Quickstart](#quickstart).

## Features

- **Field model** -- `defineFormField` defines a field type once and yields its admin authoring, a typed isomorphic `validate`, a localized `format`, and a value kind. Core set: text, textarea, email, number, select, checkbox, date, file, consent, calculation. Every seam is `false | true | object` overridable.
- **Validation subsystem** -- declarative per-field rules (`defineValidationRule`), custom messages + severity, cross-field + async server-only rules, a Standard Schema escape hatch, one server-authoritative engine.
- **Conditional logic** -- serializable `visibleWhen`/`validateWhen` with a native Payload-style builder, evaluated by one isomorphic engine (client preview + server enforcement).
- **Headless renderer** -- `@10x-media/form-builder/react`: `<Form>` with progressive validation, conditional visibility, lifecycle events, accessible primitives + built-in renderers, an optional container-query layout grid; a shadcn registry block and bring-your-own renderers.
- **Multi-step flow** -- a serializable flow state machine with conditional branching/skipping.
- **Presentations** -- page, modal, drawer, inline (+ custom), with composable accessible overlay primitives.
- **Recall + prefill** -- pipe earlier answers into later labels and the thank-you screen; URL/query prefill; hidden context fields.
- **Calculations + scoring** -- a safe (no-eval) expression engine for pricing, quotes, and quizzes.
- **Post-submit pipeline** -- email, confirmation, signed webhook, and custom actions (queued via Payload jobs / `@10x-media/jobs`, with a bounded-inline fallback) + a typed lifecycle event taxonomy through a pluggable sink.
- **Consent** -- a compliant consent field with three sources + a published-version capture utility, proof by reference.
- **Polls + aggregation** -- a submission-aggregation utility, `<FormResults>` (headless + shadcn), and a `<Poll>` pattern.
- **File uploads** -- a file field backed by a configurable upload collection, server-enforced MIME/size/required, self-describing references.
- **Spam basics** -- honeypot + rate-limiting on by default, a captcha adapter seam, upload-ownership scoping, privacy-first capture metadata.
- **Accessibility** -- accessible defaults verified by automated axe checks (jsdom + real-browser e2e); a documented a11y contract.
- **i18n** -- typed keys, flat `en`, host-overridable, never depending on `@payloadcms/translations`.

## Quickstart

Add the plugin to your Payload config:

```ts
import { formBuilder } from '@10x-media/form-builder'

export default buildConfig({
  // ...
  plugins: [formBuilder()],
})
```

Author a form in the admin (the `forms` collection), fetch it, and render it with the headless renderer:

```tsx
import { Form } from '@10x-media/form-builder/react'
import '@10x-media/form-builder/styles.css'

export function ContactForm({ form }: { form: FormDocument }) {
  return <Form form={form} />
}
```

`form` is a `forms` document loaded via Payload's Local or REST API. A complete working example (a multi-step form and a poll) lives in this package's `dev/app/(frontend)/`. For styled components, install the shadcn registry block (see [shadcn registry](#styled-components-shadcn-registry-phase-5)); to bring your own markup, supply renderers via `defineFieldRenderer` (see [BYO styling](#bring-your-own-styling-byo)).

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

## Styled components: shadcn registry (Phase 5)

Phase 5 ships a [shadcn registry](https://ui.shadcn.com/docs/registry) block that installs styled field renderers and a `<FormBuilderForm>` preconfigured with them into your own codebase. You own the copied files and can restyle them however you like.

### Install

The registry JSON is built to `registry/r/form.json` in the package source; hosting it on the docs site is a follow-up. Until then, point the shadcn CLI at the raw path:

```bash
npx shadcn@latest add <registry-url>/r/form.json
```

Once the registry is hosted, register it as a namespace in your `components.json` and install by short name:

```json
{
  "registries": {
    "@formbuilder": "https://<registry-host>/r/{name}.json"
  }
}
```

```bash
npx shadcn@latest add @formbuilder/form
```

### What gets installed

| Item | Destination |
|---|---|
| `@10x-media/form-builder` | added to `dependencies` |
| shadcn `input`, `textarea`, `label` primitives | `components/ui/` |
| `<FormBuilderForm>` | `components/form-builder/form-builder-form.tsx` |
| styled renderers map (`shadcnRenderers`) | `components/form-builder/renderers.tsx` |
| six styled field renderers | `components/form-builder/fields/*.tsx` |

### Usage

```tsx
import { FormBuilderForm } from '@/components/form-builder/form-builder-form'

export function MyForm({ form }) {
  return (
    <FormBuilderForm
      form={form}
      onSuccess={(id) => console.log('submitted', id)}
    />
  )
}
```

`<FormBuilderForm>` is `<Form>` preconfigured with the shadcn-styled renderers. Any `renderers` prop you pass merges on top, so you can override individual fields or add custom types without touching the rest.

The copied files are yours: edit typography, spacing, colors, or swap in a different component library's primitives. The shipped styling is a shadcn-convention baseline, not an API.

## Bring your own styling (BYO)

### When to BYO vs. shadcn

Use the shadcn registry when you want a working styled form in one command and your project already uses shadcn. BYO is for: projects that don't use shadcn; a design system that already has a component library; situations where you want to keep the control primitives and ship only CSS; or when you want full markup control from scratch.

Three paths from lightest to heaviest:

### Path 1: restyle with CSS on top of the unstyled primitives

The built-in renderers (via `defaultRenderers`) render through the unstyled primitives. Every element carries a stable class hook. Write CSS that targets those classes and nothing else needs to change.

| Class | Element |
|---|---|
| `fb-field` | wrapper `<div>` around the entire field |
| `fb-field__label` | `<label>` |
| `fb-field__required` | required asterisk `<span>` (aria-hidden) |
| `fb-field__messages` | description + errors + warnings region |
| `fb-field__description` | `<p>` description line |
| `fb-field__errors` | error group `<div>` (role=alert, aria-atomic) |
| `fb-field__error` | individual error `<p>` |
| `fb-field__warning` | individual warning `<p>` |
| `fb-input` | `<input type="text|email|number">` |
| `fb-textarea` | `<textarea>` |
| `fb-select` | `<select>` |
| `fb-checkbox` | `<input type="checkbox">` |

The wrapper `<div>` also receives a `data-invalid` attribute (present with empty string value) when the field has errors. Target it for error-state styling:

```css
.fb-field[data-invalid] .fb-input {
  border-color: red;
}
```

For the container-query layout grid, import the stylesheet and use `FormLayout` + `widthProps` as described in the Phase 4a section. The grid uses `fb-form--grid` on the container and `data-width` on each field slot (`full`, `half`, `third`, `twoThirds`).

```ts
import '@10x-media/form-builder/styles.css'
```

### Path 2: custom renderers with `defineFieldRenderer`

Author a renderer per field type and register it through `resolveRenderers`. See the [renderer contract section](#renderer-contract) for the full `FieldRendererProps` shape.

Use `resolveRenderers` to merge your overrides with the defaults:

```ts
import { defaultRenderers, resolveRenderers } from '@10x-media/form-builder/react'

const registry = resolveRenderers(defaultRenderers, {
  text: myText,    // replace the built-in text renderer
  number: false,   // remove number entirely
})
```

Pass `false` to remove a type, `true` to keep the default, or a renderer to replace it. The same convention applies throughout the plugin.

A complete custom text renderer with full a11y wiring:

```tsx
import { defineFieldRenderer } from '@10x-media/form-builder/react'
import { useId } from 'react'

const myText = defineFieldRenderer<string>(
  ({ field, name, value, onChange, onBlur, errors, warnings, required, disabled }) => {
    const id = useId()
    const describedById = `${id}-desc`
    const label = typeof field.label === 'string' ? field.label : undefined
    const invalid = errors.length > 0

    return (
      <div>
        {label ? (
          <label htmlFor={id}>
            {label}
            {required ? <span aria-hidden>{' *'}</span> : null}
          </label>
        ) : null}
        <input
          id={id}
          name={name}
          type="text"
          value={value ?? ''}
          required={required}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedById}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        <div id={describedById}>
          {invalid ? (
            <div role="alert" aria-atomic>
              {errors.map((msg) => <p key={msg}>{msg}</p>)}
            </div>
          ) : null}
          {warnings?.map((msg) => <p key={msg}>{msg}</p>)}
        </div>
      </div>
    )
  }
)
```

Then pass the resolved registry to `<Form>`:

```tsx
import { Form, defaultRenderers, resolveRenderers } from '@10x-media/form-builder/react'

const renderers = resolveRenderers(defaultRenderers, { text: myText })

<Form form={form} renderers={renderers} />
```

### Path 3: drop to `useField` / `useFormState`

For total markup control, pass children to `<Form>` and bind fields with the context hooks. See the [custom layouts section](#custom-layouts-with-useformstate-and-usefield).

### A11y checklist for custom renderers

Any renderer you write must satisfy these to match `FieldShell`'s baseline:

- `<label htmlFor={id}>` where `id` matches the control's `id` prop.
- `aria-invalid` set to `true` (or left absent) -- never set it to `false`; omit it when there are no errors.
- `aria-describedby={describedById}` on the control, pointing at a region that contains errors and warnings.
- The error region must have `role="alert"` and `aria-atomic` so screen readers announce it on change.
- The required asterisk (or whatever indicator you use) must be `aria-hidden`; do not rely on it as the sole signal.
- `required` on the native control so browser-native validation is consistent.

## Multi-step forms (Phase 6a)

A form document can carry an optional `flow` property that layers a serializable step graph over its flat field list. When `flow` is absent or has fewer than two steps, `<Form>` behaves as a standard single-step form; no migration or schema change is needed to adopt the feature incrementally.

### Flow data model

```ts
import type { FormFlow } from '@10x-media/form-builder/types'

const flow: FormFlow = {
  steps: [
    {
      id: 'contact',
      title: 'Contact details',
      fields: ['name', 'email'],
      next: 'message',
    },
    {
      id: 'message',
      title: 'Your message',
      fields: ['subject', 'body'],
      transitions: [
        { when: { subject: { equals: 'urgent' } }, to: 'urgent-confirm' },
      ],
      next: 'confirm',
    },
    {
      id: 'urgent-confirm',
      title: 'Confirm urgent request',
      fields: ['confirmUrgent'],
    },
    { id: 'confirm', title: 'Review', fields: ['consent'] },
  ],
}
```

Each `FlowStep` groups a subset of the form's fields by machine name. The `transitions` array is evaluated in order: the first entry whose `when` condition matches the current answers (via the same `evaluateCondition` engine used by `visibleWhen`/`validateWhen`) wins. If no transition matches, `next` is the default next step. A step with neither a matching transition nor `next` is terminal.

The `flow` is authored as data for now; a visual flow builder is a later release. Pass it alongside `fields` on the `FormDocument`:

```ts
import type { FormDocument } from '@10x-media/form-builder/react'

const form: FormDocument = { id: 'contact-form', fields: [...], flow }
```

### Renderer behavior

`<Form>` auto-drives the steps:

- Renders only the current step's fields (hides the rest).
- Back and Next buttons appear between the first and last steps.
- Advancing validates the current step's visible fields; errors block progress.
- Reaching a terminal step shows the Submit button instead of Next.
- Submission sends all accumulated answers as a single form submission.

No additional props are required; `<Form>` reads the `flow` from the form document.

### `useFormStep` for custom UIs and progress indicators

```tsx
import { useFormStep } from '@10x-media/form-builder/react'

function StepProgress() {
  const { stepIndex, stepCount, isFirst, isTerminal, currentStepId } = useFormStep()

  return (
    <p>
      Step {stepIndex + 1} of {stepCount}
      {isTerminal ? ' (final)' : null}
    </p>
  )
}
```

`stepIndex` and `stepCount` reflect the declared step order, so this reads exactly for linear flows. For branching flows, where some steps are skipped, derive progress from `currentStepId` (or track the visited steps yourself) rather than the raw index.

`useFormStep()` returns a `FormStepInfo`:

| Field | Type | Description |
|---|---|---|
| `flow` | `FormFlow \| undefined` | The full flow, or `undefined` for a single-step form. |
| `currentStepId` | `string \| undefined` | Machine id of the active step. |
| `stepIndex` | `number` | Zero-based index within the ordered step list. `0` for single-step. |
| `stepCount` | `number` | Total number of steps. `1` for single-step. |
| `isFirst` | `boolean` | `true` when on the first step. |
| `isTerminal` | `boolean` | `true` when no transition or `next` would advance further. |
| `goNext` | `() => void` | Advance to the next step (validates current step first). |
| `goBack` | `() => void` | Return to the previous step. |

### Isomorphic flow engine

The flow engine is exported from `@10x-media/form-builder/react` so you can drive custom step UIs without reimplementing the graph logic:

```ts
import {
  firstStepId,
  resolveNextStepId,
  isTerminalStepId,
  stepFieldNames,
} from '@10x-media/form-builder/react'
```

| Export | Signature | Description |
|---|---|---|
| `firstStepId` | `(flow) => string \| undefined` | Id of the first step. |
| `resolveNextStepId` | `(flow, currentId, answers) => string \| undefined` | Next step id given current answers. |
| `isTerminalStepId` | `(flow, currentId, answers) => boolean` | Whether the current step is terminal. |
| `stepFieldNames` | `(flow, id) => string[]` | Field machine names for a given step id. |

All four are pure and isomorphic (no React, no DOM).

## Presentations (Phase 6b)

A presentation is a named configuration bundle that controls how a form is surfaced to the visitor: where it appears in the page, how the overlay behaves, and whether it dismisses on success. Four presentations ship by default.

| Name | Surface | Behavior |
|---|---|---|
| `page` | Full page (default) | Renders inline in the page flow; no overlay. |
| `inline` | Embedded | Same as `page` but semantically scoped to an embedded slot. |
| `modal` | Overlay | Centered dialog; dismisses on success. |
| `drawer` | Overlay | Side-panel; dismisses on success. |

### Editor-chosen default

The Forms collection exposes a `defaultPresentation` select field in the admin UI. Editors choose a presentation when authoring the form; the renderer uses it automatically. When no presentation is chosen, `page` is the fallback.

### Render-time override

Pass the `presentation` prop to `<Form>` to override whatever the document carries. The value is either a registered name string or an inline `FormPresentation` object:

```tsx
import { Form } from '@10x-media/form-builder/react'

<Form form={form} presentation="modal" onClose={() => setOpen(false)} />
```

The `onClose` prop is forwarded to the presentation's `Wrapper` component (used by `modal` and `drawer`) so the host controls when the overlay closes.

### Presentation props on `<Form>`

| Prop | Type | Default | Description |
|---|---|---|---|
| `presentation` | `string \| FormPresentation` | `undefined` | Override the document's `defaultPresentation`. |
| `presentations` | `PresentationsConfig` | `undefined` | Registry override (`false/true/object` per name). |
| `onClose` | `() => void` | `undefined` | Forwarded to overlay wrappers for close-trigger handling. |
| `title` | `string` | `undefined` | Accessible name passed to overlay wrappers (e.g. `aria-label` on the dialog). |

### Custom presentations

Register a custom presentation through the `presentations` prop on `<Form>` (for a one-off) or via the plugin `presentations` option (to add it to the admin select and make it available everywhere). The same `false/true/object` convention used throughout the plugin applies here.

Via the plugin option:

```ts
import { formBuilder } from '@10x-media/form-builder'

formBuilder({
  presentations: {
    popover: false,         // remove a built-in
    modal: true,            // keep the default modal
    fullscreen: {           // add a new descriptor
      name: 'fullscreen',
      label: 'formBuilder:presentationFullscreen',
      surface: 'overlay',
      density: 'comfortable',
      dismissOnSuccess: true,
    },
  },
})
```

To provide a React `Wrapper` component for your custom presentation (required for overlays), pass a `FormPresentation` object directly to `<Form>`:

```tsx
import type { FormPresentation } from '@10x-media/form-builder/react'
import { DialogSurface } from '@10x-media/form-builder/react'

const fullscreen: FormPresentation = {
  name: 'fullscreen',
  label: 'formBuilder:presentationFullscreen',
  surface: 'overlay',
  density: 'comfortable',
  dismissOnSuccess: true,
  Wrapper: ({ open, onClose, title, children }) => (
    <DialogSurface open={open} onClose={onClose} label={title} surface="fullscreen">
      {children}
    </DialogSurface>
  ),
}

<Form form={form} presentations={{ fullscreen }} presentation="fullscreen" onClose={close} />
```

### Composable overlay primitives

The built-in `modal` and `drawer` are a thin composition of individually-exported primitives. A headless consumer can reach for exactly the pieces they need, or none at all.

```ts
import {
  DialogSurface,   // Backdrop + role=dialog/aria-modal + focus-trap + scroll-lock + dismiss
  Backdrop,        // full-viewport backdrop with data-fb-backdrop hook
  useFocusTrap,    // keeps Tab/Shift-Tab inside a container while active
  useScrollLock,   // locks body scroll while an overlay is open
  useDismiss,      // wires Escape and outside-click to an onDismiss callback
} from '@10x-media/form-builder/react'
```

Options:

- Use `inline` (or no presentation) for zero overlay DOM, then apply your own positioning.
- Compose only `useFocusTrap` + `useScrollLock` + `useDismiss` inside your own wrapper component.
- Use `Backdrop` standalone for a custom scrim behind your own surface markup.
- Use `DialogSurface` directly to get the full accessible dialog behavior and swap CSS only.

The built-in modal is `DialogSurface` plus a close button; the built-in drawer adds a `surface="drawer"` data hook for CSS positioning. Neither imposes a shadow DOM boundary or an opinionated style layer.

### Accessibility baseline

The built-in overlay (`DialogSurface`) ships a dependency-free, spec-compliant baseline:

- Full-viewport `Backdrop` (`aria-hidden`; click to dismiss).
- `role="dialog"` / `aria-modal` on the surface panel.
- Focus-trap: Tab and Shift-Tab cycle inside the dialog while it is open.
- Initial focus on the panel (`tabIndex=-1`) on open; focus restored to the trigger on close.
- Scroll-lock: `overflow: hidden` on `<body>` while the overlay is open.
- Escape key dismiss (configurable via `closeOnEscape`, default `true`).
- Outside-click dismiss (configurable via `closeOnOutsideClick`, default `true`).
- Accessible close button (`aria-label="Close"`, configurable via `closeLabel`).

### Deferred

Per-presentation style overrides, popover and exit-intent trigger modes, styled shadcn `Dialog` and `Sheet` wrappers (coming with the visual pass), and a React portal for the overlay DOM node (overlays currently use CSS `position: fixed`) are all planned for a later release.

## Answer recall and prefill (Phase 6c)

### Recall (piping)

Recall pipes a previously captured answer into any displayed text using `{{ fieldName }}` and `{{ fieldName|fallback }}` tokens. Tokens resolve against the current form values at render time. They work in field labels, field descriptions, option labels, and the success message.

Values are formatted through the field type's `format` function before substitution: a `select` field shows its option label, a `checkbox` shows Yes or No, a `date` shows a localized string. Token-free text is returned unchanged, so recall is a no-op when there are no tokens and can be applied unconditionally.

A simple two-field example where a later field echoes back an earlier answer:

```ts
// field 1: name (text)
// field 2: greeting (text, label uses recall)
{
  label: 'Hello {{name}}, what can we help with?',
  successMessage: 'Thanks {{name}}, we will be in touch.',
}
```

For custom layouts that manage their own rendering, `buildRecallResolver` and `interpolate` are exported from both `@10x-media/form-builder` and `@10x-media/form-builder/react`:

```ts
import { buildRecallResolver, interpolate } from '@10x-media/form-builder/react'

const resolve = buildRecallResolver({ fields, values, registry, locale, t })

const label = interpolate('Hello {{name}}', resolve)
const success = interpolate('Thanks {{name}}, we will be in touch.', resolve)
```

`buildRecallResolver` is pure and isomorphic -- no React, no DOM -- so it can also run in server components or API routes.

Deferred: recall inside email and action templates lands with the action pipeline. Calculations and scoring are their own phase.

### URL prefill

`valuesFromSearchParams` maps URL query parameters to typed initial field values. It maps KNOWN fields only, coerces each value to the field's value kind (number, boolean, multi-value, or text), and silently ignores unknown params, denied fields, and invalid values (for example a non-numeric string for a number field). Prefilled values are never trusted -- they still validate on submit.

Pass the result to `<Form initialValues={...}>`:

```tsx
import { valuesFromSearchParams } from '@10x-media/form-builder/react'
import { Form } from '@10x-media/form-builder/react'

// Server component -- reads searchParams on the server, no window access, no hydration mismatch.
export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const form = await fetchForm('contact')
  const params = new URLSearchParams(await searchParams)
  const initialValues = valuesFromSearchParams(params, form.fields, registry)

  return <Form form={form} initialValues={initialValues} />
}
```

The optional `options` argument controls which params map to which fields:

```ts
valuesFromSearchParams(params, fields, registry, {
  map: { utm_email: 'email' }, // rename: ?utm_email=... prefills the `email` field
  allow: ['name', 'email'],    // only these field names may be prefilled
  deny: ['internalRef'],       // these field names are never prefilled
})
```

`map`, `allow`, and `deny` may be combined. `allow` is evaluated after `map`, so the mapped field name (not the param name) must appear in the allow list.

### Hidden context fields

Any field can be marked hidden in the admin UI via the Advanced section of its field settings. A hidden field is captured and included in the submission but not shown to the visitor. Pair it with URL prefill to capture tracking values like `utm_source` or referrer without displaying them in the form:

```ts
// The `source` field is hidden and prefilled from ?source=...
valuesFromSearchParams(params, fields, registry, { allow: ['source'] })
```

The `hidden` flag is render-only. The server stores and validates the field normally. A hidden field that is required and not prefilled will fail validation on submit, so hidden fields should be optional or reliably prefilled.

## Calculations and scoring (Phase 6d)

A `calculation` field is a read-only numeric field whose value is derived from a serializable expression tree over other answers. The value is computed live client-side for display, then re-computed authoritatively on the server at submit. The server value is never taken from the client; it is the authoritative value stored in the submission, used in conditions, and checked by validation rules.

Set `calcDisplay: false` to compute without rendering anything visible (for example a hidden total or quiz score that conditions and validation reference but the visitor does not see).

### The `CalcExpression` AST

Expressions are plain JSON objects with a `type` discriminant. No `eval`, no `Function`, no untrusted code executes at any point.

| Node type | Shape | Notes |
|---|---|---|
| `lit` | `{ type:'lit', value:number }` | Numeric literal |
| `ref` | `{ type:'ref', field:string }` | Reference to another field's answer |
| `op` | `{ type:'op', op:'+'\|'-'\|'*'\|'/'\|'%', left:CalcExpression, right:CalcExpression }` | Binary arithmetic |
| `neg` | `{ type:'neg', operand:CalcExpression }` | Unary negation |
| `fn` | `{ type:'fn', fn:'min'\|'max'\|'round'\|'abs'\|'ceil'\|'floor', args:CalcExpression[] }` | Math functions |
| `weight` | `{ type:'weight', field:string, weights:Record<string,number> }` | Maps an option answer to a score |

A price total multiplying two referenced answers:

```ts
import type { CalcExpression } from '@10x-media/form-builder'

const total: CalcExpression = {
  type: 'op',
  op: '*',
  left: { type: 'ref', field: 'qty' },
  right: { type: 'ref', field: 'unitPrice' },
}
```

A quiz score that maps a multiple-choice answer to a point value:

```ts
const scoreQ1: CalcExpression = {
  type: 'weight',
  field: 'q1',
  weights: { a: 10, b: 0, c: 5 },
}
```

### Safety and totality

The evaluator is total: it always produces a finite number. Division or modulo by zero returns `0`; a missing `ref` returns `0`; unknown option keys in `weight` return `0`. Recursion is depth-guarded (max depth 64) so a pathologically nested expression cannot overflow the stack. The evaluator runs on the public submit path for every form submission.

### Dual compute

The `calculation` value is computed client-side each time its referenced answers change, so the running total or score is immediately visible to the visitor. On submit, the server re-computes from scratch using the same `evaluateCalc` engine. The client value is discarded; only the server result is stored.

Because the value is authoritative at the server level, it can be referenced in `visibleWhen`/`validateWhen` conditions and in validation rules exactly like any other field value.

### Scored results via recall

Pipe a computed score into the post-submit success message using the recall token syntax:

```
Thanks, you scored {{score}} points!
```

`{{score}}` resolves to the `score` calculation field's formatted value at display time. This reuses the same recall feature described in the Answer recall section above; no additional setup is needed.

### Authoring and programmatic use

Calculation expressions are authored as data (JSON stored in the field config). A visual calc-builder UI is planned for a later release.

`evaluateCalc`, `computeCalcFields`, `calcExpressionOf`, and `normalizeCalc` are exported from the root entry point and from `@10x-media/form-builder/react` so custom layouts can compute calc values with the exact same engine:

```ts
import { evaluateCalc, computeCalcFields, type CalcExpression } from '@10x-media/form-builder'

const expr: CalcExpression = { type: 'ref', field: 'qty' }
const result = evaluateCalc(expr, { qty: 3 })  // 3
```

```ts
import { computeCalcFields } from '@10x-media/form-builder/react'

const updatedValues = computeCalcFields(fields, currentValues)
```

## Post-submit actions and events

### Action pipeline

When a form submission is saved, the plugin runs the form's configured action blocks in order. Three built-in action types ship out of the box:

- **emailTeam**: sends an email to one or more addresses via `payload.sendEmail`. Subject and body are recall templates (`{{field}}`); for example, `"New submission: {{name}}"` resolves against the submission values. The plugin calls `payload.sendEmail` directly -- configure a Payload email adapter to make it work; when no adapter is configured it no-ops gracefully.
- **confirmation**: sends a confirmation email to the submitter. Same recall-template syntax.
- **signedWebhook**: POSTs the submission as JSON to a URL with an HMAC-SHA256 signature header. See Signed webhook below.

Custom action types are registered via `defineAction`:

```ts
import { defineAction } from '@10x-media/form-builder'
import type { TextField } from 'payload'

const slackNotify = defineAction({
  type: 'slackNotify',
  label: 'Notify Slack channel',
  config: [
    { name: 'webhookUrl', type: 'text', required: true } as TextField,
    { name: 'message', type: 'text' } as TextField,
  ],
  run: async ({ values, config }) => {
    const body = config.message ?? values.map((v) => `${v.label}: ${v.value}`).join('\n')
    await fetch(config.webhookUrl as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: body }),
    })
  },
})

formBuilder({ actions: { slackNotify } })
```

The `config` fields become an authoring block inside the form editor. `run` receives the submission values, the stored config, `payload`, and a translate helper.

### Plugin option and per-form blocks

The plugin accepts an `actions` option following the same `false | true | object` convention as fields and validations:

```ts
formBuilder({
  actions: {
    emailTeam: true,      // keep built-in
    confirmation: false,  // remove built-in
    slackNotify,          // add custom
  },
})
```

Forms then expose an **Actions** blocks array in the admin. Editors add one or more action blocks per form and fill in each block's `config` fields. Actions run in the order they appear.

### Run model

Actions run as Payload jobs when a job runner is present (`config.jobs.autoRun: true` or the `@10x-media/jobs` plugin). When no job runner is detected, a bounded inline fallback runs them synchronously after the submission row is stored. Either way, an action error never fails the submission: each action is isolated, and a failure is captured as a failed `ActionResult` and logged rather than re-thrown.

### Signed webhook

The `signedWebhook` action POSTs the submission body as JSON and attaches an `X-Form-Signature` header:

```
X-Form-Signature: v1=<hex>
```

The signature is HMAC-SHA256 over the raw JSON body (the body alone, not a timestamp-prefixed string). To verify on the receiving end:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

function verifyFormSignature(rawBody: string, secret: string, header: string): boolean {
  const expected = `v1=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  // Constant-time compare (avoid a timing side-channel); length guard first since timingSafeEqual requires equal lengths.
  return a.length === b.length && timingSafeEqual(a, b)
}
```

This header is intentionally distinct from `@10x-media/webhooks`' `X-Webhook-Signature` (which signs `timestamp.body`) so a receiver cannot mistake the two schemes.

`signPayload` and `SIGNATURE_HEADER` are exported from the root entry point for consumers who need to verify manually.

### Lifecycle events

The plugin emits typed lifecycle events through the `events` sink (a `FormEventSink` passed to `formBuilder({ events })`). The sink is a no-op by default; analytics adapters and the future automations plugin subscribe here.

The full event taxonomy:

| Event | Emitter | When |
|---|---|---|
| `form.viewed` | renderer (client) | form mounts |
| `form.started` | renderer (client) | first field interaction |
| `step.viewed` | renderer (client) | multi-step: step becomes active |
| `step.completed` | renderer (client) | multi-step: step passes validation |
| `field.errored` | renderer (client) | a field receives a validation error |
| `form.abandoned` | renderer (client) | component unmounts without a successful submission |
| `submission.created` | server | submission row saved and actions dispatched |

`form.viewed` through `form.abandoned` are emitted by the `<Form>` component. `submission.created` is emitted by the server `afterChange` hook.

Types are exported from `@10x-media/form-builder/types`:

```ts
import type { FormEvent, FormEventSink } from '@10x-media/form-builder/types'
```

### Deferred

Conditional notifications (only send an action when a condition is met) are planned for v1.x.

## Consent (Phase 8)

The consent field captures affirmative, checkbox-based consent with a built-in compliance baseline: unchecked by default, required to submit unless `optional: true` is set, and proof stored by reference -- never by copying policy text.

### Compliance defaults

- The checkbox is unchecked by default. The form will not submit until every non-optional consent field is checked.
- Set `optional: true` on a consent field for marketing opt-ins or similar non-required consent. Keep terms-of-service consent separate and required.
- Proof is stored as a structured object on the submission's `consent` JSON array, containing the agreed boolean, a URL reference (`ref`), and an optional version reference (`versionRef`). Policy text is never stored.

### Consent field

The `consent` field type carries a `statement` (the text shown next to the checkbox), an optional `source` (which consent source type resolves the policy link), and a `sourceConfig` group for source-specific parameters:

```ts
// In a form's fields blocks:
{
  blockType: 'consent',
  name: 'terms',
  statement: 'I have read and agree to the Privacy Policy',
  source: 'static',
  sourceConfig: {
    label: 'Privacy Policy',
    url: 'https://example.com/privacy',
  },
  optional: false,
}
```

### Consent sources

Three built-in source types ship:

- **static** (default): a fixed URL and label, authored directly in `sourceConfig`. No server step required; the renderer reads `sourceConfig` directly.
- **pageReference**: resolves a policy URL at display time by looking up a Payload collection document. Set `relationTo`, `docId`, and optionally `urlField` in `sourceConfig`.
- **custom** via `defineConsentSource`: implement a `resolve` function that returns `{ links, versionRef?, versionLabel? }` given the stored config and a Payload instance.

```ts
import { defineConsentSource } from '@10x-media/form-builder'

const mySource = defineConsentSource({
  type: 'mySource',
  label: 'My policy source',
  resolve: async ({ config, payload, locale }) => ({
    links: [{ label: config.label as string, url: config.url as string }],
  }),
})

formBuilder({ consentSources: { mySource } })
```

The `consentSources` option follows the same `false | true | object` convention used by `fields`, `rules`, and `actions`.

### Version capture

Set `captureVersion: true` in `sourceConfig` for sources that support it (currently `pageReference`). When enabled, `captureConsent` calls `resolvePublishedVersionRef` at submit time to record the version of the policy document the user agreed to. If Payload's draft/versions feature is off for that collection, `versionRef` is null and omitted from the proof.

```ts
import { resolvePublishedVersionRef } from '@10x-media/form-builder'

const ref = await resolvePublishedVersionRef(payload, {
  collection: 'pages',
  id: docId,
})
```

### Proof by reference

On submit, `captureConsent` is called for each consent field. It returns a `ConsentProof` stored in the submission's `consent` array:

```ts
import type { ConsentProof } from '@10x-media/form-builder'

// Stored per consent field:
// { agreed: true, ref: 'https://...', versionRef?: '...', at: '<ISO-8601>' }
```

`ref` is the policy URL resolved at submit time, not at page load. `at` is the ISO-8601 timestamp of the submission. Policy text is never stored.

### Display step: resolveConsentLinks

For the `pageReference` source (and any custom source), call `resolveConsentLinks` server-side before rendering so the renderer receives the resolved policy links:

```ts
import { resolveConsentLinks } from '@10x-media/form-builder'

const resolved = await resolveConsentLinks(field, {
  registry: consentRegistry,
  payload,
  locale: 'en',
})

// Embed `resolved.links` into the field as `consentLinks` before passing to the renderer.
```

The `static` source needs no server step; the renderer falls back to `sourceConfig.url` and `sourceConfig.label` directly when `consentLinks` is absent.

### Renderer

The `consent` field is included in `defaultRenderers` (keyed `'consent'`). It renders:

- the `statement` as the field label,
- an unchecked checkbox (the field value) that the user must check,
- one or more policy links derived from `field.consentLinks` (server-resolved) or, as a fallback, from `field.sourceConfig.url`.

Policy links open in a new tab with `rel="noopener noreferrer"`.

```tsx
import { Form, defaultRenderers, resolveRenderers } from '@10x-media/form-builder/react'

<Form form={form} renderers={resolveRenderers(defaultRenderers)} />
```

### Deferred

Integration with c15t (consent management infrastructure) and retention-pruning of consent proofs are planned for a later release.

## Polls and response aggregation (Phase 9)

Submissions are a collection, so aggregation is a query. This phase ships a submission-aggregation utility, a `<FormResults>` renderer (headless plus shadcn), a gated public results endpoint, and a turnkey `<Poll>` component. The same utility powers survey response summaries.

### Aggregation utility

`aggregateFieldResponses` (one field) and `aggregateFormResponses` (one or many fields, one pass) tally a form's submissions by answer value.

```ts
import { aggregateFieldResponses } from '@10x-media/form-builder'

const results = await aggregateFieldResponses({ payload, formId, field: 'colour' })
// {
//   field: 'colour',
//   label: 'Favourite colour',
//   fieldType: 'select',
//   total: 42,            // respondents who answered this field (the percentage denominator)
//   truncated: false,
//   buckets: [
//     { value: 'red', label: 'Red', count: 28, percentage: 66.7 },
//     { value: 'blue', label: 'Blue', count: 14, percentage: 33.3 },
//   ],
// }
```

- **Percentages are over respondents** (submissions with a non-empty answer for the field), not all submissions. Array answers (select-all) increment one bucket per element while counting one respondent, so percentages can sum past 100%.
- **`complete` submissions only by default.** Pass `status: 'all'` to include partials, or `status: 'partial'`.
- **Labels** come from the field's current options, falling back to the submitted snapshot label, then the raw value. Buckets follow the option order, then any retired values by count.
- **Bounded.** It pages `payload.find` and reduces in JS (identical on Mongo and Postgres, no durable snapshot; long-term rollups are the analytics plugin's concern). The scan caps at `maxSubmissions` (default 10000); past it the result is flagged `truncated: true`.

`aggregateFormResponses` with no `fields` aggregates every enumerable field (those with options), which is the survey-summary case:

```ts
const summary = await aggregateFormResponses({ payload, formId }) // FieldAggregation[]
```

### `<FormResults>`

A headless, presentational renderer. It never fetches: resolve the data server-side and pass it in. The option label, count, and percentage are real text (the accessible content); the bar fill is decorative. Import the optional `./styles.css` for the `fb-results*` bar styling, or style it yourself. A shadcn-styled parity component is available from the registry (`shadcn add` the `form-results` item).

```tsx
import { FormResults } from '@10x-media/form-builder/react'

<FormResults results={results} />          // one field, or
<FormResults results={summary} />          // an array (survey summary)
```

### Results endpoint and opt-in

Anonymous voters cannot read raw submissions (that access is gated, and submissions never reach the browser), so public poll results are served as aggregate counts through a gated endpoint:

```
GET /api/forms/:id/results?field=<name>   ->   { results: FieldAggregation[] }
```

- **Authenticated callers** (admins) may aggregate any field, or all enumerable fields when `field` is omitted.
- **Anonymous callers** are served only when the form's `showResults` is on, only for the configured `resultsField`, and only if that field is enumerable (a choice field).
- **Security:** set `resultsField` to a choice field, never a free-text or PII field. The enumerable check refuses to expose a non-choice field publicly even if `resultsField` is misconfigured.

`fetchFormResults` is the client helper:

```ts
import { fetchFormResults } from '@10x-media/form-builder/react'

const res = await fetchFormResults({ formId, field: 'colour' })
if (res.ok) {
  // res.results: FieldAggregation[]
}
```

### `<Poll>`

A turnkey poll renders `<Form>` until the visitor votes, then fetches results and shows `<FormResults>`. A per-browser localStorage flag skips straight to results on revisit.

```tsx
import { Poll } from '@10x-media/form-builder/react'

<Poll form={form} resultsField="colour" />
```

For an SSR poll, aggregate server-side and choose what to render:

```tsx
// app/poll/[id]/page.tsx (server component)
import { aggregateFieldResponses } from '@10x-media/form-builder'
import { FormResults, Form } from '@10x-media/form-builder/react'

export default async function PollPage({ params }) {
  const form = await payload.findByID({ collection: 'forms', id: params.id })
  const voted = (await cookies()).has(`voted-${form.id}`)
  if (voted) {
    const results = await aggregateFieldResponses({ payload, formId: form.id, field: 'colour' })
    return <FormResults results={results ? [results] : []} />
  }
  return <Form form={form} />
}
```

### One response per identity (dedup)

The `<Poll>` localStorage guard is per-browser UX: it stops the same browser re-seeing the form, but it is bypassable and is not integrity. Server-enforced one-per-identity dedup composes with what already ships:

- **Authenticated forms:** gate on `req.user` in a submissions hook or access rule.
- **By a field value (such as email):** the built-in `notAlreadySubmitted` validation rule.

Cookie and IP identity dedup arrives with the spam phase.

## File uploads (spec 11.6)

A `file` field backed by a configurable upload collection. The client uploads to the collection and submits only the upload id; the server re-reads the file metadata from the stored doc and enforces MIME/size, so the client is never trusted for it.

### The `file` field

```ts
{
  blockType: 'file',
  name: 'resume',
  label: 'Resume',
  required: true,
  relationTo: 'form-uploads',          // upload collection (default: form-uploads)
  mimeTypes: ['application/pdf', 'image/*'],
  maxSize: 5_000_000,                  // bytes
}
```

The submitted value is a self-describing `FileRef` snapshot, captured server-side:

```ts
type FileRef = { id: string | number; filename: string; mimeType: string; filesize: number; url?: string }
```

### Upload collection (the `uploads` option)

The plugin ships a built-in `form-uploads` collection, on by default. It allows anonymous create (public forms upload here) and gates read/update/delete to authenticated users.

```ts
formBuilder({
  uploads: true,                       // default: ship form-uploads
  // uploads: false,                   // bring your own; set the file field's relationTo to it
  // uploads: { slug, upload: { staticDir, mimeTypes }, access, fields },  // configure the built-in
})
```

Storage is the project's responsibility: configure `upload.staticDir` or a Payload storage adapter (S3, etc.). The collection has no `imageSizes`, so it needs no `sharp`.

### Server enforcement (the trust boundary)

On submit, `runSubmission` loads the referenced upload doc and re-validates it against the field's `mimeTypes`/`maxSize`, capturing the authoritative `FileRef`. A missing, disallowed, or oversize file blocks the submission with a per-field error; required presence rides the normal required rule. The client-sent filename/mimeType/filesize are never stored. Set `resultsField`-style PII care here too: only the upload id crosses the wire.

### Renderer and client helper

The headless `file` renderer (and its shadcn parity) is a file input that uploads on change and stores the returned id; `uploadFile` is the underlying client helper:

```tsx
import { uploadFile } from '@10x-media/form-builder/react'

const result = await uploadFile({ file, collection: 'form-uploads' })
if (result.ok) {
  // result.id is the upload id to store as the field value
}
```

The admin answers view renders a file answer as a download link when the `FileRef` carries a url.

### Deferred

Multiple files per field is a v1.x follow-up. Per-upload ownership scoping and rate-limiting on the public upload path now ship with the spam controls below.

## Spam and abuse prevention (spec 11.7)

A honeypot decoy and per-identity rate limiting are **on by default** on the public submission and upload paths, with a captcha adapter seam and server-stamped upload ownership. Everything is opt-out, per control or with `spam: false`.

```ts
formBuilder({
  spam: {
    // honeypot: false,                 // disable the decoy
    // rateLimit: false,                // disable submission rate limiting
    // rateLimit: { window: 60_000, max: 5 },
    // uploadRateLimit: { window: 60_000, max: 20 },
    // captcha: turnstileProvider,       // a defineCaptchaProvider adapter
    // identify: (req) => req.user ? `user:${req.user.id}` : null,
    // ipHeader: 'cf-connecting-ip',     // trusted client-IP header
    // metadata: { ip: true, ua: true }, // opt in to storing IP/UA (privacy)
  },
})
```

### Defense in depth, not DoS protection

App-level rate limiting **complements** edge/CDN/WAF rate limiting; it does not replace it. Treat it as one layer: it cheaply turns away casual abuse and bots, but a determined flood should be stopped at the edge. The default limiter is a window counter over Payload's first-class `payload.kv` (durable + cross-instance). Because the KV interface has no atomic increment, the counter is a **soft limit** (a concurrent burst can slightly exceed the cap). Swap `spam.rateLimit.limiter` for a Redis-backed `RateLimiter` if you need a hard limit.

### Best-effort identity

Payload v3 has no `req.ip`. Identity resolves to the authenticated user id, else the first hop of a trusted IP header (default `x-forwarded-for`). This is **proxy-dependent**: set `spam.ipHeader` to whatever your proxy/CDN sets, or provide a custom `spam.identify(req)` (e.g. keyed on a signed cookie). When no identity can be resolved, rate limiting and upload-ownership scoping **fail open** rather than blocking legitimate traffic, so configure your proxy for these controls to bite.

### Honeypot

`<Form>` renders a visually hidden decoy field (off-screen, `aria-hidden`, `tabIndex={-1}`, `autoComplete="off"`). A real user never fills it; a bot that fills every input does, and the server rejects the submission with a generic error. The decoy field name defaults to `confirm_email` (shared constant `DEFAULT_HONEYPOT_FIELD`); if you customize `spam.honeypot.fieldName` on the server, pass the same name to `<Form honeypot={{ name }}>`, and make sure it does not collide with a real field's machine name.

### Captcha

v1 ships the **seam only**, no built-in provider. Supply one and pass the widget token to `<Form>`:

```ts
import { defineCaptchaProvider } from '@10x-media/form-builder'

const turnstile = defineCaptchaProvider({
  type: 'turnstile',
  verify: async ({ token }) => {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: process.env.TURNSTILE_SECRET, response: token }),
    })
    return ((await res.json()) as { success: boolean }).success
  },
})
```

```tsx
<Form form={form} captchaToken={tokenFromYourWidget} />
```

When a provider is configured, a submission without a valid token is rejected. Prebuilt Turnstile/reCAPTCHA/hCaptcha adapters are a v1.x addition.

### Upload ownership

Each upload to the built-in `form-uploads` collection is stamped with the uploader's identity (`owner`). At submit, a file reference is captured only if the submitting identity matches the upload's owner, so an anonymous submitter cannot reference another identity's upload; a mismatch is treated as a missing file. When the submitter cannot be identified (no resolvable identity), ownership is not enforced (fail-open) -- a proxy-configured deployment identifies every request, so this only relaxes scoping where it could not apply fairly anyway. Unstamped uploads (no identity at upload time, or a bring-your-own collection without the field) are unaffected. Ownership granularity is identity-level (IP for anonymous traffic): clients sharing a NAT share scope, and an identity that changes between upload and submit (a rotating mobile IP) will not match its own earlier upload. A per-session token is a v1.x option.

### Capture metadata (privacy)

The submission `meta` always records a timestamp and a spam signal. The client IP and user-agent are **not** stored unless you opt in via `spam.metadata.ip` / `spam.metadata.ua` (a GDPR consideration).

### Spam options

| Option | Type | Default | Description |
|---|---|---|---|
| `honeypot` | `false \| { fieldName? }` | on (`confirm_email`) | Hidden decoy field; a filled decoy is rejected. |
| `rateLimit` | `false \| { window?, max?, limiter? }` | on (60s / 5) | Per-identity submission limit. |
| `uploadRateLimit` | `false \| { window?, max?, limiter? }` | on (60s / 20) | Per-identity upload limit. |
| `captcha` | `CaptchaProvider` | none | A `defineCaptchaProvider` adapter; token verified on submit. |
| `identify` | `IdentifyFn` | user id / IP header | Identity resolver for limiting + ownership. |
| `ipHeader` | `string` | `x-forwarded-for` | Trusted client-IP header. |
| `metadata` | `{ ip?, ua? }` | `{}` (off) | Opt in to storing IP/UA on the submission `meta`. |

## Accessibility

The headless renderer ships accessible defaults, verified by automated axe checks (`axe-core` over the rendered `<Form>` in the unit tier, plus a real-browser `@axe-core/playwright` sweep in e2e). The contract every built-in renderer upholds:

- Every field control has a programmatically associated label (`<label for>` / accessible name); the consent control falls back to the field label so it is never unlabelled.
- Validation errors are exposed via `role="alert"`, linked to the control with `aria-describedby`, and the control is marked `aria-invalid` when invalid.
- Submit, Next, and Back are real `<button>`s; the multi-step flow validates per step on advance.
- The honeypot decoy is `aria-hidden` and off the tab order, so assistive tech never encounters it.

Caveat (by design): we ship accessible structure, but final compliance also depends on your theme. Color contrast in particular is a function of the colors you apply, so the jsdom axe pass skips `color-contrast` (no layout engine) and the e2e sweep checks it against the demo theme; validate contrast against your own palette. If you supply custom renderers (`defineFieldRenderer`) or restyle the primitives, preserve the label/error wiring above. See [A11y checklist for custom renderers](#a11y-checklist-for-custom-renderers).

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
| `presentations` | `PresentationsDescriptorConfig` | `{}` | Per-presentation registry override (page/modal/drawer/inline + custom). `false` removes, `true` keeps, an object adds or replaces one. |
| `actions` | `ActionsConfig` | `{}` | Per-action registry override (email/confirmation/signed-webhook + custom). `false` removes, `true` keeps, an object adds or replaces one. |
| `consentSources` | `ConsentSourcesConfig` | `{}` | Per-consent-source registry override (static/pageReference + custom). `false` removes, `true` keeps, an object adds or replaces one. |
| `uploads` | `UploadsOption` | `true` | Built-in `form-uploads` collection backing file fields. `false` brings your own (set the file field's `relationTo`); an object overrides slug/upload/access/fields. |
| `spam` | `SpamOption` | `{}` (on) | Honeypot + rate-limiting (on by default), a captcha adapter seam, and upload-ownership scoping. `false` disables the whole subsystem; see [Spam and abuse prevention](#spam-and-abuse-prevention-spec-117). |

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
