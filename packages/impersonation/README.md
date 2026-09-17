# @10x-media/impersonation

Let an authorised account sign in as another user without their password, then return. Every session is recorded.

[![npm](https://img.shields.io/npm/v/@10x-media/impersonation?style=flat-square)](https://www.npmjs.com/package/@10x-media/impersonation)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

> [!WARNING]
> **Experimental.** This plugin will mint and revoke sessions. That is not a place where a subtle bug announces itself. The package is a scaffold today: installing it registers translations and the plugin slug, and adds no collections, endpoints, or UI. Do not use it in production until a release documents otherwise.

> Beta scaffold: this plugin currently returns the Payload config unchanged aside from translations.

## What exists today

- The `impersonation(options)` factory with `disabled` and `translations`.
- Standard subpath exports: `./types`, `./client`, `./i18n`.
- A host app under `dev/` with the collections the feature will need: `users` (admin + roles), `customers` (second local-auth), `partners` (isolated by `@10x-media/dual-session`), and `sso-users` (`disableLocalStrategy` + custom strategy).

## Quick start

```bash
pnpm add @10x-media/impersonation
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { impersonation } from '@10x-media/impersonation'

export default buildConfig({
  plugins: [impersonation({})],
})
```

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/impersonation):

- [Overview and status](https://docs.10xmedia.de/impersonation)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
