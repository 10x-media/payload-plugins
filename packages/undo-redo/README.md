![Banner](./assets/banner.jpg)

# @10x-media/undo-redo

> [!IMPORTANT]
> **This is the Payload v4 branch.** It targets Payload `4.0.0-beta` on Next.js and TanStack Start and is released under the `alpha` tag (`pnpm add @10x-media/undo-redo@alpha`). The Payload v3 version lives on [`main`](https://github.com/10x-media/payload-plugins/tree/main/packages/undo-redo) and is released as `latest`.
>
> Found a problem with the v4 version? Please [open an issue](https://github.com/10x-media/payload-plugins/issues/new?labels=v4) with the **`v4`** label.

Client-side undo/redo for Payload admin forms. Snapshots the document form state as the editor works and steps back and forth through it, independent of Payload's document versions: nothing reaches the server until the editor saves.

[![npm](https://img.shields.io/npm/v/@10x-media/undo-redo?style=flat-square)](https://www.npmjs.com/package/@10x-media/undo-redo)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In alpha on this branch: published under the `alpha` dist-tag until Payload 4 is stable.

## Features

- **Controls on every edit view**, collections and globals, mounted before the document controls. Placement is overridable.
- **Keyboard**: `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` (plus `Ctrl/Cmd+Y`), skipped inside inputs and Lexical, which own their native undo. Rebindable; tooltips render whatever is bound, in the platform's own notation.
- **Every field type**, including array and blocks row additions, deletions and moves, restoring deleted rows with their subfield state, and conditionally hidden fields with their whole subtree.
- **Scoped exclusions**: per collection, per global, per field via `admin.custom`, per field type, or by path pattern (`list.*.readingTime`).
- **Payload's own fields excluded by default** (`_status`, `createdAt`, `sessions` and the rest of auth), so undo never unpublishes a document or disturbs auth state.
- **Truthful save state**: the saved document is tracked as a baseline, so undoing back onto it reports the form clean rather than merely unchanged since load.
- **Debug overlay** listing every entry, the paths it changed, and pending edits, with click-to-restore.
- **Typed translations** with per-key overrides via `@10x-media/undo-redo/i18n`.

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

Run `payload generate:importmap`. Undo/redo is on for every collection and global; `collections` and `globals` are opt-*out* maps.

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/undo-redo):

- [Overview](https://docs.10xmedia.de/undo-redo)
- [Quick start](https://docs.10xmedia.de/undo-redo/quick-start)
- [Configuration](https://docs.10xmedia.de/undo-redo/configuration)
- [What is tracked](https://docs.10xmedia.de/undo-redo/what-is-tracked)
- [Keyboard shortcuts](https://docs.10xmedia.de/undo-redo/shortcuts)
- [Debugging](https://docs.10xmedia.de/undo-redo/debugging)
- [i18n](https://docs.10xmedia.de/undo-redo/i18n)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
