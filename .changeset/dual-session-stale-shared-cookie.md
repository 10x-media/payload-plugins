---
'@10x-media/dual-session': minor
---

A token of an isolated session left in the shared `${cookiePrefix}-token` no longer authenticates anything. Before, core's `local-jwt`, last in the strategy chain and blind to scopes, went on honouring it in every scope: every browser that signed in on the website before the plugin was deployed was that website user in the admin panel too, which locked them out of `/admin` in a redirect loop. A GraphQL `login`, or a plugin calling `generatePayloadCookie`, produced the same state.

- **The shared cookie only authenticates sessions that belong there.** The plugin wraps `local-jwt` from `onInit`: when the shared cookie holds a token of a collection isolated whole, or of a user a role-split `isolate` predicate claims, the request is read as if that cookie were not there. An `Authorization` header and `autoLogin` behave as in core, and admin sessions are untouched.
- **`adminSessionPriority` on a role-split collection** now checks the predicate against the shared cookie's user, so a website user's old token there no longer passes for a live admin session and keeps their new isolated session standing down.
- **`createAuthScopeProxy({ clearStaleSharedCookie: { collections } })`**, opt-in: drops such a token from every request the proxy matches and expires it in the browser. `isStaleSharedToken` and `withoutCookie` are exported from `@10x-media/dual-session/proxy` for a proxy of your own.

**What changes for users:** isolated sessions from before the deploy end once, in every scope, and those users sign in again into their own cookie. The docs no longer claim they ended already; see [Sessions left in the shared cookie](https://docs.10xmedia.de/dual-session/limits#sessions-left-in-the-shared-cookie), and [Resolving the user in server code](https://docs.10xmedia.de/dual-session/custom-auth#resolving-the-user-in-server-code) for server actions and preview routes.
