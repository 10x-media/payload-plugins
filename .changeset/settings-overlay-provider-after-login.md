---
'@10x-media/settings-overlay': patch
---

Fix `useSettingsOverlay must be used inside the settings overlay provider` crashing the admin after signing in through the login form. The provider now mounts its context on the login screen too, and refreshes the layout when the signed-in user changes, so the rail is computed for the new reader instead of the previous one.
