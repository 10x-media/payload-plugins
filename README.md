# @10x-media/payload-plugins

Open-source plugins for [Payload v3](https://payloadcms.com) maintained by [10x-media](https://github.com/10x-media).

## Packages

| Package | Description | Version |
|---|---|---|
| [@10x-media/automations](./packages/automations) | No-code automations and a jobs ops dashboard for Payload | [![npm](https://img.shields.io/npm/v/@10x-media/automations)](https://www.npmjs.com/package/@10x-media/automations) |

## Status

Beta. Packages publish as `*-beta.N` until 1.0. See [CHANGELOG entries](./packages/) per plugin.

## Contributing

This is a Turborepo using pnpm 10 (Node 22+, Docker for the Postgres and e2e test tiers). To get started:

```bash
pnpm install
pnpm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow and [CLAUDE.md](./CLAUDE.md) for the architecture overview.

## License

MIT
