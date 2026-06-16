# @10x-media/form-builder

An end-to-end forms platform for Payload v3: author, validate, render, collect, aggregate, and act on forms. Built to be the default forms solution for Payload projects, simple by default for non-technical editors, with real depth for power users and developers, and 100% native to Payload.

[![npm](https://img.shields.io/npm/v/@10x-media/form-builder?style=flat-square)](https://www.npmjs.com/package/@10x-media/form-builder)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> Status: beta. Phase 1 ships the field spine: the `defineFormField` primitive, a core field set, native-block authoring, server-validated typed submissions, and a formatted admin answers view. Phase 2 adds the declarative validation subsystem. Phase 3 adds serializable conditional logic: `visibleWhen`/`validateWhen` per field with a native, Payload-style condition builder UI (field/operator/value, the same look as Payload's list filters), enforced server-side by a pure isomorphic engine. Phase 4 ships the headless `@10x-media/form-builder/react` renderer: the renderer contract, registry, accessible primitives, built-in field renderers, an optional container-query layout grid, and the orchestrating `<Form>` with progressive client-side validation, conditional visibility, submission, and lifecycle events. The post-submit action pipeline (email, webhooks) lands in a subsequent phase. Phase 5 ships a shadcn registry block (styled field renderers + `<FormBuilderForm>`) plus bring-your-own-styling docs.

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
