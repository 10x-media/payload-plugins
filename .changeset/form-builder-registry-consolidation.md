---
"@10x-media/form-builder": patch
---

Consolidate the registry and constant plumbing.

- The field-type, validation-rule, action, poll-source, and poll-type registries all resolved their opt-in override map (`false` removes, `true` keeps, a definition adds/replaces with `type` forced to the key) with their own copy of the same loop. That loop now lives in one shared `applyRegistryConfig` helper, so the merge semantics are defined once instead of five times.
- Definition `label` contracts are aligned: actions and poll option sources now accept a per-locale `Record<string, string>` label in addition to a string key/literal, matching poll types. All three resolve through one shared `resolveDefinitionLabel` helper. Widening only, so existing string labels are unaffected.
- The email-format regex (duplicated between the `email` field type and the `email` validation rule) and the calc recursion-depth guard (duplicated between the calc parser and evaluator) are each a single shared constant now, so the pair can no longer drift.
