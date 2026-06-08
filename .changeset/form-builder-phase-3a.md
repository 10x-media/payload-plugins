---
"@10x-media/form-builder": minor
---

Add serializable field conditions: `visibleWhen` and `validateWhen` (Payload `Where`-shaped) on every field, enforced server-side by a pure, isomorphic `evaluateCondition` engine that mirrors Payload's query-operator semantics. Hidden fields are skipped (not validated, not stored, and a client-sent value is ignored); `validateWhen` gates a field's validation. The native Where-style condition builder UI follows in a later release; conditions are authored as JSON for now.
