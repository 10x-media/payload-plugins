---
'@10x-media/settings-overlay': minor
---

Files any Payload collection, global, registered admin view or component behind a deep-linkable floating panel.

A panel is addressable: `?settings=system/tags/abc` reopens the same document after a reload or a share. `hideEntities` takes a listed collection or global out of the nav and off its own route when the panel should be the only way in; it is off by default, because Payload's drawer mode omits the trash tab, bulk actions and the document tabs. Panels are opened from your own button through `useSettingsOverlay()`, or from anywhere with `<SettingsOverlayButton>`.

The rail each reader sees is computed on the server: overlay and item access functions, collection permissions and lifted `admin.hidden` predicates all run there, and rows the reader cannot open never reach the browser. The rail and every eager `component` item arrive with the page, so opening a panel of components costs no round trip; lists, documents, registered views and `lazy` components are fetched on open.

Inside a panel the edit view keeps its document actions: delete, duplicate, restore from trash and "create new" run Payload's own components against the panel rather than navigating the admin away.

Also included: seven replaceable slots with typed props and the hooks that keep a replacement from being a fork, badges, stable group and item sorting, rail search, `resolveDocID` for collections that behave like globals (with a `tenantGlobalItem` helper for `@payloadcms/plugin-multi-tenant`), a bundled `appearanceItem` for theme and language, an opt-in template shim for embedding third-party admin views, and typed translations with several locales built in.

Installation is one line in `payload.config.ts` plus `generate:importmap`. Nothing in `app/(payload)/layout.tsx` changes.
