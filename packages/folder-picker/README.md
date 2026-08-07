# @10x-media/folder-picker

Folder browsing inside Payload's list drawer, so any field picks documents by folder. Payload has had folders since 3.39, but only on the collection route: open the same collection from an upload field's "choose from existing" and you get a flat, paginated list. This plugin puts the folders back, for every field that opens a drawer.

[![npm](https://img.shields.io/npm/v/@10x-media/folder-picker?style=flat-square)](https://www.npmjs.com/package/@10x-media/folder-picker)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Features

- **One view swap, every caller**: upload fields, `hasMany` uploads, relationship fields with `appearance: 'drawer'`, and the lexical upload node, without patching a single field.
- **Folder browsing in the drawer**: subfolder navigation, breadcrumbs, search, grid or list display, and sorting, none of which tears the drawer down.
- **Folder management inline**: create, move, rename and delete folders, drag files and folders between them, and create documents, without leaving the document you are editing.
- **Picking is explicit**: one click selects, **Select** confirms, for single and `hasMany` fields alike.
- **Polymorphic fields switch collection in place**, through the same collection select the list tab carries.
- **Bulk upload into the current folder** for `hasMany` fields.
- **The list route stays Payload's**: outside a drawer the collection renders exactly as before.
- **Respects host customization**: collections that already declare a list view are never overwritten, and collections without `folders: true` keep the stock drawer.

## Quick start

```bash
pnpm add @10x-media/folder-picker@beta
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { folderPicker } from '@10x-media/folder-picker'

export default buildConfig({
  folders: { browseByFolder: true },
  collections: [{ slug: 'media', folders: true, upload: true, fields: [] }],
  plugins: [folderPicker({})],
})
```

Then run `payload generate:importmap`, or the swapped view will not resolve. Open any document with an upload field pointing at `media` and the drawer gains a **By folder** tab.

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/folder-picker):

- [Overview](https://docs.10xmedia.de/folder-picker)
- [Quick start](https://docs.10xmedia.de/folder-picker/quick-start)
- [How it works](https://docs.10xmedia.de/folder-picker/internals)
- [Limits](https://docs.10xmedia.de/folder-picker/limits)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
