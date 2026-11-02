---
'@10x-media/undo-redo': patch
---

An undo or redo no longer marks the form saved while an excluded field still holds an unsaved change.

- Fixed: landing back on the saved entry turned off Save and the leave-without-saving prompt even when an excluded path, such as a password typed before the undo, differed from its saved value. The form now stays modified until those paths match their saved values too.
- Changed: history entries no longer keep copies of excluded paths. A restore already passed them through from the live form, so the copies only kept values such as typed passwords and tokens in memory for the life of the history.
