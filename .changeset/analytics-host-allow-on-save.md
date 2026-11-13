---
"@10x-media/analytics": minor
---

**Behavioral: a provider document's Host outside `providers.hosts.allow` is refused on save.** The form saved an address the plugin then refused to call. The **Host** field now says the site does not allow the address. A document saved before keeps reading as refused, and its next save is refused until the Host is changed or allowed. Upgrade: check the Host of every provider document against `providers.hosts.allow`.
