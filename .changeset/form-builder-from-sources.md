---
'@10x-media/form-builder': minor
---

Add `email.fromSources`: senders resolved at send time, for hosts where the from-address is tenant identity rather than per-form configuration. A source stores a stable namespaced value (e.g. `tenant:default`) on the action and re-resolves the actual address on every send with the same run-time arguments a recipient source gets, so a tenant that changes its from-address changes it for every saved form at once. Sources appear in the existing From select ahead of the `fromAddresses` literals; literals keep today's behaviour exactly, including never touching a source at send.
