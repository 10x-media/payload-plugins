# @10x-media/admin-wiki

## 0.1.0-beta.1

### Minor Changes

- Guide-to-guide links are a lexical feature wrapping their own text, the editor takes consumer features, and the field picker renders a form the way the edit view does.

  - **Breaking: guide links are a node, not an inline block.** Select text, press the guide-link button in either toolbar, pick the target: the words stay yours to edit, and a link inside a sentence stops being an opaque chip in the middle of it. With the cursor in a link, a floating panel names the target guide and offers to point it elsewhere or take the link off. Guide links written against the previous beta do not render and are not migrated;
  - **Breaking: the guide-link API moved with it.** `GuideLinkBlockLabel` is gone, `GuideLink` takes `guide` plus children instead of `fields`, the `guideLinkBlock*` translation keys are replaced by `guideLinkFeatureLabel` / `guideLinkRemove` / `guideLinkRetarget`, and `WikiSeedContext` carries `guideTitlesBySlug` for consumer transformers that build one.
  - **Seeding understands both link forms.** `[read this first]({{wiki:guide:slug}})` keeps the words you wrote; a bare `{{wiki:guide:slug}}` still links the target's title, resolved for the locale being written, so a localized guide links its German title in the German pass.
  - **`editor.features`** adds lexical features beside the plugin's own, for the extension a block cannot express: a custom node, a toolbar item, a keyboard shortcut. An array appends; the function form is handed `defaultFeatures` and returns the whole list, so it can reorder or drop one. The seed builds the same editor, so markdown converts through your features too.
  - Fixed: the field target picker rendered the form as one flat column, dropping sidebar fields into the middle of the main one. It now uses Payload's own `DocumentFields`, so a sidebar field reads as a sidebar field and every field mounts at once instead of on scroll.
  - Fixed: the wiki's own surfaces appeared inside that picker, listing a collection's existing guides and offering "write this guide" where only field targets belong.

## 0.1.0-beta.0

### Minor Changes

- Initial beta of `@10x-media/admin-wiki`: an in-admin wiki that attaches guides to the collections, globals, fields, and blocks they explain.

  - **Guides**: a `wiki-pages` collection with drafts, its own lexical editor (callouts, guide links, optional video), and a separate `wiki-media` upload collection.
  - **Targeting**: four string lists per guide. Field targets are owner-qualified, index-free schema paths (`collection:posts.hero.title`); a field inside a block is rooted at the block slug, so one guide follows the block into every usage.
  - **Surfaces**: help under every field description (static, locale-keyed, and function descriptions alike), a guides panel in collection and global sidebars, a band on list views, block help inside every covered block, and a standalone reading view at `/admin/wiki`. Each is configurable or removable.
  - **Field picker**: a read-only drawer that renders your real form, with a select plate on each field, so targets are picked rather than typed.
  - **Write affordances**: an edit mode that turns every unguided surface into a "write this guide" link opening a create drawer with the target already filled in.
  - **Orphan banner**: the wiki pages list reports every stored target that no longer resolves against the running config.
  - **Collection overrides**: `overrides.pages.tabs` appends tabs to the guide form, and `overrides.pages.collection` / `overrides.media` hand you the finished collection to return your own.
  - **Seeding** from markdown in code, localized guide content, and typed translations (en, de). A guide's `additionalData` (an object, or a function handed `payload`) fills the fields a project added through `overrides`.
