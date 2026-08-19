---
'@10x-media/admin-wiki': minor
---

A fifth target kind for the surfaces the config does not describe.

- Added: `customTargets` declares keys for screens no config walk can find, such as a view registered through `admin.components.views` or a panel inside one. An entry is a bare key with an optional label (plain, or one per admin language), or the string shorthand for a target labelled by its own key. Keys are namespaced to `custom:<key>` internally, so a declared key can never collide with a collection, global, block, or field target and is never typed with the namespace.
- Declaring at least one key adds a `targetCustom` list to the guide pages collection, as a multi-select over exactly what was declared. Declaring none leaves the collection, and its database schema, untouched: no field, no column, no migration for a project that does not use this.
- Added: `WikiCustomHelp` renders the help surface for a declared key, so a custom view drops one in beside whatever it renders. It behaves like the field surfaces, write affordance and prefilled target included. The key builders (`collectionTargetKey`, `globalTargetKey`, `blockTargetKey`, `fieldTargetKey`, `customTargetKey`) are exported for callers of the generic `WikiTargetHelp`.
- Custom targets carry their label on the "Covers" chips, in the wiki index filters, and in the picker; a stored key that is no longer declared is reported by the orphan banner, exactly as a deleted field is. `seedWiki` takes them as `targets.custom`.
