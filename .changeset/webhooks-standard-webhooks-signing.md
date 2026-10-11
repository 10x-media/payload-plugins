---
'@10x-media/webhooks': minor
---

**Breaking.** Delivery signing now follows [Standard Webhooks](https://www.standardwebhooks.com/), so receivers can verify with an off-the-shelf library instead of a bespoke scheme. Secrets are stored write-only and encrypted at rest through `@10x-media/fields`, and can be rotated in place. Every receiver needs updating; there is no dual-header deprecation window, because the package is still in beta and maintaining two incompatible signing schemes would be worse than one clean break.

- **New signature format**: HMAC-SHA256 over `${id}.${timestamp}.${body}`, base64 encoded. The previous scheme signed `${timestamp}.${body}` and emitted hex.
- **New headers**: `webhook-id`, `webhook-timestamp`, and `webhook-signature` (`v1,<base64>`). The old `X-Webhook-Id`, `X-Webhook-Timestamp`, and `X-Webhook-Signature` headers are **removed**, not deprecated. `X-Webhook-Event` is unchanged.
- **`webhook-id` is an opaque `msg_<delivery-id>`** rather than the delivery row's primary key. On a SQL adapter that key is a sequential integer, so consecutive deliveries would publish this install's volume to every receiver, and a small integer makes a poor dedupe key for anyone consuming webhooks from more than one source. It is covered by the MAC and stable across retries. The body's `id` is the same string, so the row id leaves through neither; a redelivery carries its own.
- **New secret format**: `whsec_<base64>`, 32 random bytes for generated secrets. The `whsec_` prefix is stripped and the remainder **base64-decoded** to derive the HMAC key, matching the reference verifier. Signing with the undecoded string would produce signatures no Standard Webhooks library accepts.
- **Secrets are write-only and encrypted at rest**: stored as AES-256-GCM sealed values (authentication tag, key id, HKDF-derived keys) via `encryptedField` from `@10x-media/fields`, and stripped from every read result. A read carries `secret_set` and `secret_hint` (the last six characters) instead.
- **Secret rotation**: `POST /api/<subscriptions>/:id/rotate-secret` and a **Rotate secret** button. During the configurable grace period (`secretRotation.graceSeconds`, default 24h) deliveries carry both signatures, space separated, so receivers can switch over without dropping events. The retired secret stops signing the moment the window lapses.
- **`secretEncryption.keys`**: a key ring passed straight through to `@10x-media/fields`. Every configured key decrypts, the active one seals, and `rotateEncryptedFields()` re-seals the signing secrets. It does not reach custom header values, which sit inside an array: re-save those subscriptions before dropping an old key. With no keys configured the key derives from `PAYLOAD_SECRET`, exactly as before.
- **Key rings are resolved at boot.** A misconfigured `secretEncryption.keys` now fails startup instead of surfacing as a refused delivery on the first webhook. This matters most for a key *provider* (a KMS fetch, an env read): literal material is checked when the config is built, but a provider is only called when the ring resolves.
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
- **Unrecoverable secrets fail the delivery**, with a message naming the fix: a key missing from the ring, a value no key authenticates, and a row that predates encryption at rest are three different errors. The last is decided by the seal rather than the value's shape, so a plaintext value is refused even when it is already a well-formed `whsec_` secret. A subscription that is meant to be signed is never downgraded to an unsigned POST. Subscriptions with no secret continue to deliver unsigned as before. An unreadable *retired* secret inside an open rotation window is dropped instead, with a warning: the delivery still goes out signed with the current secret, and only the rotation overlap is lost.
- **`previousSecret` is internal**: the rotation fields reject writes from ordinary REST and GraphQL creates and updates, so only rotation and the adoption utility can set them.
- **Rotation is access-checked and bounded**: the endpoint runs the subscriptions collection's configured `update` access for the target document rather than accepting any logged-in user, validates the request body, caps `graceSeconds` at 30 days, and runs its read-modify-write in a transaction (asking a SQL adapter for `repeatable read`) so concurrent rotations cannot hand a caller a secret that never signs. A concurrent rotation returns 409 and an id that does not exist returns 404. Only the most recently retired secret is kept.
- **The Signing secret field is create-only.** The encrypted field's own Replace and Generate actions do not consult Payload's `readOnly`, so on an existing document they would be live controls over a write that field access drops: an operator could type a new secret, save, see no error, and still be signing with the old one. Rotation is the only way to change a stored secret, and **Rotate secret** is its one control.
- **Rotation UI**: a themed confirmation dialog and a reveal dialog with a copy button and an explicit acknowledgement, instead of `window.confirm` and a toast. The reveal cannot be dismissed with Escape or a click outside, since it holds the only copy of the new secret. The button no longer renders for a user the collection's update access denies, and the document refreshes after a rotation so the new grace window is visible.
- **Document actions sit beside Save.** Rotate secret and Redeliver moved out of the form into the document controls, and Redeliver now confirms first: a redelivery goes out under a fresh `webhook-id`, so a receiver that dedupes on the id processes it again.
- **The secret hint is visible on an existing subscription**, as a read-only Signing secret field, so the edit view says which key it holds. The hint cannot be rewritten through the API.
- **Subscription form layout**: Name and Endpoint URL share a row, header name and value share a row, and Enabled sits in the sidebar. The rows are unnamed, so the schema and stored data are unchanged.

**The create response contract changed.** `secret` is stripped from every read, the create response included, so reading it off a create no longer works. A create with no secret returns the generated one under `generatedSecret`:

```json
{ "doc": { "secret_set": true, "secret_hint": "····kqA=" }, "generatedSecret": "whsec_..." }
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
   import { encryptExistingSecrets } from '@10x-media/webhooks'

   const report = await encryptExistingSecrets(payload, { dryRun: true })
   ```

   Drop `dryRun` to write. It is idempotent. A legacy 48-character hex secret keeps its characters and gains the `whsec_` prefix, so the value you already hold stays usable; anything that cannot be normalized is reported by row id **and field**, and needs a rotation. A row's other secret field still migrates, so one unusable value does not leave a recoverable one in plaintext. The report also counts rows carrying no secret separately (`noSecret`) from rows already sealed.

5. Code-subscription secrets must be in `whsec_<base64>` form. A malformed one now throws at config build, naming the subscription.

**Operational note.** With no `secretEncryption.keys` configured the encryption key derives from `PAYLOAD_SECRET`, so changing `PAYLOAD_SECRET` makes every stored webhook secret unreadable and those deliveries **fail** rather than going out unsigned. Pin your current key in the ring first and the dependency goes away; it is one config line instead of a capture-and-restore script. [Security](https://docs.10xmedia.de/webhooks/security) documents that, key rotation, and the recovery path when the key is already gone.
