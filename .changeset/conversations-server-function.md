---
'@10x-media/conversations': minor
---

`serverComponents: 'server-function'` renders server slot and message type components through the plugin's own server function (`conversationsServerFunctions` from `/rsc`, spread into `handleServerFunctions` in `app/(payload)/layout.tsx`) instead of the internal dashboard widget, which is then not registered. The default stays `'widget'`, which needs no wiring. The widget is no longer registered for the plugin's own slot components (reactions, attachments), which are client components, only for components you configure. Added to a dashboard by hand, it now says it is not for display and can be removed.
