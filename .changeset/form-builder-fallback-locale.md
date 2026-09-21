---
"@10x-media/form-builder": minor
---

A per-form fallback locale, shared recipient lists by default, and no more blank emails.

- **Breaking: the email recipient lists are no longer localized by default.** `to`, `cc`, `bcc`, and `replyTo` on `emailTeam` and `confirmation` used to hold a separate list per locale, so a locale the editor never filled in had no recipient and failed `emailTeam` outright. They are now shared across locales. To keep per-locale routing, set `email.localizeRecipients: true` and nothing changes. To adopt the shared default, collapse each stored list to its default-locale value before relying on it. On MongoDB, where a localized list is stored as `{ en: [...], de: [...] }`, a migration like this does it:

  ```ts
  const forms = payload.db.collections.forms.collection
  for await (const form of forms.find({ 'actions.0': { $exists: true } })) {
    const actions = form.actions.map((action) => {
      for (const list of ['to', 'cc', 'bcc', 'replyTo']) {
        const value = action[list]
        if (value && typeof value === 'object' && !Array.isArray(value)) action[list] = value.en ?? []
      }
      return action
    })
    await forms.updateOne({ _id: form._id }, { $set: { actions } })
  }
  ```

  On Postgres the switch is a schema change: generate a migration with `payload migrate:create` and make sure each list keeps its default-locale rows.
- **`fallbackLocale`** chooses the fallback locale per form for every server-side read of it (validating a submission, running its actions, serving poll results), e.g. a tenant's own default locale instead of the config-wide one. It receives the form as already read, so a non-localized owner such as `form.tenant` needs no read of your own, and the form is read again only when the result differs from the fallback already applied.
- An email whose subject and body are both empty now fails its action with `empty subject and body` instead of being sent blank.
- The recipient fields, and the plugin's other custom selects, show Payload's localized badge when they are localized.
