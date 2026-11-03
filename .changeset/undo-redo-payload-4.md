---
'@10x-media/undo-redo': major
---

Payload 4 support, on Next.js and TanStack Start. The controls are now Payload's own ghost icon buttons, styled entirely by the admin theme: the `--undo-redo-control-size` and `--undo-redo-icon-size` properties and the `--active` class are gone (the open debug button carries `btn--selected`). Globals mount the controls through `admin.components.edit.beforeDocumentControls`, the slot Payload 4 shares with collections.
