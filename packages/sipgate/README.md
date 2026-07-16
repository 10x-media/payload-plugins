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
        authType: 'pat',
        tokenId: process.env.SIPGATE_TOKEN_ID!,
        token: process.env.SIPGATE_TOKEN!,
      },
    }),
  ],
})
```

This registers four collections (`sipgate-users`, `sipgate-devices`, `sipgate-channels`, `call-logs`) and all API endpoints. Use the **Sync** buttons inside each collection's list view to populate them from sipgate.

## Authentication modes

The plugin supports two authentication modes: Personal Access Token (PAT) and OAuth2.

### Personal Access Token (PAT)

PAT is the default mode. All API calls are made on behalf of one sipgate account using a token ID and token generated in the sipgate console.

```bash
# .env
SIPGATE_TOKEN_ID=your-token-id
SIPGATE_TOKEN=your-token

# Optional: for single-user setups
SIPGATE_USER_EMAIL=your@email.de
```

```ts
sipgate({
  sipgateCredentials: {
    authType: 'pat',
    tokenId: process.env.SIPGATE_TOKEN_ID!,
    token: process.env.SIPGATE_TOKEN!,
  },
  singleUser: process.env.SIPGATE_USER_EMAIL
    ? { email: process.env.SIPGATE_USER_EMAIL }
    : undefined,
})
```

### OAuth2 (per-user authentication)

OAuth2 lets each Payload user connect their own sipgate account. Tokens are stored per user in the `sipgate-users` collection. Dialing, call logs, device lists, and sync are all scoped to the individual user.

**`webhookUrl` is required** when using OAuth2. The plugin builds the OAuth2 `redirect_uri` as `${webhookUrl}/api/sipgate/oauth/callback`, so it must be the public base URL of your Payload instance and be reachable by sipgate (not `localhost`). Without it, the plugin throws at startup. `serverURL` is only used to build the post-callback admin redirect (where the browser lands after connecting).

```ts
// payload.config.ts
export default buildConfig({
  serverURL: process.env.SITE_URL!, // used for the post-connect admin redirect
  plugins: [
    sipgate({
      webhookUrl: process.env.SITE_URL!, // required for OAuth2 — builds the redirect_uri
      sipgateCredentials: {
        authType: 'oauth2',
        clientId: process.env.SIPGATE_CLIENT_ID!,
        clientSecret: process.env.SIPGATE_CLIENT_SECRET!,
        realm: 'third-party', // or 'sipgate-apps' — check your sipgate console
      },
      syncCallLogs: true,
    }),
  ],
})
```

```bash
# .env
SITE_URL=https://your-app.example.com
SIPGATE_CLIENT_ID=your-oauth2-client-id
SIPGATE_CLIENT_SECRET=your-oauth2-client-secret
```

**Prerequisites:**

- `webhookUrl` must be set on the plugin options (the plugin uses it to build the OAuth2 `redirect_uri`). It must be publicly reachable by sipgate.
- `payloadUsersSlug` must be set to the slug(s) of your Payload auth collection(s). The plugin injects the **Connect Sipgate** button into those collections' document edit views, so users can link their Sipgate account directly from their own profile page.

**Setup steps:**

1. Create an OAuth2 client in the [sipgate console](https://console.sipgate.com). Set the redirect URI to `{webhookUrl}/api/sipgate/oauth/callback`.
2. Configure the plugin with `authType: 'oauth2'`, the client credentials, `webhookUrl`, and `payloadUsersSlug` matching your auth collection.
3. Set `serverURL` to your app's public URL so the post-connect admin redirect lands in the right place.
4. Each Payload user opens their own profile in the admin and clicks the **Connect Sipgate** button (also visible in the admin navigation). They follow the Sipgate login flow.
5. After connecting, devices and channels are synced automatically for that user.

**OAuth2 scopes:**

By default the plugin requests `['all']`, which grants full access. You can restrict this via `scopes`:

```ts
sipgateCredentials: {
  authType: 'oauth2',
  clientId: '...',
  clientSecret: '...',
  scopes: ['balance:read', 'history:read', 'calls:write'],
}
```

Make sure the scopes you request are enabled for your OAuth2 client in the sipgate console.

**Shared Sipgate accounts (multiple Payload users, one Sipgate account):**

By default each Sipgate account can only be linked to one Payload user. A second user trying to connect the same account receives a clear error message. To allow multiple Payload users to share a single Sipgate account, set `allowSharedSipgateAccount: true`:

```ts
sipgate({
  sipgateCredentials: { authType: 'oauth2', ... },
  allowSharedSipgateAccount: true,
})
```

When this option is enabled, the plugin removes the unique constraint from the sipgate user ID field in the `sipgate-users` collection. **If you are enabling this on an existing database, you must also drop the old unique index manually:**

- **MongoDB:** Open MongoDB Compass, navigate to the `sipgate-users` collection, go to the Indexes tab, and **drop** the index on the `id` field (MongoDB does not allow editing index properties in-place; you must drop and let Payload recreate it without the unique constraint on the next startup).
- **PostgreSQL:** Create a Payload migration (`pnpm migrate:create <plugin> drop-sipgate-users-id-unique`) and drop the unique constraint in the migration file.

If you skip this step, the database will still enforce uniqueness even though the application no longer expects it, and the second user's connection attempt will fail with a generic database error.

## Startup sync (onInit)

Use `createSipgateOnInit` to perform a full sync every time the Payload server starts. The function syncs users, devices, and channels in the correct order and **prunes any Payload records that no longer exist in sipgate** — so deleted users, devices, or channels are automatically removed.

```ts
import { buildConfig } from 'payload'
import { sipgate, createSipgateOnInit } from '@10x-media/sipgate'

const credentials = {
  authType: 'pat' as const,
  tokenId: process.env.SIPGATE_TOKEN_ID!,
  token: process.env.SIPGATE_TOKEN!,
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
| Sipgate Users | `sipgate-users` | Sync Users button (PAT) / OAuth connect flow (OAuth2) |
| Sipgate Devices | `sipgate-devices` | Sync Devices button (PAT) / OAuth connect or sync (OAuth2) |
| Sipgate Channels | `sipgate-channels` | Sync Channels button (PAT) / OAuth connect or sync (OAuth2) |

**PAT mode** — Sync buttons appear in each collection's list view toolbar. Trigger programmatically:

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

**OAuth2 mode** — Devices and channels are synced automatically the moment a user completes the OAuth connect flow. You can also trigger a sync across all connected users:

```bash
curl -X POST /api/sipgate/sync \
  -H "Content-Type: application/json" \
  -d '{"type": "all"}' # or "devices" | "channels"
```

This iterates every `sipgate-users` record that has a stored access token and syncs that user's devices/channels using their own OAuth credentials.

Devices must be synced after users because device records are fetched per-user from the sipgate API (`GET /{userId}/devices`).

Personal channels are detected automatically during channel sync (a channel owned by and assigned to only one user) and stored as `defaultChannel` on the corresponding `sipgate-users` record. This is used as the fallback caller ID when dialing.

## Collection field reference

### `sipgate-users`

| Field | Type | Notes |
|---|---|---|
| `id` | text | Sipgate user ID (e.g. `w0`). Used as the Payload document ID. |
| `firstname` / `lastname` | text | |
| `email` | text | |
| `defaultDevice` | text | Sipgate device ID used for outbound calls |
| `defaultChannel` | text | Sipgate channel ID for caller ID. Set automatically during channel sync when a personal channel is detected. |
| `payloadUser` | relationship | Links to the Payload `users` collection. Set manually in PAT mode; set automatically in OAuth2 mode. |
| `accessToken` | text (hidden) | OAuth2 access token. Only present in OAuth2 mode. |
| `refreshToken` | text (hidden) | OAuth2 refresh token. Auto-refreshed on expiry. Only present in OAuth2 mode. |
| `tokenExpiresAt` | date | Access token expiry. Only present in OAuth2 mode. |

### `call-logs`

| Field | Type | Notes |
|---|---|---|
| `callId` | text (unique) | Sipgate call identifier |
| `callType` | select | `in` or `out` |
| `callStatus` | select | `ringing`, `connected`, `completed`, `missed`, `voicemail`, `rejected` |
| `callDuration` | number | Duration in seconds |
| `fromNumber` / `toNumber` | text | |
| `relatedContact` | relationship | Auto-resolved from `contactCollections` by phone number match |
| `sipgateUserId` | text | Sipgate user ID of the call owner. Populated in OAuth2 sync; empty in PAT mode. Used to scope the call activity widget and live call window to the current user. |
| `startedAt` | date | |

## Linking Payload users to sipgate users

**PAT mode:** Each `sipgate-users` record has a `payloadUser` relationship field. After syncing, manually link each sipgate user to their Payload account in the admin. This enables per-user device/channel filtering in the dial UI.

**OAuth2 mode:** The link is created automatically when the user completes the OAuth connect flow. No manual linking is required.

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

The window polls `GET /api/sipgate/active-call` every 3 seconds and lets users answer incoming calls on a specific device, hold, record, and hang up.

**User scoping:** When a Payload user has a linked sipgate account (via OAuth2 connect or manual `payloadUser` link in PAT mode), the endpoint filters active calls to only those involving their sipgate user ID. An authenticated user **without** a linked account sees an empty list rather than every user's active calls.

Incoming calls are received via sipgate webhooks. Configure your sipgate account to POST to `/api/sipgate/webhooks`.

> **Shared state:** Active calls, IVR sessions, OAuth CSRF nonces, and the contact cache are stored in Payload's KV. If you run more than one Payload instance, the KV backend must be shared (e.g. Redis). With the default in-memory KV, live-call state, OAuth connect, and IVR will not work reliably across replicas.

## Call activity dashboard widget

Add a recent call log widget to the Payload dashboard:

```ts
sipgate({
  sipgateCredentials: { ... },
  enableCallActivityWidget: true,
  syncCallLogs: true,
})
```

`syncCallLogs: true` only **registers** a Payload task; it does not schedule it. You must run it via Payload's jobs runner, for example with a `jobs.autoRun` cron in your config or an external scheduler that calls `payload.jobs.run()`.

**User scoping:** When a Payload user has a linked sipgate account, the widget shows only their calls. In PAT mode (or when no link exists), all call logs are shown. Note this differs from the live-call window, where an unlinked user sees an empty list.

**OAuth2 mode:** Call logs are fetched per user using each user's own access token. The `call-logs` collection stores a `sipgateUserId` field on each record to enable this filtering. In PAT mode, `sipgateUserId` is left empty and the widget shows everything.

## IVR (Interactive Voice Response)

Enable a menu-driven call flow (play a greeting, gather DTMF digits, branch to further steps) for incoming calls. When enabled, the plugin registers two collections and an endpoint:

- `ivr-voice-lines` (upload): the audio files played to callers. Read access is public so sipgate can fetch the audio URLs.
- `ivr-flows`: the flow definitions (entry step, steps, DTMF branches).
- `POST /api/sipgate/ivr`: sipgate posts DTMF input here; the plugin advances the caller through the flow.

```ts
sipgate({
  sipgateCredentials: { ... },
  webhookUrl: process.env.SITE_URL!, // required for IVR — builds the /api/sipgate/ivr callback
  ivr: true, // or { voiceLinesSlug: 'ivr-audio', flowsSlug: 'ivr-menus' } to customize slugs
})
```

`webhookUrl` is required when IVR is enabled (same rule as OAuth2): the plugin builds the IVR callback URL as `${webhookUrl}/api/sipgate/ivr`, so it must be publicly reachable by sipgate. IVR routing runs on the `answer` webhook event: the plugin matches the dialed number against an active flow's `phoneNumber` and plays the entry step. Each caller's position in the flow is stored in Payload's KV, keyed by call ID.

## Access control

By default, all API endpoints require an authenticated Payload session (`req.user != null`). The webhooks endpoint is always public (sipgate calls it from their servers).

The plugin's collections (`sipgate-users`, `sipgate-devices`, `sipgate-channels`, `call-logs`, and the IVR collections) default to requiring an authenticated Payload user for read/create/update/delete. The exception is `ivr-voice-lines`, whose `read` is public so sipgate can fetch audio. Override any collection's access via the matching `overrides` key.

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

Available override keys: `callLogs`, `sipgateUsers`, `sipgateDevices`, `sipgateChannels`, `ivrVoiceLines`, `ivrFlows`, `allActivityWidget`, `sipgateWebhooks`, `sipgateActiveCall`, `sipgateDial`, `sipgateRtcm`, `sipgateContacts`, `sipgateIvr`, `liveCallFloatingWindow`.

## API endpoints

| Method | Path | Mode | Description |
|---|---|---|---|
| `POST` | `/api/sipgate/webhooks` | both | Receives sipgate events (`newCall`, `answer`, `hangup`, `dtmf`) |
| `POST` | `/api/sipgate/dial` | both | Initiates an outbound call |
| `GET` | `/api/sipgate/active-call` | both | Returns active calls from the KV store, filtered to the current user's calls when a sipgate account is linked |
| `POST` | `/api/sipgate/rtcm` | both | Call control: `answer`, `hold`, `mute`, `recordings`, `hangup`, `transfer`. In OAuth2 mode, uses the current user's token. |
| `GET` | `/api/sipgate/devices` | both | Returns devices for the current user |
| `GET` | `/api/sipgate/contacts` | both | Searches sipgate contacts. In OAuth2 mode, uses the current user's token. |
| `POST` | `/api/sipgate/sync` | both | Triggers data sync. PAT: `users`, `devices`, `channels`, or `all`. OAuth2: `devices`, `channels`, or `all` (per connected user). |
| `GET` | `/api/sipgate/oauth/connect` | OAuth2 | Redirects the logged-in Payload user to sipgate's authorization screen |
| `GET` | `/api/sipgate/oauth/callback` | OAuth2 | Receives the authorization code from sipgate, exchanges it for tokens, and immediately syncs devices and channels |

## Full examples

### PAT mode

```ts
import { buildConfig } from 'payload'
import { sipgate, createSipgateOnInit } from '@10x-media/sipgate'

const credentials = {
  authType: 'pat' as const,
  tokenId: process.env.SIPGATE_TOKEN_ID!,
  token: process.env.SIPGATE_TOKEN!,
}

export default buildConfig({
  onInit: async (payload) => {
    await createSipgateOnInit(credentials)(payload)
  },
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
      sipgateCredentials: credentials,
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

### OAuth2 mode

```ts
import { buildConfig } from 'payload'
import { sipgate } from '@10x-media/sipgate'

export default buildConfig({
  serverURL: process.env.SITE_URL!, // used for the post-connect admin redirect
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
      webhookUrl: process.env.SITE_URL!, // required for OAuth2 — builds the redirect_uri
      sipgateCredentials: {
        authType: 'oauth2',
        clientId: process.env.SIPGATE_CLIENT_ID!,
        clientSecret: process.env.SIPGATE_CLIENT_SECRET!,
        realm: 'third-party',
      },
      contactCollections: ['contacts'],
      phoneNumberFields: ['phone'],
      payloadUsersSlug: 'users',
      enableCallActivityWidget: true,
      syncCallLogs: true, // uses per-user tokens
    }),
  ],
})
```

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
