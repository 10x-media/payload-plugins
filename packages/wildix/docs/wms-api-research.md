# Wildix WMS API research

Reference for how the `@10x-media/wildix` plugin talks to a Wildix WMS PBX, which
paths are covered by the `@wildix/wms-api-client` SDK, which require raw `fetch`,
and what a real tenant (`airzoon.wildixin.com`) actually returns.

Verified against `@wildix/wms-api-client@1.2.2` and the `airzoon` PBX in API-key
mode (`Authorization: Bearer access_...`).

## Authentication

Two modes, both Bearer tokens on the PBX host (`https://<pbx>.wildixin.com`):

- **API key** (`authType: 'apiKey'`): a static key sent as `Authorization: Bearer <key>`. Scopes to the whole PBX (admin surface).
- **OAuth2** (`authType: 'oauth2'`): a per-user access token from the OAuth2 app, refreshed via `buildRefreshingTokenProvider`. Scopes to that user.

`GET /api/v1/personal/info` returns the identity behind the token and is used in
the OAuth callback to link a `wildix-users` doc to the Payload user.

## SDK command inventory (`@wildix/wms-api-client@1.2.2`)

Prefer the SDK wherever it wraps a path. The SDK omits the trailing slash the
public docs show; on `airzoon` this makes no difference (Call Control 404s either
way).

### Covered by the SDK (used by the plugin)

| Command | HTTP path | Plugin use |
|---|---|---|
| `GetPbxColleaguesCommand` | `GET /api/v1/PBX/Colleagues` | `syncUsers` |
| `GetPbxCallGroupsCommand` | `GET /api/v1/Dialplan/CallGroups` | `syncChannels` |
| `GetPersonalInfoCommand` | `GET /api/v1/personal/info` | OAuth callback identity |
| `CallControlMakeCallCommand` | `POST /api/v2/call-control/make-call` | dial (primary) |
| `CallControlAnswer/Hold/Unhold/Hangup/BlindTransfer/AttendantTransfer/Dtmf` | `POST /api/v2/call-control/*` | RTCM |
| `OriginateCommand` | `POST /api/v1/Originate` | dial fallback when Call Control is absent |
| `OriginateCallCommand` | `POST /api/v1/Originate/Call` | token-user dial (single-ext) |
| `ListUserDevicesCommand` | `GET /api/v2/call-control/list-devices?user=` | softphones only where Call Control exists |
| `ListUserActiveCallsCommand` | `GET /api/v2/call-control/list-calls?user=` | optional active-call poll |

Also present but unused: ACL groups, OAuth2 app CRUD, Departments, Groups,
Notifications, ReloadBroadcasts, Colleague create/delete, CallQueues settings.

### Not in the SDK (raw REST required)

| Endpoint | Why | Plugin helper |
|---|---|---|
| `GET /api/v1/Contacts/` | Phonebook for the Contact Match UI (65 rows on airzoon) | `fetchPbxContacts` (`wildixPbxRest`) |
| `GET /api/v1/Devices/` | Hardware inventory | `fetchPbxDevices` (`wildixPbxRest`) |
| `GET /api/v1/PBX/Users/Sip/Registrations` | Softphones when `list-devices` 404s | `fetchPbxSipRegistrations` (`wildixPbxRest`) |
| `GET /api/v1/PBX/CallHistory/` + `GET /api/v1/User/{ext}/CallHistory/` | Call log sync | `wildixPbxHistory` |
| `/api/v1/Dialplan/Ivr/` | IVR CRUD | out of scope |

## Verified `airzoon` curl matrix

| Method | Path | Result |
|---|---|---|
| GET | `/api/v1/personal/info` | 200 |
| GET | `/api/v1/PBX/Colleagues` | 200 |
| GET | `/api/v1/Dialplan/CallGroups` | 200 |
| GET | `/api/v1/Devices/` | 200 |
| GET | `/api/v1/PBX/Users/Sip/Registrations` | 200 |
| GET | `/api/v1/Contacts/` | 200 (`total: 65`) |
| GET | `/api/v1/PBX/CallHistory/` | 200 |
| GET | `/api/v2/call-control/list-devices?user=201` | 404 (route missing) |
| GET | `/api/v2/call-control/list-calls?user=201` | 404 (route missing) |
| POST | `/api/v2/call-control/make-call` | 404 (route missing) |
| POST | `/api/v1/Originate/` | 500 on empty body (route exists, needs params) |

## 404 semantics: route missing vs call missing

| Kind | When | Applies to |
|---|---|---|
| Call not found | Route exists; bad or expired `sipCallId` | hold / hangup / answer / dtmf / transfer |
| Route not found | WMS has no handler; body `{ type, reason: "404 Not Found", code: 404 }` | all `/api/v2/call-control/*` on airzoon |

`list-devices`, `list-calls`, and `make-call` need no existing call, so their 404s
on airzoon are the route missing, not a missing call. The entire Call Control v2
surface is disabled on this tenant. `Originate` works (returns 500 only because
the empty probe body lacks required params), so dial falls back to it.

## Plugin mapping

| File | Source | Notes |
|---|---|---|
| `syncUsers` (`wildixSyncHandlers`) | `GetPbxColleaguesCommand` | SDK |
| `syncChannels` (`wildixSyncHandlers`) | `GetPbxCallGroupsCommand` | SDK |
| `syncDevices` (`wildixSyncHandlers`) | `fetchPbxDevices` + `fetchPbxSipRegistrations` | raw REST, merged |
| `syncCallHistoryPbx` / `syncCallHistoryOAuth` | `wildixPbxHistory` | raw REST (`CallHistory`) |
| `wildixContactsHandler` | `fetchPbxContacts` | raw REST (`Contacts`); one entry per non-empty number |
| `wildixDialHandler` | `CallControlMakeCallCommand`, then `OriginateCommand` | SDK; Originate fallback on route-missing 404 |
| `wildixRtcmHandler` | `CallControl*` commands | SDK; clearer error when Call Control is absent |
| OAuth callback | `GetPersonalInfoCommand` | SDK |

## Out of scope

- IVR CRUD (`/api/v1/Dialplan/Ivr/`), documented only.
- Rewriting the working raw helpers (Devices, SIP, CallHistory) onto SDK commands that do not exist in this version.
- Building a parallel raw Call Control client to match the docs' trailing slash; the SDK already covers those routes where the tenant enables them.
