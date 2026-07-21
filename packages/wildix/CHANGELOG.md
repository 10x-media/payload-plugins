# @10x-media/wildix

## Unreleased

### Patch

- Device sync merges WMS hardware inventory (`GET /api/v1/Devices/`) with live softphones (`GET /api/v1/PBX/Users/Sip/Registrations`), keyed by a stable `wildixId` on `wildix-devices`. Softphone `contact` is the SIP URI used as dial `deviceId`.
- Call-log sync uses WMS CallHistory (`/api/v1/User/{extension}/CallHistory/`, org fallback `/api/v1/PBX/CallHistory/`) for both API-key and OAuth paths. `type: 'all'` includes call logs. WDA history is no longer used for sync (`company` / `wdaEnv` kept for compatibility).
- Sync fetch failures are counted per source/user instead of failing the endpoint with 500.
