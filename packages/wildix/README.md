# @10x-media/wildix

Payload v3 plugin for [Wildix](https://www.wildix.com) Unified Communications. Sibling to [`@10x-media/sipgate`](../sipgate): click-to-dial, live call control, device/user/queue sync, and call log history against the WMS admin REST API.

[![npm](https://img.shields.io/npm/v/@10x-media/wildix?style=flat-square)](https://www.npmjs.com/package/@10x-media/wildix)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Requirements

- Payload v3 (peer: `payload@^3.82.0`)
- React 19 (peer)
- A Wildix PBX with a WMS API key (`apiKey` mode) or an OAuth2 application (`oauth2` mode)

## Installation

```bash
pnpm add @10x-media/wildix
```

## Minimum setup (API key)

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { wildix } from '@10x-media/wildix'

export default buildConfig({
  plugins: [
    wildix({
      wildixCredentials: {
        authType: 'apiKey',
        pbxHost: process.env.WILDIX_PBX_HOST!, // e.g. mycompany.wildixin.com
        apiKey: process.env.WILDIX_API_KEY!,
      },
      syncCallLogs: true,
    }),
  ],
})
```

This registers `wildix-users`, `wildix-devices`, `wildix-channels`, and `call-logs`, plus the sync / dial / webhook endpoints. Use the **Sync** buttons in each collection's list view to pull data from the PBX.

## Authentication modes

### API key (server-to-server)

Shared Bearer token for the whole Payload instance. Create the key in WMS (PBX → Integrations → Server to Server / API keys).

```ts
wildix({
  wildixCredentials: {
    authType: 'apiKey',
    pbxHost: process.env.WILDIX_PBX_HOST!,
    apiKey: process.env.WILDIX_API_KEY!,
  },
})
```

### OAuth2 (per-user)

Each Payload user connects their own Wildix account. Tokens live on `wildix-users`. **`webhookUrl` is required**: the plugin builds `redirect_uri` as `${webhookUrl}/api/wildix/oauth/callback`.

```ts
wildix({
  webhookUrl: process.env.SITE_URL!,
  payloadUsersSlug: 'users',
  wildixCredentials: {
    authType: 'oauth2',
    pbxHost: process.env.WILDIX_PBX_HOST!,
    clientId: process.env.WILDIX_CLIENT_ID!,
    clientSecret: process.env.WILDIX_CLIENT_SECRET!,
  },
  syncCallLogs: true,
})
```

Register the same redirect URI on the OAuth2 application in WMS Settings → PBX → Integrations.

## Syncing Wildix data

| Collection | Slug | Source |
|---|---|---|
| Wildix Users | `wildix-users` | WMS colleagues (`GetPbxColleagues`) |
| Wildix Devices | `wildix-devices` | Hardware `GET /api/v1/Devices/` **plus** softphones `GET /api/v1/PBX/Users/Sip/Registrations` |
| Wildix Call Groups | `wildix-channels` | WMS call groups / queues |
| Call Logs | `call-logs` | WMS CallHistory (`/api/v1/User/{extension}/CallHistory/`, org fallback `/api/v1/PBX/CallHistory/`) |

Trigger via the admin Sync buttons or:

```bash
curl -X POST /api/wildix/sync \
  -H "Content-Type: application/json" \
  -d '{"type": "all"}'   # or users | devices | channels | call-logs
```

### Devices

`syncDevices` merges two WMS sources into `wildix-devices`, keyed by a stable `wildixId`:

- **Hardware** from `/api/v1/Devices/`: `wildixId` = device id, `contact` = MAC (or id), `online` from `state === 'on'`
- **Softphones** from `/api/v1/PBX/Users/Sip/Registrations`: `wildixId` = `sip:{extension}:{instance}`, `contact` = SIP URI (what dial sends as `deviceId`), `userAgent` from the registration `useragent`

Many cloud PBXs have an empty hardware inventory and only softphone (WebRTC / Zero Distance / x-bees) registrations. Sync Users first so devices can link by extension.

### Call logs

Call history uses the WMS CallHistory endpoints (not WDA). With `syncCallLogs: true`, the plugin registers a Payload job and the Sync Call Logs button. Per-user history is preferred when `wildix-users` have extensions; otherwise it falls back to org-wide history. Failures are counted per user and returned in the sync result (no 500 from a single bad extension).

`company` / `wdaEnv` on `wildixCredentials` are kept for config compatibility but are unused by call-log sync.

### Contact matching on call logs

When `contactCollections` and `phoneNumberFields` are set, `call-logs` gets a `relatedContact` relationship. On create/update, a `beforeChange` hook matches the remote number (outbound → `toNumber`, inbound → `fromNumber`) against those fields using phone-number variants (E.164, digits, `00…`).

```ts
wildix({
  wildixCredentials: { ... },
  contactCollections: ['contacts'],
  phoneNumberFields: ['phoneNumber'],
  syncCallLogs: true,
})
```

## Click-to-dial and live call UI

```ts
wildix({
  wildixCredentials: { ... },
  contactCollections: ['contacts'],
  phoneNumberFields: ['phoneNumber'],
  enableCallActivityWidget: true,
  enableLiveCallFloatingWindow: true,
  enableContactMatchUi: true,
})
```

Dial uses the WMS Call Control API and an optional SIP `deviceId` (`contact` on `wildix-devices`). Webhooks (`POST /api/wildix/webhooks`) drive the active-call store; set `webhookSecret` so `x-signature` HMAC is verified.

## Startup sync

```ts
import { wildix, createWildixOnInit } from '@10x-media/wildix'

const credentials = {
  authType: 'apiKey' as const,
  pbxHost: process.env.WILDIX_PBX_HOST!,
  apiKey: process.env.WILDIX_API_KEY!,
}

export default buildConfig({
  onInit: async (payload) => {
    await createWildixOnInit(credentials)(payload)
  },
  plugins: [wildix({ wildixCredentials: credentials })],
})
```

Order: users → devices (hardware + SIP) → channels, with prune.

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/wildix):

- [Overview](https://docs.10xmedia.de/wildix)
- [Quick start](https://docs.10xmedia.de/wildix/quick-start)
- [Sync](https://docs.10xmedia.de/wildix/sync)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
