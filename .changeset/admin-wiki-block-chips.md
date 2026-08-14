---
'@10x-media/admin-wiki': minor
---

Block targets can be left out of the "Covers" chips.

- Added: `chips: { blocks: false }` drops `block:` targets from the chips on the wiki index and the guide page. Blocks are chipped by default, as before. A guide attached to a dozen blocks chips a dozen times, and a block whose `labels` are a function is not in the label map, so it chips its slug: a project can now keep the collections and globals a reader navigates by and leave the rest out.
- The index's filter pills follow the chips, so a surface no row displays is not offered as a filter either. Blocks stay full targets everywhere else: block help, the target pickers, and the guides they resolve to are untouched.
- `useWikiTargets()` exposes the setting as `blockChips`, and the exported `TargetChips` component honors it, so a custom surface built on either agrees with the built-in ones.
