# @10x-media/form-builder

An end-to-end forms platform for Payload v3: author forms in the admin, validate server-side, render headless on your frontend, collect typed submissions, aggregate results, and act on them. Simple by default for editors, with a definition seam (`defineFormField`, `defineValidationRule`, `defineAction`, and friends) wherever developers need depth, and 100% native to Payload.

[![npm](https://img.shields.io/npm/v/@10x-media/form-builder?style=flat-square)](https://www.npmjs.com/package/@10x-media/form-builder)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Features

- **Fields**: text, textarea, email, number, date, select, checkbox, file, consent, calculation, and repeater (dynamic row lists with per-row sub-field validation), authored as Payload blocks; custom types via `defineFormField` are never second-class.
- **Validation**: declarative per-field rules, custom messages and severities, cross-field and async server-only rules, a Standard Schema escape hatch (zod, valibot, ...), one server-authoritative engine.
- **Conditional logic**: `visibleWhen` / `validateWhen` in Payload's `Where` shape, one isomorphic engine on client and server.
- **Multi-step flows** with conditional branching, authored in the admin flow builder.
- **Headless rendering**: `<Form>` with progressive validation and lifecycle events, accessible primitives, an optional layout grid; style via CSS hooks, a shadcn registry, or your own renderers.
- **Presentations**: page, inline, modal, drawer, built from composable accessible overlay primitives.
- **Recall and prefill**: pipe answers into labels and messages; URL prefill; hidden context fields.
- **Calculations**: a safe no-eval expression engine for totals and quiz scores, recomputed on the server.
- **Post-submit actions**: email, confirmation, signed webhook, and custom actions, queued via Payload jobs with a bounded inline fallback.
- **Consent** with proof by reference and policy-version capture; **file uploads** with server-enforced MIME/size; **polls** with a gated public results endpoint.
- **Spam protection** on by default: honeypot, per-identity rate limiting, bundled captcha adapters (Turnstile, reCAPTCHA, hCaptcha), upload-ownership scoping, privacy-first metadata.
- **Accessibility** verified by automated axe checks; **typed translations** via `@10x-media/form-builder/i18n`.
- **Collection overrides**: extend `forms`, `form-submissions`, and `form-uploads` with extra fields, hooks, and access rules using an explicit spread API that guarantees plugin-critical hooks always run.

## Quick start

```bash
pnpm add @10x-media/form-builder
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { formBuilder } from '@10x-media/form-builder'

export default buildConfig({
  plugins: [formBuilder()],
})
```

Author a form in the admin (`forms` collection), then render it:

```tsx
import { Form } from '@10x-media/form-builder/react'
import '@10x-media/form-builder/styles.css'

export function ContactForm({ form }) {
  return <Form form={form} />
}
```

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/form-builder):

- [Overview](https://docs.10xmedia.de/form-builder)
- [Quick start](https://docs.10xmedia.de/form-builder/quick-start)
- [Fields](https://docs.10xmedia.de/form-builder/fields)
- [Validation](https://docs.10xmedia.de/form-builder/validation)
- [Conditional logic](https://docs.10xmedia.de/form-builder/conditions)
- [Multi-step forms](https://docs.10xmedia.de/form-builder/multi-step)
- [Rendering](https://docs.10xmedia.de/form-builder/rendering)
- [Styling](https://docs.10xmedia.de/form-builder/styling)
- [Presentations](https://docs.10xmedia.de/form-builder/presentations)
- [Recall and prefill](https://docs.10xmedia.de/form-builder/recall-prefill)
- [Calculations](https://docs.10xmedia.de/form-builder/calculations)
- [Actions and events](https://docs.10xmedia.de/form-builder/actions)
- [Consent](https://docs.10xmedia.de/form-builder/consent)
- [File uploads](https://docs.10xmedia.de/form-builder/uploads)
- [Polls and aggregation](https://docs.10xmedia.de/form-builder/polls)
- [Spam protection](https://docs.10xmedia.de/form-builder/spam)
- [i18n](https://docs.10xmedia.de/form-builder/i18n)
- [Collection overrides](https://docs.10xmedia.de/form-builder/customization)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
