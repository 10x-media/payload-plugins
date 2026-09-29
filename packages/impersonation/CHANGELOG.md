# @10x-media/impersonation

## 0.1.0-beta.0

### Minor Changes

- Sessions collection accepts `collection.overrides`. `useImpersonation().targetFilters` is the filter map (the `targets` option is unchanged). `decorateRequests: false` still enforces `maxDuration`. The admin bar, switcher, and frontend banner pick up the review's layout and copy fixes.

- Show the sessions collection only when `ui.sessionsCollection` is on, hide End session on a closed row, and clear impersonation cookies when a session hits its absolute expiry.

- Replace the switcher row with your own card and end a session from the document controls.

- Initial beta of `@10x-media/impersonation`: an authorised account can sign in as another user without their password. After start, `req.user` is the target. Every session is a closed-never-deleted row. Exit, logout, or remote terminate ends it.

  - **Mandatory `access.impersonate`**: only the literal `true` allows. A Payload `Where` object is deny. Start also reads the target with `overrideAccess: false`.
  - **Minted target session**: `db.findOne` + `addSessionToUser` + `jwtSign` + cookie. Active means an open row whose `targetSid` matches `req.user._sid`, so Payload refresh cannot hide the bar.
  - **Plugin-owned origin gate** on cookie POSTs. JWT/Bearer skip it only when `jwtOrder` ranks that scheme before `cookie`.
  - **Swap or parallel**: parallel only when `@10x-media/dual-session` isolated the target. Hint cookie is never trusted alone.
  - **Admin UI**: Switch to user, Acting as bar (including `/admin/unauthorized`), document action, End session on the record.

  Requires Payload `^3.83.0`. Dual-session is an optional peer.

### Patch Changes

- Keep the impersonation bar beside the nav, and collapse it to a chip that snaps to the edges of the content area.

- Admin impersonation UI uses Payload's native drawer, confirmation modal, inputs, and theme tokens.

- Rebuild the Impersonate UI (Payload SearchFilter, compact Button margins, card drawer/document actions, pagination, nav-aware bar, countdown), always register the provider with `useImpersonation`, add `filterTargets`, a frontend banner, opt-in retention, and skip session lookups on ordinary traffic.

- Restore the impersonator's tenant cookie on exit, and set the target's when they belong to exactly one tenant.
