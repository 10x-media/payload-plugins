---
'@10x-media/settings-overlay': minor
---

The panel now uses the browser's history the way pages do, and a new `history` option on each overlay (or in `defaults`) chooses how.

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
