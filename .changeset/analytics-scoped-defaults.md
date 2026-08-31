---
"@10x-media/analytics": minor
---

**Breaking:** fail-closed defaults for scoped installs. With a `scopeResolver` configured, `access.platformRead` now defaults to deny instead of any authenticated user; configure it (for example a role check) so platform admins can read cross-scope and manage every tenant's provider documents. Scoped reads through a shared config adapter that cannot filter by scope are now gated behind `platformRead` even when the adapter is not designated as `platformAdapter`; a tenant's own runtime providers are never gated. A `scopeResolver` returning an empty string is now treated as the install-wide scope (fail closed) everywhere, matching ingest and registry semantics. `providers.collection.scopeField` must be a top-level field name; a dotted path now throws at config build. The provider collection's admin duplicate action is disabled (a duplicate could never carry the write-only credentials). Unscoped installs are unchanged.
