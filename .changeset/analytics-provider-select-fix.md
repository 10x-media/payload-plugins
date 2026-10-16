---
"@10x-media/analytics": patch
---

**Fix: the providers' create and edit views open again when the Provider select is narrowed.** In 1.0.0-beta.13 they answered 500 ("Functions cannot be passed directly to Client Components") on every install running the providers collection without `native()` in `adapters`, or with `providers.collection.types` naming fewer than every type: the select's `filterOptions` handed Payload's client form state option labels that were functions. It now hands over the types' values alone, which is all the client select reads. A document stored with a type the install no longer serves still opens showing its type, and its save is still refused on the **Provider** field ([Which provider types a document may have](https://docs.10xmedia.de/analytics/providers#which-provider-types-a-document-may-have)).

**Behavioral:** the docs no longer promise that `providers.collection.types` orders the select. Its first type is the default, and the select lists the types it offers in one fixed order, the order of the **Provider** column's values, so no install's column changes with the list. A host that wrapped `providers.collection.fields.provider` to map the result to values keeps working, and can drop the wrapper.
