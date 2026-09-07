---
'@10x-media/settings-overlay': minor
---

Files any Payload collection, global, registered admin view or component behind a deep-linkable floating panel.

A listed collection or global is hidden from the nav and from its own route, so there is one way in rather than two, and that way is a URL: `?settings=system/tags/abc` reopens the same document after a reload or a share. Panels are opened from your own button through `useSettingsOverlay()`, or from anywhere with `<SettingsOverlayButton>`.

The rail each reader sees is computed on the server: overlay and item access functions, collection permissions and lifted `admin.hidden` predicates all run there, and rows the reader cannot open never reach the browser. The rail and every eager `component` item arrive with the page, so opening a panel of components costs no round trip; lists, documents, registered views and `lazy` components are fetched on open.

Also included: seven replaceable slots with typed props and the hooks that keep a replacement from being a fork, badges, stable group and item sorting, rail search, `resolveDocID` for collections that behave like globals (with a `tenantGlobalItem` helper for `@payloadcms/plugin-multi-tenant`), a bundled `appearanceItem` for theme and language, an opt-in template shim for embedding third-party admin views, and eleven languages.

Installation is one line in `payload.config.ts` plus `generate:importmap`. Nothing in `app/(payload)/layout.tsx` changes.
