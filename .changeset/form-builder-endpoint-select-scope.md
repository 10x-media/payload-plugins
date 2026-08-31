---
'@10x-media/form-builder': minor
---

The from-address and department selects now load their options while a form is still being created, instead of sitting empty until the first save. Both option sets are request-scoped (they depend on who is asking, not on the form document), so their endpoints now live at id-less paths (`GET /api/forms/from-addresses`, `GET /api/forms/departments`); the old `/:id/`-prefixed routes still answer on the same handlers for anything that hardcoded them. `EndpointOptionsSelect` and `RecipientsSelect` gain a `scope: 'document' | 'request'` clientProp (default `'document'`, unchanged behaviour) so a host field backed by its own request-scoped endpoint can opt into the same create-mode loading. Document-scoped selects (poll options, consent sources) are unaffected.
