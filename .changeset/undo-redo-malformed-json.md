---
'@10x-media/undo-redo': patch
---

Stop the history from recording a JSON field while its text does not parse. Payload keeps the raw editor text in form state as a string there, and renders the editor from `JSON.stringify(value)`, so restoring that string showed it escaped inside quotes instead of as the text the editor had. A capture taken while the text is broken now carries the field's last restorable value forward, so entries only ever describe states the form can be put back into: breaking the JSON alone records nothing, undo restores the last value that parsed, and redo never re-breaks it. The debug overlay stops reporting the field as a change that is forever pending.
