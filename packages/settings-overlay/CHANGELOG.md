# @10x-media/settings-overlay

## 0.1.0-beta.1

### Minor Changes

- The panel now uses the browser's history the way pages do, and a new `history` option on each overlay (or in `defaults`) chooses how.

  - `history: 'push'`, the default, makes every navigation in the panel an entry: opening it, switching rows, opening a document, returning to its list, and closing it again. The back button walks all of it in reverse, and pressing it after a close reopens the panel where the reader left it. A list's filters, search, sort and paging replace the current entry instead, as Payload's own list does on a page.
  - `history: 'replace'` adds no entries. The URL still names the panel, so a link to it can be sent and survives a reload, but the back button leaves the page, as it does over one of Payload's drawers.

  The option has no effect on an overlay with `addressable: false`.

  Fixed along the way:

  - Closing the panel no longer leaves a dead entry behind, which made the next press of the back button appear to do nothing, one extra press per open and close.
  - Returning with back or forward to an address that names a panel opens it and keeps it open. Payload closes every modal when the pathname changes, and the panel used to take that for Escape and strip its own address a moment after opening.
  - A `link` row now pushes its destination, so the back button returns the reader to the panel exactly as they left it.
  - On phone-width screens the close button sits in the panel's top corner, sized as a touch target, instead of below the stacked rail.
  - The README, the type docs and the docs site no longer say a listed collection or global is hidden from the nav. It is not, unless the overlay sets `hideEntities`, which is off by default.

  `useSettingsOverlay()` gains `navigate(url)`, which closes the panel and pushes an admin URL, and `setTarget` takes an optional `{ replace: true }` for a change that corrects the address rather than moving the reader. The `OverlayHistory` type is exported from `@10x-media/settings-overlay/types`.

## 0.1.0-beta.0

### Minor Changes

- Files any Payload collection, global, registered admin view or component behind a deep-linkable floating panel.

  A panel is addressable: `?settings=system/tags/abc` reopens the same document after a reload or a share. `hideEntities` takes a listed collection or global out of the nav and off its own route when the panel should be the only way in; it is off by default, because Payload's drawer mode omits the trash tab, bulk actions and the document tabs. Panels are opened from your own button through `useSettingsOverlay()`, or from anywhere with `<SettingsOverlayButton>`.

  The rail each reader sees is computed on the server: overlay and item access functions, collection permissions and lifted `admin.hidden` predicates all run there, and rows the reader cannot open never reach the browser. The rail and every eager `component` item arrive with the page, so opening a panel of components costs no round trip; lists, documents, registered views and `lazy` components are fetched on open.

  Inside a panel the edit view keeps its document actions: delete, duplicate, restore from trash and "create new" run Payload's own components against the panel rather than navigating the admin away.

  Also included: seven replaceable slots with typed props and the hooks that keep a replacement from being a fork, badges, stable group and item sorting, rail search, `resolveDocID` for collections that behave like globals (with a `tenantGlobalItem` helper for `@payloadcms/plugin-multi-tenant`), a bundled `appearanceItem` for theme and language, an opt-in template shim for embedding third-party admin views, and typed translations with several locales built in.

  Installation is one line in `payload.config.ts` plus `generate:importmap`. Nothing in `app/(payload)/layout.tsx` changes.
