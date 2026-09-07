# @10x-media/settings-overlay

Files any Payload collection, global, registered admin view or component behind a floating panel, and makes that panel addressable by URL. `?settings=system/tags/abc` opens the panel on that document; copy the link, send it, it reopens the same thing.

[![npm](https://img.shields.io/npm/v/@10x-media/settings-overlay?style=flat-square)](https://www.npmjs.com/package/@10x-media/settings-overlay)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Features

- **Anything goes in the panel**: collections (list and edit), globals, registered admin views, your own components, and plain links.
- **Deep links**: `?settings=<overlay>/<item>[/<id>]` survives a reload, a share, and the back button.
- **One way in, when you want it**: `hideEntities` takes a listed collection or global out of the nav and off its own route. Off by default, because Payload's drawer mode omits the trash tab, bulk actions and the document tabs.
- **Open it from anywhere**: `useSettingsOverlay()` and `<SettingsOverlayButton>` work in a field, a list action or a dashboard card.
- **Access is decided on the server**: the rail each reader sees is computed for them. Items they cannot open never reach the browser.
- **No round trip for what does not need one**: the rail and every eager component arrive with the page. Lists, documents and views are fetched on open.
- **Replaceable pieces**: the rail, its rows and groups, the header, the search box and the whole panel are slots, each with exported prop types and the hooks a replacement needs.
- **Collections that behave like globals**: `resolveDocID` opens one document instead of a list, which is what `@payloadcms/plugin-multi-tenant` globals need.
- **Eleven languages** out of the box, overridable key by key.

## Quick start

```bash
pnpm add @10x-media/settings-overlay@beta
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { settingsOverlay } from '@10x-media/settings-overlay'
import { appearanceItem } from '@10x-media/settings-overlay/items'

export default buildConfig({
  collections: [tags, redirects],
  globals: [branding],
  plugins: [
    settingsOverlay({
      overlays: [
        {
          id: 'system',
          label: 'Settings',
          items: [
            appearanceItem(),
            { type: 'collection', slug: 'tags' },
            { type: 'collection', slug: 'redirects' },
            { type: 'global', slug: 'branding' },
          ],
        },
      ],
    }),
  ],
})
```

Then run `payload generate:importmap`. That is the whole installation: no change to `app/(payload)/layout.tsx`, no provider to mount.

The plugin ships no sidebar button. Open the panel from wherever suits you:

```tsx
'use client'
import { useSettingsOverlay } from '@10x-media/settings-overlay/client'

export const SettingsButton = () => {
  const { toggle } = useSettingsOverlay()
  return <button onClick={() => toggle('system')}>Settings</button>
}
```

## Item types

| Type | Source field | Own URL | Fetched |
|---|---|---|---|
| `collection` | `slug` | no, the plugin hides it | on open |
| `global` | `slug` | no, the plugin hides it | on open |
| `component` | `component` | no | with the page, or on open with `lazy: true` |
| `view` | `viewKey` in `admin.components.views` | yes | on open |
| `link` | `href` | n/a | n/a |

A `component` may be a server or a client component; the plugin renders it the way Payload renders any custom component and only hands server props to the former.

## Documentation

Full documentation lives at [the docs site](https://github.com/10x-media/payload-plugins/tree/main/apps/docs).

## Known workarounds

Two pieces of this plugin work around Payload limitations rather than using an API meant for the job. Both are isolated to one file each, documented in place, and guarded by a test that fails when the workaround stops being necessary:

- **`server/widgetDispatcher.tsx`** rides the built-in `render-widget` server function to render a lazy item on demand, because Payload has no config-level way to register a server function. `lazyTransport: 'server-function'` opts out of it and registers the plugin's own function instead, at the price of one edit to your generated layout.
- **`client/documentActions.tsx`** supplies the edit view's dots menu, because `@payloadcms/ui` exports `useDocumentDrawerContext` but not the provider that feeds it, so Payload's own menu has nobody to report a delete, duplicate or restore to. Payload's action components take those callbacks as props, but they cannot be reused: `@payloadcms/ui/exports/client` is a bundle carrying its own copy of every provider, so a component reached through `@payloadcms/ui/elements/*` reads a context nothing mounted. Each request is therefore rewritten to match, under Payload's own translation keys.

## License

MIT
