---
'@10x-media/folder-picker': minor
---

Initial beta of `@10x-media/folder-picker`: folder browsing inside Payload's list drawer.

Payload has had folders since 3.39, but only on the collection route. Opening the same collection from an upload field's "choose from existing" gives a flat, paginated list with no folders. This plugin puts them back.

- **One view swap, every caller**: replaces `admin.components.views.list.Component` on folder-enabled collections. Payload resolves that component for both the list route and the list drawer, so upload fields, `hasMany` upload fields, relationship fields with `appearance: 'drawer'`, and the lexical upload node are all covered without patching a single field.
- **Folder browser in the drawer**: subfolder navigation, breadcrumbs, search, grid and list display, and sorting, driven by `get-folder-results-component-and-data` so changing folder never tears the drawer down.
- **Folder management inline**: create folders and documents, and move, rename or delete folders, without leaving the drawer. Bulk upload lands in the folder being viewed.
- **The list route is untouched**: the swapped view defers to `DefaultListView` outside a drawer, so Payload's own tabs and behavior come back unchanged.
- **Respects host customization**: collections that already declare a list view are never overwritten, and collections without `folders: true` keep the stock drawer.
- **Documented internals**: the three undocumented Payload behaviors this relies on are recorded in the README, along with the version sensitivity of the copied drawer-header markup.
