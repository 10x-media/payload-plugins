---
"@10x-media/analytics": minor
---

**A provider document is a source only once it can read, and the Provider select offers only the types the install serves.** A document now has to be enabled, of a served type and hold the credentials its adapter reads with; `native` is offered only beside `native()`; `providers.collection.types` narrows the list; and a scoped install's documents get a **Default for this site** checkbox ([When a document is a source](https://docs.10xmedia.de/analytics/providers#when-a-document-is-a-source), [Which provider types a document may have](https://docs.10xmedia.de/analytics/providers#which-provider-types-a-document-may-have), [From 1.0.0-beta.12](https://docs.10xmedia.de/analytics/upgrading/beta-13)).

**Upgrade actions**

1. On a scoped install running the providers collection, on Postgres or SQLite in migrate mode, generate a migration (`pnpm payload migrate:create`), review it and run it: it adds the `is_default` column to the providers table. Push mode and MongoDB need nothing ([The `is_default` column](https://docs.10xmedia.de/analytics/upgrading/beta-13#the-is_default-column)).
2. On Postgres or SQLite, where the install runs the providers collection without `native()` in `adapters`, or sets `providers.collection.types` with another type first, the generated migration also drops the **Provider** column's `native` default. No stored value changes ([The `provider` column](https://docs.10xmedia.de/analytics/upgrading/beta-13#the-provider-column)).
3. Enter the read credentials of any provider document that lacks them, or switch it off.

**Behavioral:** a provider document missing the credentials its adapter reads with is no longer listed as a source, fills no capture slot whatever capture fields it holds, and is no tenant's own source under a `fallback` policy. 1.0.0-beta.12 listed it and showed an empty state. A document whose credential fails to decrypt is still listed, as a failing source. `providers.resolve` installs decide for themselves.

**Behavioral:** the **Provider** select offers `native` only while `adapters` holds `native()`, and defaults to the first type it offers rather than `native`. Saving a document with a type the install does not serve is refused with a message on that field; a stored document keeps its type until it is saved.

**Additive:** `providers.collection.types` lists the types documents may have, in the order the select offers them; an unknown id, or a list leaving no served type, fails the boot. `analyticsProviderFields({ types })` takes the same list.

**Additive:** on a scoped install, the **Default for this site** checkbox (`isDefault`) in the provider document's sidebar, at most one per scope, a second refused on save. `providers.collection.defaultAccess` (a field access function or `{ create, update }`) decides who may set it, following `connectionAccess` when unset; `providers.collection.fields.isDefault` replaces the field. The flagged document's source also fills the tenant capture slot when it captures.
