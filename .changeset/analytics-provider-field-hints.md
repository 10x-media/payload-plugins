---
"@10x-media/analytics": patch
---

**Fixed: provider fields say what to paste and where to find it.** PostHog's **Project ID**, **API key** (a personal `phx_...` key with the Query Read scope) and **Region**, Plausible's **API key** (a Stats API key), GA4's **Project ID**, **Client email** (added as a Viewer on the property) and **Measurement ID** have help text, and every **Host** says it is only for a self-hosted instance. **Region** says it is required when **Host** is blank, and the form's description says that changing the Host, an ID or the Region of a saved entry clears its keys. All 11 locales.
