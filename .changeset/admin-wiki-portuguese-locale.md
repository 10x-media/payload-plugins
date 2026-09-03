---
'@10x-media/admin-wiki': minor
---

Portuguese locale for the admin UI.

- **`pt` ships alongside `en` and `de`**: every admin-facing string the plugin renders (collection and field labels, the field help and drawer chrome, the target pickers, the wiki index and guide views, the callout variants, the edit-mode toggle, the video embed, and every empty state) now resolves in European Portuguese. Override any of it key by key through the `translations` option, as before.
- A parity test holds the locales together: each one must cover exactly the English key set, carry no blank strings, and keep every `{{placeholder}}` the English string uses.
