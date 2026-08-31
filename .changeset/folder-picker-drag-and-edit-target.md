---
'@10x-media/folder-picker': patch
---

Two fixes to the folder view, both places where the port drifted from the admin's own behaviour.

- **Editing with a file selected no longer lands on a "not found" page.** The edit action fed its target's id to a drawer keyed to the folder collection, and a selected target could be a document, so picking a file and choosing edit sent the admin to `/admin/collections/<folders>?notFound=<file id>`. A document is no longer a target for it, which is what Payload's own selection bar does: the action hides when the selection is not a folder, leaving the bulk document actions to handle it. Editing the folder in view, and editing a selected folder, are unchanged.
- **The dragged card no longer trails from wherever it was grabbed.** dnd-kit preserves the grab point, so a card taken by its lower edge followed the cursor from that edge and covered what was being dragged over. The card now pins its top left just below and right of the cursor however it was picked up, matching the folder view on the route. Payload applies a modifier for this but does not export it, so it is reproduced alongside the card itself.
