![Banner](./assets/banner.jpg)

# @10x-media/dual-session

Give each Payload auth collection its own session cookie, so an admin session and a frontend session can coexist. Payload signs every collection's token into one config-wide `payload-token`, which means a customer logging in on your website overwrites the editor's admin session in the same browser, and back again. This plugin moves the collections you name onto cookies of their own.

[![npm](https://img.shields.io/npm/v/@10x-media/dual-session?style=flat-square)](https://www.npmjs.com/package/@10x-media/dual-session)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> [!WARNING]
> **Experimental.** This plugin changes how sessions are established, which is not a place where a subtle bug announces itself. It is covered by unit, integration and end-to-end tests against Payload's real routing on both Mongo and Postgres, but auth surfaces differ a lot between projects and yours may take a path none of those cover. Try it in staging first, and [report anything that looks off](https://github.com/10x-media/payload-plugins/issues).

## Features

- **One cookie per collection**: `payload-customers-token` alongside `payload-token`, so both sessions are live at once.
- **Core operations, not reimplementations**: the six cookie-writing auth endpoints are shadowed by replacements that delegate to the same Payload operations, so hooks, lockout, sessions and verification are unchanged.
- **A strategy that mirrors Payload's own**: same CSRF gate, same `verify` check, same session `sid` check — it just reads a different cookie.
- **Request attribution via an optional Next proxy**, so the admin panel and the website get different answers from the same REST URL.
- **Ranked frontend sessions**: list order decides which one wins when a visitor holds several.
- **Works with your own SSO**: declared strategies keep first refusal, and `generateIsolatedAuthCookie` is the one-line swap for `generatePayloadCookie` in a custom OAuth callback.
- **One collection with roles, too**: an `isolate` predicate splits a single `users` collection so editors keep the shared cookie and website visitors get their own.
- **The admin panel is left alone**: the collection behind `admin.user` keeps the shared cookie, byte for byte as core writes it.

## Before you install

If another auth plugin is already in the config — OAuth, magic links, passkeys, SSO, 2FA — check it first. This plugin owns a collection's auth endpoints and decides where its cookie is written, so anything that writes the session cookie itself or declares its own `/login` on the same collection conflicts, silently. Plugins that only read `req.user` or add a strategy compose fine. [Other plugins that touch auth](https://docs.10xmedia.de/dual-session/limits#other-plugins-that-touch-auth) has the two-minute check and the ways out.

## Quick start

```bash
pnpm add @10x-media/dual-session@beta
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { dualSession } from '@10x-media/dual-session'

export default buildConfig({
  admin: { user: 'users' },
  collections: [users, customers],
  plugins: [dualSession({ collections: ['customers'] })],
})
```

```ts
// proxy.ts (middleware.ts on Next 15)
import { createAuthScopeProxy } from '@10x-media/dual-session/proxy'

export default createAuthScopeProxy()

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

The matcher must cover `/api`; the widely copied default excludes it, which leaves every REST call unattributed.

If editors and website visitors are one collection told apart by a `roles` field, split it by user instead of by collection:

```ts
dualSession({
  collections: [{ slug: 'users', isolate: (user) => !checkRole(['admin', 'editor'], user) }],
})
```

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/dual-session):

- [Overview](https://docs.10xmedia.de/dual-session)
- [Quick start](https://docs.10xmedia.de/dual-session/quick-start)
- [One collection, two sessions](https://docs.10xmedia.de/dual-session/role-split)
- [Scopes](https://docs.10xmedia.de/dual-session/scopes)
- [Frontends and clients](https://docs.10xmedia.de/dual-session/clients)
- [Custom auth](https://docs.10xmedia.de/dual-session/custom-auth)
- [Configuration](https://docs.10xmedia.de/dual-session/configuration)
- [Limits](https://docs.10xmedia.de/dual-session/limits)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
