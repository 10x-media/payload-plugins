---
'@10x-media/admin-wiki': minor
'@10x-media/form-builder': minor
'@10x-media/webhooks': minor
---

The plugin takes an `order` option, so a host can move it when another plugin has to run on the other side of it, as content-lock already allowed. admin-wiki keeps `order: 1000` by default; lowering it lets a plugin on the default order see `wiki-pages` and `wiki-media` (a storage adapter, document-preview), at the cost of the config walk no longer seeing that plugin's collections and fields. form-builder keeps `50` and webhooks `10`.
