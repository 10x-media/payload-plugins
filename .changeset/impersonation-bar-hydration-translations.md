---
'@10x-media/impersonation': patch
---

The admin bar no longer throws a hydration error on page load: its session countdown appears once the bar has mounted. The bar's text, button labels and exit errors now take overrides from the `translations` option and from `i18n.translations`, as the plugin's other admin strings do.
