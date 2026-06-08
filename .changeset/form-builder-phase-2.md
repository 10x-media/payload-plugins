---
"@10x-media/form-builder": minor
---

Add the declarative validation subsystem: define validation rule types with `defineValidationRule`, add per-field rules in the admin (minLength, maxLength, min, max, pattern, email, url, oneOf, matchesField, notAlreadySubmitted) with custom localized messages and error/warning severity, server-authoritative enforcement through one engine (including cross-field and async server-only rules), and a Standard Schema escape hatch per field type.
