# @10x-media/webhooks

## 0.1.0-beta.1

### Minor Changes

- Add a typed `translations` option to every plugin factory and make translation keys a stable public API. Each plugin's `./i18n` subpath now exports the `keys` object, the `TranslationKey` union, and the `TranslationsOption` shape. Overrides are flat and per-locale: values win over the built-in locales key-by-key, locales a plugin does not ship are added whole, and app-level `i18n.translations` still wins over everything.

  ```ts
  import { analytics } from "@10x-media/analytics";
  import { keys } from "@10x-media/analytics/i18n";

  analytics({
    adapters: [nativeAdapter()],
    translations: {
      de: { [keys.pluginName]: "Analytik" },
    },
  });
  ```

  A typo'd key inside `translations` is a compile error.

### Patch Changes

- Restructure README: features, quick start, and links into the documentation site at https://docs.10xmedia.de. Long-form documentation moved out of the package README.

- Update README documentation links: the docs site now serves from the domain root, so `docs.10xmedia.de/docs/<plugin>` links became `docs.10xmedia.de/<plugin>`.

- Ship per-file dist output instead of bundled chunks. Bundling merged client components into shared chunks and dropped their 'use client' directives, so Next.js lost the RSC boundary and the admin panel crashed with "useRef only works in Client Components" when rendering components imported through such a chunk (for analytics: every chart-based dashboard widget). Dist now mirrors src one file at a time, directives stay exactly where they were authored, and file names are stable across releases. A repo-level `check:dist` verification (directive parity, no inlined dependencies, exports resolution, publint) now runs in CI so this class of regression cannot ship again.

## 0.1.0-beta.0

### Minor Changes

- Initial beta of `@10x-media/webhooks`: outbound webhook subscriptions for Payload v3.

  - **Subscriptions**: an admin-managed collection for registering endpoint URLs, selecting events, and storing per-subscription secrets. A 48-character hex secret is auto-generated on create.
  - **Deliveries log**: an append-only collection with derived status, HTTP response code, and a redeliver button that replays the original payload to the original URL.
  - **Event hooks**: opt any collection in with `collections: { posts: true }`. Emits `<slug>.created`, `<slug>.updated`, and `<slug>.deleted` events. Per-collection `operations`, `transform`, and `includePreviousData` options.
  - **HMAC signing**: `X-Webhook-Signature: v1=<hex>` on every request when a subscription has a secret. Signed over `${timestamp}.${rawBody}`.
  - **Delivery modes**: `inline` (awaited in the hook), `queue` (Payload jobs task with configurable retries and queue), and `auto` (queue when a runner is detected, inline otherwise).
  - **Code subscriptions**: hard-coded subscriptions in plugin options, merged with admin-managed ones at delivery time.
  - **Composable**: auto-detects `@10x-media/jobs` (uses its worker) and `@10x-media/automations` (registers a `webhook` trigger in the catalog).
  - **Cross-DB**: tested on MongoDB and PostgreSQL via the matrix integration suite.
