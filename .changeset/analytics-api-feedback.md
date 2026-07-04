---
"@10x-media/analytics": minor
---

Field, type, and resolver API fixes from user feedback.

**Breaking:** `analyticsTab()` now returns a Payload `Tab` (as its name promises) instead of a whole tabs field, so it can be pushed into your own tabs field's `tabs` array. If you used it standalone in a `fields` array, switch to the new `analyticsTabsField()`:

```ts
fields: [analyticsTab()]        // before
fields: [analyticsTabsField()]  // after (same rendered result)
```

Display fields no longer blank entirely when one requested metric is unsupported by the active adapter: unsupported metrics are dropped (logged once per field render with the dropped names and adapter id), the supported remainder renders, and the "not available" state shows only when nothing survives.

Bindings are typed over `CollectionSlug`: the `collections` option keys are checked against your generated slugs and inline resolvers receive that collection's generated document type (degrading to `Record<string, unknown>` without generated types); `sync.collectionSlug` is checked the same way. `HostnameResolver` gains the same `(doc, ctx)` signature as `PathResolver` and may return `string | null | Promise<string | null>`; sync one-argument resolvers keep working.

Widget config Titles can opt into localization via `widgets: { localizeText: true }`. Field factories accept label overrides wherever they hardcoded translation keys: `analyticsStat` takes `label`, the row/fields/tab factories take per-metric `labels`, and `analyticsTab` / `analyticsTabsField` take tab `label` and `description`, each as a string, locale map, or Payload label function. The date range picker placeholder is now translatable.
