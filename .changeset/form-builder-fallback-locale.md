---
"@10x-media/form-builder": minor
---

A per-form fallback locale, shared recipient lists by default, and no more blank emails.

- **Breaking: the email recipient lists are no longer localized by default.** `to`, `cc`, `bcc`, and `replyTo` on `emailTeam` and `confirmation` used to hold a separate list per locale, so a locale the editor never filled in had no recipient and failed `emailTeam` outright. They are now shared across locales. To keep per-locale routing, set `email.localizeRecipients: true` and nothing changes. To adopt the shared default, migrate the stored lists to a single value (typically the default locale's) the way you would for any Payload field that stops being localized.
- **`fallbackLocale`** chooses the fallback locale per form for every server-side read of it (validating a submission, running its actions, serving poll results), e.g. a tenant's own default locale instead of the config-wide one, or a forced fallback on a host with `localization.fallback: false`. Without it those reads fall back exactly like any Payload read, as your config says. It receives the form as already read, so a non-localized owner such as `form.tenant` needs no read of your own, and the form is read again only when the result differs from the fallback already applied.
- An email whose subject and body are both empty now fails its action with `empty subject and body` instead of being sent blank.
- The recipient fields, and the plugin's other custom selects, show Payload's localized badge when they are localized.
