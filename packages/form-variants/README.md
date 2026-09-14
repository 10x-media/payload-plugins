# @10x-media/form-variants

Alternative edit forms for a Payload collection. A variant is a sequence of steps drawn over Payload's own form state, rendered with Payload's own fields, saved by Payload's own save. The native form is one of the variants, so accounts with access can switch back and forth.

[![npm](https://img.shields.io/npm/v/@10x-media/form-variants?style=flat-square)](https://www.npmjs.com/package/@10x-media/form-variants)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Features

- **Steps over the real form**: a step lists paths of the collection's own fields, so custom components, conditions and validation apply. A simplified form and a guided wizard are the same mechanism.
- **`native` is Payload's own view**, untouched, with a switcher. Restricting who sees it is one `access` function.
- **One save guard**: header buttons, Ctrl+S and Enter all respect it. Saving happens on the last step unless a variant says `save: 'always'`.
- **Server-side step logic**: `access`, `defaultVariant`, `condition`, `gate` and `afterSave` run with `req`, first at page render and then through the plugin's endpoint.
- **Component steps** with the full wizard API (`useWizard`, `useWizardState`, `finish`), and slots for every piece of chrome down to a headless layout.
- **Drawers too**: a document created from a relationship field's drawer gets the same variant.
- **No storage**: the step lives in the URL, the chosen variant in a Payload preference.
- **Typed translations** with per-key overrides via `@10x-media/form-variants/i18n`.

## Quick start

```bash
pnpm add @10x-media/form-variants@beta
```

```ts
// collections/people.ts
import { defineFormVariants } from '@10x-media/form-variants'

export const People: CollectionConfig = {
  slug: 'people',
  custom: {
    formVariants: defineFormVariants('people', {
      defaultVariant: ({ user }) => (isAdmin(user) ? 'native' : 'quick'),
      variants: [
        {
          key: 'quick',
          label: 'Quick form',
          steps: [{ key: 'identity', fields: ['firstName', 'lastName', 'dateOfBirth', 'gender'] }],
        },
        { key: 'native', access: ({ user }) => isAdmin(user) },
      ],
    }),
  },
  fields: [/* unchanged */],
}
```

```ts
// payload.config.ts
import { formVariants } from '@10x-media/form-variants'

export default buildConfig({
  plugins: [formVariants({})], // last, so it sees every collection
})
```

Then `payload generate:importmap`.

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/form-variants):

- [Overview](https://docs.10xmedia.de/form-variants)
- [Configuration](https://docs.10xmedia.de/form-variants/configuration)
- [Steps](https://docs.10xmedia.de/form-variants/steps)
- [Saving](https://docs.10xmedia.de/form-variants/saving)
- [Customization](https://docs.10xmedia.de/form-variants/customization)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
