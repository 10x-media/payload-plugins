# @10x-media/sipgate

Payload v3 plugin for [sipgate](https://www.sipgate.de) telephony integration. Adds click-to-dial on any phone number field, live call management, call log syncing, and full contact/device/channel synchronization.

[![npm](https://img.shields.io/npm/v/@10x-media/sipgate?style=flat-square)](https://www.npmjs.com/package/@10x-media/sipgate)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Requirements

- Payload v3 (peer: `payload@^3.82.0`)
- React 19 (peer)
- A [sipgate](https://www.sipgate.de) account with API access

## Installation

```bash
pnpm add @10x-media/sipgate
# or
npm install @10x-media/sipgate
```

## Minimum setup

The only hard requirement is a set of sipgate credentials. Everything else is opt-in.

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { sipgate } from '@10x-media/sipgate'

export default buildConfig({
  plugins: [
    sipgate({
      sipgateCredentials: {
        username: process.env.SIPGATE_USERNAME,
        password: process.env.SIPGATE_PASSWORD,
      },
    }),
  ],
})
```

This registers the four sync collections (`sipgate-users`, `sipgate-devices`, `sipgate-channels`, `call-logs`) and all API endpoints. Use the **Sync** buttons inside each collection's list view to populate them from sipgate.

## Environment variables

Store credentials and any sensitive config in environment variables, never in source code.

```bash
# .env
SIPGATE_USERNAME=your@email.de
SIPGATE_PASSWORD=your-sipgate-password

# Optional: for single-user setups
SIPGATE_USER_EMAIL=your@email.de
```

```ts
sipgate({
  sipgateCredentials: {
    username: process.env.SIPGATE_USERNAME!,
    password: process.env.SIPGATE_PASSWORD!,
  },
  singleUser: process.env.SIPGATE_USER_EMAIL
    ? { email: process.env.SIPGATE_USER_EMAIL }
    : undefined,
})
```

## Startup sync (onInit)

Use `createSipgateOnInit` to perform a full sync every time the Payload server starts. The function syncs users, devices, and channels in the correct order and **prunes any Payload records that no longer exist in sipgate** — so deleted users, devices, or channels are automatically removed.

```ts
import { buildConfig } from 'payload'
import { sipgate, createSipgateOnInit } from '@10x-media/sipgate'

const credentials = {
  username: process.env.SIPGATE_USERNAME!,
  password: process.env.SIPGATE_PASSWORD!,
}

export default buildConfig({
  onInit: async (payload) => {
    await createSipgateOnInit(credentials)(payload)
  },
  plugins: [
    sipgate({ sipgateCredentials: credentials }),
  ],
})
```

Sync order is always users → devices → channels. Devices require users to be synced first since they are fetched per-user from the sipgate API.

## Click-to-dial on contact fields

Add `contactCollections` and `phoneNumberFields` to enable click-to-dial on any phone number field across your collections. The plugin wraps the specified fields with a custom UI that lets users pick a device and initiate a call with one click.

```ts
sipgate({
  sipgateCredentials: { ... },
  contactCollections: ['contacts', 'leads'],
  phoneNumberFields: ['phone', 'mobile'],
})
```

The device picker is automatically filtered to the devices belonging to the logged-in Payload user (matched via their linked sipgate account). Set `filterDevicesByUser: false` to show all devices to all users.

If the user is assigned to multiple sipgate channels (e.g. group lines), a channel selector appears in the dial drawer so they can choose which number the recipient sees. If no group channels are assigned, the user's personal channel is used automatically.

## Syncing sipgate data

The plugin registers three Payload collections that mirror sipgate's user, device, and channel data:

| Collection | Slug | Populated by |
|---|---|---|
| Sipgate Users | `sipgate-users` | Sync Users button |
| Sipgate Devices | `sipgate-devices` | Sync Devices button (requires Users synced first) |
| Sipgate Channels | `sipgate-channels` | Sync Channels button |

Sync buttons appear in each collection's list view toolbar. You can also trigger sync programmatically via the API:

```bash
# Sync all
curl -X POST /api/sipgate/sync \
  -H "Content-Type: application/json" \
  -d '{"type": "all"}'

# Sync specific entity
curl -X POST /api/sipgate/sync \
  -H "Content-Type: application/json" \
  -d '{"type": "users"}' # or "devices" | "channels"
```

Devices must be synced after users because device records are fetched per-user from the sipgate API (`GET /{userId}/devices`).

Personal channels are detected automatically during channel sync (a channel owned by and assigned to only one user) and stored as `defaultChannel` on the corresponding `sipgate-users` record. This is used as the fallback caller ID when dialing.

## Linking Payload users to sipgate users

Each `sipgate-users` record has a `payloadUser` relationship field. After syncing, manually link each sipgate user to their Payload account. This enables:

- Device and channel filtering per logged-in user in the dial UI
- Automatic fallback `deviceId` and `channelId` resolution when dialing

## Single-user mode

For setups where all Payload users share one sipgate identity (e.g. a single-operator CRM), use `singleUser`:

```ts
sipgate({
  sipgateCredentials: { ... },
  singleUser: { email: process.env.SIPGATE_USER_EMAIL! },
})
```

In single-user mode, `deviceId` and `channelId` are resolved from the sipgate user matching the configured email, regardless of who is logged in.

## Live call window

Add a floating call management window to the Payload admin UI:

```ts
sipgate({
  sipgateCredentials: { ... },
  enableLiveCallFloatingWindow: true,
})
```

The window polls active calls every 3 seconds and lets users answer incoming calls on a specific device, hold, record, and hang up.

Incoming calls are received via sipgate webhooks. Configure your sipgate account to POST to `/api/sipgate/webhooks`.

## Call activity dashboard widget

Add a recent call log widget to the Payload dashboard:

```ts
sipgate({
  sipgateCredentials: { ... },
  enableCallActivityWidget: true,
  syncCallLogs: true,
})
```

`syncCallLogs: true` registers a Payload job that periodically pulls call history from sipgate into the `call-logs` collection. Use Payload's jobs runner to execute it.

## Access control

By default, all API endpoints require an authenticated Payload session (`req.user != null`). The webhooks endpoint is always public (sipgate calls it from their servers).

Override per-endpoint or globally:

```ts
import type { SipgateAccess } from '@10x-media/sipgate'

const access: SipgateAccess = {
  // fallback for any endpoint not explicitly overridden
  default: (req) => req.user != null,

  // restrict dialing to users with a specific role
  dial: (req) => req.user?.role === 'agent',

  // allow sync only for admins
  sync: (req) => req.user?.roles?.includes('admin') ?? false,
}

sipgate({
  sipgateCredentials: { ... },
  access,
})
```

Available keys: `default`, `dial`, `rtcm`, `activeCall`, `devices`, `contacts`, `sync`.

## Custom Payload users collection

If your users are not in the default `users` collection:

```ts
sipgate({
  payloadUsersSlug: 'staff', // or an array: ['staff', 'admins']
})
```

## Overriding collections and endpoints

Every collection and endpoint the plugin registers can be customized via `overrides`. Overrides are deep-merged with the plugin defaults, so you only need to specify what you want to change.

```ts
sipgate({
  overrides: {
    // Add extra fields to the call-logs collection
    callLogs: {
      fields: [{ name: 'outcome', type: 'select', options: ['sale', 'no-answer'] }],
    },

    // Change the dial endpoint path
    sipgateDial: {
      path: '/telephony/dial',
    },

    // Restrict the webhooks handler to a specific method
    sipgateWebhooks: {
      method: 'post',
    },
  },
})
```

Available override keys: `callLogs`, `sipgateUsers`, `sipgateDevices`, `sipgateChannels`, `allActivityWidget`, `sipgateWebhooks`, `sipgateActiveCall`, `sipgateDial`, `sipgateRtcm`, `sipgateContacts`, `liveCallFloatingWindow`.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/sipgate/webhooks` | Receives sipgate events (`newCall`, `answer`, `hangup`, `dtmf`) |
| `POST` | `/api/sipgate/dial` | Initiates an outbound call |
| `GET` | `/api/sipgate/active-call` | Returns currently active calls from the KV store |
| `POST` | `/api/sipgate/rtcm` | Call control: `answer`, `hold`, `mute`, `recordings`, `hangup`, `transfer` |
| `GET` | `/api/sipgate/devices` | Returns devices for the current user |
| `GET` | `/api/sipgate/contacts` | Searches sipgate contacts |
| `POST` | `/api/sipgate/sync` | Triggers data sync (`users`, `devices`, `channels`, or `all`) |

## Full example

```ts
import { buildConfig } from 'payload'
import { sipgate } from '@10x-media/sipgate'

export default buildConfig({
  collections: [
    {
      slug: 'contacts',
      fields: [
        { name: 'name', type: 'text' },
        { name: 'phone', type: 'text' },
      ],
    },
  ],
  plugins: [
    sipgate({
      sipgateCredentials: {
        username: process.env.SIPGATE_USERNAME!,
        password: process.env.SIPGATE_PASSWORD!,
      },
      contactCollections: ['contacts'],
      phoneNumberFields: ['phone'],
      payloadUsersSlug: 'users',
      filterDevicesByUser: true,
      enableLiveCallFloatingWindow: true,
      enableCallActivityWidget: true,
      syncCallLogs: true,
    }),
  ],
})
```

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
