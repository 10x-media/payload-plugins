---
"@10x-media/analytics": minor
"@10x-media/automations": minor
"@10x-media/form-builder": minor
"@10x-media/jobs": minor
"@10x-media/webhooks": minor
---

Add a typed `translations` option to every plugin factory and make translation keys a stable public API. Each plugin's `./i18n` subpath now exports the `keys` object, the `TranslationKey` union, and the `TranslationsOption` shape. Overrides are flat and per-locale: values win over the built-in locales key-by-key, locales a plugin does not ship are added whole, and app-level `i18n.translations` still wins over everything.

```ts
import { analytics } from '@10x-media/analytics'
import { keys } from '@10x-media/analytics/i18n'

analytics({
  adapters: [nativeAdapter()],
  translations: {
    de: { [keys.pluginName]: 'Analytik' },
  },
})
```

A typo'd key inside `translations` is a compile error.
