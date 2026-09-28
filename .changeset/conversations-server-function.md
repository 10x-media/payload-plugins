---
'@10x-media/conversations': minor
---

`serverComponents: 'server-function'` renders server slot and message type components through the plugin's own server function (`conversationsServerFunctions` from `/rsc`, spread into `handleServerFunctions` in `app/(payload)/layout.tsx`) instead of the internal dashboard widget, which is then not registered. The default stays `'widget'`, which needs no wiring. The widget, added to a dashboard by hand, now says it is not for display and can be removed.
