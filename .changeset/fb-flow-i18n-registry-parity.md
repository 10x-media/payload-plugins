---
'@10x-media/form-builder': minor
---

Finish localizing the flow builder: the remaining transition, hint, empty-state, and fallback-title strings now go through the translation system (en and de).

Ship shadcn `country` and `state` field renderers so the shadcn registry covers every built-in field type, and export `COUNTRIES` and `US_STATES` from `@10x-media/form-builder/react` for them. A parity test now asserts the registry renderer set matches the package's `defaultRenderers`, so a new field type cannot ship without its shadcn renderer. The country and state option labels are intentionally left unlocalized (the stored value is the stable code).
