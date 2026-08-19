# @10x-media/dual-session

## 0.1.0-beta.0

### Minor Changes

- Initial beta of `@10x-media/dual-session`: give each Payload auth collection its own session cookie, so an admin session and a frontend session can live in one browser at once.

  Payload signs every collection's token into a single config-wide `${cookiePrefix}-token`, so a customer logging in on the website overwrites the editor's admin session, and logging into the admin panel logs them out of the website. This plugin moves the collections you name onto cookies of their own.

  - **Shadowed endpoints**: the six auth routes that write a cookie (`/login`, `/logout`, `/refresh-token`, `/me`, `/reset-password`, `/first-register`) are replaced by handlers that delegate to the same core operations, so hooks, lockout, sessions and verification are unchanged and only the cookie name differs. Endpoints that never touch a cookie are left alone.
  - **A strategy that mirrors core's**: same CSRF gate, same `verify` check, same session `sid` check, reading the isolated cookie instead of the shared one. It stands down for an `Authorization` header, so `jwtOrder` and API keys keep the precedence core gives them.
  - **Auth scopes**: an optional Next proxy (`@10x-media/dual-session/proxy`) stamps each request with the session it may authenticate against, resolved from the admin route and the `Referer`/`Sec-Fetch-Site` pair, so the admin panel and the website get different answers from the same REST URL. Without it, `adminSessionPriority` keeps the admin panel reachable.
  - **Ranked sessions**: list order decides which isolated collection wins when a visitor holds several at once, independently of config order.
  - **Per-collection cookie names**, and `disabled` for opting out per environment.
  - **Custom auth**: declared strategies keep first refusal, and `generateIsolatedAuthCookie` is the one-line replacement for `generatePayloadCookie` in an OAuth callback or server action. `resolveIsolatedCookieName` answers with the name alone.
  - **The admin panel is untouched**: the collection behind `admin.user` keeps the shared cookie, written byte for byte as core writes it.

  Requires Payload `^3.83.0`. Next is optional and only needed for the proxy.

- Support one auth collection with roles backing both sessions, via an `isolate` predicate.

  A collection entry now accepts `isolate: (user) => boolean`, which decides per user rather than per collection which cookie a session lands in. Users it returns `false` for keep the shared `${cookiePrefix}-token`, so projects with a single `users` collection gated by `access.admin` can hold an editor's admin session and a website visitor's session in one browser. This is also the only way to list the collection named by `admin.user`: listing it without a predicate still throws, and giving that entry the `admin` scope now throws too, because an isolated cookie answering admin-scoped requests would outrank the admin's own session.

  The shared cookie the plugin writes for a non-isolated user is the same string `generatePayloadCookie` produces, so the admin half is core behaviour untouched. All six shadowed endpoints resolve the cookie from the user in front of them, except `first-register`, which always writes the shared cookie because the first user has no roles yet to classify. In development, a login routed to the isolated cookie for a user who would pass `access.admin` logs a warning, so a predicate that disagrees with the admin gate is not silent.

  `generateIsolatedAuthCookie` and `resolveIsolatedCookieName` take an optional `user`, required for a collection configured with `isolate`. They throw rather than guess which cookie to write.
