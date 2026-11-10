---
'@10x-media/folder-picker': major
---

Payload 4 support, on Next.js and TanStack Start. Payload 4 rebuilt folders: a folder collection of your own (`folders: true`) and `createFolderField` on each collection filed into it replace the root `folders` option and the built-in `payload-folders` collection, and the picker finds them on its own. The drawer's By Folder tab now hosts Payload's own hierarchy view: a click on a name picks for a single field, `hasMany` fields tick documents and Confirm, a trail leads back up, and only folders that accept the drawer's collection are listed. Grid view, the sort pill, drag and drop and the Ctrl / Shift hint are gone with the Payload 3 browser, and `@dnd-kit/core` is no longer a peer. See Upgrading to Payload 4 in the docs.
