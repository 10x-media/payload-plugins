---
'@10x-media/form-builder': minor
---

Collection slugs are now overridable. `overrides.forms.slug`, `overrides.formSubmissions.slug`, and `poll.votes.overrides.slug` rename the plugin's collections, and every internal path follows: the submissions relationship, the actions job and pruning, the vote tally's raw Mongo and Postgres writes, results and outcomes, `notAlreadySubmitted`, and the signed voted cookie. Two plugin collections sharing a slug is a boot error.

- `poll.cookiePrefix` renames the `fb-voted-{formId}` cookie (validated as a cookie-name token at boot). `hasVotedCookie` and `votedCookieName` take an optional `payload` to read it.
- `<Form collections={{ forms, formSubmissions }}>` points the browser transports at renamed collections; it reaches `<Poll>` and the registry form, and a custom `onSubmit` receives it as `input.collection`. `submitForm` and `fetchFormResults` accept `collection`.
- `collectionSlugsOf(payload)` returns the live slugs for host server code; `DEFAULT_COLLECTION_SLUGS` and the `FormBuilderCollectionSlugs` / `FormCollections` types are exported.

Behavioral change: a `slug` set on any of those overrides was previously accepted by the type and silently ignored. It is now honored, so a config that already carries one renames the collection on upgrade. Remove it to keep the default slug.
