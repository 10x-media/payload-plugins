---
"@10x-media/form-builder": patch
---

Condition and flow correctness.

- `file` and `repeater` fields now offer a presence-only condition (exists / does not exist) in the builder, instead of the text/select operators they cannot actually satisfy (a `FileRef` object or a row array only stringifies). A presence check also treats an empty repeater as absent.
- Flow transition `when` clauses are laundered the same way field conditions are: a transition referencing a field that was later deleted is dropped, rather than persisting as an always-true route that force-navigates the visitor. Valid transition conditions are canonicalized to the same OR-of-ANDs shape as field conditions.
