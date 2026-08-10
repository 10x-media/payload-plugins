---
'@10x-media/form-builder': minor
---

Add an `adapters` prop for host-owned effects on `<Form>`, `<Poll>`, and the captcha widgets. `adapters.navigate` replaces the post-submit `window.location` redirect so router-based hosts (Next.js App Router, TanStack Router, React Router) can transition in place; the plugin passes its intent (`{ replace: false }`) and never falls back to a hard navigation when the adapter is set. `adapters.voteStorage` overrides the poll voted-flag persistence (or disables it with `false` for hosts on the server-side `poll.votedCookie`). `adapters.loadScript` replaces the captcha vendor script injection for consent-gated or CSP-nonced loading, keeping the per-src cache and evict-on-failure retry. Every member is optional and defaults to the current behavior, so existing consumers are unaffected.
