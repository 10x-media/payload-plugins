# @10x-media/form-variants

## 0.1.0-beta.0

### Minor Changes

- Initial beta: alternative edit forms for a collection. Variants are sequences of steps drawn over Payload's own form state and rendered with Payload's own fields; `native` (the default edit view) is one of them. Field steps, component steps with a wizard API, server-side `access`, `defaultVariant`, `condition`, `gate` and `afterSave`, a single save guard, drawer support, and slots down to a headless layout.

- More built-in locales for the `formVariants:` strings.

  - Added: `ar`, `de`, `es`, `fr`, `id`, `ko`, `pt`, `ru`, `uk`, `zh`. Every key is covered in each.

### Patch Changes

- Register component items nested in a step's containers.

  A `{ type: 'component' }` item inside a step `row`, `collapsible` or `group` was rendered but never added to `admin.dependencies`, so the import map generator did not know about it and the component could not resolve at render time. Only items at the top level of a step were registered. The walk now descends into the containers, as the renderer already did.
