# @10x-media/impersonation

## 4.0.0-alpha.4

### Minor Changes

- Add `inheritStrategies`. The target session takes over the impersonator's `req.user._strategy` when it is in the list, so a second-factor plugin such as `payload-totp` no longer denies every collection while impersonating. Start stores the strategy on the row as `impersonatorStrategy`. On Postgres, create a migration for the new column.

### Patch Changes

- The impersonation bar follows the admin language. It used to keep the language the session was started in.

  Closes #312

- The switcher, the document button and `useImpersonation().targetFilters` follow `access.filterTargets` right after login and after switching accounts in the same tab. Before, they kept the filters resolved on the signed-out login page until the next full reload, so a user the filter excludes still saw the switcher. The plugin now also registers a header component, `ImpersonationTargetsHeader`, that renders nothing visible. Upgrade: run `pnpm payload generate:importmap`, so the admin renders the header component.

## 4.0.0-alpha.3

### Patch Changes

- Requires Payload `4.0.0-beta.10`: the `payload` and `@payloadcms/*` peers are `^4.0.0-beta.10`, and the plugins are built and tested against it.

## 4.0.0-alpha.2

### Patch Changes

- The "Switch to user" drawer now opens on the full list every time. Before, a search typed into it filtered the list on the next open too, while the search input showed empty, so most accounts went missing with nothing on screen to explain why.

## 4.0.0-alpha.1

### Major Changes

- Payload 4 support, on Next.js and TanStack Start. `next` is no longer a peer: the admin components read cookies and headers through Payload 4's server adapter. On TanStack Start, where route components render on the client, the website banner is `getFrontendBanner` in a server function plus `ImpersonationFrontendBannerView` from `@10x-media/impersonation/client`; `ImpersonationFrontendBanner` stays the Next.js server component and renders the same view. The plugin's Local API reads and writes pass `overrideAccess: true`, since Payload 4 applies access there by default. The admin bar moved into Payload's `header` slot, above the nav and in the flow of the page, so it no longer covers Payload 4's bottom-pinned pagination; the collapsible, draggable chip and its `collapseBar` / `expandBar` translations are gone, and pages without the nav (`/admin/unauthorized`) keep a bottom bar. The bar, switcher and user card use Payload 4's tokens and buttons (`pill` and `ghost`, `ChevronIcon`, `NewTabIcon`), and the switcher uses Payload's list search and drawer. The sessions collection opts out of Payload 4's default versions. Parallel mode needs `@10x-media/dual-session` 4.x. Sessions from Payload 3 end with the upgrade; end open impersonation sessions before deploying to keep the audit trail exact. Plugin types take Payload 4's `User` type. Requires Payload `4.0.0-beta.7`. See Upgrading to Payload 4 in the docs.

## 0.1.0-beta.2

### Patch Changes

- The admin bar no longer throws a hydration error on page load: its session countdown appears once the bar has mounted. The bar's text, button labels and exit errors now take overrides from the `translations` option and from `i18n.translations`, as the plugin's other admin strings do.

## 0.1.0-beta.1

### Patch Changes

- The tenant selector is now a plain `cookies.clearOnSwitch` entry. Swap start and exit expire it, and `@payloadcms/plugin-multi-tenant` selects the tenant itself; the impersonator's selection is no longer restored on exit. Parallel leaves every `clearOnSwitch` cookie in place. The default is `payload-tenant` regardless of `cookiePrefix`, matching the name the multi-tenant plugin hardcodes. The `impersonatorTenantCookie` field is removed from `impersonation-sessions`, so Postgres installs get a dropped column in their next migration.

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
