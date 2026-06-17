---
'@10x-media/form-builder': minor
---

Consent field (Phase 8): compliant affirmative consent with unchecked-by-default checkbox, required-to-submit enforcement, and proof-by-reference storage; pluggable consent-source adapter (static, page-reference, and custom via `defineConsentSource`); optional version capture via `captureVersion` + `resolvePublishedVersionRef`; submission `consent` JSON array stores `{ agreed, ref, versionRef?, at }` without policy text; `resolveConsentLinks` for server-side display-time link resolution; `consentRenderer` included in `defaultRenderers`.
