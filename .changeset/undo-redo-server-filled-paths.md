---
'@10x-media/undo-redo': patch
---

Stop a newly added array or blocks row from costing two undos. Payload adds a row as a blank one and leaves the row's own fields to the debounced form-state request that follows, so on a large config the capture can land between the two waves and record the half-built row as an entry of its own. A capture whose only difference from the current entry is paths that did not exist before is now folded into that entry rather than appended, which is the shape of Payload finishing a job rather than of an edit: every user action that adds paths also changes a row id or the value of the field controlling a condition. Folding rather than discarding keeps the entry able to restore the fields Payload filled in.
