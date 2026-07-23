---
"@10x-media/form-builder": patch
---

Consolidate the built-in email actions. `emailTeam` and `confirmation` were ~80% identical (the same recipient fields, subject/body config, from-field insertion, and send logic) duplicated across two files, each built through a five-positional-argument builder that needed a `useMaxParams` lint suppression. Both now share one `buildEmailAction` skeleton and one `EmailActionOptions` object; each action supplies only what differs (its `to` target and whether a missing recipient throws or is skipped). Behavior is unchanged, verified by both actions' full existing test suites passing against the shared implementation.
