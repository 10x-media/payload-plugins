---
'@10x-media/webhooks': minor
---

**Breaking.** Delivery signing now follows [Standard Webhooks](https://www.standardwebhooks.com/), so receivers can verify with an off-the-shelf library instead of a bespoke scheme. Secrets are encrypted at rest and can be rotated in place. Every receiver needs updating; there is no dual-header deprecation window, because the package is still in beta and maintaining two incompatible signing schemes would be worse than one clean break.

- **New signature format**: HMAC-SHA256 over `${id}.${timestamp}.${body}`, base64 encoded. The previous scheme signed `${timestamp}.${body}` and emitted hex.
- **New headers**: `webhook-id`, `webhook-timestamp`, and `webhook-signature` (`v1,<base64>`). The old `X-Webhook-Id`, `X-Webhook-Timestamp`, and `X-Webhook-Signature` headers are **removed**, not deprecated. `X-Webhook-Event` is unchanged.
- **New secret format**: `whsec_<base64>`, 32 random bytes for generated secrets. The `whsec_` prefix is stripped and the remainder **base64-decoded** to derive the HMAC key, matching the reference verifier. Signing with the undecoded string would produce signatures no Standard Webhooks library accepts.
- **Secrets encrypted at rest**: stored ciphertext via Payload's `encrypt`, keyed from `PAYLOAD_SECRET`. Reveal-once on create is unchanged from the caller's side, and normal reads stay masked.
- **Secret rotation**: `POST /api/<subscriptions>/:id/rotate-secret` and a **Rotate secret** button. During the configurable grace period (`secretRotation.graceSeconds`, default 24h) deliveries carry both signatures, space separated, so receivers can switch over without dropping events. The retired secret stops signing the moment the window lapses.
- **Customer-supplied secrets**: accepted on create and on rotation, normalized to exactly one `whsec_` prefix, and rejected when they are not base64 carrying at least 16 bytes. Malformed code-subscription secrets now fail at startup rather than at delivery.
- **Reserved headers**: a subscription's custom headers can no longer overwrite `webhook-id`, `webhook-timestamp`, `webhook-signature`, or `X-Webhook-Event`. Previously a custom header of the same name replaced the generated one, including the signature.
- **Unrecoverable secrets fail the delivery**: if a stored secret cannot be decrypted, the delivery row is marked `dead` with an explicit error and nothing is sent. A subscription that is meant to be signed is never downgraded to an unsigned POST, since receivers commonly verify only when a signature header is present. Subscriptions with no secret continue to deliver unsigned as before.
- **`previousSecret` is internal**: the rotation fields reject writes from ordinary REST and GraphQL creates and updates, so only rotation and the adoption utility can set them.
- **Rotation is access-checked and bounded**: the endpoint runs the subscriptions collection's configured `update` access for the target document rather than accepting any logged-in user, validates the request body, caps `graceSeconds` at 30 days, and runs its read-modify-write in a transaction so concurrent rotations cannot hand a caller a secret that never signs. Only the most recently retired secret is kept: rotating twice inside one window ends the first secret's grace period early.

**Action required for existing beta users.**

1. Update every receiver to the new headers and signature scheme before deploying. See [Signing](https://docs.10xmedia.de/webhooks/signing).
2. Run the adoption utility once to encrypt subscriptions created before this release. **Do this as part of the deploy**: until a legacy secret is migrated or rotated it cannot be decrypted, so those subscriptions' deliveries fail (marked `dead`, with an error logged) rather than being sent unsigned.

   ```ts
   import { encryptExistingSecrets } from '@10x-media/webhooks'

   const report = await encryptExistingSecrets(payload, { dryRun: true })
   ```

   Drop `dryRun` to write. It is idempotent. A legacy 48-character hex secret keeps its characters and gains the `whsec_` prefix, so the value you already hold stays usable; anything that cannot be normalized is reported by row id and needs a rotation.
3. Code-subscription secrets must be in `whsec_<base64>` form. A malformed one now throws at config build, naming the subscription.

**Operational note.** Stored secrets are encrypted with a key derived from `PAYLOAD_SECRET`. Changing `PAYLOAD_SECRET` without decrypting and re-encrypting first makes every stored webhook secret unreadable, and deliveries then go out unsigned with an error logged per subscription. [Security](https://docs.10xmedia.de/webhooks/security) documents the safe procedure in both directions and the recovery path.
