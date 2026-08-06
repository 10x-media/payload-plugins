# @10x-media/undo-redo

Introduces undo/redo functionality to Payload forms.

[![npm](https://img.shields.io/npm/v/@10x-media/undo-redo?style=flat-square)](https://www.npmjs.com/package/@10x-media/undo-redo)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Features

- Undo/redo controls before the document controls on every collection and global edit view.
- `Ctrl+Z` / `Ctrl+Shift+Z` (and `Ctrl+Y`) when focus is outside text-editing surfaces, which keep their own native or Lexical undo.
- Covers text edits plus array and blocks row additions, deletions and moves, restoring deleted rows with their subfield state.
- Client-side only: history lives in memory for the editor session and nothing reaches the server until you save. Independent of Payload versions and drafts.
- Hook-derived and auth-managed paths (`pathname`, `breadcrumbs`, `sessions`, `updatedAt`, ...) are excluded from history and passed through untouched on restore.
- Typed translations with per-key overrides via `@10x-media/undo-redo/i18n`.

## Quick start

```bash
pnpm add @10x-media/undo-redo
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { undoRedo } from '@10x-media/undo-redo'

export default buildConfig({
  plugins: [undoRedo({})],
})
```

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/undo-redo):

- [Overview](https://docs.10xmedia.de/undo-redo)
- [Quick start](https://docs.10xmedia.de/undo-redo/quick-start)

Add the plugin's docs tree under `apps/docs/content/docs/undo-redo/` and list its pages here. Long-form documentation lives on the docs site, not in this README.

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
