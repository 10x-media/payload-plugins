---
'@10x-media/wildix': patch
---

Fix device and call-log sync to use documented WMS admin REST endpoints instead of the SDK's `ListUserDevices` (404 on some PBXs) and the WDA history API (401 without a company key).

- **Devices**: `syncDevices` merges hardware from `GET /api/v1/Devices/` with live softphones from `GET /api/v1/PBX/Users/Sip/Registrations`, keyed by a new stable `wildixId` on `wildix-devices`. Hardware uses MAC (or device id) as `contact`; softphones use the SIP contact URI (what dial needs as `deviceId`). Each row links to its `wildix-users` doc by extension.
- **Call logs**: all sync paths (button, `type: 'all'`, jobs, OAuth) run against WMS CallHistory (`/api/v1/User/{extension}/CallHistory/`, falling back to `/api/v1/PBX/CallHistory/` when no linked extensions exist yet). OAuth sync uses each user's own access token. The WDA history path is retired from sync; `company` / `wdaEnv` options are kept for compatibility but unused.
- **Contacts**: the Contact Match UI directory now comes from the PBX phonebook (`GET /api/v1/Contacts/`, paginated) instead of colleagues, emitting one `{ name, phone }` per non-empty number field (phone, office, mobile, home, home_mobile, extension).
- **Dial**: `make-call` (Call Control) stays primary, with an AMI `Originate` fallback (`Local/{extension}@{dialplan}`) for PBXs where the `/api/v2/call-control/*` routes 404. In-call actions (answer, hold, transfer, hangup) return a clear "Call Control not available on this PBX" error where that surface is disabled.
- Fetch failures are counted per source/user and reported in the sync result instead of returning a 500.
- Added `docs/wms-api-research.md`: verified SDK command inventory, raw-REST gaps, and an endpoint matrix against a live PBX.
