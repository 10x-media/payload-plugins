---
'@10x-media/admin-wiki': minor
---

Inline blocks in the wiki editor, and the read side of the editor opened up.

- `editor.inlineBlocks` declares blocks that sit inside a paragraph rather than between them, paired with a renderer exactly as `editor.blocks` is. The two lists stay apart, so an inline block never appears in the block insert menu. A renderer missing from the import map degrades to a `<span>` placeholder rather than the block form's `<p>`.
- `editor.converters` points at a client module exporting a `WikiConvertersFunction`, the read side of `editor.features`: a feature puts a node in the document, a converter decides what it renders as. It resolves through the import map and is registered as an admin dependency, so `payload generate:importmap` finds it.
- The function receives `defaultConverters` and returns the map that renders, so a project can add, override or drop one.
- Converters apply wherever the plugin renders a guide, including a node nested inside a callout body. `GuideArticle` also takes `converters` and `inlineBlockRenderers` props, applied over the project's own.
