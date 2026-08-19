# @10x-media/folder-picker

## 0.1.0-beta.0

### Minor Changes

- Initial beta of `@10x-media/folder-picker`: folder browsing inside Payload's list drawer.

  Payload has had folders since 3.39, but only on the collection route. Opening the same collection from an upload field's "choose from existing" gives a flat, paginated list with no folders. This plugin puts them back.

  - **One view swap, every caller**: replaces `admin.components.views.list.Component` on folder-enabled collections. Payload resolves that component for both the list route and the list drawer, so upload fields, `hasMany` upload fields, relationship fields with `appearance: 'drawer'`, and the lexical upload node are all covered without patching a single field.
  - **Folder browser in the drawer**: subfolder navigation, breadcrumbs, search, grid and list display, and sorting, driven by `get-folder-results-component-and-data` so changing folder never tears the drawer down.
  - **Folder management inline**: create folders and documents, and move, rename or delete folders, without leaving the drawer. Bulk upload lands in the folder being viewed.
  - **The list route is untouched**: the swapped view defers to `DefaultListView` outside a drawer, so Payload's own tabs and behavior come back unchanged.
  - **Respects host customization**: collections that already declare a list view are never overwritten, and collections without `folders: true` keep the stock drawer.
  - **Documented internals**: the three undocumented Payload behaviors this relies on are recorded in the README, along with the version sensitivity of the copied drawer-header markup.

- Review round: picking a file is an explicit action, polymorphic fields switch collection without leaving the folder view, and dragging no longer crashes the drawer.

  - **Collection select above the folder view.** A polymorphic upload field (`relationTo: ['media', 'files']`) previously stripped its collection picker in the folder tab, so reaching the second collection meant going back to the list tab and forward again. The picker now sits above the folders exactly as it does above the list, and switching re-renders the view for the collection that was chosen. Folder state is keyed to the collection it was loaded for, so a switch never leaves the previous collection's folders under the new collection's title, and the header stays mounted while the new results load.
  - **Selection is confirmed, not double-clicked.** Picking a file used to require a double-click, and the only confirmation was a pale pill that appeared for `hasMany` fields alone. One click now selects and **Select** confirms, from the search bar row Payload's own list tab confirms in, but dark rather than white: the folder view has no row checkboxes to hint that selecting is a thing. A single-value field routes through `onSelect`, which it never had a button for; `hasMany` keeps the bulk path and labels the count. Double-clicking a file still picks it outright, and double-clicking a folder still opens it.
  - **Dragging a card no longer crashes the admin panel.** A document view wraps its children in `LivePreviewProvider`, whose `DndContext` looks up a `live-preview-area` droppable and hands the result to `rectIntersection` unchecked; inside a drawer that area does not exist, so the first pointer move threw. The folder cards now register in their own `DndContext` with the collision detection the admin root uses, and a drag overlay follows the cursor as it does on the route.
  - **`folders.fieldName` is honored when moving a folder.** Moving the folder in view PATCHed a hard-coded `folder` field, so a host that renamed the folder field through `config.folders.fieldName` silently wrote nothing. The configured name is threaded through and used.
  - **Translation keys without a namespace are dropped.** `toNested` split every key at `indexOf(':')`, so an override key with no colon was filed under itself with its last character shaved off. Such keys are skipped instead.
  - **The `translations` option is documented**, alongside which strings belong to the plugin and which come from Payload's own admin locale.

- The folder tab stops offering what the field cannot take, and says how to pick more than one.

  - **A file the field already holds no longer appears.** Payload's upload field hides its current value from the list tab by building `filterOptions` with `id: { not_in: [...] }`, but the folder server function takes no filter, so the folder tab kept offering those files. Picking one again stored it twice, because the field appends whatever the drawer hands it. The same rule is now applied to the folder's results, for single-value fields as well as `hasMany`, and removing a value puts the file back among the options.
  - **Multi-selection is limited to `hasMany` fields.** It was enabled everywhere, so on a single-value field Ctrl and Shift built a selection the field could not accept and the confirm pill counted files that were then dropped.
  - **A hint under the header explains the modifiers**, for `hasMany` fields only, where a selection can actually hold several. It draws `⌘` and `⇧` on macOS and spells `Ctrl` and `Shift` out everywhere else.
  - **German and Ukrainian locales**, alongside the English the plugin already shipped. Every string is checked against the English key set, and against the placeholders each one carries.

### Patch Changes

- Two fixes to the folder view, both places where the port drifted from the admin's own behaviour.

  - **Editing with a file selected no longer lands on a "not found" page.** The edit action fed its target's id to a drawer keyed to the folder collection, and a selected target could be a document, so picking a file and choosing edit sent the admin to `/admin/collections/<folders>?notFound=<file id>`. A document is no longer a target for it, which is what Payload's own selection bar does: the action hides when the selection is not a folder, leaving the bulk document actions to handle it. Editing the folder in view, and editing a selected folder, are unchanged.
  - **The dragged card no longer trails from wherever it was grabbed.** dnd-kit preserves the grab point, so a card taken by its lower edge followed the cursor from that edge and covered what was being dragged over. The card now pins its top left just below and right of the cursor however it was picked up, matching the folder view on the route. Payload applies a modifier for this but does not export it, so it is reproduced alongside the card itself.
