# @10x-media/webhooks

## 4.0.0-alpha.1

### Major Changes

- Payload 4 support, on Next.js and TanStack Start. `next` is no longer a peer. Subscriptions and the delivery log set `versions: false`, as they had no history on Payload 3; the delivery log also sets `authorship: false`, while subscriptions get Payload 4's `createdBy` and `updatedBy`, so SQL installs run a migration. Delivery jobs are queued with `overrideAccess: true`, so a write by someone who may not queue jobs still emits its webhooks. Rotate secret and Redeliver are secondary buttons, the rotated-secret reveal is Payload 4's dialog (still closed only by its acknowledgement), and the status pills use the Payload 4 tokens, Delivered staying green. See Upgrading to Payload 4 in the docs.

### Minor Changes

- Make the plugin safe when subscriptions are created by tenants rather than by trusted operators. **This release breaks existing installs:** one default changed and SQL installs need a migration (see **Action required** below); everything else is opt-in.

  - **Breaking: subscription URLs must be `https:` and public.** An admin-managed subscription pointing at `http:`, or at a loopback, private, link-local or otherwise non-public address, is rejected on save, refused at delivery time (`dead`), and refused at the socket: deliveries now go through a dispatcher whose DNS lookup rejects non-public addresses, so a public hostname cannot be re-pointed at an internal one after it was saved. The save also resolves the hostname to give the reason in the form, waiting at most two seconds. That guarded dispatcher connects directly and ignores `HTTP(S)_PROXY` and `setGlobalDispatcher`. Set `delivery.allowHttp` and `delivery.allowPrivateAddresses` to keep the old behaviour, which local development needs. **Code subscriptions are not affected.**
  - **`owner` and `enforceOwnerAccess`.** `owner.resolve` tells the plugin who a subscription acts as. With `enforceOwnerAccess`, a subscription can only list events from collections its owner can read, and on every write the document is re-read through Payload's access control as the owner: no access, no delivery row and nothing sent. What the owner can read, at depth 0 and with their field-level access, is what is sent, and `previousData` is omitted. `owner.canActAs` decides who may assign which owner. Both are handed a request of the plugin's own that carries the caller's user and headers, cookies included; the read made as the owner carries neither the writer's headers nor its context. `transform` runs on the owner's view and is told whose it is through `owner`, while `req` stays the writer's request. A subscription whose owner is gone or has lost access can still be switched off, edited, rotated or deleted. Access is asked again before every queued attempt and every replay, so a revoked access takes effect for what is already queued: a create or update re-reads the document as the owner, a delete asks whether the owner can still read the collection, and a refusal is recorded as `dead`. A check that cannot be made counts as a failed attempt and is retried. It requires explicit `overrides.access` on both plugin collections and fails at startup without them.
  - **`collections.<slug>.filter`**: decide per subscription whether a document is delivered. It receives the stored subscription, fields you added included, never its secret. A rejection leaves no delivery row.
  - **`collections.<slug>.scope`**: narrow the subscriptions loaded for a document with a `Where`, so a tenanted install reads its own tenant's rows per write.
  - **No more 1,000-subscription ceiling.** Subscriptions for an event are paged through instead of scanned up to a cap, and `events` is indexed on every adapter.
  - **Redelivery checks the subscription too.** The caller needs read access to the delivery and to the subscription behind it. A replay keeps the original's owner, and is refused when the subscription has changed owner since. A queued delivery is held to the same rule on every attempt.
  - **Delivery rows record `ownerId`, `ownerCollection` and `documentId`** when `owner` is configured.
  - **A stored URL that is not an absolute `http(s)` URL is refused as `dead` on the first attempt**, with the reason, instead of failing every retry.
  - **New dependencies:** `undici` and `ipaddr.js`, the two libraries Payload's own SSRF-safe fetch is built on. Deliveries are now sent with `undici`'s `fetch` and its own dispatcher, so a test that stubs `globalThis.fetch`, or a process-wide dispatcher set with `setGlobalDispatcher`, no longer sees deliveries to admin-managed subscriptions.
  - **Bulk updates and deletes no longer lose deliveries in `inline` mode.** Their documents dispatch concurrently on one request, and a shared window onto the sealed secrets made some of them refuse to send. Subscriptions are now read on a request of their own, outside the write's transaction.
  - **Queued deliveries processed in the same job run no longer refuse to send.** Payload runs a batch of jobs concurrently on requests that share their `context`, where the same window was kept, so a delivery could be marked `dead` as "refused rather than sent unsigned". The task now reads its subscription on a request of its own.

  **Action required**

  1. If any admin-managed subscription points at `http:` or at an internal address, either move it to a code subscription, or set `delivery.allowHttp` / `delivery.allowPrivateAddresses`. Until then its deliveries are recorded as `dead` with the reason.
  2. On a SQL adapter, run a schema migration (`pnpm payload migrate:create`), whether or not you configure `owner`: the subscriptions' events table gains an index on its value column, and, if you configure `owner`, the delivery log gains `owner_id`, `owner_collection` and `document_id`. MongoDB needs nothing.
  3. Under `enforceOwnerAccess`, existing subscriptions have no owner and stop delivering until one is assigned.
  4. Let the delivery queue drain before deploying a configuration with `owner`. Deliveries queued before it record no owner, so when their attempt runs they are marked `dead`: as made for someone else when their subscription resolves to a user, and, under `enforceOwnerAccess`, as having no owner when it resolves to none. Assigning an owner later does not bring them back; only rows for subscriptions that resolve as global keep going.
  5. If outbound traffic must go through an egress proxy, admin-managed subscriptions cannot reach it while the address guard is on. `delivery.allowPrivateAddresses: true` turns the guard off; deliveries then use undici's global dispatcher, so install one that proxies, such as `setGlobalDispatcher(new EnvHttpProxyAgent())`.

  See [Multi-tenancy](https://docs.10xmedia.de/webhooks/multi-tenancy) and [Security](https://docs.10xmedia.de/webhooks/security#subscription-urls-ssrf).

## 0.1.0-beta.5

### Minor Changes

- **Breaking.** Delivery signing now follows [Standard Webhooks](https://www.standardwebhooks.com/), so receivers can verify with an off-the-shelf library instead of a bespoke scheme. Secrets are stored write-only and encrypted at rest through `@10x-media/fields`, and can be rotated in place. Every receiver needs updating; there is no dual-header deprecation window, because the package is still in beta and maintaining two incompatible signing schemes would be worse than one clean break.

  - **New signature format**: HMAC-SHA256 over `${id}.${timestamp}.${body}`, base64 encoded. The previous scheme signed `${timestamp}.${body}` and emitted hex.
  - **New headers**: `webhook-id`, `webhook-timestamp`, and `webhook-signature` (`v1,<base64>`). The old `X-Webhook-Id`, `X-Webhook-Timestamp`, and `X-Webhook-Signature` headers are **removed**, not deprecated. `X-Webhook-Event` is unchanged.
  - **`webhook-id` is an opaque `msg_<delivery-id>`** rather than the delivery row's primary key. On a SQL adapter that key is a sequential integer, so consecutive deliveries would publish this install's volume to every receiver, and a small integer makes a poor dedupe key for anyone consuming webhooks from more than one source. It is covered by the MAC and stable across retries. The body's `id` is the same string, so the row id leaves through neither; a redelivery carries its own.
  - **New secret format**: `whsec_<base64>`, 32 random bytes for generated secrets. The `whsec_` prefix is stripped and the remainder **base64-decoded** to derive the HMAC key, matching the reference verifier. Signing with the undecoded string would produce signatures no Standard Webhooks library accepts.
  - **Secrets are write-only and encrypted at rest**: stored as AES-256-GCM sealed values (authentication tag, key id, HKDF-derived keys) via `encryptedField` from `@10x-media/fields`, and stripped from every read result. A read carries `secret_set` and `secret_hint` (the last six characters) instead.
  - **Secret rotation**: `POST /api/<subscriptions>/:id/rotate-secret` and a **Rotate secret** button. During the configurable grace period (`secretRotation.graceSeconds`, default 24h) deliveries carry both signatures, space separated, so receivers can switch over without dropping events. The retired secret stops signing the moment the window lapses.
  - **`secretEncryption.keys`**: a key ring passed straight through to `@10x-media/fields`. Every configured key decrypts, the active one seals, and `rotateEncryptedFields()` re-seals the signing secrets. It does not reach custom header values, which sit inside an array: re-save those subscriptions before dropping an old key. With no keys configured the key derives from `PAYLOAD_SECRET`, exactly as before.
  - **Key rings are resolved at boot.** A misconfigured `secretEncryption.keys` now fails startup instead of surfacing as a refused delivery on the first webhook. This matters most for a key _provider_ (a KMS fetch, an env read): literal material is checked when the config is built, but a provider is only called when the ring resolves.
  - **Collection overrides**: `subscriptionsCollection.overrides` and `deliveriesLog.overrides`, the same shape the rest of the family uses. This is now the supported way to tenant-scope `access.update`, which also governs the rotate endpoint. `endpoints` and `admin.components.edit.beforeDocumentControls` add to the plugin's own entries rather than replacing them, so an override cannot leave the Rotate or Redeliver button calling a 404, and the write-only response strip runs after the override, so an `encryptedField` added through `fields` is stripped too.
  - **Both collections default to admin-collection users.** Access used to be "any logged-in user", which on an app with a second auth collection let every customer or member account read the delivery log (the full body of every emitted document) and register a subscription of its own. The default is now a user of `admin.user`; widen it through `overrides.access` if your operators live elsewhere.
  - **Redeliver defers to the deliveries collection's `read` access** instead of accepting any logged-in user, so a tenant-scoped override governs the replay too.
  - **Autosaves no longer emit**, and `includeDrafts: false` on a collection keeps deliberate draft saves from emitting as well. Previously every autosave of a drafts-enabled collection sent an `updated` delivery.
  - **A dispatch failure no longer fails the write.** A `transform` that throws is logged and the save still succeeds; `transform` now runs once per event, before any delivery row exists.
  - **Custom header values are encrypted at rest** and masked in the admin, since that is where a receiver's credential goes. Existing values read back and keep working as they are, and are sealed on the next save. A value containing a line break is rejected, and a padded header name is stored trimmed. Code subscriptions with an invalid header name or a line break in a value fail at startup.
  - **Deliveries record `subscriptionSource`**, so a code subscription whose `id` equals a database id can no longer be resolved in place of that row.
  - **`delivery.allowedHosts`**: an opt-in hostname allowlist for subscription URLs, enforced on save, at startup for code subscriptions, and again at delivery time. Unset, every host stays allowed, localhost included.
  - **`deliveriesLog.retentionDays`** and an exported `pruneDeliveries()`: finished deliveries older than the window are deleted. Unset, the log is never pruned, as before.
  - **A source slug that matches no collection now throws at startup**, as does one of the plugin's own collections or a Payload internal one. Both used to be ignored silently while the subscription form still offered their events.
  - **An autosave collection no longer emits `created` for the empty draft the admin makes when "Create new" is opened.** The document's first deliberate save arrives as `updated`. The rule is a draft create on an autosave collection through the Local API with a user, so REST, GraphQL and user-less Local API creates still emit; application code creating such a draft through the Local API on a user's behalf is skipped as well.
  - **Inline deliveries for one write are sent together**, so the write waits for the slowest receiver instead of for all of them in turn.
  - **The redeliver endpoint returns the outcome** (`status`: `pending`, `success` or `dead`), and the button reports a refused or rejected replay as a failure instead of "queued".
  - **Transport headers are reserved**: `Host`, `Content-Length`, `Transfer-Encoding`, `Keep-Alive`, `Upgrade` and `Expect` can no longer be custom headers. `fetch` refuses four of them, hangs on a wrong `Content-Length`, and silently replaces `Host`. A name or URL a save is not changing is not re-checked, so an existing subscription carrying one can still be saved, rotated or switched off; the send drops the header. A code subscription setting one fails at startup.
  - **`encryptExistingSecrets` also seals custom header values** stored before header encryption, reported as `headersSealed`. A row that fails to save is now reported in `failed` by id and the run continues, instead of the run stopping there.
  - **Deliveries do not follow redirects and read at most 2,000 characters of the response.** A subscription that relied on a redirect now records the 3xx as a failed delivery; enter the final URL.
  - **A queued delivery's job shares the write's transaction**, so a write that rolls back takes its job with it.
  - **The secret editor's strings are registered by this plugin.** They belong to `@10x-media/fields`, whose own plugin a consumer does not have to install, so without it the admin showed raw keys such as `fields:generateValue`.
  - **`collections` is typed against `CollectionSlug`**, so a typo or a global's slug is a type error instead of a source that compiles and never emits. Without generated types the key stays a `string`.
  - **The subscription URL is validated** as an absolute `http:` or `https:` URL on save, instead of surfacing later as a dead delivery. The host is not judged, so localhost and private addresses still work.
  - **Customer-supplied secrets**: accepted on create and on rotation, normalized to exactly one `whsec_` prefix before sealing, and rejected when they are not canonical padded base64 carrying at least 16 bytes. Malformed code-subscription secrets fail at startup rather than at delivery.
  - **Reserved headers**: a subscription's custom headers can no longer overwrite `webhook-id`, `webhook-timestamp`, `webhook-signature`, `X-Webhook-Event`, `Content-Type`, or `User-Agent`. The body is always JSON, so a custom `Content-Type` mislabelled every delivery it sent. A custom header name that is not a valid HTTP token is now rejected in the form rather than throwing at delivery time.
  - **Unrecoverable secrets fail the delivery**, with a message naming the fix: a key missing from the ring, a value no key authenticates, and a row that predates encryption at rest are three different errors. The last is decided by the seal rather than the value's shape, so a plaintext value is refused even when it is already a well-formed `whsec_` secret. A subscription that is meant to be signed is never downgraded to an unsigned POST. Subscriptions with no secret continue to deliver unsigned as before. An unreadable _retired_ secret inside an open rotation window is dropped instead, with a warning: the delivery still goes out signed with the current secret, and only the rotation overlap is lost.
  - **`previousSecret` is internal**: the rotation fields reject writes from ordinary REST and GraphQL creates and updates, so only rotation and the adoption utility can set them.
  - **Rotation is access-checked and bounded**: the endpoint runs the subscriptions collection's configured `update` access for the target document rather than accepting any logged-in user, validates the request body, caps `graceSeconds` at 30 days, and runs its read-modify-write in a transaction (asking a SQL adapter for `repeatable read`) so concurrent rotations cannot hand a caller a secret that never signs. A concurrent rotation returns 409 and an id that does not exist returns 404. Only the most recently retired secret is kept.
  - **The Signing secret field is create-only.** The encrypted field's own Replace and Generate actions do not consult Payload's `readOnly`, so on an existing document they would be live controls over a write that field access drops: an operator could type a new secret, save, see no error, and still be signing with the old one. Rotation is the only way to change a stored secret, and **Rotate secret** is its one control.
  - **Rotation UI**: a themed confirmation dialog and a reveal dialog with a copy button and an explicit acknowledgement, instead of `window.confirm` and a toast. The reveal cannot be dismissed with Escape or a click outside, since it holds the only copy of the new secret. The button no longer renders for a user the collection's update access denies, and the document refreshes after a rotation so the new grace window is visible.
  - **Document actions sit beside Save.** Rotate secret and Redeliver moved out of the form into the document controls, and Redeliver now confirms first: a redelivery goes out under a fresh `webhook-id`, so a receiver that dedupes on the id processes it again.
  - **The secret hint is visible on an existing subscription**, as a read-only Signing secret field, so the edit view says which key it holds. The hint cannot be rewritten through the API.
  - **Subscription form layout**: Name and Endpoint URL share a row, header name and value share a row, and Enabled sits in the sidebar. The rows are unnamed, so the schema and stored data are unchanged.

  **The create response contract changed.** `secret` is stripped from every read, the create response included, so reading it off a create no longer works. A create with no secret returns the generated one under `generatedSecret`:

  ```json
  {
    "doc": { "secret_set": true, "secret_hint": "····kqA=" },
    "generatedSecret": "whsec_..."
  }
  ```

  A create that supplies a secret returns nothing extra: the caller already holds it.

  **Action required for existing beta users.**

  1. **Install `@10x-media/fields`.** It is a peer dependency, not a dependency: its admin components are import-map paths into `@10x-media/fields/client` and `/rsc`, and under pnpm your app cannot import a transitive dependency. You do not have to register the `fields()` plugin.

     ```bash
     pnpm add @10x-media/fields
     ```

  2. **Run the schema migration first, on every SQL adapter.** This release adds `previous_secret`, `previous_secret_expires_at`, and `secret_hint` to the subscriptions collection (`secret_set` is a virtual field and has no column). On MongoDB that is free. It also adds `subscription_source` to the deliveries collection. On Postgres, SQLite, and Vercel Postgres those are new columns, and the adoption utility in step 4 writes into them:

     ```bash
     pnpm payload migrate:create add-webhook-secret-columns
     pnpm payload migrate
     ```

  3. Update every receiver to the new headers and signature scheme before deploying. See [Signing](https://docs.10xmedia.de/webhooks/signing).

  4. Run the adoption utility once to seal subscriptions created before this release. **Do this as part of the deploy**: until a legacy secret is migrated or rotated it cannot be recovered, so those subscriptions' deliveries fail (marked `dead`, with an error logged) rather than being sent unsigned.

     ```ts
     import { encryptExistingSecrets } from "@10x-media/webhooks";

     const report = await encryptExistingSecrets(payload, { dryRun: true });
     ```

     Drop `dryRun` to write. It is idempotent. A legacy 48-character hex secret keeps its characters and gains the `whsec_` prefix, so the value you already hold stays usable; anything that cannot be normalized is reported by row id **and field**, and needs a rotation. A row's other secret field still migrates, so one unusable value does not leave a recoverable one in plaintext. The report also counts rows carrying no secret separately (`noSecret`) from rows already sealed.

  5. Code-subscription secrets must be in `whsec_<base64>` form. A malformed one now throws at config build, naming the subscription.

  **Operational note.** With no `secretEncryption.keys` configured the encryption key derives from `PAYLOAD_SECRET`, so changing `PAYLOAD_SECRET` makes every stored webhook secret unreadable and those deliveries **fail** rather than going out unsigned. Pin your current key in the ring first and the dependency goes away; it is one config line instead of a capture-and-restore script. [Security](https://docs.10xmedia.de/webhooks/security) documents that, key rotation, and the recovery path when the key is already gone.

## 0.1.0-beta.4

### Minor Changes

- More built-in locales for the `webhooks:` strings.

  - Added: `de`, `es`, `fr`, `id`, `pt`, `ru`, `zh`, `uk`, `ar`, `ko`. Every key is covered in each.

## 0.1.0-beta.3

### Patch Changes

- Correct `payload` and `@payloadcms/ui` peer ranges to `^3.83.0`. The plugin uses `definePlugin`, which shipped in Payload 3.83.0, so 3.82.x installs satisfied the old range but failed at import.

## 0.1.0-beta.2

### Patch Changes

- `transform` now also applies to `previousData` on update deliveries, closing a gap where the prior document shipped unredacted when `includePreviousData` and a redacting `transform` were combined. The transform args gain a `target` field (`'data'` or `'previousData'`) naming the slot being built; on the `previousData` call `doc` is the prior document. Existing transforms need no change and now redact both slots.

  Redelivery (and queued delivery attempts) short-circuit to a `dead` row when the subscription has been disabled, matching the dispatch path. Docs now state that redelivery targets the subscription's current URL.

- Redelivered delivery rows now store the subscription's current URL as `endpoint` instead of the stale URL captured on the original delivery. The subscription is resolved before the new row is created (in both queue and inline modes), so `endpoint` reflects where the retry actually targets. Missing and disabled subscriptions still dead-row without sending; a missing subscription falls back to the original endpoint, while a disabled one stores its live URL.

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
