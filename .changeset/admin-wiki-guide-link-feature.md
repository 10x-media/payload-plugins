---
'@10x-media/admin-wiki': minor
---

Guide-to-guide links are a lexical feature wrapping their own text, the editor takes consumer features, and the field picker renders a form the way the edit view does.

- **Breaking: guide links are a node, not an inline block.** Select text, press the guide-link button in either toolbar, pick the target: the words stay yours to edit, and a link inside a sentence stops being an opaque chip in the middle of it. With the cursor in a link, a floating panel names the target guide and offers to point it elsewhere or take the link off. Guide links written against the previous beta do not render and are not migrated;
- **Breaking: the guide-link API moved with it.** `GuideLinkBlockLabel` is gone, `GuideLink` takes `guide` plus children instead of `fields`, the `guideLinkBlock*` translation keys are replaced by `guideLinkFeatureLabel` / `guideLinkRemove` / `guideLinkRetarget`, and `WikiSeedContext` carries `guideTitlesBySlug` for consumer transformers that build one.
- **Seeding understands both link forms.** `[read this first]({{wiki:guide:slug}})` keeps the words you wrote; a bare `{{wiki:guide:slug}}` still links the target's title, resolved for the locale being written, so a localized guide links its German title in the German pass.
- **`editor.features`** adds lexical features beside the plugin's own, for the extension a block cannot express: a custom node, a toolbar item, a keyboard shortcut. An array appends; the function form is handed `defaultFeatures` and returns the whole list, so it can reorder or drop one. The seed builds the same editor, so markdown converts through your features too.
- Fixed: the field target picker rendered the form as one flat column, dropping sidebar fields into the middle of the main one. It now uses Payload's own `DocumentFields`, so a sidebar field reads as a sidebar field and every field mounts at once instead of on scroll.
- Fixed: the wiki's own surfaces appeared inside that picker, listing a collection's existing guides and offering "write this guide" where only field targets belong.
