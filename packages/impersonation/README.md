![Banner](./assets/banner.jpg)

# @10x-media/impersonation

Let an authorised account sign in as another user without their password, then return. Every session is recorded. After start, `req.user` is the target.

[![npm](https://img.shields.io/npm/v/@10x-media/impersonation?style=flat-square)](https://www.npmjs.com/package/@10x-media/impersonation)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> [!WARNING]
> **Experimental.** This plugin mints and revokes sessions. That is not a place where a subtle bug announces itself. It is covered by unit, integration and end-to-end tests against Payload's real routing on Mongo and Postgres, but auth surfaces differ a lot between projects. Try it in staging first, and [report anything that looks off](https://github.com/10x-media/payload-plugins/issues).

## Quick start

```bash
pnpm add @10x-media/impersonation
```

```ts
import { impersonation } from '@10x-media/impersonation'

export default buildConfig({
  plugins: [
    impersonation({
      access: {
        impersonate: ({ req }) => req.user?.roles?.includes('admin') === true,
      },
    }),
  ],
})
```

`access.impersonate` is required. Only the literal `true` allows.

The admin header gets **Switch to user**, which opens a Payload drawer, then the native confirmation modal. While impersonating, a bar on every admin route (including `/admin/unauthorized`) shows **Acting as** and **Return to**.

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/impersonation):

- [Overview](https://docs.10xmedia.de/impersonation)
- [Quick start](https://docs.10xmedia.de/impersonation/quick-start)
- [Configuration](https://docs.10xmedia.de/impersonation/configuration)
- [Security](https://docs.10xmedia.de/impersonation/security)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
