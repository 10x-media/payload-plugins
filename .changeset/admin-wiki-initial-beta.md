---
'@10x-media/admin-wiki': minor
---

Initial beta of `@10x-media/admin-wiki`: an in-admin wiki that attaches guides to the collections, globals, fields, and blocks they explain.

- **Guides**: a `wiki-pages` collection with drafts, its own lexical editor (callouts, guide links, optional video), and a separate `wiki-media` upload collection.
- **Targeting**: four string lists per guide. Field targets are owner-qualified, index-free schema paths (`collection:posts.hero.title`); a field inside a block is rooted at the block slug, so one guide follows the block into every usage.
- **Surfaces**: help under every field description (static, locale-keyed, and function descriptions alike), a guides panel in collection and global sidebars, a band on list views, block help inside every covered block, and a standalone reading view at `/admin/wiki`. Each is configurable or removable.
- **Field picker**: a read-only drawer that renders your real form, with a select plate on each field, so targets are picked rather than typed.
- **Write affordances**: an edit mode that turns every unguided surface into a "write this guide" link opening a create drawer with the target already filled in.
- **Orphan banner**: the wiki pages list reports every stored target that no longer resolves against the running config.
- **Collection overrides**: `overrides.pages.tabs` appends tabs to the guide form, and `overrides.pages.collection` / `overrides.media` hand you the finished collection to return your own.
- **Seeding** from markdown in code, localized guide content, and typed translations (en, de).
