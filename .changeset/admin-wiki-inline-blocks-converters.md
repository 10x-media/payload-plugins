---
'@10x-media/admin-wiki': minor
---

Inline blocks in the wiki editor, consumer converters, and one editor shared by the guide body and the callout body.

- `editor.inlineBlocks` takes consumer inline blocks, paired with a renderer as `editor.blocks` is.
- `editor.converters` points at a client module exporting a `JSXConvertersFunction`. It receives `defaultConverters` and returns the map that renders.
- A callout body now takes project blocks, features and converters, plus images and video.
- `nestable` on a block option offers it inside a callout body. Blocks default to false, inline blocks to true.
- `wikiFeatures` is exported for a block that holds its own rich text field: `wikiFeatures({ ...wikiEditorOptions, mediaSlug, pagesSlug, nested: true })`. A block whose body runs it must not also be `nestable`, or the config recurses into itself while sanitizing.
- `nested` drops the callout, headings, blockquotes, horizontal rules, indentation and the fixed toolbar. Lists, images, video and `nestable` blocks stay.
- The features function form also receives `nested`.
- `WikiConvertersFunction` is removed; type consumer converters with `JSXConvertersFunction` from `@payloadcms/richtext-lexical/react`.
