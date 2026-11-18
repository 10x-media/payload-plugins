# @10x-media/form-variants

## 4.0.0-alpha.3

### Patch Changes

- The variant form saves the way Payload `4.0.0-beta.10`'s edit view does: the form refreshes its own state after a save and on each change, and locks and stale data come from the document info. A save whose form was reset or left before it returned no longer redirects, switches variant or runs `afterSave`.

- Requires Payload `4.0.0-beta.10`: the `payload` and `@payloadcms/*` peers are `^4.0.0-beta.10`, and the plugins are built and tested against it.

## 4.0.0-alpha.2

### Minor Changes

- A new `./shared` entry exports the helpers with no server and no React dependency (key formats and parsers, constants, error names and guards, formatters), for a host module that both server code and client components import. On Payload 4 the browser build of `payload` is `payload/shared`, so a client bundle that reaches the root fails on `definePlugin` and the Local API, and a server caller of a `'use client'` entry gets a client reference instead of the function. The root and the client entries keep exporting the same helpers.

## 4.0.0-alpha.1

### Major Changes

- Payload 4 support, on Next.js and TanStack Start. `next` is no longer a peer: the plugin reads and writes its `?variant=` parameter through Payload's router. The variant's edit form follows Payload 4's own: the save flow, lock expiry, trash and hierarchy checks and the stale data notice (`DocumentStaleData`) match the native view, and in a drawer the switcher and save controls move into the drawer's header bar. The chrome takes Payload 4's look from Payload's own components on its tokens: document controls markup for the top bar, Payload's tabs for the progress rail (the step classes now sit on the tab button), a secondary `Button` for the switcher, and `Button`'s `loading` state on the primary step button. The fallback outcome screen's title and message take Payload 4's heading and body styles (`form-variants__outcome-title`, `form-variants__outcome-message`). `--form-variants-rail` and `--form-variants-current` are removed. The package declares its CSS as side effects. See Upgrading to Payload 4 in the docs.

## 0.1.0-beta.0

### Minor Changes

- Initial beta: alternative edit forms for a collection. Variants are sequences of steps drawn over Payload's own form state and rendered with Payload's own fields; `native` (the default edit view) is one of them. Field steps, component steps with a wizard API, server-side `access`, `defaultVariant`, `condition`, `gate` and `afterSave`, a single save guard, drawer support, and slots down to a headless layout.

- More built-in locales for the `formVariants:` strings.

  - Added: `ar`, `de`, `es`, `fr`, `id`, `ko`, `pt`, `ru`, `uk`, `zh`. Every key is covered in each.

### Patch Changes

- Register component items nested in a step's containers.

  A `{ type: 'component' }` item inside a step `row`, `collapsible` or `group` was rendered but never added to `admin.dependencies`, so the import map generator did not know about it and the component could not resolve at render time. Only items at the top level of a step were registered. The walk now descends into the containers, as the renderer already did.
