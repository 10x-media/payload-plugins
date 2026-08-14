---
'@10x-media/admin-wiki': minor
---

Three component slots on the wiki index view.

- Added: `wikiView` now takes an object as well as a boolean, and `wikiView.components` holds one array of components per slot, exactly as a collection's `admin.components` takes them. `beforeControls` renders in the header actions row, ahead of the edit mode toggle and the create button; `beforeTable` sits between the search controls and the guide list; `afterTable` below it. `wikiView: true` and omitting it are the views with every slot empty, and `wikiView: false` still skips the routes.
- Slot components receive `slot`, `wikiPath`, `guideCount`, and `canCreate` as client props, and server components additionally receive `payload`, `req`, `i18n`, `locale`, `params`, and `searchParams`, so a slot can query for whatever the index does not carry. Both prop types are exported as `WikiViewSlotClientProps` and `WikiViewSlotServerProps`.
- Each slot component is registered under `config.admin.dependencies`, so `payload generate:importmap` finds it the same way it finds a block renderer or a video player. A reference that names its export in `exportName` is registered under the key the runtime lookup asks for.
