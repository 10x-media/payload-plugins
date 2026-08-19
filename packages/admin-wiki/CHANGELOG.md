# @10x-media/admin-wiki

## 0.1.0-beta.3

### Minor Changes

- A fifth target kind for the surfaces the config does not describe.

  - Added: `customTargets` declares keys for screens no config walk can find, such as a view registered through `admin.components.views` or a panel inside one. An entry is a bare key with an optional label (plain, or one per admin language), or the string shorthand for a target labelled by its own key. Keys are namespaced to `custom:<key>` internally, so a declared key can never collide with a collection, global, block, or field target and is never typed with the namespace.
  - Declaring at least one key adds a `targetCustom` list to the guide pages collection, as a multi-select over exactly what was declared. Declaring none leaves the collection, and its database schema, untouched: no field, no column, no migration for a project that does not use this.
  - Added: `WikiCustomHelp` renders the help surface for a declared key, so a custom view drops one in beside whatever it renders. It behaves like the field surfaces, write affordance and prefilled target included. The key builders (`collectionTargetKey`, `globalTargetKey`, `blockTargetKey`, `fieldTargetKey`, `customTargetKey`) are exported for callers of the generic `WikiTargetHelp`.
  - Custom targets carry their label on the "Covers" chips, in the wiki index filters, and in the picker; a stored key that is no longer declared is reported by the orphan banner, exactly as a deleted field is. `seedWiki` takes them as `targets.custom`.

## 0.1.0-beta.2

### Minor Changes

- Block targets can be left out of the "Covers" chips.

  - Added: `chips: { blocks: false }` drops `block:` targets from the chips on the wiki index and the guide page. Blocks are chipped by default, as before. A guide attached to a dozen blocks chips a dozen times, and a block whose `labels` are a function is not in the label map, so it chips its slug: a project can now keep the collections and globals a reader navigates by and leave the rest out.
  - The index's filter pills follow the chips, so a surface no row displays is not offered as a filter either. Blocks stay full targets everywhere else: block help, the target pickers, and the guides they resolve to are untouched.
  - `useWikiTargets()` exposes the setting as `blockChips`, and the exported `TargetChips` component honors it, so a custom surface built on either agrees with the built-in ones.

- Three component slots on the wiki index view.

  - Added: `wikiView` now takes an object as well as a boolean, and `wikiView.components` holds one array of components per slot, exactly as a collection's `admin.components` takes them. `beforeControls` renders in the header actions row, ahead of the edit mode toggle and the create button; `beforeTable` sits between the search controls and the guide list; `afterTable` below it. `wikiView: true` and omitting it are the views with every slot empty, and `wikiView: false` still skips the routes.
  - Slot components receive `slot`, `wikiPath`, `guideCount`, and `canCreate` as client props, and server components additionally receive `payload`, `req`, `i18n`, `locale`, `params`, and `searchParams`, so a slot can query for whatever the index does not carry. Both prop types are exported as `WikiViewSlotClientProps` and `WikiViewSlotServerProps`.
  - Each slot component is registered under `config.admin.dependencies`, so `payload generate:importmap` finds it the same way it finds a block renderer or a video player. A reference that names its export in `exportName` is registered under the key the runtime lookup asks for.

### Patch Changes

- Seeded callouts keep their line breaks, and guide links inside them resolve.

  - Fixed: a multi-line GitHub alert seeded as one run of glued-together words. Payload's blockquote markdown transformer splices each `> ` continuation line onto the quote before it with nothing in between, so `> Draft first.\n> Publish after review.` imported as `Draft first.Publish after review.`. The wiki editor now registers Lexical's own `QUOTE` transformer in its place, which is the same code with the line break it forgets.
  - Fixed: a `{{wiki:guide:slug}}` placeholder inside a callout was left behind, because the transformer walked only the outer tree and the alert had already moved the content into the callout block's own editor state. In the `[words]({{wiki:guide:slug}})` form that surfaced as an ordinary link pointing at the raw placeholder. Block fields are now walked too, and callout bodies render and accept guide links.
  - A placeholder still left anywhere after every transformer has run now fails the seed, naming the guide and the placeholder, rather than saving a guide that reads wrong. Inline code is exempt, so a guide can spell the syntax out while documenting it.

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
